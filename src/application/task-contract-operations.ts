import type { ApplicationTaskContractStore } from './ports.js';
import {
  getTaskContractReadiness,
  parseTaskContractBrief,
  parseTaskContractPlan,
  parseTaskContractTodo,
  TaskContractError,
  type TaskContractDocumentKind,
  type TaskContractListQuery,
  type TaskContractQueries,
  type TaskContractService,
  type TaskContractView,
  type TaskContractCreateRequest,
  type TaskContractReviseBriefRequest,
  type TaskContractPlanRequest,
  type TaskContractCommentRequest,
  type TaskContractApprovePlanRequest,
  type TaskContractTodoRequest,
  type TaskContractBlockRequest,
  type TaskContractResolveBlockRequest,
} from './task-contract.js';

export interface TaskContractOperationsContext {
  readonly store: ApplicationTaskContractStore;
  readonly workspace: string;
}

export function createTaskContractQueries(
  context: TaskContractOperationsContext,
): TaskContractQueries {
  return {
    get: async (contractId) =>
      toView(await context.store.getTaskContract(context.workspace, requireId(contractId))),
    list: async (query) => {
      const validated = validateListQuery(query);
      return context.store.listTaskContracts(context.workspace, validated.afterId, validated.limit);
    },
    getDocument: async (request) => {
      const validated = validateDocumentRequest(request);
      const document = await context.store.getTaskContractDocument({
        ...validated,
        workspace: context.workspace,
      });
      if (!document)
        throw new TaskContractError('invalid-target', 'Task contract document does not exist');
      return document;
    },
    listDocuments: async (request) => {
      const validated = validateListDocumentsRequest(request);
      return context.store.listTaskContractDocuments({
        ...validated,
        workspace: context.workspace,
      });
    },
    listActions: async (request) => {
      const validated = validateListActionsRequest(request);
      return context.store.listTaskContractActions({ ...validated, workspace: context.workspace });
    },
  };
}

