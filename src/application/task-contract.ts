import { Ajv } from 'ajv';

export const TASK_CONTRACT_VERSION = 1 as const;
export const TASK_CONTRACT_KIND = 'guided-task' as const;

export const TASK_CONTRACT_LIMITS = {
  briefBytes: 16 * 1024,
  planBytes: 64 * 1024,
  todoBytes: 64 * 1024,
  maxPlanItems: 50,
  maxPhases: 20,
  maxTasks: 100,
  maxCommentBytes: 4 * 1024,
  maxBlockReasonBytes: 4 * 1024,
} as const;

export type TaskContractPhase = 'exploration' | 'planning' | 'todo';
export type TaskContractReadiness =
  'blocked' | 'needs-plan' | 'needs-approval' | 'needs-todo' | 'ready';
export type TaskContractDocumentKind = 'brief' | 'plan' | 'todo';
export type TaskContractActionKind = 'comment' | 'approve-plan' | 'block' | 'resolve-block';

export interface TaskContractBrief {
  objective: string;
  conclusions: string[];
  constraints: string[];
  outOfScope: string[];
}

export interface TaskContractPlanFile {
  path: string;
  reason: string;
}

export interface TaskContractPlanItem {
  id: string;
  title: string;
  description: string;
  files: TaskContractPlanFile[];
  acceptanceCriteria: string[];
}

export interface TaskContractPlan {
  briefVersion: number;
  summary: string;
  items: TaskContractPlanItem[];
  verification: string[];
}

export interface TaskContractTodoTask {
  id: string;
  planItemId: string;
  instructions: string[];
  files: string[];
  acceptanceCriteria: string[];
  verification: string[];
  stopConditions: string[];
}

export interface TaskContractTodoPhase {
  id: string;
  title: string;
  tasks: TaskContractTodoTask[];
}

export interface TaskContractTodo {
  planVersion: number;
  phases: TaskContractTodoPhase[];
  scopeChanges: string[];
}

