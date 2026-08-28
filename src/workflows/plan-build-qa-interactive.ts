import { Ajv, type JSONSchemaType } from 'ajv';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';
import { planBuildQaWorkflow, planBuildQaPlanSchema } from './plan-build-qa.js';

export const INTERACTIVE_REVIEW_PHASES = ['scope', 'changes', 'qa'] as const;
export type InteractiveReviewPhase = (typeof INTERACTIVE_REVIEW_PHASES)[number];

export const INTERACTIVE_REVIEW_OPERATIONS = ['message', 'decide', 'finalize'] as const;
export type InteractiveReviewOperationKind = (typeof INTERACTIVE_REVIEW_OPERATIONS)[number];

export type InteractiveReviewState = 'waiting' | 'decided' | 'finalized';

export interface InteractiveScopeTask {
  id: string;
  title: string;
  description: string;
  files: string[];
  acceptanceCriteria: string[];
}

export interface InteractiveScopeRisk {
  description: string;
  mitigation: string;
}

export interface InteractiveScope {
  strategy: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  tasks: InteractiveScopeTask[];
  risks: InteractiveScopeRisk[];
  questions: string[];
}

export interface InteractiveChange {
  id: string;
  taskId?: string;
  summary: string;
  files: string[];
}

export interface ScopeReviewTarget {
  kind: 'scope';
  id: 'scope';
}

export interface TaskReviewTarget {
  kind: 'task';
  id: string;
}

export interface ChangeReviewTarget {
  kind: 'change';
  id: string;
}

export interface FindingReviewTarget {
  kind: 'finding';
  id: string;
}

export type InteractiveReviewTarget =
  ScopeReviewTarget | TaskReviewTarget | ChangeReviewTarget | FindingReviewTarget;

export interface InteractiveReviewContract {
  phases: InteractiveReviewPhase[];
  targetKinds: InteractiveReviewTarget['kind'][];
  operations: InteractiveReviewOperationKind[];
  todoArtifact: 'TODO.md';
}

export interface InteractiveMessageOperation {
  operation: 'message';
  target: InteractiveReviewTarget;
  message: string;
}

export interface InteractiveDecideOperation {
  operation: 'decide';
  target: InteractiveReviewTarget;
  decision: 'approve' | 'reject' | 'correct' | 'withdraw' | 'accept-risk' | 'postpone';
}

export interface InteractiveAdjudicationOperation {
  operation: 'adjudicate';
  target: FindingReviewTarget;
  decision: 'withdrawn' | 'confirmed' | 'reclassified' | 'needs-human-decision';
  evidence: string[];
}

export interface InteractiveFinalizeOperation {
  operation: 'finalize';
  target: ScopeReviewTarget | ChangeReviewTarget | FindingReviewTarget;
}

export type InteractiveReviewOperation =
  InteractiveMessageOperation | InteractiveDecideOperation | InteractiveFinalizeOperation;

export interface InteractiveReviewWorkflowDefinition extends WorkflowDefinition {
  interactiveReview: InteractiveReviewContract;
}

const riskSchema: JSONSchemaType<InteractiveScopeRisk> = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'mitigation'],
  properties: {
    description: { type: 'string', minLength: 1 },
    mitigation: { type: 'string', minLength: 1 },
  },
};

const taskSchema: JSONSchemaType<InteractiveScopeTask> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'description', 'files', 'acceptanceCriteria'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    files: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
};

