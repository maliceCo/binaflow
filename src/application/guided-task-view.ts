import type {
  GuidedExecutionBlock,
  GuidedExecutionQueries,
  GuidedExecutionProgress,
  GuidedExecutionTaskProgress,
} from './guided-execution.js';
import type {
  GuidedPreparationMessage,
  GuidedPreparationSource,
  GuidedPreparationState,
  GuidedPreparationRequestRecord,
} from './guided-preparation.js';
import type {
  ApplicationTaskContractStore,
  GuidedExecutionStore,
  GuidedPreparationStore,
} from './ports.js';
import { createTaskContractQueries } from './task-contract-operations.js';
import type {
  TaskContractAction,
  TaskContractDocument,
  TaskContractDocumentHeader,
  TaskContractQueries,
  TaskContractReadiness,
  TaskContractView,
  TaskContractBrief,
  TaskContractPlan,
  TaskContractTodo,
} from './task-contract.js';

export const GUIDED_TASK_VIEW_DEFAULT_LIMIT = 50 as const;

export interface GuidedTaskListQuery {
  afterId?: string;
  limit?: number;
}

export interface GuidedTaskDetailQuery {
  actionsAfterSequence?: number;
  messagesAfterSequence?: number;
  sourcesAfterSequence?: number;
  limit?: number;
}

export interface GuidedTaskSummaryView {
  id: string;
  revision: number;
  readiness: TaskContractReadiness;
  phase: TaskContractView['contract']['phase'];
  brief: TaskContractDocumentHeader;
  plan: TaskContractDocumentHeader | null;
  approvedPlan: TaskContractDocumentHeader | null;
  todo: TaskContractDocumentHeader | null;
  executionRunId?: string;
}

export interface GuidedTaskSummaryPage {
  items: GuidedTaskSummaryView[];
  nextCursor?: string;
}

export type GuidedTaskDocument<T> = TaskContractDocument<T>;

