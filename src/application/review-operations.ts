import { randomUUID } from 'node:crypto';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { ReviewDecision, ReviewMessage, ReviewThread } from '../core/interactive-review.js';
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
  const claimed = await context.store.claimRunForExecution(request.runId, ['waiting']);
  if (!claimed) throw new Error(`Run ${request.runId} is no longer waiting for review`);

  const now = new Date().toISOString();
  try {
    await reviewStore.saveReviewDecision(
      {
        threadId: thread.id,
        target: request.target,
        decision: decisionKind,
        revision: thread.revision,
        ...(request.details?.trim() ? { details: request.details.trim() } : {}),
        createdAt: now,
      },
      nextState,
    );
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

function requireReviewStore(context: ReviewContext) {
  if (!context.reviewStore) throw new Error('Interactive review persistence is not configured');
  return context.reviewStore;
}
