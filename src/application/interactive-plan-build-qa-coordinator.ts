import { randomUUID } from 'node:crypto';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { ReviewDecision, ReviewMessage, ReviewThread } from '../core/interactive-review.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import type { AgentStep, WorkflowDefinition } from '../core/workflow.js';
import type { WorkflowArtifactStore } from '../core/ports.js';
import type { WorkflowRuntime } from '../core/workflow-runtime.js';
import { isStepRetryEligible } from '../core/run.js';
import {
  findArtifact,
  replaceArtifacts,
  StepExecutionFailure,
  validateWorkflowInput,
} from '../core/workflow-runtime.js';
import {
  parseInteractiveScope,
  validateInteractiveWorkflowDefinition,
  type InteractiveReviewPhase,
} from '../workflows/plan-build-qa-interactive.js';
import type { ApplicationReviewStore, ApplicationRunStore } from './ports.js';

export type InteractivePlanBuildQaRuntime = Pick<
  WorkflowRuntime,
  | 'resolveInput'
  | 'prepareRun'
  | 'notifyRunStarted'
  | 'executeStep'
  | 'saveRunStatus'
  | 'emitStatus'
>;

export type InteractivePlanBuildQaPersistence = Pick<
  ApplicationRunStore,
  'getStepRuns' | 'getArtifacts'
> &
  ApplicationReviewStore;