export interface GuidedTaskAction {
  id: string;
  sequence: number;
  kind: TaskContractAction['kind'];
  targetDocumentId: string;
  relatedActionId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface GuidedPreparationMessageView {
  id: string;
  sequence: number;
  role: GuidedPreparationMessage['role'];
  content: string;
  createdAt: string;
  metadata?: GuidedPreparationMessage['metadata'];
}

export interface GuidedPreparationSourceView {
  id: string;
  sequence: number;
  kind: GuidedPreparationSource['kind'];
  url: string;
  title: string;
  excerpt: string;
  query?: string;
  retrievedAt: string;
  truncated: boolean;
}

export interface GuidedPreparationOperationView {
  requestId: string;
  operationId: string;
  kind: GuidedPreparationRequestRecord['kind'];
  preparationRevision: number;
  contractRevision: number;
  status: GuidedPreparationRequestRecord['status'];
  errorCode?: string;
  publishedDocumentId?: string;
  resultExternalSessionId?: string;
  resultSessionThroughSequence?: number;
}

export interface GuidedPreparationView {
  revision: number;
  lastSequence: number;
  briefConfirmedThroughSequence: number;
  confirmedSourceIds: string[];
  messagesCompactedThroughSequence: number;
  sessionRecoveredAt?: string;
  draftBrief?: TaskContractBrief;
  activeOperation: GuidedPreparationOperationView | null;
  planVersion: number | null;
  todoVersion: number | null;
  messages: {
    items: GuidedPreparationMessageView[];
    nextCursor?: number;
  };
  sources: {
    items: GuidedPreparationSourceView[];
    nextCursor?: number;
  };
}

export interface GuidedTaskDetailView extends GuidedTaskSummaryView {
  createdAt: string;
  updatedAt: string;
  contractVersion: number;
  brief: GuidedTaskDocument<TaskContractBrief>;
  plan: GuidedTaskDocument<TaskContractPlan> | null;
  approvedPlan: GuidedTaskDocument<TaskContractPlan> | null;
  todo: GuidedTaskDocument<TaskContractTodo> | null;
  actions: {
    items: GuidedTaskAction[];
    nextCursor?: number;
  };
  preparation: GuidedPreparationView | null;
  execution: GuidedExecutionProgressView | null;
}

export interface GuidedExecutionArtifactView {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: 'json' | 'text';
  mediaType: string;
  sizeBytes: number;
}

export interface GuidedExecutionGitStateView {
  branch: string;
  head: string;
  clean: boolean;
  changes: Array<{
    path: string;
    status: string;
    mode: string;
    contentHash: string | null;
  }>;
}

export interface GuidedExecutionBlockView {
  id: string;
  revision: number;
  phaseId: string;
  taskId?: string;
  type: GuidedExecutionBlock['type'];
  reason: string;
  evidence: GuidedExecutionArtifactView[];
  fingerprint?: GuidedExecutionGitStateView;
}

export interface GuidedExecutionTaskProgressView {
  id: string;
  phaseId: string;
  ordinal: number;
  status: GuidedExecutionTaskProgress['status'];
  attempt: number;
  agentStepId?: string;
  resultArtifact?: GuidedExecutionArtifactView;
  verificationArtifact?: GuidedExecutionArtifactView;
}

export interface GuidedExecutionProgressView {
  runId: string;
  contractId: string;
  revision: number;
  stage: GuidedExecutionProgress['stage'];
  status: GuidedExecutionProgress['status'];
  phases: Array<{
    id: string;
    ordinal: number;
    title: string;
    status: GuidedExecutionProgress['status'];
    tasks: GuidedExecutionTaskProgressView[];
    commitSha?: string;
    noChanges?: boolean;
  }>;
  activeBlock: GuidedExecutionBlockView | null;
  nextAction: GuidedExecutionProgress['nextAction'];
}

export interface GuidedTaskViewQueries {
  listGuidedTaskViews(query?: GuidedTaskListQuery): Promise<GuidedTaskSummaryPage>;
  getGuidedTaskView(
    contractId: string,
    query?: GuidedTaskDetailQuery,
  ): Promise<GuidedTaskDetailView>;
}

export interface GuidedPreparationViewQueries {
  getState(contractId: string): Promise<GuidedPreparationState | undefined>;
  listMessages(
    contractId: string,
    afterSequence?: number,
    limit?: number,
  ): Promise<{ items: GuidedPreparationMessage[]; nextCursor?: number }>;
  listSources(
    contractId: string,
    afterSequence?: number,
    limit?: number,
  ): Promise<{ items: GuidedPreparationSource[]; nextCursor?: number }>;
}

export interface GuidedTaskViewContext {
  taskContracts: TaskContractQueries;
  preparation?: GuidedPreparationViewQueries;
  executions?: GuidedExecutionQueries;
}

export function createGuidedTaskViewQueries(context: GuidedTaskViewContext): GuidedTaskViewQueries {
  return {
    listGuidedTaskViews: (query) => listGuidedTaskViews(context, query),
    getGuidedTaskView: (contractId, query) => getGuidedTaskView(context, contractId, query),
  };
}

export function createGuidedTaskPreparationQueries(
  store: Pick<
    GuidedPreparationStore,
    'getGuidedPreparation' | 'listGuidedPreparationMessages' | 'listGuidedPreparationSources'
  >,
  workspace: string,
): GuidedPreparationViewQueries {
  return {
    getState: (contractId) => store.getGuidedPreparation(workspace, contractId),
    listMessages: (contractId, afterSequence, limit) =>
      store.listGuidedPreparationMessages({
        workspace,
        contractId,
        ...(afterSequence === undefined ? {} : { afterSequence }),
        ...(limit === undefined ? {} : { limit }),
      }),
    listSources: (contractId, afterSequence, limit) =>
      store.listGuidedPreparationSources({
        workspace,
        contractId,
        ...(afterSequence === undefined ? {} : { afterSequence }),
        ...(limit === undefined ? {} : { limit }),
      }),
  };
}

export function createGuidedTaskExecutionQueries(
  store: Pick<GuidedExecutionStore, 'getGuidedExecution' | 'listGuidedExecutions'>,
  workspace: string,
): GuidedExecutionQueries {
  return {
    previewStart: async () => {
      throw new Error('Guided execution start preview is unavailable in a read-only context');
    },
    previewResume: async () => {
      throw new Error('Guided execution resume preview is unavailable in a read-only context');
    },
    get: async (runId) => {
      const progress = await store.getGuidedExecution(runId);
      if (!progress) throw new Error(`Unknown guided execution: ${runId}`);
      return progress;
    },
    list: (query) =>
      store
        .listGuidedExecutions({
          workspace,
          ...(query?.contractId ? { contractId: query.contractId } : {}),
          ...(query?.limit === undefined ? {} : { limit: query.limit }),
          ...(query?.cursor ? { cursor: query.cursor } : {}),
        })
        .then((page) => ({
          items: page.items,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        })),
  };
}

export function toGuidedExecutionProgressView(
  progress: GuidedExecutionProgress,
): GuidedExecutionProgressView {
  return {
    runId: progress.runId,
    contractId: progress.contractId,
    revision: progress.revision,
    stage: progress.stage,
    status: progress.status,
    phases: progress.phases.map((phase) => ({
      id: phase.id,
      ordinal: phase.ordinal,
      title: phase.title,
      status: phase.status,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        phaseId: task.phaseId,
        ordinal: task.ordinal,
        status: task.status,
        attempt: task.attempt,
        ...(task.agentStepId ? { agentStepId: task.agentStepId } : {}),
        ...(task.resultArtifact ? { resultArtifact: toArtifactView(task.resultArtifact) } : {}),
        ...(task.verificationArtifact
          ? { verificationArtifact: toArtifactView(task.verificationArtifact) }
          : {}),
      })),
      ...(phase.commitSha ? { commitSha: phase.commitSha } : {}),
      ...(phase.noChanges === undefined ? {} : { noChanges: phase.noChanges }),
    })),
    activeBlock: progress.activeBlock ? toBlockView(progress.activeBlock) : null,
    nextAction: progress.nextAction,
  };
}

