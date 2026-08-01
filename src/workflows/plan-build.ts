import { Ajv, type JSONSchemaType } from 'ajv';
import type { WorkflowDefinition } from '../core/workflow.js';

export interface BuildPlan {
  decision: 'build' | 'needs_clarification';
  summary: string;
  tasks: BuildTask[];
  verification: string[];
  risks: BuildRisk[];
  clarificationQuestions: string[];
}

export interface BuildTask {
  id: string;
  title: string;
  description: string;
  files: string[];
  acceptanceCriteria: string[];
}

export interface BuildRisk {
  description: string;
  mitigation: string;
}

export const buildPlanSchema: JSONSchemaType<BuildPlan> = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary', 'tasks', 'verification', 'risks', 'clarificationQuestions'],
  properties: {
    decision: { type: 'string', enum: ['build', 'needs_clarification'] },
    summary: { type: 'string', minLength: 1 },
    tasks: {
      type: 'array',
      items: {
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
      },
    },
    verification: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'mitigation'],
        properties: {
          description: { type: 'string', minLength: 1 },
          mitigation: { type: 'string', minLength: 1 },
        },
      },
    },
    clarificationQuestions: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
  oneOf: [
    {
      properties: {
        decision: { const: 'build' },
        tasks: { type: 'array', minItems: 1 },
        clarificationQuestions: { type: 'array', maxItems: 0 },
      },
    },
    {
      properties: {
        decision: { const: 'needs_clarification' },
        tasks: { type: 'array', maxItems: 0 },
        clarificationQuestions: { type: 'array', minItems: 1 },
      },
    },
  ],
};

const validateBuildPlanSchema = new Ajv({ allErrors: true }).compile<BuildPlan>(buildPlanSchema);

const plannerPrompt = [
  'Analyze the objective and repository before proposing implementation work.',
  'Return exactly one JSON object and nothing else: no Markdown fences, explanation, or commentary.',
  'The object must have decision (build or needs_clarification), summary (string), tasks (array), verification (non-empty string array), risks (array), and clarificationQuestions (array).',
  'Use decision=build only when implementation can proceed. Use decision=needs_clarification when the objective is not actionable.',
  'Every task must be an object with id, title, description, files (string array), and acceptanceCriteria (non-empty string array).',
  'Every risk must be an object with description and mitigation strings.',
  'For decision=build, tasks must be non-empty and clarificationQuestions must be empty. For decision=needs_clarification, tasks must be empty and clarificationQuestions must be non-empty.',
  'Example shape: {"decision":"needs_clarification","summary":"The objective needs clarification","tasks":[],"verification":["Confirm the clarified behavior"],"risks":[],"clarificationQuestions":["What behavior should change?"]}',
].join(' ');

export function parseBuildPlan(value: unknown): BuildPlan {
  if (!validateBuildPlanSchema(value)) {
    const details = validateBuildPlanSchema.errors?.map((error) => error.message).join(', ');
    throw new Error(`Invalid build plan${details ? `: ${details}` : ''}`);
  }
  return value as BuildPlan;
}

export const planBuildWorkflow: WorkflowDefinition = {
  version: 1,
  id: 'plan-build',
  input: {
    required: ['objective'],
    properties: {
      objective: { type: 'string', minLength: 1 },
    },
  },
  steps: [
    {
      kind: 'agent',
      id: 'plan',
      profile: 'planner',
      prompt: plannerPrompt,
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
      ],
      outputs: [
        {
          name: 'plan',
          kind: 'artifact',
          format: 'json',
          schema: buildPlanSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'build',
      profile: 'builder',
      prompt:
        'Implement the objective using the validated BuildPlan artifact. Keep changes focused and run relevant verification.',
      dependsOn: ['plan'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
      ],
      outputs: [{ name: 'result', kind: 'artifact', format: 'text' }],
    },
  ],
};
