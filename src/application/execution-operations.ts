import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import { randomUUID } from 'node:crypto';
import { WorkflowVersionMismatchError } from '../core/execute-request.js';
import {
  retryableWorkflowStepIds,
  validateWorkflowInput,
  workflowStepsCompleted,
} from '../core/workflow-runtime.js';
import type { ExecutionClaim } from '../core/ports.js';
import type { StepRun, WorkflowRun } from '../core/run.js';
import { resolveWorkflow } from '../workflows/catalog.js';
import {
  MAX_RESEARCH_ITERATIONS,
  RESEARCH_ITERATION_INPUT,
  researchPlanBuildWorkflow,
  type WorkflowApprovalDefinition,
} from '../workflows/research-plan-build.js';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';
import { MAX_QA_ITERATIONS, QA_ITERATION_INPUT } from './plan-build-qa-coordinator.js';
import { planBuildQaWorkflow } from '../workflows/plan-build-qa.js';
import { planBuildQaInteractiveWorkflow } from '../workflows/plan-build-qa-interactive.js';
import type { ApplicationInternals } from './context.js';
import { findWaitingApprovalStep, isResearchIterationExhausted } from './run-operations.js';
import { validateWorkflowProfiles } from './workflow-operations.js';

export interface RunWorkflowRequest {
  workflowId: string;
  objective: string;
  input: Record<string, unknown>;
  runId?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export async function runWorkflow(
  context: ApplicationInternals,
  request: RunWorkflowRequest,
): Promise<WorkflowRun> {
  const workflow = resolveAndValidateWorkflow(context, request.workflowId);
  const runId = request.runId ?? randomUUID();
  try {
    return await executeWorkflow(context, workflow, {
      runId,
      objective: request.objective,
      input: { ...request.input, objective: request.objective },
      profiles: context.config.profiles,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
    });
  } catch (error) {
    await context.store.releaseExecution(runId).catch(() => undefined);
    await context.store.markRunInterrupted(runId).catch(() => undefined);
    throw error;
  }
}

export interface ResumeWorkflowRequest {
  runId: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export interface ResumeWorkflowResult {
  run: WorkflowRun;
  alreadyCompleted: boolean;
}

export async function resumeWorkflow(
  context: ApplicationInternals,
  request: ResumeWorkflowRequest,
): Promise<ResumeWorkflowResult> {
  const previous = await context.store.getRun(request.runId);
  if (!previous) throw new Error(`Unknown run: ${request.runId}`);
  if (previous.status === 'completed') {
    return { run: previous, alreadyCompleted: true };
  }
  const workflow = resolveAndValidateWorkflow(context, previous.workflowId);
  validatePersistedRunCompatibility(previous, workflow);
  await preflightPersistedInput(context, previous, workflow);
  if (previous.status === 'running') {
    throw new Error(`Run ${previous.id} is still running; mark it interrupted before recovery`);
  }
  await validateResumeEligibility(context, previous, workflow);
  const claim = await claimRunForExecution(context, previous.id, [
    'pending',
    'failed',
    'interrupted',
  ]);
  const run = await executeClaimedWorkflow(context, workflow, {
    runId: request.runId,
    profiles: context.config.profiles,
    resume: true,
    executionClaim: claim.claim,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
  return { run, alreadyCompleted: false };
}

export interface ApprovalDecisionRequest {
  runId: string;
  decision: 'approved' | 'rejected';
  feedback?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export async function decideApproval(
  context: ApplicationInternals,
  request: ApprovalDecisionRequest,
): Promise<WorkflowRun> {
  const previous = await context.store.getRun(request.runId);
  if (!previous) throw new Error(`Unknown run: ${request.runId}`);
  const workflow = resolveAndValidateWorkflow(context, previous.workflowId);
  validatePersistedRunCompatibility(previous, workflow);
  await preflightPersistedInput(context, previous, workflow);
  const approvalDefinition = researchApproval(workflow);
  if (!approvalDefinition) throw new Error(`Workflow ${workflow.id} has no approval gate`);
  if (previous.status !== 'waiting') {
    throw new Error(`Run ${request.runId} is not waiting for approval`);
  }

  const steps = await context.store.getStepRuns(request.runId);
  const approval = findWaitingApprovalStep(workflow, previous, steps);
  if (!approval) {
    throw new Error(`Run ${request.runId} is not waiting for approval`);
  }
  const feedback = request.feedback?.trim();
  if (request.decision === 'rejected' && !feedback) {
    throw new Error('Rejection feedback must be non-empty');
  }

  const decisionStep: StepRun = {
    ...approval,
    status: 'pending',
    approval: {
      decision: request.decision,
      ...(feedback ? { feedback } : {}),
      decidedAt: new Date().toISOString(),
    },
  };
  const claimed = await context.store.claimApprovalForExecution(request.runId, decisionStep);
  if (!claimed) {
    const current = await context.store.getRun(request.runId);
    if (!current) throw new Error(`Unknown run: ${request.runId}`);
    if (current.status === 'running') throw new Error(`Run ${request.runId} is already running`);
    throw new Error(`Run ${request.runId} is no longer waiting for approval`);
  }

  return executeClaimedWorkflow(context, workflow, {
    runId: request.runId,
    profiles: context.config.profiles,
    resume: true,
    executionClaim: claimed.claim,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
}

async function claimRunForExecution(
  context: Pick<ApplicationInternals, 'store'>,
  runId: string,
  eligibleStatuses: readonly WorkflowRun['status'][],
): Promise<{ run: WorkflowRun; claim: ExecutionClaim }> {
  const claimed = await context.store.claimRunForExecution(runId, eligibleStatuses);
  if (claimed) return claimed;
  const current = await context.store.getRun(runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  if (current.status === 'running') throw new Error(`Run ${runId} is already running`);
  throw new Error(`Run ${runId} is not eligible for execution from status ${current.status}`);
}

function resolveAndValidateWorkflow(
  context: Pick<ApplicationInternals, 'config'>,
  workflowId: string,
): WorkflowDefinition {
  const workflow = resolveWorkflow(workflowId);
  validateWorkflowDefinition(workflow);
  validateWorkflowProfiles(workflow, context.config.profiles);
  return workflow;
}

function researchApproval(workflow: WorkflowDefinition): WorkflowApprovalDefinition | undefined {
  if (workflow.id !== researchPlanBuildWorkflow.id) return undefined;
  return (workflow as typeof researchPlanBuildWorkflow).approval;
}

function validatePersistedRunCompatibility(run: WorkflowRun, workflow: WorkflowDefinition): void {
  if (run.workflowId !== workflow.id) {
    throw new Error(`Run ${run.id} belongs to workflow ${run.workflowId}`);
  }
  if (run.workflowVersion !== workflow.version) {
    throw new WorkflowVersionMismatchError(run.id, run.workflowVersion, workflow.version);
  }
}

async function validateResumeEligibility(
  context: Pick<ApplicationInternals, 'store' | 'artifacts'>,
  run: WorkflowRun,
  workflow: WorkflowDefinition,
): Promise<void> {
  if (run.status !== 'failed' && run.status !== 'interrupted') return;
  if (run.workflowId === planBuildQaWorkflow.id) return;
  if (
    run.workflowId === researchPlanBuildWorkflow.id &&
    (await isResearchIterationExhausted(context, run))
  ) {
    throw new Error(`Run ${run.id} has reached the research iteration limit and is terminal`);
  }
  const steps = await context.store.getStepRuns(run.id);
  const retryable = retryableWorkflowStepIds(workflow, steps).length > 0;
  if (!retryable && !workflowStepsCompleted(workflow, steps)) {
    throw new Error(`Run ${run.id} has no retryable failed, interrupted, or pending steps`);
  }
}

async function preflightPersistedInput(
  context: Pick<ApplicationInternals, 'artifacts' | 'store'>,
  run: WorkflowRun,
  workflow: WorkflowDefinition,
): Promise<void> {
  const inputArtifact = (await context.store.getArtifacts(run.id)).find(
    (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
  );
  if (!inputArtifact) {
    validateWorkflowInput(workflow, { objective: run.objective });
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(await context.artifacts.read(inputArtifact));
  } catch (error) {
    throw new Error(
      `Persisted run input is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(input)) throw new Error('Persisted run input must be a JSON object');
  validateWorkflowInput(workflow, input);
  if (workflow.id === researchPlanBuildWorkflow.id) {
    const iteration = input[RESEARCH_ITERATION_INPUT];
    if (
      typeof iteration !== 'number' ||
      !Number.isInteger(iteration) ||
      iteration < 0 ||
      iteration >= MAX_RESEARCH_ITERATIONS
    ) {
      throw new Error('Persisted research iteration is invalid');
    }
  }
  if (workflow.id === planBuildQaWorkflow.id) {
    const iteration = input[QA_ITERATION_INPUT];
    if (
      typeof iteration !== 'number' ||
      !Number.isInteger(iteration) ||
      iteration < 0 ||
      iteration >= MAX_QA_ITERATIONS
    ) {
      throw new Error('Persisted QA iteration is invalid');
    }
  }
}

async function executeClaimedWorkflow(
  context: ApplicationInternals,
  workflow: WorkflowDefinition,
  request: ExecuteWorkflowRequest,
): Promise<WorkflowRun> {
  try {
    return await executeWorkflow(context, workflow, request);
  } catch (error) {
    // The engine has stopped owning the run. Release its local marker before the
    // explicit recovery transition, leaving the store to perform the CAS.
    if (!request.runId) throw error;
    await context.store.releaseExecution(request.runId);
    await context.store.markRunInterrupted(request.runId);
    throw error;
  }
}

async function executeWorkflow(
  context: ApplicationInternals,
  workflow: WorkflowDefinition,
  request: ExecuteWorkflowRequest,
): Promise<WorkflowRun> {
  if (workflow.id === researchPlanBuildWorkflow.id) {
    return context.researchCoordinator.execute(workflow, request);
  }
  if (workflow.id === planBuildQaWorkflow.id) {
    if (!context.planBuildQaCoordinator) {
      throw new Error('Plan-build-qa coordinator is not configured');
    }
    return context.planBuildQaCoordinator.execute(workflow, request);
  }
  if (workflow.id === planBuildQaInteractiveWorkflow.id) {
    if (!context.interactivePlanBuildQaCoordinator) {
      throw new Error('Interactive review coordinator is not configured');
    }
    return context.interactivePlanBuildQaCoordinator.execute(workflow, request);
  }
  return context.engine.execute(workflow, request);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