export async function listGuidedTaskViews(
  context: GuidedTaskViewContext,
  query?: GuidedTaskListQuery,
): Promise<GuidedTaskSummaryPage> {
  const page = await context.taskContracts.list({
    ...(query?.afterId ? { afterId: query.afterId } : {}),
    limit: query?.limit ?? GUIDED_TASK_VIEW_DEFAULT_LIMIT,
  });
  const tasks = await Promise.all(
    page.items.map((contract) => context.taskContracts.get(contract.id)),
  );
  return {
    items: tasks.map(toSummaryView),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };
}

export async function getGuidedTaskView(
  context: GuidedTaskViewContext,
  contractId: string,
  query?: GuidedTaskDetailQuery,
): Promise<GuidedTaskDetailView> {
  const task = await context.taskContracts.get(contractId);
  const limit = query?.limit ?? GUIDED_TASK_VIEW_DEFAULT_LIMIT;
  const [brief, plan, approvedPlan, todo, actions, preparationState] = await Promise.all([
    context.taskContracts
      .getDocument({
        contractId,
        kind: 'brief',
        version: task.currentBrief.version,
      })
      .then((document) => document as GuidedTaskDocument<TaskContractBrief>),
    getOptionalDocument<TaskContractPlan>(
      context.taskContracts,
      contractId,
      task.currentPlan,
      'plan',
    ),
    getOptionalDocument<TaskContractPlan>(
      context.taskContracts,
      contractId,
      task.approvedPlan,
      'plan',
    ),
    getOptionalDocument<TaskContractTodo>(
      context.taskContracts,
      contractId,
      task.currentTodo,
      'todo',
    ),
    context.taskContracts.listActions({
      contractId,
      ...(query?.actionsAfterSequence === undefined
        ? {}
        : { afterSequence: query.actionsAfterSequence }),
      limit,
    }),
    context.preparation?.getState(contractId) ?? Promise.resolve(undefined),
  ]);

  const [messages, sources] = await Promise.all([
    context.preparation && preparationState
      ? context.preparation.listMessages(contractId, query?.messagesAfterSequence, limit)
      : Promise.resolve({ items: [] as GuidedPreparationMessage[], nextCursor: undefined }),
    context.preparation && preparationState
      ? context.preparation.listSources(contractId, query?.sourcesAfterSequence, limit)
      : Promise.resolve({ items: [] as GuidedPreparationSource[], nextCursor: undefined }),
  ]);
  const execution =
    task.execution && context.executions
      ? await context.executions.get(task.execution.runId)
      : null;

  return {
    ...toSummaryView(task),
    createdAt: task.contract.createdAt,
    updatedAt: task.contract.updatedAt,
    contractVersion: task.contract.contractVersion,
    brief,
    plan,
    approvedPlan,
    todo,
    actions: {
      items: actions.items.map(toActionView),
      ...(actions.nextCursor === undefined ? {} : { nextCursor: actions.nextCursor }),
    },
    preparation: preparationState
      ? {
          revision: preparationState.revision,
          lastSequence: preparationState.lastSequence,
          briefConfirmedThroughSequence: preparationState.briefConfirmedThroughSequence,
          confirmedSourceIds: [...preparationState.confirmedSourceIds],
          messagesCompactedThroughSequence: preparationState.messagesCompactedThroughSequence ?? 0,
          ...(preparationState.sessionRecoveredAt
            ? { sessionRecoveredAt: preparationState.sessionRecoveredAt }
            : {}),
          ...(preparationState.draftBrief ? { draftBrief: preparationState.draftBrief } : {}),
          activeOperation: preparationState.activeOperation
            ? toPreparationOperationView(preparationState.activeOperation)
            : null,
          planVersion: preparationState.planVersion,
          todoVersion: preparationState.todoVersion,
          messages: {
            items: messages.items.map(toMessageView),
            ...(messages.nextCursor === undefined ? {} : { nextCursor: messages.nextCursor }),
          },
          sources: {
            items: sources.items.map(toSourceView),
            ...(sources.nextCursor === undefined ? {} : { nextCursor: sources.nextCursor }),
          },
        }
      : null,
    execution: execution ? toGuidedExecutionProgressView(execution) : null,
  };
}