export class InteractivePlanBuildQaCoordinator {
  constructor(
    private readonly runtime: InteractivePlanBuildQaRuntime,
    private readonly persistence: InteractivePlanBuildQaPersistence,
    private readonly artifactsStore: WorkflowArtifactStore,
  ) {}

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validateInteractiveWorkflowDefinition(workflow);
    const input = await this.runtime.resolveInput(request);
    validateWorkflowInput(workflow, input);
    const run = await this.runtime.prepareRun(workflow, request, input);
    if (run.status === 'completed') return run;
    await this.runtime.notifyRunStarted(run, request.onRunStarted);
    return this.advance(workflow, request, run, input);
  }

  async explain(
    run: WorkflowRun,
    thread: ReviewThread,
    request: ExecuteWorkflowRequest,
    evidence: string,
  ): Promise<ReviewMessage> {
    const explainer = request.profiles.analyst;
    if (
      !explainer ||
      explainer.workspaceMode !== 'read-only' ||
      explainer.tools.some((tool) => tool !== 'ls' && tool !== 'find' && tool !== 'read')
    ) {
      throw new Error('The interactive review explainer requires a read-only analyst profile');
    }
    const steps = await this.persistence.getStepRuns(run.id);
    const existing = steps.find((step) => step.stepId === `review-explainer-${thread.id}`);
    const artifacts = await this.persistence.getArtifacts(run.id);
    const step: AgentStep = {
      kind: 'agent',
      id: `review-explainer-${thread.id}`,
      profile: 'analyst',
      prompt: [
        'Explain the selected review target using only the supplied scope and evidence.',
        'Do not modify files. Return a concise explanation for a human reviewer.',
        `Target: ${thread.target.kind}:${thread.target.id}`,
        `Evidence: ${evidence.slice(0, 12_000)}`,
      ].join('\n'),
      dependsOn: [],
      inputReferences: [],
      outputs: [{ name: 'explanation', kind: 'artifact', format: 'text' }],
    };
    const result = await this.runtime.executeStep(
      run,
      step,
      existing,
      { objective: run.objective },
      artifacts,
      request,
    );
    await this.runtime.saveRunStatus(run, 'waiting');
    const now = new Date().toISOString();
    return {
      id: `message-explanation-${randomUUID()}`,
      threadId: thread.id,
      sequence: 0,
      role: 'assistant',
      content: result.stepRun.result?.text ?? 'No explanation was returned.',
      generationStatus: 'sent',
      ...(result.stepRun.profileSnapshot
        ? { profileSnapshot: result.stepRun.profileSnapshot }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  async continueAfterDecision(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
    run: WorkflowRun,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    validateInteractiveWorkflowDefinition(workflow);
    validateWorkflowInput(workflow, input);
    return this.advance(workflow, request, run, input);
  }

  private async advance(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
    run: WorkflowRun,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    let artifacts = await this.persistence.getArtifacts(run.id);
    const steps = new Map(
      (await this.persistence.getStepRuns(run.id)).map((step) => [step.stepId, step]),
    );
    const scopeStep = requiredStep(workflow, 'scope');
    const planStep = requiredStep(workflow, 'plan');
    const buildStep = requiredStep(workflow, 'build');
    const qaStep = requiredStep(workflow, 'qa');
    const fixStep = requiredStep(workflow, 'fix');
    const runtime = this.runtime;

    const scopeThread = await this.thread(run.id, 'scope', { kind: 'scope', id: 'scope' });
    if (!completed(steps.get(scopeStep.id))) {
      const result = await executeStep(scopeStep);
      const artifact = requiredArtifact(artifacts, scopeStep.id, 'scope');
      parseInteractiveScope(JSON.parse(await this.artifactsStore.read(artifact)));
      if (result.status !== 'completed') return failRun(result);
      await this.wait(run, scopeThread);
      return { ...run, status: 'waiting' };
    }
    if (scopeThread.state === 'waiting') return ensureWaiting(run);

    if (!completed(steps.get(planStep.id))) await executeStep(planStep);
    if (!completed(steps.get(buildStep.id))) await executeStep(buildStep);

    const changesThread = await this.thread(run.id, 'changes', {
      kind: 'change',
      id: 'changes',
    });
    if (changesThread.state === 'waiting') {
      await this.wait(run, changesThread);
      return ensureWaiting(run);
    }

    if (!completed(steps.get(qaStep.id))) await executeStep(qaStep);
    const qaThread = await this.thread(run.id, 'qa', { kind: 'finding', id: 'qa' });
    if (qaThread.state === 'waiting') {
      await this.wait(run, qaThread);
      return ensureWaiting(run);
    }

    if (qaThread.state === 'decided' && hasDecision(qaThread, 'correct')) {
      if (!completed(steps.get(fixStep.id))) await executeStep(fixStep);
    }
    return this.runtime.saveRunStatus(run, 'completed');

    async function executeStep(step: AgentStep): Promise<StepRun> {
      const existing = steps.get(step.id);
      if (existing?.status === 'completed') return existing;
      if (existing && !isStepRetryEligible(existing, request.resume === true)) {
        throw new StepExecutionFailure(existing);
      }
      try {
        const result = await runtime.executeStep(run, step, existing, input, artifacts, request);
        steps.set(step.id, result.stepRun);
        artifacts = replaceArtifacts(artifacts, result.artifacts);
        return result.stepRun;
      } catch (error) {
        if (error instanceof StepExecutionFailure) throw error;
        throw error;
      }
    }

    async function failRun(step: StepRun): Promise<WorkflowRun> {
      return runtime.saveRunStatus(run, step.status === 'cancelled' ? 'cancelled' : 'failed');
    }
  }

  private async thread(
    runId: string,
    phase: InteractiveReviewPhase,
    target: ReviewThread['target'],
  ): Promise<ReviewThread> {
    const existing = (await this.persistence.listReviewThreads(runId, phase)).find(
      (thread) => thread.target.kind === target.kind && thread.target.id === target.id,
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const thread: ReviewThread = {
      id: `${runId}-${phase}-${target.id}`,
      runId,
      phase,
      target,
      artifactRevision: 1,
      state: 'waiting',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.persistence.createReviewThread(thread);
    return thread;
  }

  private async wait(run: WorkflowRun, thread: ReviewThread): Promise<void> {
    await this.runtime.emitStatus(
      run.id,
      thread.phase,
      `Review waiting for ${thread.target.kind}:${thread.target.id}`,
    );
    if (run.status !== 'waiting') await this.runtime.saveRunStatus(run, 'waiting');
  }
}

function requiredStep(workflow: WorkflowDefinition, id: string): AgentStep {
  const step = workflow.steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Invalid plan-build-qa-interactive workflow: missing ${id} step`);
  return step;
}

function requiredArtifact(
  artifacts: ArtifactReference[],
  stepId: string,
  name: string,
): ArtifactReference {
  const artifact = findArtifact(artifacts, stepId, name);
  if (!artifact) throw new Error(`Missing ${stepId} ${name} artifact`);
  return artifact;
}

function completed(step: StepRun | undefined): boolean {
  return step?.status === 'completed';
}

function ensureWaiting(run: WorkflowRun): WorkflowRun {
  return run.status === 'waiting' ? run : { ...run, status: 'waiting' };
}

function hasDecision(thread: ReviewThread, decision: ReviewDecision['decision']): boolean {
  return thread.state === 'decided' && decision === 'correct';
}
