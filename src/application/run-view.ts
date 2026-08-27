import type {
  AgentUsage,
  ApprovalDecision,
  ArtifactReference,
  StepDisposition,
  StepError,
  StepRun,
  StepSkipReason,
  StepStatus,
  WorkflowRun,
} from '../core/run.js';
import type { WorkflowDefinition } from '../core/workflow.js';
import { resolveWorkflow } from '../workflows/catalog.js';
import { researchPlanBuildWorkflow } from '../workflows/research-plan-build.js';
import {
  buildRunRecoveryExplanation,
  findWaitingApprovalStep,
  isResearchIterationExhausted,
  type ApplicationInternals,
} from './operations.js';

export interface RunView {
  id: string;
  workflow: RunWorkflowView;
  objective: string;
  status: WorkflowRun['status'];
  createdAt: string;
  updatedAt: string;
  phases: RunPhaseView[];
  currentPhaseId?: string;
  artifacts: RunArtifactView[];
  eventCount: number;
  metrics: RunMetricsView;
  availableActions: RunAction[];
  pendingAction?: PendingRunAction;
  followUp?: RunFollowUp;
}

export interface RunWorkflowView {
  id: string;
  version: number;
  installedVersion?: number;
  compatible: boolean;
}

export interface RunPhaseView {
  id: string;
  kind: 'agent' | 'approval' | 'unknown';
  profile?: string;
  status: StepStatus;
  attempt?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  usage?: AgentUsage;
  costUsd?: number;
  error?: StepError;
  disposition?: StepDisposition;
  skipReason?: StepSkipReason;
  approval?: ApprovalDecision;
}

export interface RunArtifactView {
  id: string;
  stepId: string;
  name: string;
  kind: ArtifactReference['kind'];
  mediaType: string;
  sizeBytes: number;
}

export interface RunMetricsView {
  usage?: AgentUsage;
  costUsd?: number;
  durationMs?: number;
}

export interface PendingRunAction {
  kind: 'research-approval';
  stepId: string;
  message: string;
}

export interface RunFollowUp {
  kind: 'clarification';
}

export type RunAction =
  | {
      kind: 'resume';
      label: string;
      requiresConfirmation: boolean;
    }
  | {
      kind: 'mark-interrupted';
      label: string;
      requiresConfirmation: boolean;
    }
  | {
      kind: 'approve-research';
      stepId: string;
      label: string;
      requiresConfirmation: false;
    }
  | {
      kind: 'reject-research';
      stepId: string;
      label: string;
      requiresConfirmation: false;
      requiresFeedback: true;
    };

export async function getRunView(
  context: Pick<ApplicationInternals, 'store'> & Partial<Pick<ApplicationInternals, 'artifacts'>>,
  runId: string,
): Promise<RunView> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);

  const [steps, artifacts, eventCount] = await Promise.all([
    context.store.getStepRuns(runId, { includeResult: 'usage' }),
    context.store.getArtifacts(runId),
    context.store.countEvents(runId),
  ]);
  const installedWorkflow = resolveInstalledWorkflow(run.workflowId);
  const compatible = installedWorkflow?.version === run.workflowVersion;
  const recoveryBase = buildRunRecoveryExplanation(run, steps, installedWorkflow);
  const recovery = (await isResearchIterationExhausted(context, run, artifacts))
    ? {
        ...recoveryBase,
        eligible: false,
        reason: 'The research iteration limit has been reached; this run is terminal.',
        actions: [],
      }
    : recoveryBase;
  const phases = buildPhases(
    compatible ? installedWorkflow : undefined,
    steps,
    Date.now(),
    run.status === 'running',
  );
  const pendingAction = compatible ? buildPendingAction(run, installedWorkflow, steps) : undefined;
  const followUp = clarificationFollowUp(run.status, phases);
  const availableActions = [
    ...mapRecoveryActions(recovery.actions ?? []),
    ...(pendingAction && compatible ? approvalActions(pendingAction) : []),
  ];
  const phaseId = currentPhaseId(run.status, phases);

  return {
    id: run.id,
    workflow: {
      id: run.workflowId,
      version: run.workflowVersion,
      ...(installedWorkflow ? { installedVersion: installedWorkflow.version } : {}),
      compatible,
    },
    objective: run.objective,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    phases,
    ...(phaseId ? { currentPhaseId: phaseId } : {}),
    artifacts: artifacts.map(toArtifactView),
    eventCount,
    metrics: aggregateMetrics(phases),
    availableActions,
    ...(pendingAction ? { pendingAction } : {}),
    ...(followUp ? { followUp } : {}),
  };
}

function resolveInstalledWorkflow(workflowId: string): WorkflowDefinition | undefined {
  try {
    return resolveWorkflow(workflowId);
  } catch {
    return undefined;
  }
}

function buildPhases(
  workflow: WorkflowDefinition | undefined,
  steps: StepRun[],
  nowMs: number,
  runIsActive: boolean,
): RunPhaseView[] {
  const persisted = new Map(steps.map((step) => [step.stepId, step]));
  const definitions = workflow ? workflowPhaseDefinitions(workflow) : [];
  const phases = definitions.map(({ id, kind, profile }) =>
    toPhaseView(persisted.get(id), id, kind, profile, nowMs, runIsActive),
  );
  const definedIds = new Set(definitions.map(({ id }) => id));

  for (const step of steps) {
    if (!definedIds.has(step.stepId))
      phases.push(toPhaseView(step, step.stepId, 'unknown', undefined, nowMs, runIsActive));
  }
  return phases;
}

