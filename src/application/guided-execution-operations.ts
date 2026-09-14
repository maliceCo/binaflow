import { createHash } from 'node:crypto';
import type { AgentProfile } from '../core/agent-profile.js';
import type { ArtifactReference } from '../core/run.js';
import { renderTaskContractTodo } from './task-contract-render.js';
import { getTaskContractReadiness } from './task-contract.js';
import type {
  ApplicationPreparationArtifactStore,
  ApplicationTaskContractStore,
  GitWorkspace,
  GuidedExecutionStore,
  WorkspaceExecutionLock,
} from './ports.js';
import {
  canonicalizeJson,
  GUIDED_EXECUTION_COORDINATOR_VERSION,
  type GuidedExecutionAuthorization,
  type GuidedExecutionCreateRequest,
  type GuidedExecutionPreview,
  type GuidedExecutionProfile,
  type GuidedExecutionProgress,
  type GuidedExecutionQueries,
  type GuidedExecutionService,
  type GuidedExecutionSnapshot,
  type GuidedResumeDecision,
  type GuidedResumePreview,
  type GuidedResumeRequest,
  type GuidedStartRequest,
} from './guided-execution.js';
import { GUIDED_TASK_BUILD_VERSION } from '../workflows/guided-task-build.js';

export interface GuidedExecutionOperationsContext {
  readonly taskContracts: ApplicationTaskContractStore;
  readonly executions: GuidedExecutionStore;
  readonly artifacts: ApplicationPreparationArtifactStore & {
    read(artifact: ArtifactReference): Promise<string>;
  };
  readonly git: GitWorkspace;
  readonly lock: WorkspaceExecutionLock;
  readonly workspace: string;
  readonly profiles: Record<string, AgentProfile>;
}

export function createGuidedExecutionQueries(
  context: GuidedExecutionOperationsContext,
): GuidedExecutionQueries {
  return {
    previewStart: (request) => previewStart(context, request),
    previewResume: (runId) => previewResume(context, runId),
    get: async (runId) => requireExecution(context, runId),
    list: (query) =>
      context.executions.listGuidedExecutions({
        ...(query?.contractId ? { contractId: query.contractId } : {}),
        workspace: context.workspace,
        ...(query?.limit !== undefined ? { limit: query.limit } : {}),
        ...(query?.cursor ? { cursor: query.cursor } : {}),
      }),
  };
}

export function createGuidedExecutionService(
  context: GuidedExecutionOperationsContext,
): GuidedExecutionService {
  const queries = createGuidedExecutionQueries(context);
  return {
    ...queries,
    start: (request) => start(context, request),
    resume: (request) => resume(context, request),
    cancelWaiting: (runId, reason) => cancelWaiting(context, runId, reason),
  };
}