function toSummaryView(task: TaskContractView): GuidedTaskSummaryView {
  return {
    id: task.contract.id,
    revision: task.contract.revision,
    readiness: task.readiness,
    phase: task.contract.phase,
    brief: task.currentBrief,
    plan: task.currentPlan,
    approvedPlan: task.approvedPlan,
    todo: task.currentTodo,
    ...(task.execution ? { executionRunId: task.execution.runId } : {}),
  };
}

async function getOptionalDocument<T extends TaskContractPlan | TaskContractTodo>(
  queries: TaskContractQueries,
  contractId: string,
  header: TaskContractDocumentHeader | null,
  kind: 'plan' | 'todo',
): Promise<TaskContractDocument<T> | null> {
  if (!header) return null;
  return (await queries.getDocument({
    contractId,
    kind,
    version: header.version,
  })) as TaskContractDocument<T>;
}

function toActionView(action: TaskContractAction): GuidedTaskAction {
  return {
    id: action.id,
    sequence: action.sequence,
    kind: action.kind,
    targetDocumentId: action.targetDocumentId,
    relatedActionId: action.relatedActionId,
    details: action.details,
    createdAt: action.createdAt,
  };
}

function toMessageView(message: GuidedPreparationMessage): GuidedPreparationMessageView {
  return {
    id: message.id,
    sequence: message.sequence,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };
}

function toSourceView(source: GuidedPreparationSource): GuidedPreparationSourceView {
  return {
    id: source.id,
    sequence: source.sequence,
    kind: source.kind,
    url: source.url,
    title: source.title,
    excerpt: source.excerpt,
    ...(source.query ? { query: source.query } : {}),
    retrievedAt: source.retrievedAt,
    truncated: source.truncated,
  };
}

function toPreparationOperationView(
  operation: GuidedPreparationRequestRecord,
): GuidedPreparationOperationView {
  return {
    requestId: operation.requestId,
    operationId: operation.operationId,
    kind: operation.kind,
    preparationRevision: operation.preparationRevision,
    contractRevision: operation.contractRevision,
    status: operation.status,
    ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
    ...(operation.publishedDocumentId
      ? { publishedDocumentId: operation.publishedDocumentId }
      : {}),
    ...(operation.resultExternalSessionId
      ? { resultExternalSessionId: operation.resultExternalSessionId }
      : {}),
    ...(operation.resultSessionThroughSequence === undefined
      ? {}
      : { resultSessionThroughSequence: operation.resultSessionThroughSequence }),
  };
}

function toArtifactView(
  artifact: import('../core/run.js').ArtifactReference,
): GuidedExecutionArtifactView {
  return {
    id: artifact.id,
    runId: artifact.runId,
    stepId: artifact.stepId,
    name: artifact.name,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
  };
}

function toBlockView(block: GuidedExecutionBlock): GuidedExecutionBlockView {
  return {
    id: block.id,
    revision: block.revision,
    phaseId: block.phaseId,
    ...(block.taskId ? { taskId: block.taskId } : {}),
    type: block.type,
    reason: block.reason,
    evidence: block.evidence.map(toArtifactView),
    ...(block.fingerprint
      ? {
          fingerprint: {
            branch: block.fingerprint.branch,
            head: block.fingerprint.head,
            clean: block.fingerprint.clean,
            changes: block.fingerprint.changes.map((change) => ({
              path: change.path,
              status: change.status,
              mode: change.mode,
              contentHash: change.contentHash,
            })),
          },
        }
      : {}),
  };
}

export function createGuidedTaskViewContext(options: {
  taskContractStore: ApplicationTaskContractStore;
  workspace: string;
  preparationStore?: Pick<
    GuidedPreparationStore,
    'getGuidedPreparation' | 'listGuidedPreparationMessages' | 'listGuidedPreparationSources'
  >;
  executionQueries?: GuidedExecutionQueries;
  executionStore?: Pick<GuidedExecutionStore, 'getGuidedExecution' | 'listGuidedExecutions'>;
}): GuidedTaskViewContext {
  const taskContracts = createTaskContractQueries({
    store: options.taskContractStore,
    workspace: options.workspace,
  });
  return {
    taskContracts,
    ...(options.preparationStore
      ? {
          preparation: createGuidedTaskPreparationQueries(
            options.preparationStore,
            options.workspace,
          ),
        }
      : {}),
    ...(options.executionQueries
      ? { executions: options.executionQueries }
      : options.executionStore
        ? {
            executions: createGuidedTaskExecutionQueries(options.executionStore, options.workspace),
          }
        : {}),
  };
}