export interface TaskContract {
  id: string;
  kind: typeof TASK_CONTRACT_KIND;
  workspace: string;
  contractVersion: typeof TASK_CONTRACT_VERSION;
  revision: number;
  phase: TaskContractPhase;
  currentBriefId: string;
  currentPlanId: string | null;
  approvedPlanId: string | null;
  currentTodoId: string | null;
  currentBlockId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskContractDocumentHeader {
  id: string;
  contractId: string;
  kind: TaskContractDocumentKind;
  version: number;
  sourceDocumentId: string | null;
  createdAt: string;
}

export interface TaskContractAction {
  id: string;
  contractId: string;
  sequence: number;
  kind: TaskContractActionKind;
  targetDocumentId: string;
  relatedActionId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface TaskContractDocument<
  T = TaskContractBrief | TaskContractPlan | TaskContractTodo,
> extends TaskContractDocumentHeader {
  body: T;
}

export interface TaskContractView {
  contract: TaskContract;
  readiness: TaskContractReadiness;
  execution?: { runId: string };
  currentBrief: TaskContractDocumentHeader;
  currentPlan: TaskContractDocumentHeader | null;
  approvedPlan: TaskContractDocumentHeader | null;
  currentTodo: TaskContractDocumentHeader | null;
  approval: TaskContractAction | null;
  activeBlock: TaskContractAction | null;
}

export interface TaskContractListQuery {
  afterId?: string;
  limit?: number;
}

export interface TaskContractCreateRequest {
  contractId: string;
  brief: TaskContractBrief;
}

export interface TaskContractReviseBriefRequest extends TaskContractCreateRequest {
  expectedRevision: number;
}

export interface TaskContractPlanRequest {
  contractId: string;
  expectedRevision: number;
  plan: TaskContractPlan;
}

export interface TaskContractCommentRequest {
  contractId: string;
  expectedRevision: number;
  planVersion: number;
  content: string;
}

export interface TaskContractApprovePlanRequest {
  contractId: string;
  expectedRevision: number;
  planVersion: number;
}

export interface TaskContractTodoRequest {
  contractId: string;
  expectedRevision: number;
  todo: TaskContractTodo;
}

export interface TaskContractBlockRequest {
  contractId: string;
  expectedRevision: number;
  documentKind: TaskContractDocumentKind;
  documentVersion: number;
  reason: string;
  differences?: TaskContractTodoScopeDifference[];
}

export interface TaskContractResolveBlockRequest {
  contractId: string;
  expectedRevision: number;
  blockId: string;
  reason: string;
}

export interface TaskContractTodoMarkdownRequest {
  contractId: string;
  todoVersion: number;
}

export interface TaskContractTodoMarkdown {
  contractId: string;
  planVersion: number;
  todoVersion: number;
  current: boolean;
  readiness: TaskContractReadiness;
  fileName: 'TODO.md';
  content: string;
}

export interface TaskContractStoredState {
  contract: TaskContract;
  execution?: { runId: string };
  currentBrief: TaskContractDocument<TaskContractBrief>;
  currentPlan: TaskContractDocument<TaskContractPlan> | null;
  approvedPlan: TaskContractDocument<TaskContractPlan> | null;
  currentTodo: TaskContractDocument<TaskContractTodo> | null;
  activeBlock: TaskContractAction | null;
  approval: TaskContractAction | null;
}

export interface TaskContractQueries {
  get(contractId: string): Promise<TaskContractView>;
  list(query?: TaskContractListQuery): Promise<TaskContractPage>;
  getDocument(
    request: Omit<TaskContractDocumentRequest, 'workspace'>,
  ): Promise<TaskContractDocument>;
  listDocuments(
    request: Omit<TaskContractListDocumentsRequest, 'contractId' | 'workspace'> & {
      contractId: string;
    },
  ): Promise<TaskContractDocumentPage>;
  listActions(
    request: Omit<TaskContractListActionsRequest, 'contractId' | 'workspace'> & {
      contractId: string;
    },
  ): Promise<TaskContractActionPage>;
  getTodoMarkdown(request: TaskContractTodoMarkdownRequest): Promise<TaskContractTodoMarkdown>;
}

export interface TaskContractService extends TaskContractQueries {
  create(request: TaskContractCreateRequest): Promise<TaskContractView>;
  reviseBrief(request: TaskContractReviseBriefRequest): Promise<TaskContractView>;
  publishPlan(request: TaskContractPlanRequest): Promise<TaskContractView>;
  commentPlan(request: TaskContractCommentRequest): Promise<TaskContractView>;
  approvePlan(request: TaskContractApprovePlanRequest): Promise<TaskContractView>;
  publishTodo(request: TaskContractTodoRequest): Promise<TaskContractView>;
  block(request: TaskContractBlockRequest): Promise<TaskContractView>;
  resolveBlock(request: TaskContractResolveBlockRequest): Promise<TaskContractView>;
}

export interface TaskContractDocumentPage {
  items: TaskContractDocumentHeader[];
  nextCursor?: number;
}

export interface TaskContractActionPage {
  items: TaskContractAction[];
  nextCursor?: number;
}

export interface TaskContractPage {
  items: TaskContract[];
  nextCursor?: string;
}

export interface TaskContractDocumentRequest {
  contractId: string;
  workspace: string;
  kind: TaskContractDocumentKind;
  version: number;
}

export interface TaskContractListDocumentsRequest {
  contractId: string;
  workspace: string;
  kind: TaskContractDocumentKind;
  afterVersion?: number;
  limit?: number;
}

export interface TaskContractListActionsRequest {
  contractId: string;
  workspace: string;
  afterSequence?: number;
  limit?: number;
}

export interface TaskContractMutationRequest {
  contractId: string;
  workspace: string;
  expectedRevision: number;
}

export interface TaskContractStoredCreateRequest {
  contractId: string;
  workspace: string;
  brief: TaskContractBrief;
}

export interface TaskContractStoredPlanRequest extends TaskContractMutationRequest {
  plan: TaskContractPlan;
}

export interface TaskContractStoredCommentRequest extends TaskContractMutationRequest {
  planVersion: number;
  content: string;
}

export interface TaskContractStoredApprovalRequest extends TaskContractMutationRequest {
  planVersion: number;
}

export interface TaskContractStoredTodoRequest extends TaskContractMutationRequest {
  todo: TaskContractTodo;
}

export interface TaskContractStoredBlockRequest extends TaskContractMutationRequest {
  documentKind: TaskContractDocumentKind;
  documentVersion: number;
  reason: string;
  differences?: TaskContractTodoScopeDifference[];
}

export interface TaskContractStoredResolveBlockRequest extends TaskContractMutationRequest {
  blockId: string;
  reason: string;
}

export interface TaskContractVersionPointer {
  id: string;
  version: number;
}

export interface TaskContractPlanPointer extends TaskContractVersionPointer {
  briefVersion: number;
}

export interface TaskContractTodoPointer extends TaskContractVersionPointer {
  planVersion: number;
}

export interface TaskContractReadinessState {
  brief: TaskContractVersionPointer | null;
  plan: TaskContractPlanPointer | null;
  approvedPlan: TaskContractPlanPointer | null;
  todo: TaskContractTodoPointer | null;
  activeBlock: { id: string } | null;
}

export interface TaskContractTodoScopeDifference {
  kind:
    | 'scope-change'
    | 'unknown-plan-item'
    | 'uncovered-plan-item'
    | 'extra-file'
    | 'version-mismatch';
  taskId?: string;
  planItemId?: string;
  path?: string;
  detail: string;
}

export interface TaskContractTodoScopeResult {
  compatible: boolean;
  differences: TaskContractTodoScopeDifference[];
}

export interface TaskContractTransitionState {
  phase: TaskContractPhase;
  currentPlanId: string | null;
  approvedPlanId: string | null;
  currentTodoId: string | null;
  activeBlockId: string | null;
}

export type TaskContractTransition =
  | { kind: 'revise-brief' }
  | { kind: 'publish-plan'; planId: string }
  | { kind: 'comment-plan' }
  | { kind: 'approve-plan' }
  | { kind: 'publish-todo'; todoId: string; compatible: boolean }
  | { kind: 'block'; blockId: string }
  | { kind: 'resolve-block' };

export type TaskContractErrorCode =
  'invalid-input' | 'stale-revision' | 'invalid-target' | 'blocked' | 'incompatible-version';

export class TaskContractError extends Error {
  readonly code: TaskContractErrorCode;

