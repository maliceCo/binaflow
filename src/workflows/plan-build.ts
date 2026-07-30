import { Ajv, type JSONSchemaType } from 'ajv';
import type { WorkflowDefinition } from '../core/workflow.js';

export interface BuildPlan {
  summary: string;
  tasks: BuildTask[];
  verification: string[];
  risks: BuildRisk[];
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
  required: ['summary', 'tasks', 'verification', 'risks'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    tasks: {
      type: 'array',
      minItems: 1,
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
  },
};

const validateBuildPlanSchema = new Ajv({ allErrors: true }).compile<BuildPlan>(buildPlanSchema);

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
      prompt:
        'Analyze the objective and repository. Return only a JSON BuildPlan with summary, tasks, verification, and risks.',
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
      ],
      outputs: [{ name: 'plan', kind: 'artifact', format: 'json' }],
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