export async function previewStart(
  context: GuidedExecutionOperationsContext,
  request: { contractId: string; expectedRevision: number; todoVersion: number },
): Promise<GuidedExecutionPreview> {
  assertPositiveInteger(request.expectedRevision, 'expectedRevision');
  assertPositiveInteger(request.todoVersion, 'todoVersion');
  const state = await context.taskContracts.getTaskContract(context.workspace, request.contractId);
  if (!state) throw new Error(`Unknown task contract: ${request.contractId}`);
  if (state.contract.revision !== request.expectedRevision)
    throw new Error('Task contract revision is stale');
  const readiness = getTaskContractReadiness({
    brief: { id: state.currentBrief.id, version: state.currentBrief.version },
    plan: state.currentPlan
      ? {
          id: state.currentPlan.id,
          version: state.currentPlan.version,
          briefVersion: state.currentPlan.body.briefVersion,
        }
      : null,
    approvedPlan: state.approvedPlan
      ? {
          id: state.approvedPlan.id,
          version: state.approvedPlan.version,
          briefVersion: state.approvedPlan.body.briefVersion,
        }
      : null,
    todo: state.currentTodo
      ? {
          id: state.currentTodo.id,
          version: state.currentTodo.version,
          planVersion: state.currentTodo.body.planVersion,
        }
      : null,
    activeBlock: state.activeBlock ? { id: state.activeBlock.id } : null,
  });
  if (readiness !== 'ready' || !state.currentPlan || !state.currentTodo || !state.approval) {
    throw new Error('Task contract is not ready for guided execution');
  }
  if (state.currentTodo.version !== request.todoVersion)
    throw new Error('Task contract TODO version is stale');
  if (state.execution)
    throw new Error(`Task contract is already linked to ${state.execution.runId}`);

  const profile = context.profiles.builder;
  if (!profile) throw new Error('Builder profile is not configured');
  if (profile.driver !== 'pi' || profile.workspaceMode !== 'read-write') {
    throw new Error('Guided execution requires a read-write builder profile');
  }
  if (profile.retryLimit !== 0) throw new Error('Guided execution requires builder retryLimit = 0');
  const git = await context.git.preflight(context.workspace);
  const commands = unique([
    ...state.currentPlan.body.verification,
    ...state.currentTodo.body.phases.flatMap((phase) =>
      phase.tasks.flatMap((task) => task.verification),
    ),
  ]).map((command) => ({ command, shell: true as const }));
  const files = unique(
    state.currentTodo.body.phases.flatMap((phase) => phase.tasks.flatMap((task) => task.files)),
  );
  const snapshot: GuidedExecutionSnapshot = {
    contractId: state.contract.id,
    contractRevision: state.contract.revision,
    coordinatorVersion: GUIDED_EXECUTION_COORDINATOR_VERSION,
    workflowVersion: GUIDED_TASK_BUILD_VERSION,
    workspace: git.workspace,
    objective: state.currentBrief.body.objective,
    brief: state.currentBrief,
    plan: state.currentPlan,
    todo: state.currentTodo,
    approval: state.approval,
    profile: snapshotProfile('builder', profile),
    git,
    commands,
    files,
  };
  const authorization: GuidedExecutionAuthorization = {
    contractId: snapshot.contractId,
    contractRevision: snapshot.contractRevision,
    todoVersion: snapshot.todo.version,
    coordinatorVersion: snapshot.coordinatorVersion,
    workflowVersion: snapshot.workflowVersion,
    workspace: snapshot.workspace,
    documents: {
      briefId: snapshot.brief.id,
      briefVersion: snapshot.brief.version,
      planId: snapshot.plan.id,
      planVersion: snapshot.plan.version,
      todoId: snapshot.todo.id,
      todoVersion: snapshot.todo.version,
      approvalId: snapshot.approval.id,
    },
    profile: snapshot.profile,
    commands,
    files,
    branch: git.branch,
    head: git.head,
  };
  const todoMarkdown = renderTaskContractTodo({
    contractId: state.contract.id,
    brief: state.currentBrief,
    plan: state.currentPlan,
    todo: state.currentTodo,
    readiness,
    current: true,
    approvedPlanId: state.contract.approvedPlanId,
    activeBlock: state.activeBlock,
  });
  return {
    authorization,
    todoMarkdown: { fileName: 'TODO.md', content: todoMarkdown },
    git,
    digest: digest(authorization),
  };
}

export async function start(
  context: GuidedExecutionOperationsContext,
  request: GuidedStartRequest,
): Promise<GuidedExecutionProgress> {
  assertUuidV4(request.requestId, 'requestId');
  assertPositiveInteger(request.expectedRevision, 'expectedRevision');
  assertPositiveInteger(request.todoVersion, 'todoVersion');
  const existing = await context.executions.getGuidedExecutionRequest(request.requestId);
  if (existing) {
    if (
      existing.contractId !== request.contractId ||
      existing.authorizationDigest !== request.previewDigest
    ) {
      throw new Error('Guided execution request replay has different content');
    }
    return requireExecution(context, `guided-${request.requestId}`);
  }

  const lease = await context.lock.acquire(context.workspace);
  const created: ArtifactReference[] = [];
  try {
    const preview = await previewStart(context, request);
    if (preview.digest !== request.previewDigest) throw new Error('Guided start preview is stale');
    const runId = `guided-${request.requestId}`;
    const snapshot = await snapshotForStart(context, request, preview);
    const snapshotArtifact = await writeArtifact(
      context,
      created,
      runId,
      'execution',
      'execution.SNAPSHOT.json',
      'json',
      JSON.stringify(snapshot),
    );
    const todoArtifact = await writeArtifact(
      context,
      created,
      runId,
      'execution',
      'execution.TODO.md',
      'text',
      preview.todoMarkdown.content,
    );
    const inputArtifact = await writeArtifact(
      context,
      created,
      runId,
      'run',
      'input',
      'json',
      JSON.stringify({
        objective: snapshot.objective,
        contractId: request.contractId,
        todoVersion: request.todoVersion,
      }),
    );
    const createRequest: GuidedExecutionCreateRequest = {
      requestId: request.requestId,
      snapshot,
      snapshotArtifact,
      todoArtifact,
      inputArtifact,
      authorizationDigest: preview.digest,
    };
    return await context.executions.createGuidedExecution(createRequest);
  } catch (error) {
    for (const artifact of created) await context.artifacts.remove(artifact).catch(() => undefined);
    throw error;
  } finally {
    await lease.release();
  }
}

export async function previewResume(
  context: GuidedExecutionOperationsContext,
  runId: string,
): Promise<GuidedResumePreview> {
  const progress = await requireExecution(context, runId);
  const allowedDecisions: GuidedResumeDecision[] =
    progress.status === 'waiting'
      ? ['retry-task', 'retry-verification', 'continue', 'reconcile-commit', 'cancel']
      : [];
  return {
    runId,
    revision: progress.revision,
    status: progress.status,
    activeBlock: progress.activeBlock,
    allowedDecisions,
    digest: digest({
      runId,
      revision: progress.revision,
      status: progress.status,
      activeBlock: progress.activeBlock,
      allowedDecisions,
    }),
  };
}