function workflowPhaseDefinitions(
  workflow: WorkflowDefinition,
): Array<{ id: string; kind: RunPhaseView['kind']; profile?: string }> {
  const definitions: Array<{ id: string; kind: RunPhaseView['kind']; profile?: string }> = [];
  const approval =
    workflow.id === researchPlanBuildWorkflow.id ? researchPlanBuildWorkflow.approval : undefined;
  for (const step of workflow.steps) {
    definitions.push({ id: step.id, kind: 'agent', profile: step.profile });
    if (approval?.after === step.id) {
      definitions.push({ id: approval.id, kind: 'approval', profile: 'human' });
    }
  }
  return definitions;
}

function toPhaseView(
  step: StepRun | undefined,
  id: string,
  kind: RunPhaseView['kind'],
  profile?: string,
  nowMs = Date.now(),
  runIsActive = false,
): RunPhaseView {
  if (!step) return { id, kind, ...(profile ? { profile } : {}), status: 'pending' };

  const durationMs = phaseDurationMs(step, nowMs, runIsActive);
  const phaseProfile = step.profile || profile;
  return {
    id,
    kind,
    ...(phaseProfile ? { profile: phaseProfile } : {}),
    status: step.status,
    attempt: step.attempt,
    ...(step.startedAt ? { startedAt: step.startedAt } : {}),
    ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(step.result?.usage ? { usage: step.result.usage } : {}),
    ...(step.result?.costUsd !== undefined ? { costUsd: step.result.costUsd } : {}),
    ...(step.error ? { error: step.error } : {}),
    ...(step.disposition ? { disposition: step.disposition } : {}),
    ...(step.skipReason ? { skipReason: step.skipReason } : {}),
    ...(step.approval ? { approval: step.approval } : {}),
  };
}

function phaseDurationMs(step: StepRun, nowMs: number, runIsActive: boolean): number | undefined {
  if (!step.startedAt) return undefined;
  const start = Date.parse(step.startedAt);
  const finish = step.finishedAt
    ? Date.parse(step.finishedAt)
    : step.status === 'running' && runIsActive
      ? nowMs
      : undefined;
  if (finish === undefined) return undefined;
  if (Number.isNaN(start) || Number.isNaN(finish)) return undefined;
  return Math.max(0, finish - start);
}

function clarificationFollowUp(
  status: WorkflowRun['status'],
  phases: RunPhaseView[],
): RunFollowUp | undefined {
  if (status !== 'completed') return undefined;
  return phases.some(
    (phase) =>
      phase.disposition?.kind === 'stop' && phase.disposition.code === 'PLAN_NEEDS_CLARIFICATION',
  )
    ? { kind: 'clarification' }
    : undefined;
}

function currentPhaseId(status: WorkflowRun['status'], phases: RunPhaseView[]): string | undefined {
  if (status === 'completed' || status === 'cancelled') return undefined;
  return (
    phases.find((phase) => phase.status === 'running')?.id ??
    phases.find((phase) => phase.status === 'waiting')?.id ??
    phases.find((phase) => phase.status === 'failed' || phase.status === 'interrupted')?.id ??
    phases.find((phase) => phase.status === 'pending')?.id
  );
}

function toArtifactView(artifact: ArtifactReference): RunArtifactView {
  return {
    id: artifact.id,
    stepId: artifact.stepId,
    name: artifact.name,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
  };
}

function aggregateMetrics(phases: RunPhaseView[]): RunMetricsView {
  const usage: AgentUsage = {};
  let hasUsage = false;
  let costUsd = 0;
  let hasCost = false;
  let durationMs = 0;
  let hasDuration = false;

  for (const phase of phases) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const value = phase.usage?.[key];
      if (value !== undefined) {
        usage[key] = (usage[key] ?? 0) + value;
        hasUsage = true;
      }
    }
    if (phase.costUsd !== undefined) {
      costUsd += phase.costUsd;
      hasCost = true;
    }
    if (phase.durationMs !== undefined) {
      durationMs += phase.durationMs;
      hasDuration = true;
    }
  }

  return {
    ...(hasUsage ? { usage } : {}),
    ...(hasCost ? { costUsd } : {}),
    ...(hasDuration ? { durationMs } : {}),
  };
}

function mapRecoveryActions(
  actions: ReadonlyArray<{
    kind: 'resume' | 'mark-interrupted';
    label: string;
    requiresConfirmation: boolean;
  }>,
): RunAction[] {
  return actions.map((action) =>
    action.kind === 'resume'
      ? { kind: 'resume', label: action.label, requiresConfirmation: action.requiresConfirmation }
      : {
          kind: 'mark-interrupted',
          label: action.label,
          requiresConfirmation: action.requiresConfirmation,
        },
  );
}

function buildPendingAction(
  run: WorkflowRun,
  workflow: WorkflowDefinition | undefined,
  steps: StepRun[],
): PendingRunAction | undefined {
  if (!workflow || workflow.id !== researchPlanBuildWorkflow.id) return undefined;
  const approval = findWaitingApprovalStep(workflow, run, steps);
  if (!approval) return undefined;
  return {
    kind: 'research-approval',
    stepId: approval.stepId,
    message: researchPlanBuildWorkflow.approval.message,
  };
}

function approvalActions(pendingAction: PendingRunAction): RunAction[] {
  return [
    {
      kind: 'approve-research',
      stepId: pendingAction.stepId,
      label: 'Approve research and continue',
      requiresConfirmation: false,
    },
    {
      kind: 'reject-research',
      stepId: pendingAction.stepId,
      label: 'Reject research and request another iteration',
      requiresConfirmation: false,
      requiresFeedback: true,
    },
  ];
}