export function createTaskContractService(
  context: TaskContractOperationsContext,
): TaskContractService {
  const queries = createTaskContractQueries(context);
  return {
    ...queries,
    create: async (request) => {
      const validated = validateCreateRequest(request);
      return toView(
        await context.store.createTaskContract({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    reviseBrief: async (request) => {
      const validated = validateReviseBriefRequest(request);
      return toView(
        await context.store.reviseTaskContractBrief({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    publishPlan: async (request) => {
      const validated = validatePlanRequest(request);
      return toView(
        await context.store.publishTaskContractPlan({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    commentPlan: async (request) => {
      const validated = validateCommentRequest(request);
      return toView(
        await context.store.commentTaskContractPlan({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    approvePlan: async (request) => {
      const validated = validateApproveRequest(request);
      return toView(
        await context.store.approveTaskContractPlan({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    publishTodo: async (request) => {
      const validated = validateTodoRequest(request);
      return toView(
        await context.store.publishTaskContractTodo({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    block: async (request) => {
      const validated = validateBlockRequest(request);
      return toView(
        await context.store.blockTaskContract({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
    resolveBlock: async (request) => {
      const validated = validateResolveBlockRequest(request);
      return toView(
        await context.store.resolveTaskContractBlock({
          ...validated,
          workspace: context.workspace,
        }),
      );
    },
  };
}

function toView(
  state: Awaited<ReturnType<ApplicationTaskContractStore['getTaskContract']>>,
): TaskContractView {
  if (!state) throw new TaskContractError('invalid-target', 'Task contract does not exist');
  const { contract, currentBrief, currentPlan, approvedPlan, currentTodo, activeBlock, approval } =
    state;
  return {
    contract,
    readiness: getTaskContractReadiness({
      brief: { id: currentBrief.id, version: currentBrief.version },
      plan: currentPlan
        ? {
            id: currentPlan.id,
            version: currentPlan.version,
            briefVersion: currentPlan.body.briefVersion,
          }
        : null,
      approvedPlan: approvedPlan
        ? {
            id: approvedPlan.id,
            version: approvedPlan.version,
            briefVersion: approvedPlan.body.briefVersion,
          }
        : null,
      todo: currentTodo
        ? {
            id: currentTodo.id,
            version: currentTodo.version,
            planVersion: currentTodo.body.planVersion,
          }
        : null,
      activeBlock: activeBlock ? { id: activeBlock.id } : null,
    }),
    currentBrief,
    currentPlan,
    approvedPlan,
    currentTodo,
    approval,
    activeBlock,
  };
}

function validateCreateRequest(request: TaskContractCreateRequest): TaskContractCreateRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'brief']);
  requireId(request.contractId);
  parseTaskContractBrief(request.brief);
  return request;
}

function validateReviseBriefRequest(
  request: TaskContractReviseBriefRequest,
): TaskContractReviseBriefRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'brief']);
  assertRevision(request.expectedRevision);
  validateCreateRequest({ contractId: request.contractId, brief: request.brief });
  return request;
}

function validatePlanRequest(request: TaskContractPlanRequest): TaskContractPlanRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'plan']);
  requireId(request.contractId);
  assertRevision(request.expectedRevision);
  parseTaskContractPlan(request.plan);
  return request;
}

function validateCommentRequest(request: TaskContractCommentRequest): TaskContractCommentRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'planVersion', 'content']);
  requireId(request.contractId);
  assertRevision(request.expectedRevision);
  assertVersion(request.planVersion, 'planVersion');
  assertText(request.content, 'comment');
  return request;
}

function validateApproveRequest(
  request: TaskContractApprovePlanRequest,
): TaskContractApprovePlanRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'planVersion']);
  requireId(request.contractId);
  assertRevision(request.expectedRevision);
  assertVersion(request.planVersion, 'planVersion');
  return request;
}

function validateTodoRequest(request: TaskContractTodoRequest): TaskContractTodoRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'todo']);
  requireId(request.contractId);
  assertRevision(request.expectedRevision);
  parseTaskContractTodo(request.todo);
  return request;
}

function validateBlockRequest(request: TaskContractBlockRequest): TaskContractBlockRequest {
  assertRequestObject(request);
  assertOnly(request, [
    'contractId',
    'expectedRevision',
    'documentKind',
    'documentVersion',
    'reason',
    'differences',
  ]);
  requireId(request.contractId);
  assertRevision(request.expectedRevision);
  assertDocumentKind(request.documentKind);
  assertVersion(request.documentVersion, 'documentVersion');
  assertText(request.reason, 'block reason');
  return request;
}

function validateResolveBlockRequest(
  request: TaskContractResolveBlockRequest,
): TaskContractResolveBlockRequest {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'expectedRevision', 'blockId', 'reason']);
  requireId(request.contractId);
  requireId(request.blockId);
  assertRevision(request.expectedRevision);
  assertText(request.reason, 'block resolution reason');
  return request;
}

function validateDocumentRequest(
  request: Omit<import('./task-contract.js').TaskContractDocumentRequest, 'workspace'>,
): Omit<import('./task-contract.js').TaskContractDocumentRequest, 'workspace'> {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'kind', 'version']);
  requireId(request.contractId);
  assertDocumentKind(request.kind);
  assertVersion(request.version, 'document version');
  return request;
}

function validateListDocumentsRequest(request: {
  contractId: string;
  kind: TaskContractDocumentKind;
  afterVersion?: number;
  limit?: number;
}) {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'kind', 'afterVersion', 'limit']);
  requireId(request.contractId);
  assertDocumentKind(request.kind);
  if (request.afterVersion !== undefined) assertCursor(request.afterVersion, 'document cursor');
  assertLimit(request.limit);
  return request;
}

function validateListActionsRequest(request: {
  contractId: string;
  afterSequence?: number;
  limit?: number;
}) {
  assertRequestObject(request);
  assertOnly(request, ['contractId', 'afterSequence', 'limit']);
  requireId(request.contractId);
  if (request.afterSequence !== undefined) assertCursor(request.afterSequence, 'action cursor');
  assertLimit(request.limit);
  return request;
}

function validateListQuery(query: TaskContractListQuery | undefined): TaskContractListQuery {
  if (query === undefined) return {};
  assertRequestObject(query);
  assertOnly(query, ['afterId', 'limit']);
  if (query.afterId !== undefined) requireId(query.afterId);
  assertLimit(query.limit);
  return query;
}

function assertRequestObject(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TaskContractError('invalid-input', 'Task contract request must be an object');
  }
}

function assertOnly(value: object, fields: readonly string[]): void {
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).find((field) => !allowed.has(field));
  if (unexpected)
    throw new TaskContractError('invalid-input', `Unexpected task contract field: ${unexpected}`);
}

function requireId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TaskContractError('invalid-input', 'Task contract ID must be non-empty');
  }
  return value;
}

function assertRevision(value: number): void {
  assertVersion(value, 'expectedRevision');
}

function assertVersion(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TaskContractError('invalid-input', `${label} must be a positive integer`);
  }
}

function assertCursor(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TaskContractError('invalid-input', `${label} must be a non-negative integer`);
  }
}

function assertLimit(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 50)) {
    throw new TaskContractError('invalid-input', 'Task contract limit must be between 1 and 50');
  }
}

function assertText(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TaskContractError('invalid-input', `${label} must be non-empty`);
  }
}

function assertDocumentKind(value: TaskContractDocumentKind): void {
  if (value !== 'brief' && value !== 'plan' && value !== 'todo') {
    throw new TaskContractError('invalid-input', 'Invalid task contract document kind');
  }
}