export async function resume(
  context: GuidedExecutionOperationsContext,
  request: GuidedResumeRequest,
): Promise<GuidedExecutionProgress> {
  if (!request.reason.trim()) throw new Error('Resume reason must be non-empty');
  const preview = await previewResume(context, request.runId);
  if (preview.revision !== request.expectedRevision)
    throw new Error('Guided execution revision is stale');
  if (preview.digest !== request.previewDigest) throw new Error('Guided resume preview is stale');
  if (!preview.allowedDecisions.includes(request.decision))
    throw new Error(`Resume decision is not allowed: ${request.decision}`);
  const lease = await context.lock.acquire(context.workspace);
  try {
    const claim = await context.executions.claimGuidedExecution(request.runId, [
      'waiting',
      'failed',
      'interrupted',
      'pending',
    ]);
    if (!claim) throw new Error(`Guided execution ${request.runId} is not available for recovery`);
    try {
      const current = await requireExecution(context, request.runId);
      const next = applyResumeDecision(current, request.decision);
      return await context.executions
        .saveGuidedProgress(next, current.revision, claim)
        .then(() => next);
    } finally {
      await context.executions.releaseGuidedExecution(request.runId, claim);
    }
  } finally {
    await lease.release();
  }
}

export async function cancelWaiting(
  context: GuidedExecutionOperationsContext,
  runId: string,
  reason: string,
): Promise<GuidedExecutionProgress> {
  const preview = await previewResume(context, runId);
  return resume(context, {
    runId,
    expectedRevision: preview.revision,
    previewDigest: preview.digest,
    decision: 'cancel',
    reason,
  });
}

function applyResumeDecision(
  progress: GuidedExecutionProgress,
  decision: GuidedResumeDecision,
): GuidedExecutionProgress {
  if (decision === 'cancel') {
    return {
      ...progress,
      revision: progress.revision + 1,
      status: 'cancelled',
      nextAction: 'none',
    };
  }
  if (decision === 'retry-task') {
    return {
      ...progress,
      revision: progress.revision + 1,
      status: 'running',
      activeBlock: null,
      nextAction: 'execute',
      phases: progress.phases.map((phase) => ({
        ...phase,
        tasks: phase.tasks.map((task) =>
          progress.activeBlock?.taskId === task.id
            ? { ...task, status: 'pending' as const, attempt: task.attempt + 1 }
            : task,
        ),
      })),
    };
  }
  return {
    ...progress,
    revision: progress.revision + 1,
    status: 'running',
    activeBlock: null,
    nextAction: 'execute',
  };
}

async function snapshotForStart(
  context: GuidedExecutionOperationsContext,
  request: { contractId: string; expectedRevision: number; todoVersion: number },
  preview: GuidedExecutionPreview,
): Promise<GuidedExecutionSnapshot> {
  const state = await context.taskContracts.getTaskContract(context.workspace, request.contractId);
  if (!state?.currentPlan || !state.currentTodo || !state.approval)
    throw new Error('Guided task contract changed during start');
  if (
    state.contract.revision !== request.expectedRevision ||
    state.currentTodo.version !== request.todoVersion
  ) {
    throw new Error('Guided task contract changed during start');
  }
  return {
    contractId: request.contractId,
    contractRevision: state.contract.revision,
    coordinatorVersion: GUIDED_EXECUTION_COORDINATOR_VERSION,
    workflowVersion: GUIDED_TASK_BUILD_VERSION,
    workspace: preview.authorization.workspace,
    objective: state.currentBrief.body.objective,
    brief: state.currentBrief,
    plan: state.currentPlan,
    todo: state.currentTodo,
    approval: state.approval,
    profile: preview.authorization.profile,
    git: preview.git,
    commands: preview.authorization.commands,
    files: preview.authorization.files,
  };
}

async function writeArtifact(
  context: GuidedExecutionOperationsContext,
  created: ArtifactReference[],
  runId: string,
  stepId: string,
  name: string,
  kind: 'json' | 'text',
  content: string,
): Promise<ArtifactReference> {
  const artifact = await context.artifacts.write(
    runId,
    stepId,
    name,
    kind,
    content,
    kind === 'json' ? 'application/json' : 'text/markdown',
  );
  created.push(artifact);
  return artifact;
}

async function requireExecution(
  context: GuidedExecutionOperationsContext,
  runId: string,
): Promise<GuidedExecutionProgress> {
  const progress = await context.executions.getGuidedExecution(runId);
  if (!progress) throw new Error(`Unknown guided execution: ${runId}`);
  return progress;
}

function snapshotProfile(name: string, profile: AgentProfile): GuidedExecutionProfile {
  return { name, ...profile };
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function assertUuidV4(value: string, name: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`${name} must be a canonical UUID v4`);
  }
}
