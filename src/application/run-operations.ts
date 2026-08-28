import { retryableWorkflowStepIds, workflowStepsCompleted } from '../core/workflow-runtime.js';
import {
  isStepRetryEligible,
  type ArtifactReference,
  type StepRun,
  type WorkflowRun,
} from '../core/run.js';
import { resolveWorkflow } from '../workflows/catalog.js';
import type { WorkflowDefinition } from '../core/workflow.js';
import {
  MAX_RESEARCH_ITERATIONS,
  RESEARCH_ITERATION_INPUT,
  researchPlanBuildWorkflow,
  type WorkflowApprovalDefinition,
} from '../workflows/research-plan-build.js';
import type {
  ApplicationRunEventPage,
  ApplicationRunEventPageQuery,
  ApplicationRunListPage,
  ApplicationRunListQuery,
  ApplicationRunStore,
} from './ports.js';
import type { ApplicationInternals } from './context.js';
import { MAX_QA_ITERATIONS, QA_ITERATION_INPUT } from './plan-build-qa-coordinator.js';

const DEFAULT_RUN_EVENT_LIMIT = 50;
const MAX_RUN_EVENT_LIMIT = 100;

export interface RunInspection {
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: ArtifactReference[];
  eventCount: number;
  events?: Awaited<ReturnType<ApplicationRunStore['getEvents']>>;
}

export interface RunRecoveryExplanation {
  eligible: boolean;
  reason: string;
  completedStepIds: string[];
  retryableStepIds: string[];
  workflowVersionCompatible: boolean;
  actions?: RunRecoveryAction[];
}

export interface RunRecoveryAction {
  kind: 'mark-interrupted' | 'resume';
  label: string;
  requiresConfirmation: boolean;
}

export async function explainRunRecovery(
  context: Pick<ApplicationInternals, 'store'> & Partial<Pick<ApplicationInternals, 'artifacts'>>,
  runId: string,
): Promise<RunRecoveryExplanation> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const steps = await context.store.getStepRuns(runId);
  const explanation = buildRunRecoveryExplanation(
    run,
    steps,
    resolveRecoveryWorkflow(run.workflowId),
  );
  const recoveryState =
    run.workflowId === 'plan-build-qa'
      ? await planBuildQaRecoveryState(context, run)
      : await researchRecoveryState(context, run);
  if (recoveryState === 'exhausted') {
    return {
      ...explanation,
      eligible: false,
      reason:
        run.workflowId === 'plan-build-qa'
          ? 'The QA iteration limit has been reached; this run is terminal.'
          : 'The research iteration limit has been reached; this run is terminal.',
      actions: [],
    };
  }
  if (recoveryState === 'invalid') {
    return {
      ...explanation,
      eligible: false,
      reason:
        run.workflowId === 'plan-build-qa'
          ? 'The persisted QA input is missing or invalid; this run cannot be resumed.'
          : 'The persisted research input is missing or invalid; this run cannot be resumed.',
      actions: [],
    };
  }
  return explanation;
}

export async function isResearchIterationExhausted(
  context: Pick<ApplicationInternals, 'store'> & Partial<Pick<ApplicationInternals, 'artifacts'>>,
  run: WorkflowRun,
  artifacts?: ArtifactReference[],
): Promise<boolean> {
  return (await researchRecoveryState(context, run, artifacts)) === 'exhausted';
}