  constructor(code: TaskContractErrorCode, message: string) {
    super(message);
    this.name = 'TaskContractError';
    this.code = code;
  }
}

export const taskContractBriefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['objective', 'conclusions', 'constraints', 'outOfScope'],
  properties: {
    objective: { type: 'string', minLength: 1 },
    conclusions: { type: 'array', items: { type: 'string', minLength: 1 } },
    constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
    outOfScope: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

export const taskContractPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['briefVersion', 'summary', 'items', 'verification'],
  properties: {
    briefVersion: { type: 'integer', minimum: 1 },
    summary: { type: 'string', minLength: 1 },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: TASK_CONTRACT_LIMITS.maxPlanItems,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description', 'files', 'acceptanceCriteria'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
          },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'reason'],
              properties: {
                path: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 1 },
              },
            },
          },
          acceptanceCriteria: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    verification: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

export const taskContractTodoSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['planVersion', 'phases', 'scopeChanges'],
  properties: {
    planVersion: { type: 'integer', minimum: 1 },
    phases: {
      type: 'array',
      minItems: 1,
      maxItems: TASK_CONTRACT_LIMITS.maxPhases,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'tasks'],
        properties: {
          id: {
            type: 'string',
            minLength: 1,
            maxLength: 80,
            pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
          },
          title: { type: 'string', minLength: 1 },
          tasks: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'id',
                'planItemId',
                'instructions',
                'files',
                'acceptanceCriteria',
                'verification',
                'stopConditions',
              ],
              properties: {
                id: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 80,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
                },
                planItemId: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 80,
                  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
                },
                instructions: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
                files: { type: 'array', items: { type: 'string', minLength: 1 } },
                acceptanceCriteria: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
                verification: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
                stopConditions: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
              },
            },
          },
        },
      },
    },
    scopeChanges: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateBriefSchema = ajv.compile<TaskContractBrief>(taskContractBriefSchema);
const validatePlanSchema = ajv.compile<TaskContractPlan>(taskContractPlanSchema);
const validateTodoSchema = ajv.compile<TaskContractTodo>(taskContractTodoSchema);

export function parseTaskContractBrief(value: unknown): TaskContractBrief {
  assertSchema<TaskContractBrief>(validateBriefSchema, value, 'brief');
  assertSerializedSize(value, TASK_CONTRACT_LIMITS.briefBytes, 'brief');
  assertBriefText(value);
  return value;
}

export function parseTaskContractPlan(value: unknown): TaskContractPlan {
  assertSchema<TaskContractPlan>(validatePlanSchema, value, 'plan');
  assertSerializedSize(value, TASK_CONTRACT_LIMITS.planBytes, 'plan');
  assertPlanTextAndPaths(value);
  return value;
}

export function parseTaskContractTodo(value: unknown): TaskContractTodo {
  assertSchema<TaskContractTodo>(validateTodoSchema, value, 'todo');
  assertSerializedSize(value, TASK_CONTRACT_LIMITS.todoBytes, 'todo');
  assertTodoTextAndPaths(value);
  return value;
}

