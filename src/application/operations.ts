import type { ArtifactStore } from '../artifacts/artifact-store.js';
import { validateAgentProfile, type AgentProfile, type BinaflowConfig } from '../config.js';
import {
  validateWorkflowInput,
  WorkflowVersionMismatchError,
  type ExecuteWorkflowRequest,
  type WorkflowEngine,
} from '../core/engine.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';
import type { RunListPage, RunListQuery, RunStore } from '../storage/run-store.js';
import {
  listWorkflowContracts,
  resolveWorkflow,
  type WorkflowContract,
} from '../workflows/catalog.js';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';

export interface ApplicationContext {
  config: Pick<BinaflowConfig, 'profiles'>;
  store: RunStore;
  artifacts: ArtifactStore;
  engine: WorkflowEngine;
  subscribeEvents?(listener: (event: NormalizedEvent) => void): () => void;
}

export interface RunWorkflowRequest {
  workflowId: string;
  objective: string;
  input: Record<string, unknown>;
  runId?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export async function runWorkflow(
  context: ApplicationContext,
  request: RunWorkflowRequest,
): Promise<WorkflowRun> {
  const workflow = resolveAndValidateWorkflow(context, request.workflowId);
  return context.engine.execute(workflow, {
    objective: request.objective,
    input: { ...request.input, objective: request.objective },
    profiles: context.config.profiles,
    ...(request.runId ? { runId: request.runId } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
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
  context: ApplicationContext,
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
  await validateResumeEligibility(context, previous);
  await claimRunForExecution(context, previous.id, ['pending', 'failed', 'interrupted']);
  const run = await executeClaimedWorkflow(context, workflow, {
    runId: request.runId,
    profiles: context.config.profiles,
    resume: true,
    runClaimed: true,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
  return { run, alreadyCompleted: false };
}

export interface RunInspection {
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: ArtifactReference[];
  eventCount: number;
  events?: Awaited<ReturnType<RunStore['getEvents']>>;
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
  context: Pick<ApplicationContext, 'store'>,
  runId: string,
): Promise<RunRecoveryExplanation> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const steps = await context.store.getStepRuns(runId);
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
  const retryableStepIds = steps
    .filter(
      (step) =>
        step.status === 'pending' ||
        step.status === 'interrupted' ||
        (step.status === 'failed' && step.error?.retryable === true),
    )
    .map((step) => step.stepId);

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
  if (run.status === 'failed' && retryableStepIds.length === 0) {
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

export async function markRunInterrupted(
  context: Pick<ApplicationContext, 'store'>,
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

export interface ArtifactContentView {
  artifact: ArtifactReference;
  content?: string;
  truncated: boolean;
  formatted: boolean;
  error?: string;
}

export interface ReadArtifactOptions {
  mode?: 'preview' | 'full';
  format?: 'raw' | 'text' | 'json';
  maxBytes?: number;
}

const ARTIFACT_PREVIEW_BYTES = 4_000;
const MAX_ARTIFACT_PREVIEW_BYTES = 64_000;
const MAX_CLARIFICATION_PLAN_BYTES = 64_000;

export async function readArtifact(
  context: Pick<ApplicationContext, 'store' | 'artifacts'>,
  runId: string,
  artifactKey: string,
  options: ReadArtifactOptions = {},
): Promise<ArtifactContentView> {
  const artifact = (await context.store.getArtifacts(runId)).find(
    (candidate) =>
      candidate.id === artifactKey || `${candidate.stepId}.${candidate.name}` === artifactKey,
  );
  if (!artifact) throw new Error(`Unknown artifact for run ${runId}: ${artifactKey}`);
  const mode = options.mode ?? 'preview';
  try {
    if (mode === 'full') {
      return formatArtifactContent(artifact, await context.artifacts.read(artifact), false);
    }
    const maxBytes = options.maxBytes ?? ARTIFACT_PREVIEW_BYTES;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARTIFACT_PREVIEW_BYTES) {
      throw new Error(
        `Artifact preview limit must be between 1 and ${MAX_ARTIFACT_PREVIEW_BYTES} bytes`,
      );
    }
    const bounded = await context.artifacts.readBounded(artifact, maxBytes);
    return formatArtifactContent(artifact, bounded.content, bounded.truncated);
  } catch (error) {
    return {
      artifact,
      truncated: false,
      formatted: false,
      error: `Artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function formatArtifactContent(
  artifact: ArtifactReference,
  content: string,
  truncated: boolean,
): ArtifactContentView {
  if (artifact.kind !== 'json') return { artifact, content, truncated, formatted: false };
  if (truncated) {
    return {
      artifact,
      content,
      truncated,
      formatted: false,
      error: 'JSON preview is truncated; use full viewing for formatted JSON.',
    };
  }
  try {
    return {
      artifact,
      content: JSON.stringify(JSON.parse(content) as unknown, null, 2),
      truncated: false,
      formatted: true,
    };
  } catch (error) {
    return {
      artifact,
      content,
      truncated,
      formatted: false,
      error: `Artifact JSON is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function loadResearchApprovalPreviews(
  context: Pick<ApplicationContext, 'store' | 'artifacts'>,
  inspection: RunInspection,
): Promise<ArtifactContentView[]> {
  const selected = inspection.artifacts.filter(
    (artifact) =>
      (artifact.stepId === 'research' && artifact.name === 'report') ||
      (artifact.stepId === 'research-review' && artifact.name === 'review'),
  );
  return Promise.all(
    selected.map(async (artifact) => {
      try {
        return await readArtifact(
          context,
          inspection.run.id,
          `${artifact.stepId}.${artifact.name}`,
        );
      } catch (error) {
        return {
          artifact,
          truncated: false,
          formatted: false,
          error: `Artifact preview cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}

export async function clarificationQuestions(
  context: Pick<ApplicationContext, 'store' | 'artifacts'>,
  inspection: RunInspection,
): Promise<string[]> {
  const disposition = inspection.steps.find(
    (step) => step.disposition?.kind === 'stop',
  )?.disposition;
  if (
    !disposition ||
    disposition.kind !== 'stop' ||
    disposition.code !== 'PLAN_NEEDS_CLARIFICATION'
  ) {
    return [];
  }
  const plan = inspection.artifacts.find((artifact) => artifact.name === 'plan');
  if (plan) {
    try {
      const bounded = await context.artifacts.readBounded(plan, MAX_CLARIFICATION_PLAN_BYTES);
      if (!bounded.truncated) {
        const value = JSON.parse(bounded.content) as Record<string, unknown>;
        if (Array.isArray(value.clarificationQuestions)) {
          const questions = value.clarificationQuestions.filter(
            (question): question is string =>
              typeof question === 'string' && question.trim().length > 0,
          );
          if (questions.length > 0) return questions;
        }
      }
    } catch {
      // The artifact view reports corrupt content separately.
    }
  }
  return disposition.message ? [disposition.message] : [];
}

export async function listRuns(
  context: Pick<ApplicationContext, 'store'>,
  query: RunListQuery = {},
): Promise<RunListPage> {
  return context.store.listRunsPage(query);
}

export interface RunInspectionOptions {
  includeEvents?: boolean;
  includeStepResults?: boolean;
}

export async function inspectRun(
  context: Pick<ApplicationContext, 'store'>,
  runId: string,
  options: RunInspectionOptions = {},
): Promise<RunInspection> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const [steps, artifacts, eventCount] = await Promise.all([
    context.store.getStepRuns(runId, { includeResult: options.includeStepResults === true }),
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

export interface ApprovalDecisionRequest {
  runId: string;
  decision: 'approved' | 'rejected';
  feedback?: string;
  signal?: AbortSignal;
  onRunStarted?: ExecuteWorkflowRequest['onRunStarted'];
}

export async function decideApproval(
  context: ApplicationContext,
  request: ApprovalDecisionRequest,
): Promise<WorkflowRun> {
  const previous = await context.store.getRun(request.runId);
  if (!previous) throw new Error(`Unknown run: ${request.runId}`);
  const workflow = resolveAndValidateWorkflow(context, previous.workflowId);
  validatePersistedRunCompatibility(previous, workflow);
  await preflightPersistedInput(context, previous, workflow);
  if (!workflow.approval) throw new Error(`Workflow ${workflow.id} has no approval gate`);
  if (previous.status !== 'waiting') {
    throw new Error(`Run ${request.runId} is not waiting for approval`);
  }

  const steps = await context.store.getStepRuns(request.runId);
  const approval = steps.find((step) => step.stepId === workflow.approval?.id);
  if (!approval || approval.status !== 'waiting') {
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
  const claimed = await context.store.claimApproval(request.runId, decisionStep);
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
    runClaimed: true,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
}

async function claimRunForExecution(
  context: Pick<ApplicationContext, 'store'>,
  runId: string,
  eligibleStatuses: readonly WorkflowRun['status'][],
): Promise<WorkflowRun> {
  const claimed = await context.store.claimRun(runId, eligibleStatuses);
  if (claimed) return claimed;
  const current = await context.store.getRun(runId);
  if (!current) throw new Error(`Unknown run: ${runId}`);
  if (current.status === 'running') throw new Error(`Run ${runId} is already running`);
  throw new Error(`Run ${runId} is not eligible for execution from status ${current.status}`);
}

export function discoverWorkflows(): WorkflowContract[] {
  return listWorkflowContracts();
}

export interface WorkflowConfigurationDiagnosis {
  id: string;
  experimental?: boolean;
  requiredProfiles: string[];
  missingProfiles: string[];
}

export interface ConfigurationDiagnosis {
  configuredProfiles: string[];
  workflows: WorkflowConfigurationDiagnosis[];
}

export function diagnoseConfiguration(
  config: Pick<BinaflowConfig, 'profiles'>,
): ConfigurationDiagnosis {
  const configuredProfiles = Object.keys(config.profiles).sort();
  return {
    configuredProfiles,
    workflows: discoverWorkflows().map((workflow) => ({
      id: workflow.id,
      ...(workflow.experimental ? { experimental: true } : {}),
      requiredProfiles: workflow.requiredProfiles,
      missingProfiles: workflow.requiredProfiles.filter((profile) => !config.profiles[profile]),
    })),
  };
}

function resolveAndValidateWorkflow(
  context: Pick<ApplicationContext, 'config'>,
  workflowId: string,
): WorkflowDefinition {
  const workflow = resolveWorkflow(workflowId);
  validateWorkflowDefinition(workflow);
  validateWorkflowProfiles(workflow, context.config.profiles);
  return workflow;
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
  context: Pick<ApplicationContext, 'store'>,
  run: WorkflowRun,
): Promise<void> {
  if (run.status !== 'failed' && run.status !== 'interrupted') return;
  const steps = await context.store.getStepRuns(run.id);
  const retryable = steps.some(
    (step) =>
      step.status === 'pending' ||
      step.status === 'interrupted' ||
      (step.status === 'failed' && step.error?.retryable === true),
  );
  if (!retryable) {
    throw new Error(`Run ${run.id} has no retryable failed, interrupted, or pending steps`);
  }
}

async function preflightPersistedInput(
  context: Pick<ApplicationContext, 'artifacts' | 'store'>,
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
}

async function executeClaimedWorkflow(
  context: ApplicationContext,
  workflow: WorkflowDefinition,
  request: ExecuteWorkflowRequest,
): Promise<WorkflowRun> {
  try {
    return await context.engine.execute(workflow, request);
  } catch (error) {
    // The engine has stopped owning the run. Release its local marker before the
    // explicit recovery transition, leaving the store to perform the CAS.
    if (!request.runId) throw error;
    await context.store.releaseExecution(request.runId);
    await context.store.markRunInterrupted(request.runId);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateWorkflowProfiles(
  workflow: WorkflowDefinition,
  profiles: Record<string, AgentProfile>,
): void {
  const required = [...new Set(workflow.steps.map((step) => step.profile))];
  const missing = required.filter((profile) => !profiles[profile]);
  if (missing.length > 0) {
    throw new Error(
      `Missing agent profile(s): ${missing.join(', ')}. Add them to .binaflow/config.json`,
    );
  }
  for (const name of required) {
    const validation = validateAgentProfile(name, profiles[name]);
    if (validation.errors.length > 0) {
      throw new Error(`Profile ${name} has invalid configuration: ${validation.errors.join('; ')}`);
    }
  }
}