export const interactiveScopeSchema: JSONSchemaType<InteractiveScope> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'strategy',
    'inScope',
    'outOfScope',
    'acceptanceCriteria',
    'tasks',
    'risks',
    'questions',
  ],
  properties: {
    strategy: { type: 'string', minLength: 1 },
    inScope: { type: 'array', items: { type: 'string', minLength: 1 } },
    outOfScope: { type: 'array', items: { type: 'string', minLength: 1 } },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    tasks: { type: 'array', minItems: 1, items: taskSchema },
    risks: { type: 'array', items: riskSchema },
    questions: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

export const interactiveChangeSchema: JSONSchemaType<InteractiveChange> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'summary', 'files'],
  properties: {
    id: { type: 'string', minLength: 1 },
    taskId: { type: 'string', minLength: 1, nullable: true },
    summary: { type: 'string', minLength: 1 },
    files: { type: 'array', items: { type: 'string' } },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateScope = ajv.compile<InteractiveScope>(interactiveScopeSchema);
const validateChange = ajv.compile<InteractiveChange>(interactiveChangeSchema);

export const interactiveReviewContract: InteractiveReviewContract = {
  phases: [...INTERACTIVE_REVIEW_PHASES],
  targetKinds: ['scope', 'change', 'finding'],
  operations: [...INTERACTIVE_REVIEW_OPERATIONS],
  todoArtifact: 'TODO.md',
};

const interactiveScopePrompt = [
  'Propose the implementation scope for the objective and repository.',
  'Include a strategy and an ordered list of concrete tasks with stable IDs.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain strategy, inScope, outOfScope, acceptanceCriteria, tasks, risks, and questions.',
].join(' ');

export const planBuildQaInteractiveWorkflow: InteractiveReviewWorkflowDefinition = {
  version: 1,
  id: 'plan-build-qa-interactive',
  input: {
    required: ['objective'],
    properties: { objective: { type: 'string', minLength: 1 } },
  },
  interactiveReview: structuredClone(interactiveReviewContract),
  steps: planBuildQaWorkflow.steps.map((step) => {
    if (step.id === 'scope') {
      return {
        ...step,
        prompt: interactiveScopePrompt,
        outputs: [
          {
            name: 'scope',
            kind: 'artifact' as const,
            format: 'json' as const,
            schema: interactiveScopeSchema as unknown as Record<string, unknown>,
          },
        ],
      };
    }
    if (step.id === 'plan') {
      return {
        ...step,
        inputReferences: step.inputReferences.map((reference) => ({ ...reference })),
        outputs: [
          {
            name: 'plan',
            kind: 'artifact' as const,
            format: 'json' as const,
            schema: planBuildQaPlanSchema as unknown as Record<string, unknown>,
          },
        ],
      };
    }
    return {
      ...step,
      inputReferences: step.inputReferences.map((reference) => ({ ...reference })),
      outputs: step.outputs.map((output) => ({ ...output })),
    };
  }),
};

export function parseInteractiveScope(value: unknown): InteractiveScope {
  if (!validateScope(value)) {
    throw new Error(
      `Invalid plan-build-qa-interactive scope: ${validationDetails(validateScope.errors)}`,
    );
  }
  const scope = value as InteractiveScope;
  assertUniqueIds(
    scope.tasks.map((task) => task.id),
    'task',
  );
  return scope;
}

export function parseInteractiveChange(value: unknown): InteractiveChange {
  if (!validateChange(value)) {
    throw new Error(
      `Invalid plan-build-qa-interactive change: ${validationDetails(validateChange.errors)}`,
    );
  }
  return value as InteractiveChange;
}

export function validateInteractiveTarget(
  target: unknown,
  known: {
    taskIds?: readonly string[];
    changeIds?: readonly string[];
    findingIds?: readonly string[];
  } = {},
): asserts target is InteractiveReviewTarget {
  if (!isRecord(target) || !isTargetKind(target.kind) || !isNonEmptyString(target.id)) {
    throw new Error('Invalid interactive review target');
  }
  if (target.kind === 'scope' && target.id !== 'scope') {
    throw new Error('The scope target must use id scope');
  }
  const ids =
    target.kind === 'task'
      ? known.taskIds
      : target.kind === 'change'
        ? known.changeIds
        : target.kind === 'finding'
          ? known.findingIds
          : undefined;
  if (ids && !ids.includes(target.id)) {
    throw new Error(`Unknown ${target.kind} target: ${target.id}`);
  }
}

export function interactiveTargetKey(target: InteractiveReviewTarget): string {
  return `${target.kind}:${target.id}`;
}

export function reviewOperationTransition(
  operation: InteractiveReviewOperation | { operation: 'navigate' | 'explain' },
): 'none' | 'decision' | 'finalization' {
  if (
    operation.operation === 'message' ||
    operation.operation === 'navigate' ||
    operation.operation === 'explain'
  ) {
    return 'none';
  }
  return operation.operation === 'decide' ? 'decision' : 'finalization';
}

export function validateInteractiveWorkflowDefinition(
  workflow: unknown,
): asserts workflow is InteractiveReviewWorkflowDefinition {
  validateWorkflowDefinition(workflow);
  if (
    !isRecord(workflow) ||
    workflow.id !== planBuildQaInteractiveWorkflow.id ||
    workflow.version !== planBuildQaInteractiveWorkflow.version
  ) {
    throw new Error('Invalid plan-build-qa-interactive workflow identity');
  }
  const candidate = workflow as unknown as InteractiveReviewWorkflowDefinition;
  const contract = candidate.interactiveReview;
  if (!isRecord(contract)) throw new Error('Interactive review contract is required');
  if (!sameStringArray(contract.phases, INTERACTIVE_REVIEW_PHASES)) {
    throw new Error('Invalid interactive review phases');
  }
  if (!sameStringArray(contract.operations, INTERACTIVE_REVIEW_OPERATIONS)) {
    throw new Error('Invalid interactive review operations');
  }
  if (!sameStringArray(contract.targetKinds, ['scope', 'change', 'finding'])) {
    throw new Error('Invalid interactive review target kinds');
  }
  if (contract.todoArtifact !== 'TODO.md') {
    throw new Error('Interactive review must produce TODO.md');
  }
}

function assertUniqueIds(ids: string[], kind: 'task' | 'change'): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Invalid interactive scope: duplicate ${kind} id: ${id}`);
    seen.add(id);
  }
}

function validationDetails(errors: Array<{ message?: string }> | null | undefined): string {
  return errors?.map((error) => error.message).join(', ') ?? 'schema validation failed';
}

function isTargetKind(value: unknown): value is InteractiveReviewTarget['kind'] {
  return value === 'scope' || value === 'task' || value === 'change' || value === 'finding';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}