export function applyTaskContractTransition(
  state: TaskContractTransitionState,
  transition: TaskContractTransition,
): TaskContractTransitionState {
  switch (transition.kind) {
    case 'revise-brief':
      return {
        ...state,
        phase: 'exploration',
        currentPlanId: null,
        approvedPlanId: null,
        currentTodoId: null,
      };
    case 'publish-plan':
      return {
        ...state,
        phase: 'planning',
        currentPlanId: transition.planId,
        approvedPlanId: null,
        currentTodoId: null,
      };
    case 'comment-plan':
      return { ...state, phase: 'planning', approvedPlanId: null, currentTodoId: null };
    case 'approve-plan':
      return { ...state, phase: 'todo', approvedPlanId: state.currentPlanId, currentTodoId: null };
    case 'publish-todo':
      return transition.compatible
        ? { ...state, phase: 'todo', currentTodoId: transition.todoId }
        : { ...state, phase: 'planning', approvedPlanId: null, currentTodoId: null };
    case 'block':
      return {
        ...state,
        phase: state.currentPlanId ? 'planning' : 'exploration',
        approvedPlanId: null,
        currentTodoId: null,
        activeBlockId: transition.blockId,
      };
    case 'resolve-block':
      return { ...state, activeBlockId: null };
  }
}

export function getTaskContractReadiness(state: TaskContractReadinessState): TaskContractReadiness {
  if (!state.brief || state.brief.version < 1 || !state.brief.id) {
    throw new TaskContractError('invalid-input', 'A task contract must have a valid current brief');
  }
  if (state.activeBlock) return 'blocked';
  if (!state.plan || state.plan.version < 1 || state.plan.briefVersion !== state.brief.version) {
    return 'needs-plan';
  }
  if (
    !state.approvedPlan ||
    state.approvedPlan.id !== state.plan.id ||
    state.approvedPlan.version !== state.plan.version ||
    state.approvedPlan.briefVersion !== state.brief.version
  ) {
    return 'needs-approval';
  }
  if (!state.todo || state.todo.planVersion !== state.approvedPlan.version) {
    return 'needs-todo';
  }
  return 'ready';
}

export function validateTaskContractTodoScope(
  todo: TaskContractTodo,
  plan: TaskContractPlan,
): TaskContractTodoScopeResult {
  const differences: TaskContractTodoScopeDifference[] = [];
  for (const change of todo.scopeChanges) {
    differences.push({ kind: 'scope-change', detail: change });
  }

  const items = new Map(plan.items.map((item) => [item.id, item]));
  const covered = new Set<string>();
  for (const phase of todo.phases) {
    for (const task of phase.tasks) {
      const item = items.get(task.planItemId);
      if (!item) {
        differences.push({
          kind: 'unknown-plan-item',
          taskId: task.id,
          planItemId: task.planItemId,
          detail: `Task ${task.id} references unknown plan item ${task.planItemId}`,
        });
        continue;
      }
      covered.add(item.id);
      const allowedFiles = new Set(item.files.map((file) => file.path));
      for (const path of task.files) {
        if (!allowedFiles.has(path)) {
          differences.push({
            kind: 'extra-file',
            taskId: task.id,
            planItemId: item.id,
            path,
            detail: `Task ${task.id} adds file ${path} outside plan item ${item.id}`,
          });
        }
      }
    }
  }
  for (const item of plan.items) {
    if (!covered.has(item.id)) {
      differences.push({
        kind: 'uncovered-plan-item',
        planItemId: item.id,
        detail: `Plan item ${item.id} has no TODO task`,
      });
    }
  }

  return { compatible: differences.length === 0, differences };
}

export function assertTaskContractTodoMatchesPlan(
  todo: TaskContractTodo,
  planVersion: number,
): void {
  if (todo.planVersion !== planVersion) {
    throw new TaskContractError(
      'incompatible-version',
      `TODO refers to plan version ${todo.planVersion}, expected ${planVersion}`,
    );
  }
}

export function assertCompatibleTaskContractTodo(
  todo: TaskContractTodo,
  plan: TaskContractPlan,
): void {
  const result = validateTaskContractTodoScope(todo, plan);
  if (!result.compatible) {
    throw new TaskContractError(
      'blocked',
      `TODO scope requires review: ${result.differences.map((difference) => difference.detail).join('; ')}`,
    );
  }
}