export async function planBuildQaRecoveryState(
  context: Pick<ApplicationInternals, 'store'> & Partial<Pick<ApplicationInternals, 'artifacts'>>,
  run: WorkflowRun,
  artifacts?: ArtifactReference[],
): Promise<'exhausted' | 'invalid' | undefined> {
  if (run.workflowId !== 'plan-build-qa' || !context.artifacts) return undefined;
  const runArtifacts = artifacts ?? (await context.store.getArtifacts(run.id));
  const inputArtifact = runArtifacts.find(
    (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
  );
  if (!inputArtifact) return 'invalid';
  try {
    const input: unknown = JSON.parse(await context.artifacts.read(inputArtifact));
    if (!isRecord(input)) return 'invalid';
    const iteration = input[QA_ITERATION_INPUT];
    if (
      typeof iteration !== 'number' ||
      !Number.isInteger(iteration) ||
      iteration < 0 ||
      iteration >= MAX_QA_ITERATIONS
    ) {
      return 'invalid';
    }
    return runArtifacts.some((artifact) => artifact.stepId === 'qa-3' && artifact.name === 'report')
      ? 'exhausted'
      : undefined;
  } catch {
    return 'invalid';
  }
}

export async function researchRecoveryState(
  context: Pick<ApplicationInternals, 'store'> & Partial<Pick<ApplicationInternals, 'artifacts'>>,
  run: WorkflowRun,
  artifacts?: ArtifactReference[],
): Promise<'exhausted' | 'invalid' | undefined> {
  if (run.workflowId !== researchPlanBuildWorkflow.id || !context.artifacts) return undefined;
  const inputArtifact = (artifacts ?? (await context.store.getArtifacts(run.id))).find(
    (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
  );
  if (!inputArtifact) return 'invalid';
  try {
    const input: unknown = JSON.parse(await context.artifacts.read(inputArtifact));
    if (!isRecord(input)) return 'invalid';
    const iteration = input[RESEARCH_ITERATION_INPUT];
    if (typeof iteration !== 'number' || !Number.isInteger(iteration) || iteration < 0) {
      return 'invalid';
    }
    return iteration >= MAX_RESEARCH_ITERATIONS ? 'exhausted' : undefined;
  } catch {
    return 'invalid';
  }
}

export function buildRunRecoveryExplanation(
  run: WorkflowRun,
  steps: StepRun[],
  workflow: WorkflowDefinition | undefined = resolveRecoveryWorkflow(run.workflowId),
): RunRecoveryExplanation {
  let workflowVersionCompatible = true;
  let installedVersion: number | undefined;
  try {
    installedVersion = resolveWorkflow(run.workflowId).version;
    workflowVersionCompatible = installedVersion === run.workflowVersion;
  } catch {
    workflowVersionCompatible = false;
  }

  const completedStepIds = steps
    .filter((step) => step.status === 'completed')
    .map((step) => step.stepId);
  const retryableStepIds = recoveryRetryableStepIds(workflow, steps);

  if (!workflowVersionCompatible) {
    return {
      eligible: false,
      reason: `Workflow version incompatibility: this run uses version ${run.workflowVersion}, but the installed workflow is version ${installedVersion ?? 'unavailable'}. Resume is not supported across workflow versions.`,
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [],
    };
  }
  if (run.status === 'cancelled') {
    return {
      eligible: false,
      reason: 'Cancelled runs cannot be resumed. Start a new run instead.',
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [],
    };
  }
  if (run.status === 'completed') {
    return {
      eligible: false,
      reason: 'This run is completed and does not need recovery.',
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [],
    };
  }
  if (run.status === 'waiting') {
    return {
      eligible: false,
      reason: 'This run is waiting for its workflow-specific approval action.',
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [],
    };
  }
  if (run.status === 'running') {
    return {
      eligible: false,
      reason:
        'This run is still marked running. Attached execution must finish before recovery is offered.',
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [
        {
          kind: 'mark-interrupted',
          label: 'Mark interrupted and review recovery',
          requiresConfirmation: true,
        },
      ],
    };
  }
  const canFinalize = workflow !== undefined && workflowStepsCompleted(workflow, steps);
  if (
    (run.status === 'failed' || run.status === 'interrupted') &&
    retryableStepIds.length === 0 &&
    !canFinalize
  ) {
    return {
      eligible: false,
      reason: 'The run has no retryable failed, interrupted, or pending steps.',
      completedStepIds,
      retryableStepIds,
      workflowVersionCompatible,
      actions: [],
    };
  }
  return {
    eligible: true,
    reason:
      completedStepIds.length > 0
        ? `Recovery will reuse completed steps (${completedStepIds.join(', ')}); only retryable steps will run. Completed steps are never silently rerun.`
        : 'Recovery will run the pending or interrupted workflow steps.',
    completedStepIds,
    retryableStepIds,
    workflowVersionCompatible,
    actions: [
      {
        kind: 'resume',
        label: 'Resume retryable work',
        requiresConfirmation: false,
      },
    ],
  };
}

export function findWaitingApprovalStep(
  workflow: WorkflowDefinition,
  run: WorkflowRun,
  steps: readonly StepRun[],
): StepRun | undefined {
  const approval = researchApproval(workflow);
  if (run.status !== 'waiting' || !approval) return undefined;
  return steps.find((step) => step.stepId === approval.id && step.status === 'waiting');
}

export async function markRunInterrupted(
  context: RunStoreContext<'getRun' | 'markRunInterrupted'>,
  runId: string,
): Promise<WorkflowRun> {
  const current = await context.store.getRun(runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  if (current.status !== 'running') {
    throw new Error(`Run ${runId} is not marked running and cannot be interrupted for recovery`);
  }
  const interrupted = await context.store.markRunInterrupted(runId);
  if (!interrupted) throw new Error(`Run ${runId} is no longer marked running`);
  return interrupted;
}

export async function listRuns(
  context: RunStoreContext<'listRunsPage'>,
  query: ApplicationRunListQuery = {},
): Promise<ApplicationRunListPage> {
  return context.store.listRunsPage(query);
}

export async function listRunEvents(
  context: RunStoreContext<'getRun' | 'listRunEventsPage'>,
  runId: string,
  query: ApplicationRunEventPageQuery = {},
): Promise<ApplicationRunEventPage> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const afterId = query.afterId ?? 0;
  const limit = query.limit ?? DEFAULT_RUN_EVENT_LIMIT;
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    throw new Error('Invalid event cursor: afterId must be a non-negative integer');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_EVENT_LIMIT) {
    throw new Error(`Event limit must be an integer between 1 and ${MAX_RUN_EVENT_LIMIT}`);
  }
  return context.store.listRunEventsPage(runId, { afterId, limit });
}

export interface RunInspectionOptions {
  includeEvents?: boolean;
  /** true loads full agent result text; 'usage' keeps usage/cost only; false omits results. */
  includeStepResults?: boolean | 'usage';
}

export async function inspectRun(
  context: RunStoreContext<'getRun' | 'getStepRuns' | 'getArtifacts' | 'countEvents' | 'getEvents'>,
  runId: string,
  options: RunInspectionOptions = {},
): Promise<RunInspection> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const includeResult =
    options.includeStepResults === true
      ? true
      : options.includeStepResults === 'usage'
        ? 'usage'
        : false;
  const [steps, artifacts, eventCount] = await Promise.all([
    context.store.getStepRuns(runId, { includeResult }),
    context.store.getArtifacts(runId),
    context.store.countEvents(runId),
  ]);
  const events = options.includeEvents ? await context.store.getEvents(runId) : undefined;
  return {
    run,
    steps,
    artifacts,
    eventCount,
    ...(events ? { events } : {}),
  };
}

function resolveRecoveryWorkflow(workflowId: string): WorkflowDefinition | undefined {
  try {
    return resolveWorkflow(workflowId);
  } catch {
    return undefined;
  }
}

function recoveryRetryableStepIds(
  workflow: WorkflowDefinition | undefined,
  steps: StepRun[],
): string[] {
  if (!workflow)
    return steps.filter((step) => isStepRetryEligible(step, true)).map((step) => step.stepId);
  return retryableWorkflowStepIds(workflow, steps);
}

function researchApproval(workflow: WorkflowDefinition): WorkflowApprovalDefinition | undefined {
  if (workflow.id !== researchPlanBuildWorkflow.id) return undefined;
  return (workflow as typeof researchPlanBuildWorkflow).approval;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type RunStoreContext<Keys extends keyof ApplicationRunStore> = {
  store: Pick<ApplicationRunStore, Keys>;
};
