import { Ajv, type JSONSchemaType } from 'ajv';
import type { WorkflowDefinition } from '../core/workflow.js';
import {
  GUIDED_EXECUTION_COORDINATOR_VERSION,
  GUIDED_EXECUTION_WORKFLOW_ID,
  guidedTaskAgentResultSchema,
  type GuidedTaskAgentResult,
} from '../application/guided-execution.js';

export const GUIDED_TASK_BUILD_VERSION = 1 as const;

export const guidedTaskBuildResultSchema: JSONSchemaType<GuidedTaskAgentResult> =
  guidedTaskAgentResultSchema as unknown as JSONSchemaType<GuidedTaskAgentResult>;

const guidedTaskBuildPrompt = [
  'Implement exactly the supplied guided task in the current workspace.',
  'Do not commit, stage, reset, push, change branches, or modify files outside the supplied scope.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain decision (done or blocked), summary, files, and evidence.',
  'Use decision=blocked with blockReason when the task or a stop condition cannot be completed safely.',
  'files is only the list of files you intended to change; Binaflow verifies actual Git changes separately.',
].join(' ');

export const guidedTaskBuildWorkflow: WorkflowDefinition = {
  version: GUIDED_TASK_BUILD_VERSION,
  id: GUIDED_EXECUTION_WORKFLOW_ID,
  input: {
    required: ['objective', 'task'],
    properties: {
      objective: { type: 'string', minLength: 1 },
      task: { type: 'string', minLength: 1 },
      phase: { type: 'string', minLength: 1 },
      constraints: { type: 'string', minLength: 1 },
      verification: { type: 'string', minLength: 1 },
      stopConditions: { type: 'string', minLength: 1 },
      previousCheckpoint: { type: 'string' },
    },
  },
  steps: [
    {
      kind: 'agent',
      id: 'guided-task',
      profile: 'builder',
      prompt: guidedTaskBuildPrompt,
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'task', source: { kind: 'workflow-input', key: 'task' } },
        { name: 'phase', source: { kind: 'workflow-input', key: 'phase' } },
        { name: 'constraints', source: { kind: 'workflow-input', key: 'constraints' } },
        { name: 'verification', source: { kind: 'workflow-input', key: 'verification' } },
        { name: 'stopConditions', source: { kind: 'workflow-input', key: 'stopConditions' } },
        {
          name: 'previousCheckpoint',
          source: { kind: 'workflow-input', key: 'previousCheckpoint' },
        },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: guidedTaskBuildResultSchema as unknown as Record<string, unknown>,
          disposition: 'guided-task-result',
        },
      ],
    },
  ],
};

export const guidedTaskBuildCoordinatorVersion = GUIDED_EXECUTION_COORDINATOR_VERSION;

export function parseGuidedTaskBuildResult(value: unknown): GuidedTaskAgentResult {
  const validator = new Ajv({ allErrors: true }).compile<GuidedTaskAgentResult>(
    guidedTaskBuildResultSchema,
  );
  if (!validator(value)) {
    const details = validator.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join(', ');
    throw new Error(`Invalid guided task build result${details ? `: ${details}` : ''}`);
  }
  return value as GuidedTaskAgentResult;
}