function assertSchema<T>(
  validate: ((value: unknown) => boolean) & {
    errors?: Array<{ instancePath?: string; message?: string }> | null;
  },
  value: unknown,
  documentKind: TaskContractDocumentKind,
): asserts value is T {
  if (validate(value)) return;
  const details = validate.errors
    ?.map((error) => `${error.instancePath || '$'} ${error.message ?? 'is invalid'}`)
    .join(', ');
  throw new TaskContractError(
    'invalid-input',
    `Invalid task contract ${documentKind}${details ? `: ${details}` : ''}`,
  );
}

function assertSerializedSize(value: unknown, maximumBytes: number, documentKind: string): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
    throw new TaskContractError(
      'invalid-input',
      `Task contract ${documentKind} exceeds ${maximumBytes} serialized UTF-8 bytes`,
    );
  }
}

function assertBriefText(brief: TaskContractBrief): void {
  assertNonBlank(brief.objective, 'brief objective');
  assertStringList(brief.conclusions, 'brief conclusions');
  assertStringList(brief.constraints, 'brief constraints');
  assertStringList(brief.outOfScope, 'brief outOfScope');
}

function assertPlanTextAndPaths(plan: TaskContractPlan): void {
  assertPositiveInteger(plan.briefVersion, 'plan briefVersion');
  assertNonBlank(plan.summary, 'plan summary');
  assertStringList(plan.verification, 'plan verification');
  assertUniqueIds(
    plan.items.map((item) => item.id),
    'plan item',
  );
  for (const item of plan.items) {
    assertId(item.id, 'plan item id');
    assertNonBlank(item.title, `plan item ${item.id} title`);
    assertNonBlank(item.description, `plan item ${item.id} description`);
    assertStringList(item.acceptanceCriteria, `plan item ${item.id} acceptanceCriteria`);
    for (const file of item.files) {
      assertRelativeWorkspacePath(file.path, `plan item ${item.id} file path`);
      assertNonBlank(file.reason, `plan item ${item.id} file reason`);
    }
  }
}

function assertTodoTextAndPaths(todo: TaskContractTodo): void {
  assertPositiveInteger(todo.planVersion, 'todo planVersion');
  assertStringList(todo.scopeChanges, 'todo scopeChanges');
  assertUniqueIds(
    todo.phases.map((phase) => phase.id),
    'TODO phase',
  );
  const taskIds: string[] = [];
  for (const phase of todo.phases) {
    assertId(phase.id, 'TODO phase id');
    assertNonBlank(phase.title, `TODO phase ${phase.id} title`);
    for (const task of phase.tasks) {
      taskIds.push(task.id);
      assertId(task.id, 'TODO task id');
      assertId(task.planItemId, `TODO task ${task.id} planItemId`);
      assertStringList(task.instructions, `TODO task ${task.id} instructions`);
      assertStringList(task.acceptanceCriteria, `TODO task ${task.id} acceptanceCriteria`);
      assertStringList(task.verification, `TODO task ${task.id} verification`);
      assertStringList(task.stopConditions, `TODO task ${task.id} stopConditions`);
      for (const path of task.files) {
        assertRelativeWorkspacePath(path, `TODO task ${task.id} file path`);
      }
    }
  }
  if (taskIds.length > TASK_CONTRACT_LIMITS.maxTasks) {
    throw new TaskContractError(
      'invalid-input',
      `TODO cannot contain more than ${TASK_CONTRACT_LIMITS.maxTasks} tasks`,
    );
  }
  assertUniqueIds(taskIds, 'TODO task');
}

function assertStringList(values: string[], label: string): void {
  for (const value of values) assertNonBlank(value, `${label} entry`);
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TaskContractError('invalid-input', `${label} must not be empty`);
  }
}

function assertId(value: string, label: string): void {
  if (value.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new TaskContractError('invalid-input', `${label} must match [A-Za-z0-9][A-Za-z0-9_-]*`);
  }
}

function assertUniqueIds(ids: string[], label: string): void {
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new TaskContractError('invalid-input', `${label} IDs must be unique`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TaskContractError('invalid-input', `${label} must be a positive integer`);
  }
}

function assertRelativeWorkspacePath(value: string, label: string): void {
  if (
    value.includes('\\') ||
    value.includes('\u0000') ||
    value.startsWith('/') ||
    /^[A-Za-z]:($|\/)/.test(value) ||
    value.startsWith('~') ||
    /[*?[\]{}!]/.test(value)
  ) {
    throw new TaskContractError('invalid-input', `${label} must be a relative workspace path`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TaskContractError(
      'invalid-input',
      `${label} must not contain empty, dot, or parent segments`,
    );
  }
}
