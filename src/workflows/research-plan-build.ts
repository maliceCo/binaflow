import { Ajv, type JSONSchemaType } from 'ajv';
import type { WorkflowDefinition } from '../core/workflow.js';
import { buildPlanSchema } from './plan-build.js';

export interface ResearchEvidence {
  type: 'repository' | 'web';
  source: string;
  locator?: string;
}

export interface ResearchFinding {
  statement: string;
  evidence: ResearchEvidence[];
}

export interface ResearchReport {
  summary: string;
  findings: ResearchFinding[];
  relevantFiles: string[];
  constraints: string[];
  openQuestions: string[];
  risks: string[];
}

export interface ResearchReview {
  decision: 'ready' | 'needs_more_research';
  summary: string;
  gaps: string[];
  nextResearchQuestions: string[];
}

export const researchReportSchema: JSONSchemaType<ResearchReport> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'relevantFiles', 'constraints', 'openQuestions', 'risks'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'evidence'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'source'],
              properties: {
                type: { type: 'string', enum: ['repository', 'web'] },
                source: { type: 'string', minLength: 1 },
                locator: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
    relevantFiles: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
};

export const researchReviewSchema: JSONSchemaType<ResearchReview> = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary', 'gaps', 'nextResearchQuestions'],
  properties: {
    decision: { type: 'string', enum: ['ready', 'needs_more_research'] },
    summary: { type: 'string', minLength: 1 },
    gaps: { type: 'array', items: { type: 'string' } },
    nextResearchQuestions: { type: 'array', items: { type: 'string' } },
  },
};

const validateResearchReport = new Ajv({ allErrors: true }).compile<ResearchReport>(
  researchReportSchema,
);
const validateResearchReview = new Ajv({ allErrors: true }).compile<ResearchReview>(
  researchReviewSchema,
);

export function parseResearchReport(value: unknown): ResearchReport {
  if (!validateResearchReport(value)) {
    throw new Error(`Invalid research report: ${validationDetails(validateResearchReport.errors)}`);
  }
  return value as ResearchReport;
}

export function parseResearchReview(value: unknown): ResearchReview {
  if (!validateResearchReview(value)) {
    throw new Error(`Invalid research review: ${validationDetails(validateResearchReview.errors)}`);
  }
  return value as ResearchReview;
}

const researchPrompt = [
  'Investigate the repository and the objective before implementation.',
  'Use the available read-only repository and web tools when they are configured by the harness.',
  'Cite repository paths and web URLs in evidence. Do not modify files.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain summary, findings, relevantFiles, constraints, openQuestions, and risks.',
  'Each finding must contain a statement and an evidence array with type, source, and optional locator.',
  'Use the feedback and unanswered questions from previous research when provided.',
].join(' ');

const reviewPrompt = [
  'Review the research report against the objective.',
  'Check whether the repository and web evidence is sufficient for safe implementation planning.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain decision (ready or needs_more_research), summary, gaps, and nextResearchQuestions.',
  'Choose needs_more_research when important facts are missing, unsupported, or contradictory.',
].join(' ');

const plannerPrompt = [
  'Create an implementation plan using the objective and the approved research report and review.',
  'Return exactly the validated BuildPlan JSON object and nothing else.',
].join(' ');

export const researchPlanBuildWorkflow: WorkflowDefinition = {
  version: 1,
  id: 'research-plan-build',
  input: {
    required: ['objective'],
    properties: {
      objective: { type: 'string', minLength: 1 },
      researchFeedback: { type: 'string' },
    },
  },
  approval: {
    id: 'research-approval',
    after: 'research-review',
    message: 'Review the research artifact before planning and execution.',
  },
  steps: [
    {
      kind: 'agent',
      id: 'research',
      profile: 'researcher',
      prompt: researchPrompt,
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'feedback', source: { kind: 'workflow-input', key: 'researchFeedback' } },
      ],
      outputs: [
        {
          name: 'report',
          kind: 'artifact',
          format: 'json',
          schema: researchReportSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'research-review',
      profile: 'research-reviewer',
      prompt: reviewPrompt,
      dependsOn: ['research'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'report', source: { kind: 'step-output', stepId: 'research', output: 'report' } },
      ],
      outputs: [
        {
          name: 'review',
          kind: 'artifact',
          format: 'json',
          schema: researchReviewSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'plan',
      profile: 'planner',
      prompt: plannerPrompt,
      dependsOn: ['research-review'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'research', source: { kind: 'step-output', stepId: 'research', output: 'report' } },
        {
          name: 'review',
          source: { kind: 'step-output', stepId: 'research-review', output: 'review' },
        },
      ],
      outputs: [
        {
          name: 'plan',
          kind: 'artifact',
          format: 'json',
          schema: buildPlanSchema as unknown as Record<string, unknown>,
          disposition: 'build-plan',
        },
      ],
    },
    {
      kind: 'agent',
      id: 'build',
      profile: 'builder',
      prompt: 'Implement the objective using the validated research and BuildPlan artifacts.',
      dependsOn: ['plan'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'research', source: { kind: 'step-output', stepId: 'research', output: 'report' } },
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
      ],
      outputs: [{ name: 'result', kind: 'artifact', format: 'text' }],
    },
  ],
};

function validationDetails(errors: Array<{ message?: string }> | null | undefined): string {
  return errors?.map((error) => error.message).join(', ') ?? 'schema validation failed';
}
