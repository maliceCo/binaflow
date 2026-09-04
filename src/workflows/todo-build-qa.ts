import { Ajv, type JSONSchemaType } from 'ajv';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';
import {
  planBuildQaReportSchema,
  type BuildVerification,
  type PlanBuildQaReport,
  type PlanBuildQaRisk,
  type PlanBuildQaTask,
} from './plan-build-qa.js';

export type TodoAssessmentDecision = 'ready' | 'needs_preparation' | 'blocked';

export interface TodoAssessment {
  decision: TodoAssessmentDecision;
  summary: string;
  tasks: PlanBuildQaTask[];
  preparationTasks: PlanBuildQaTask[];
  verification: string[];
  risks: PlanBuildQaRisk[];
  blockers: string[];
}

export interface TodoResolvedItem {
  id: string;
  title: string;
  resolution: string;
  evidence: string[];
}

export interface TodoPendingItem {
  id: string;
  title: string;
  reason: string;
}

export interface TodoBuildResult {
  status: 'passed' | 'failed';
  summary: string;
  resolvedItems: TodoResolvedItem[];
  pendingItems: TodoPendingItem[];
  changedFiles: string[];
  verifications: BuildVerification[];
}

const riskSchema: JSONSchemaType<PlanBuildQaRisk> = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'mitigation'],
  properties: {
    description: { type: 'string', minLength: 1 },
    mitigation: { type: 'string', minLength: 1 },
  },
};

const taskSchema: JSONSchemaType<PlanBuildQaTask> = {
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

export const todoAssessmentSchema: JSONSchemaType<TodoAssessment> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'decision',
    'summary',
    'tasks',
    'preparationTasks',
    'verification',
    'risks',
    'blockers',
  ],
  properties: {
    decision: { type: 'string', enum: ['ready', 'needs_preparation', 'blocked'] },
    summary: { type: 'string', minLength: 1 },
    tasks: { type: 'array', items: taskSchema },
    preparationTasks: { type: 'array', items: taskSchema },
    verification: { type: 'array', items: { type: 'string', minLength: 1 } },
    risks: { type: 'array', items: riskSchema },
    blockers: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  oneOf: [
    {
      properties: {
        decision: { const: 'ready' },
        tasks: { type: 'array', minItems: 1 },
        preparationTasks: { type: 'array', maxItems: 0 },
        verification: { type: 'array', minItems: 1 },
        blockers: { type: 'array', maxItems: 0 },
      },
    },
    {
      properties: {
        decision: { const: 'needs_preparation' },
        tasks: { type: 'array', minItems: 1 },
        preparationTasks: { type: 'array', minItems: 1 },
        verification: { type: 'array', minItems: 1 },
        blockers: { type: 'array', maxItems: 0 },
      },
    },
    {
      properties: {
        decision: { const: 'blocked' },
        preparationTasks: { type: 'array', maxItems: 0 },
        blockers: { type: 'array', minItems: 1 },
      },
    },
  ],
};

const resolvedItemSchema: JSONSchemaType<TodoResolvedItem> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'resolution', 'evidence'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    resolution: { type: 'string', minLength: 1 },
    evidence: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const pendingItemSchema: JSONSchemaType<TodoPendingItem> = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'reason'],
  properties: {
    id: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
};

const verificationSchema: JSONSchemaType<BuildVerification> = {
  type: 'object',
  additionalProperties: false,
  required: ['command', 'status'],
  properties: {
    command: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
  },
};

