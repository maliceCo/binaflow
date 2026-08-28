import { createHash, randomUUID } from 'node:crypto';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { ReviewMessage, ReviewThread } from '../core/interactive-review.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import type { AgentStep, WorkflowDefinition } from '../core/workflow.js';
import type { WorkflowArtifactStore } from '../core/ports.js';
import type { ApplicationQaHistoryStore } from './ports.js';
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
  type InteractiveScope,
  validateInteractiveWorkflowDefinition,
  type InteractiveReviewPhase,
} from '../workflows/plan-build-qa-interactive.js';
import {
  parsePlanBuildQaQaReport,
  parsePlanBuildQaPlan,
  type PlanBuildQaPlan,
} from '../workflows/plan-build-qa.js';
import {
  renderInteractiveFinalReport,
  renderInteractiveTodo,
  type InteractiveReviewReportEntry,
} from '../workflows/plan-build-qa-render.js';
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
  'getStepRuns' | 'getArtifacts' | 'saveCoordinatorArtifacts'
> &
  ApplicationReviewStore;

export class InteractivePlanBuildQaCoordinator {
  constructor(
    private readonly runtime: InteractivePlanBuildQaRuntime,
    private readonly persistence: InteractivePlanBuildQaPersistence,
    private readonly artifactsStore: WorkflowArtifactStore,
    private readonly qaHistory?: ApplicationQaHistoryStore,
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
    const artifacts = await this.persistence.getArtifacts(run.id);
    const step: AgentStep = {
      kind: 'agent',
      id: `review-explainer-${thread.id}-${randomUUID()}`,
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
      undefined,
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
    let scopeValue: InteractiveScope | undefined;
    let planValue: PlanBuildQaPlan | undefined;
    let qaReports: Array<{
      iteration: number;
      report: ReturnType<typeof parsePlanBuildQaQaReport>;
    }> = [];
    const readScope = async (step: AgentStep): Promise<InteractiveScope> => {
      const artifact = requiredArtifact(artifacts, step.id, 'scope');
      return parseInteractiveScope(JSON.parse(await this.artifactsStore.read(artifact)));
    };
    const finish = async (status: 'completed' | 'failed' | 'cancelled'): Promise<WorkflowRun> => {
      const review = await reviewEntries(run.id, this.persistence);
      artifacts = await persistCoordinatorArtifact(
        run.id,
        'FINAL-REPORT.md',
        renderInteractiveFinalReport({
          objective: run.objective,
          ...(scopeValue ? { scope: scopeValue } : {}),
          ...(planValue ? { plan: planValue } : {}),
          qaReports,
          review,
          status,
        }),
        artifacts,
        this.artifactsStore,
        this.persistence,
      );
      return runtime.saveRunStatus(run, status);
    };

    const scopeThread = await this.thread(run.id, 'scope', { kind: 'scope', id: 'scope' });
    if (!completed(steps.get(scopeStep.id))) {
      const result = await executeStep(scopeStep);
      const artifact = requiredArtifact(artifacts, scopeStep.id, 'scope');
      scopeValue = parseInteractiveScope(JSON.parse(await this.artifactsStore.read(artifact)));
      if (result.status !== 'completed') return failRun(result);
      await this.wait(run, scopeThread);
      return { ...run, status: 'waiting' };
    }
    if (scopeThread.state === 'waiting') return ensureWaiting(run);
    if (!findArtifact(artifacts, 'coordinator', 'TODO.md')) {
      artifacts = await persistCoordinatorArtifact(
        run.id,
        'TODO.md',
        renderInteractiveTodo(scopeValue ?? (await readScope(scopeStep))),
        artifacts,
        this.artifactsStore,
        this.persistence,
      );
    }

    if (!completed(steps.get(planStep.id))) await executeStep(planStep);
    const planArtifact = findArtifact(artifacts, planStep.id, 'plan');
    if (planArtifact)
      planValue = parsePlanBuildQaPlan(JSON.parse(await this.artifactsStore.read(planArtifact)));
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
    const qaArtifact = requiredArtifact(artifacts, qaStep.id, 'report');
    const qaReport = parsePlanBuildQaQaReport(
      JSON.parse(await this.artifactsStore.read(qaArtifact)),
    );
    const findingIds = qaReport.findings.map((finding) => finding.id);
    qaReports = [{ iteration: 1, report: qaReport }];
    await recordInteractiveQaHistory(run.id, 1, qaReport, qaArtifact, this.qaHistory);
    const qaThreads =
      findingIds.length > 0
        ? await Promise.all(
            findingIds.map((id) => this.thread(run.id, 'qa', { kind: 'finding', id })),
          )
        : [await this.thread(run.id, 'qa', { kind: 'finding', id: 'qa' })];
    const waitingThread = qaThreads.find((thread) => thread.state === 'waiting');
    if (waitingThread) {
      await this.wait(run, waitingThread);
      return ensureWaiting(run);
    }

    const decisions = await Promise.all(
      qaThreads.map((thread) => this.persistence.getReviewDecisions(thread.id)),
    );
    if (decisions.some((items) => items.some((decision) => decision.decision === 'correct'))) {
      if (!completed(steps.get(fixStep.id))) await executeStep(fixStep);
    }
    return finish('completed');

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
      return finish(step.status === 'cancelled' ? 'cancelled' : 'failed');
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

async function persistCoordinatorArtifact(
  runId: string,
  name: string,
  content: string,
  artifacts: ArtifactReference[],
  artifactStore: WorkflowArtifactStore,
  persistence: Pick<ApplicationRunStore, 'saveCoordinatorArtifacts'>,
): Promise<ArtifactReference[]> {
  const artifact = await artifactStore.write(
    runId,
    'coordinator',
    name,
    'text',
    content,
    'text/markdown',
  );
  await persistence.saveCoordinatorArtifacts(runId, [artifact]);
  const previous = findArtifact(artifacts, 'coordinator', name);
  if (previous && previous.id !== artifact.id)
    await artifactStore.remove(previous).catch(() => undefined);
  return replaceArtifacts(artifacts, [artifact]);
}

async function reviewEntries(
  runId: string,
  persistence: Pick<ApplicationReviewStore, 'listReviewThreads' | 'getReviewDecisions'>,
): Promise<InteractiveReviewReportEntry[]> {
  const threads = await persistence.listReviewThreads(runId);
  return Promise.all(
    threads.map(async (thread) => ({
      phase: thread.phase,
      target: `${thread.target.kind}:${thread.target.id}`,
      state: thread.state,
      decisions: (await persistence.getReviewDecisions(thread.id)).map(
        (decision) => decision.decision,
      ),
    })),
  );
}

async function recordInteractiveQaHistory(
  runId: string,
  iteration: number,
  report: ReturnType<typeof parsePlanBuildQaQaReport>,
  reportArtifact: ArtifactReference,
  history: ApplicationQaHistoryStore | undefined,
): Promise<void> {
  if (!history) return;
  for (const finding of report.findings) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          category: finding.category,
          title: finding.title,
          explanation: finding.explanation,
          impact: finding.impact,
          evidence: [...finding.evidence].sort(),
        }),
      )
      .digest('hex');
    const exact = (await history.searchQaDefects(fingerprint, ''))[0]?.defect;
    const now = new Date().toISOString();
    const defect = exact ?? {
      id: `defect-${fingerprint}`,
      fingerprint,
      title: finding.title,
      summary: finding.explanation,
      category: finding.category,
      severity: finding.severity,
      status: 'detected' as const,
      createdAt: now,
      updatedAt: now,
      locations: finding.evidence,
    };
    if (!exact) await history.saveQaDefect(defect);
    const occurrenceId = `${runId}:${iteration}:${finding.id}`;
    if ((await history.getQaOccurrences(defect.id)).some((item) => item.id === occurrenceId))
      continue;
    await history.saveQaOccurrence({
      id: occurrenceId,
      runId,
      defectId: defect.id,
      qaIteration: iteration,
      findingId: finding.id,
      reportArtifactId: reportArtifact.id,
      createdAt: now,
    });
    await history.saveQaDefectEvent({
      defectId: defect.id,
      occurrenceId,
      status: 'detected',
      createdAt: now,
    });
  }
}
