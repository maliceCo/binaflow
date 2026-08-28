import { randomUUID } from 'node:crypto';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import {
  interactiveDecisionEffect,
  type InteractiveDecision,
  type ReviewDecision,
  type ReviewMessage,
  type ReviewThread,
} from '../core/interactive-review.js';
import { validateInteractiveTarget } from '../workflows/plan-build-qa-interactive.js';
import { resolveWorkflow } from '../workflows/catalog.js';
import type { WorkflowRun } from '../core/run.js';
import type { ApplicationInternals } from './context.js';

export interface ReviewThreadDetails {
  thread: ReviewThread;
  messages: ReviewMessage[];
  decisions: ReviewDecision[];
}

export interface ReviewView {
  runId: string;
  status: WorkflowRun['status'];
  threads: ReviewThreadDetails[];
}

export interface ReviewMessageRequest {
  runId: string;
  threadId: string;
  content: string;
}

export interface ReviewDecisionRequest {
  runId: string;
  threadId: string;
  target: ReviewThread['target'];
  decision: ReviewDecision['decision'];
  details?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export interface ReviewExplanationRequest {
  runId: string;
  threadId: string;
  target: ReviewThread['target'];
  evidence: string;
  signal?: AbortSignal;
}

export interface ReviewExplanation {
  explanation: ReviewMessage;
  review: ReviewView;
}

export type ReviewAdjudicationKind =
  'withdrawn' | 'confirmed' | 'reclassified' | 'needs-human-decision';

export interface ReviewAdjudicationRequest {
  runId: string;
  threadId: string;
  target: ReviewThread['target'];
  decision: ReviewAdjudicationKind;
  issue: string;
  evidence: string[];
  scope: string;
  clarification: string;
}

export interface ReviewFinalizeRequest {
  runId: string;
  threadId: string;
  target: ReviewThread['target'];
  details?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

type ReviewContext = Pick<
  ApplicationInternals,
  'config' | 'store' | 'artifacts' | 'reviewStore' | 'interactivePlanBuildQaCoordinator'
>;

export async function getReview(context: ReviewContext, runId: string): Promise<ReviewView> {
  const reviewStore = requireReviewStore(context);
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const threads = await reviewStore.listReviewThreads(runId);
  return {
    runId,
    status: run.status,
    threads: await Promise.all(
      threads.map(async (thread) => ({
        thread,
        messages: await reviewStore.getReviewMessages(thread.id),
        decisions: await reviewStore.getReviewDecisions(thread.id),
      })),
    ),
  };
}

export async function postReviewMessage(
  context: ReviewContext,
  request: ReviewMessageRequest,
): Promise<ReviewView> {
  const reviewStore = requireReviewStore(context);
  const thread = await requireThread(context, request.runId, request.threadId);
  const content = request.content.trim();
  if (!content) throw new Error('Review message must be non-empty');
  const messages = await reviewStore.getReviewMessages(thread.id);
  const now = new Date().toISOString();
  await reviewStore.saveReviewMessage({
    id: randomUUID(),
    threadId: thread.id,
    sequence: (messages[messages.length - 1]?.sequence ?? 0) + 1,
    role: 'user',
    content,
    generationStatus: 'sent',
    createdAt: now,
    updatedAt: now,
  });
  return getReview(context, request.runId);
}

export async function explainReview(
  context: ReviewContext,
  request: ReviewExplanationRequest,
): Promise<ReviewExplanation> {
  const reviewStore = requireReviewStore(context);
  const coordinator = context.interactivePlanBuildQaCoordinator;
  if (!coordinator) throw new Error('Interactive review coordinator is not configured');
  const thread = await requireThread(context, request.runId, request.threadId);
  if (thread.state !== 'waiting')
    throw new Error(`Review thread ${thread.id} is no longer waiting`);
  validateInteractiveTarget(request.target, targetIds(thread));
  if (request.target.kind !== thread.target.kind || request.target.id !== thread.target.id) {
    throw new Error(`Review target does not belong to thread ${thread.id}`);
  }
  const claimed = await context.store.claimRunForExecution(request.runId, ['waiting']);
  if (!claimed) throw new Error(`Run ${request.runId} is no longer waiting for review`);
  const now = new Date().toISOString();
  const messages = await reviewStore.getReviewMessages(thread.id);
  const question: ReviewMessage = {
    id: randomUUID(),
    threadId: thread.id,
    sequence: (messages[messages.length - 1]?.sequence ?? 0) + 1,
    role: 'user',
    content: `Explain ${request.target.kind}:${request.target.id}`,
    generationStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await reviewStore.saveReviewMessage(question);
  try {
    const input = await loadInput(context, claimed.run.id);
    const explanation = await coordinator.explain(
      claimed.run,
      thread,
      {
        objective: claimed.run.objective,
        input,
        profiles: context.config.profiles,
        runId: claimed.run.id,
        resume: true,
        executionClaim: claimed.claim,
        ...(request.signal ? { signal: request.signal } : {}),
      },
      request.evidence,
    );
    const answer = {
      ...explanation,
      sequence: question.sequence + 1,
    };
    await reviewStore.saveReviewMessage(answer);
    await context.store.releaseExecution(claimed.run.id);
    return { explanation: answer, review: await getReview(context, request.runId) };
  } catch (error) {
    await reviewStore
      .saveReviewMessage({
        ...question,
        generationStatus: 'failed',
        updatedAt: new Date().toISOString(),
      })
      .catch(() => undefined);
    await context.store.releaseExecution(request.runId).catch(() => undefined);
    await context.store.markRunInterrupted(request.runId).catch(() => undefined);
    throw error;
  }
}

export async function adjudicateReview(
  context: ReviewContext,
  request: ReviewAdjudicationRequest,
): Promise<ReviewView> {
  const reviewStore = requireReviewStore(context);
  const thread = await requireThread(context, request.runId, request.threadId);
  if (thread.phase !== 'qa' || request.target.kind !== 'finding') {
    throw new Error('QA adjudications require a finding target');
  }
  validateInteractiveTarget(request.target, targetIds(thread));
  if (request.target.id !== thread.target.id) {
    throw new Error(`Review target does not belong to thread ${thread.id}`);
  }
  const evidence = request.evidence.map((item) => item.trim()).filter(Boolean);
  if (!request.issue.trim() || !request.scope.trim() || !request.clarification.trim()) {
    throw new Error('Adjudication issue, scope, and clarification must be non-empty');
  }
  if (evidence.length === 0) throw new Error('Adjudication evidence must be non-empty');
  const previousThreads = await reviewStore.listReviewThreads(request.runId, 'qa');
  const previous = await Promise.all(
    previousThreads.map((candidate) => reviewStore.getReviewDecisions(candidate.id)),
  );
  const evidenceKey = JSON.stringify(evidence);
  if (
    previous
      .flat()
      .some(
        (decision) =>
          isAdjudication(decision.decision) &&
          decision.target.id === request.target.id &&
          readAdjudicationEvidence(decision.details) === evidenceKey,
      )
  ) {
    throw new Error('A new adjudication requires additional evidence');
  }
  const adjudicationRevision =
    Math.max(
      thread.artifactRevision,
      ...previousThreads
        .filter(
          (candidate) =>
            candidate.target.kind === request.target.kind &&
            candidate.target.id === request.target.id,
        )
        .map((candidate) => candidate.artifactRevision),
    ) + 1;
  const adjudicationThread: ReviewThread = {
    id: `${thread.id}-adjudication-${randomUUID()}`,
    runId: request.runId,
    phase: 'qa',
    target: request.target,
    artifactRevision: adjudicationRevision,
    state: 'waiting',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await reviewStore.createReviewThread(adjudicationThread);
  await reviewStore.saveReviewDecision(
    {
      threadId: adjudicationThread.id,
      target: request.target,
      decision: request.decision,
      revision: adjudicationThread.revision,
      details: JSON.stringify({
        issue: request.issue.trim(),
        evidence,
        scope: request.scope.trim(),
        clarification: request.clarification.trim(),
      }),
      createdAt: new Date().toISOString(),
    },
    'finalized',
  );
  return getReview(context, request.runId);
}

export async function decideReview(
  context: ReviewContext,
  request: ReviewDecisionRequest,
): Promise<WorkflowRun> {
  return continueReview(context, request, 'decided', request.decision);
}

export async function finalizeReview(
  context: ReviewContext,
  request: ReviewFinalizeRequest,
): Promise<WorkflowRun> {
  const thread = await requireThread(context, request.runId, request.threadId);
  if (thread.phase === 'qa') {
    const reviewStore = requireReviewStore(context);
    const threads = await reviewStore.listReviewThreads(request.runId, 'qa');
    const decisions = await Promise.all(
      threads.map((candidate) => reviewStore.getReviewDecisions(candidate.id)),
    );
    if (
      !decisions
        .flat()
        .some(
          (decision) =>
            isAdjudication(decision.decision) && decision.target.id === request.target.id,
        )
    ) {
      throw new Error('Cannot finalize a QA finding without an adjudication decision');
    }
  }
  return continueReview(context, { ...request, decision: 'approve' }, 'finalized', 'approve');
}

async function continueReview(
  context: ReviewContext,
  request: ReviewDecisionRequest,
  nextState: 'decided' | 'finalized',
  decisionKind: ReviewDecision['decision'],
): Promise<WorkflowRun> {
  const reviewStore = requireReviewStore(context);
  const coordinator = context.interactivePlanBuildQaCoordinator;
  if (!coordinator) throw new Error('Interactive review coordinator is not configured');
  const thread = await requireThread(context, request.runId, request.threadId);
  if (thread.state !== 'waiting') {
    throw new Error(`Review thread ${thread.id} is no longer waiting`);
  }
  validateInteractiveTarget(request.target, targetIds(thread));
  if (request.target.kind !== thread.target.kind || request.target.id !== thread.target.id) {
    throw new Error(`Review target does not belong to thread ${thread.id}`);
  }
  const effect = decisionEffect(thread, decisionKind);
  const now = new Date().toISOString();
  const decision = {
    threadId: thread.id,
    target: request.target,
    decision: decisionKind,
    revision: thread.revision,
    ...(request.details?.trim() ? { details: request.details.trim() } : {}),
    createdAt: now,
  };
  if (effect === 'stay') {
    await reviewStore.saveReviewDecision(decision, 'waiting');
    const current = await context.store.getRun(request.runId);
    if (!current) throw new Error(`Unknown run: ${request.runId}`);
    return current;
  }

  const claimed = await context.store.claimRunForExecution(request.runId, ['waiting']);
  if (!claimed) throw new Error(`Run ${request.runId} is no longer waiting for review`);

  try {
    await reviewStore.saveReviewDecision(decision, nextState);
    await request.onRunStarted?.(claimed.run);
    const workflow = resolveWorkflow(claimed.run.workflowId);
    const input = await loadInput(context, claimed.run.id);
    return coordinator.continueAfterDecision(
      workflow,
      {
        objective: claimed.run.objective,
        input,
        profiles: context.config.profiles,
        runId: claimed.run.id,
        resume: true,
        executionClaim: claimed.claim,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
      },
      claimed.run,
      input,
    );
  } catch (error) {
    await context.store.releaseExecution(request.runId).catch(() => undefined);
    await context.store.markRunInterrupted(request.runId).catch(() => undefined);
    throw error;
  }
}

async function requireThread(
  context: ReviewContext,
  runId: string,
  threadId: string,
): Promise<ReviewThread> {
  const reviewStore = requireReviewStore(context);
  const thread = await reviewStore.getReviewThread(threadId);
  if (!thread || thread.runId !== runId) throw new Error(`Unknown review thread: ${threadId}`);
  return thread;
}

function isAdjudication(decision: ReviewDecision['decision']): boolean {
  return (
    decision === 'withdrawn' ||
    decision === 'confirmed' ||
    decision === 'reclassified' ||
    decision === 'needs-human-decision'
  );
}

function readAdjudicationEvidence(details: string | undefined): string | undefined {
  if (!details) return undefined;
  try {
    const parsed = JSON.parse(details) as { evidence?: unknown };
    return Array.isArray(parsed.evidence) ? JSON.stringify(parsed.evidence) : undefined;
  } catch {
    return undefined;
  }
}

function targetIds(thread: ReviewThread): {
  taskIds: string[];
  changeIds: string[];
  findingIds: string[];
} {
  return {
    taskIds: thread.target.kind === 'task' ? [thread.target.id] : [],
    changeIds: thread.target.kind === 'change' ? [thread.target.id] : [],
    findingIds: thread.target.kind === 'finding' ? [thread.target.id] : [],
  };
}

async function loadInput(context: ReviewContext, runId: string): Promise<Record<string, unknown>> {
  const inputArtifact = (await context.store.getArtifacts(runId)).find(
    (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
  );
  if (!inputArtifact) throw new Error(`Missing persisted run input artifact for ${runId}`);
  const parsed: unknown = JSON.parse(await context.artifacts.read(inputArtifact));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Persisted review input must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function decisionEffect(
  thread: ReviewThread,
  decision: ReviewDecisionRequest['decision'],
): ReturnType<typeof interactiveDecisionEffect> {
  if (
    decision !== 'approve' &&
    decision !== 'reject' &&
    decision !== 'correct' &&
    decision !== 'withdraw' &&
    decision !== 'accept-risk' &&
    decision !== 'postpone'
  ) {
    throw new Error(`Invalid interactive review decision: ${decision}`);
  }
  return interactiveDecisionEffect(thread.phase, decision as InteractiveDecision);
}

function requireReviewStore(context: ReviewContext) {
  if (!context.reviewStore) throw new Error('Interactive review persistence is not configured');
  return context.reviewStore;
}