export const todoBuildResultSchema: JSONSchemaType<TodoBuildResult> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'resolvedItems', 'pendingItems', 'changedFiles', 'verifications'],
  properties: {
    status: { type: 'string', enum: ['passed', 'failed'] },
    summary: { type: 'string', minLength: 1 },
    resolvedItems: { type: 'array', items: resolvedItemSchema },
    pendingItems: { type: 'array', items: pendingItemSchema },
    changedFiles: { type: 'array', items: { type: 'string' } },
    verifications: { type: 'array', minItems: 1, items: verificationSchema },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateAssessment = ajv.compile<TodoAssessment>(todoAssessmentSchema);
const validateBuildResult = ajv.compile<TodoBuildResult>(todoBuildResultSchema);

export function parseTodoAssessment(value: unknown): TodoAssessment {
  if (!validateAssessment(value)) {
    throw new Error(`Invalid TODO assessment: ${validationDetails(validateAssessment.errors)}`);
  }
  const assessment = value as TodoAssessment;
  assertUniqueIds([...assessment.tasks, ...assessment.preparationTasks].map((task) => task.id));
  return assessment;
}

export function parseTodoBuildResult(value: unknown): TodoBuildResult {
  if (!validateBuildResult(value)) {
    throw new Error(`Invalid TODO build result: ${validationDetails(validateBuildResult.errors)}`);
  }
  const result = value as TodoBuildResult;
  assertUniqueIds(result.resolvedItems.map((item) => item.id));
  assertUniqueIds(result.pendingItems.map((item) => item.id));
  return result;
}

const validatePrompt = [
  'Validate the reviewed TODO against the current repository without changing files.',
  'Preserve its intent; normalize its work into stable task IDs rather than replanning it.',
  'Return exactly one JSON object with decision, summary, tasks, preparationTasks, verification, risks, and blockers.',
  'Use ready when it can run as written, needs_preparation only for concrete prerequisite repository changes, and blocked when ambiguity or contradiction prevents safe execution.',
  'For ready, tasks and verification are non-empty while preparationTasks and blockers are empty.',
  'For needs_preparation, tasks, preparationTasks, and verification are non-empty while blockers is empty.',
  'For blocked, blockers is non-empty and preparationTasks is empty.',
  'Every task has id, title, description, files, and non-empty acceptanceCriteria. Every risk has description and mitigation.',
].join(' ');

const preparePrompt = [
  'Apply only the prerequisite changes declared in preparationTasks.',
  'Do not execute the reviewed TODO yet and do not alter its intent.',
  'Run relevant verification and return exactly one JSON object with status, summary, resolvedItems, pendingItems, changedFiles, and verifications.',
].join(' ');

const buildPrompt = [
  'Execute the reviewed TODO using the validated normalized tasks.',
  'Keep changes focused, run the declared verification, and do not claim an item is resolved without evidence.',
  'Return exactly one JSON object with status, summary, resolvedItems, pendingItems, changedFiles, and verifications.',
].join(' ');

const qaPrompt = [
  'Review the repository changes and declared verifications against the original reviewed TODO and its normalized tasks.',
  'Do not modify files or execute shell commands.',
  'Return exactly one JSON object with decision (pass or block), summary, and findings.',
  'Each finding has a stable id, severity, category, title, explanation, impact, evidence, suggestedCorrection, and verifications.',
  'Only critical and high findings block. Medium and low findings remain visible but do not trigger automatic correction.',
].join(' ');

const fixPrompt = [
  'Correct only the critical and high findings in the QA report.',
  'Preserve the reviewed TODO intent, rerun relevant verification, and return the TODO build result JSON.',
].join(' ');

export const todoBuildQaWorkflow: WorkflowDefinition = {
  version: 1,
  id: 'todo-build-qa',
  input: {
    required: ['objective', 'todo'],
    properties: {
      objective: { type: 'string', minLength: 1 },
      todo: { type: 'string', minLength: 1 },
      todoPath: { type: 'string', minLength: 1 },
    },
  },
  steps: [
    {
      kind: 'agent',
      id: 'validate-todo',
      profile: 'analyst',
      prompt: validatePrompt,
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'todo', source: { kind: 'workflow-input', key: 'todo' } },
      ],
      outputs: [
        {
          name: 'assessment',
          kind: 'artifact',
          format: 'json',
          schema: todoAssessmentSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'prepare',
      profile: 'builder',
      prompt: preparePrompt,
      dependsOn: ['validate-todo'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'todo', source: { kind: 'workflow-input', key: 'todo' } },
        {
          name: 'assessment',
          source: { kind: 'step-output', stepId: 'validate-todo', output: 'assessment' },
        },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: todoBuildResultSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'build',
      profile: 'builder',
      prompt: buildPrompt,
      dependsOn: ['validate-todo', 'prepare'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'todo', source: { kind: 'workflow-input', key: 'todo' } },
        {
          name: 'assessment',
          source: { kind: 'step-output', stepId: 'validate-todo', output: 'assessment' },
        },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: todoBuildResultSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'qa',
      profile: 'qa',
      prompt: qaPrompt,
      dependsOn: ['build'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'todo', source: { kind: 'workflow-input', key: 'todo' } },
        {
          name: 'assessment',
          source: { kind: 'step-output', stepId: 'validate-todo', output: 'assessment' },
        },
        { name: 'build', source: { kind: 'step-output', stepId: 'build', output: 'result' } },
      ],
      outputs: [
        {
          name: 'report',
          kind: 'artifact',
          format: 'json',
          schema: planBuildQaReportSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'fix',
      profile: 'builder',
      prompt: fixPrompt,
      dependsOn: ['qa'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'todo', source: { kind: 'workflow-input', key: 'todo' } },
        {
          name: 'assessment',
          source: { kind: 'step-output', stepId: 'validate-todo', output: 'assessment' },
        },
        { name: 'build', source: { kind: 'step-output', stepId: 'build', output: 'result' } },
        { name: 'qa', source: { kind: 'step-output', stepId: 'qa', output: 'report' } },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: todoBuildResultSchema as unknown as Record<string, unknown>,
        },
      ],
    },
  ],
};

export function validateTodoBuildQaWorkflowDefinition(
  workflow: unknown,
): asserts workflow is WorkflowDefinition {
  validateWorkflowDefinition(workflow);
  if (workflow.id !== todoBuildQaWorkflow.id || workflow.version !== todoBuildQaWorkflow.version) {
    throw new Error('Invalid todo-build-qa workflow identity');
  }
  const expectedSteps = ['validate-todo', 'prepare', 'build', 'qa', 'fix'];
  if (workflow.steps.map((step) => step.id).join(',') !== expectedSteps.join(',')) {
    throw new Error('Invalid todo-build-qa workflow phases');
  }
}

function assertUniqueIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Invalid TODO contract: duplicate id: ${id}`);
    seen.add(id);
  }
}

function validationDetails(errors: Array<{ message?: string }> | null | undefined): string {
  return errors?.map((error) => error.message).join(', ') ?? 'schema validation failed';
}

export type { PlanBuildQaReport };
