import { Ajv, type JSONSchemaType } from 'ajv';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';

export interface PlanBuildQaRisk {
  description: string;
  mitigation: string;
}

export interface PlanBuildQaScope {
  decision: 'proceed' | 'needs_clarification';
  strategy: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
  risks: PlanBuildQaRisk[];
  questions: string[];
}

export interface PlanBuildQaTask {
  id: string;
  title: string;
  description: string;
  files: string[];
  acceptanceCriteria: string[];
}

export interface PlanBuildQaPlan {
  summary: string;
  tasks: PlanBuildQaTask[];
  verification: string[];
  risks: PlanBuildQaRisk[];
  questions: string[];
}

export interface BuildVerification {
  command: string;
  status: 'passed' | 'failed' | 'skipped';
}

export interface PlanBuildQaBuildResult {
  status: 'passed' | 'failed';
  summary: string;
  changedFiles: string[];
  verifications: BuildVerification[];
  commits: string[];
}

export type QaFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface QaFinding {
  id: string;
  severity: QaFindingSeverity;
  category: string;
  title: string;
  explanation: string;
  impact: string;
  evidence: string[];
  suggestedCorrection: string;
  verifications: string[];
}

export interface PlanBuildQaReport {
  decision: 'pass' | 'block';
  summary: string;
  findings: QaFinding[];
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

export const planBuildQaScopeSchema: JSONSchemaType<PlanBuildQaScope> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'decision',
    'strategy',
    'inScope',
    'outOfScope',
    'acceptanceCriteria',
    'risks',
    'questions',
  ],
  properties: {
    decision: { type: 'string', enum: ['proceed', 'needs_clarification'] },
    strategy: { type: 'string', minLength: 1 },
    inScope: { type: 'array', items: { type: 'string', minLength: 1 } },
    outOfScope: { type: 'array', items: { type: 'string', minLength: 1 } },
    acceptanceCriteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    risks: { type: 'array', items: riskSchema },
    questions: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  oneOf: [
    {
      properties: {
        decision: { const: 'proceed' },
        questions: { type: 'array', maxItems: 0 },
      },
    },
    {
      properties: {
        decision: { const: 'needs_clarification' },
        questions: { type: 'array', minItems: 1 },
      },
    },
  ],
};

export const planBuildQaPlanSchema: JSONSchemaType<PlanBuildQaPlan> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'tasks', 'verification', 'risks', 'questions'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    tasks: { type: 'array', minItems: 1, items: taskSchema },
    verification: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    risks: { type: 'array', items: riskSchema },
    questions: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const buildVerificationSchema: JSONSchemaType<BuildVerification> = {
  type: 'object',
  additionalProperties: false,
  required: ['command', 'status'],
  properties: {
    command: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
  },
};

export const planBuildQaBuildResultSchema: JSONSchemaType<PlanBuildQaBuildResult> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'changedFiles', 'verifications', 'commits'],
  properties: {
    status: { type: 'string', enum: ['passed', 'failed'] },
    summary: { type: 'string', minLength: 1 },
    changedFiles: { type: 'array', items: { type: 'string' } },
    verifications: { type: 'array', minItems: 1, items: buildVerificationSchema },
    commits: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const qaFindingSchema: JSONSchemaType<QaFinding> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'severity',
    'category',
    'title',
    'explanation',
    'impact',
    'evidence',
    'suggestedCorrection',
    'verifications',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    category: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    explanation: { type: 'string', minLength: 1 },
    impact: { type: 'string', minLength: 1 },
    evidence: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    suggestedCorrection: { type: 'string', minLength: 1 },
    verifications: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
};

export const planBuildQaReportSchema: JSONSchemaType<PlanBuildQaReport> = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary', 'findings'],
  properties: {
    decision: { type: 'string', enum: ['pass', 'block'] },
    summary: { type: 'string', minLength: 1 },
    findings: { type: 'array', items: qaFindingSchema },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateScope = ajv.compile<PlanBuildQaScope>(planBuildQaScopeSchema);
const validatePlan = ajv.compile<PlanBuildQaPlan>(planBuildQaPlanSchema);
const validateBuildResult = ajv.compile<PlanBuildQaBuildResult>(planBuildQaBuildResultSchema);
const validateQaReport = ajv.compile<PlanBuildQaReport>(planBuildQaReportSchema);

export function parsePlanBuildQaScope(value: unknown): PlanBuildQaScope {
  if (!validateScope(value)) {
    throw new Error(`Invalid plan-build-qa scope: ${validationDetails(validateScope.errors)}`);
  }
  return value as PlanBuildQaScope;
}

export function parsePlanBuildQaPlan(value: unknown): PlanBuildQaPlan {
  if (!validatePlan(value)) {
    throw new Error(`Invalid plan-build-qa plan: ${validationDetails(validatePlan.errors)}`);
  }
  const plan = value as PlanBuildQaPlan;
  assertUniqueIds(
    plan.tasks.map((task) => task.id),
    'task',
  );
  return plan;
}

export function parsePlanBuildQaBuildResult(value: unknown): PlanBuildQaBuildResult {
  if (!validateBuildResult(value)) {
    throw new Error(
      `Invalid plan-build-qa build result: ${validationDetails(validateBuildResult.errors)}`,
    );
  }
  return value as PlanBuildQaBuildResult;
}

export function parsePlanBuildQaQaReport(value: unknown): PlanBuildQaReport {
  if (!validateQaReport(value)) {
    throw new Error(
      `Invalid plan-build-qa QA report: ${validationDetails(validateQaReport.errors)}`,
    );
  }
  const report = value as PlanBuildQaReport;
  assertUniqueIds(
    report.findings.map((finding) => finding.id),
    'finding',
  );
  const hasBlockingFinding = report.findings.some(
    (finding) => finding.severity === 'critical' || finding.severity === 'high',
  );
  if (report.decision === 'block' && !hasBlockingFinding) {
    throw new Error('Invalid plan-build-qa QA report: block requires a critical or high finding');
  }
  if (report.decision === 'pass' && hasBlockingFinding) {
    throw new Error(
      'Invalid plan-build-qa QA report: pass cannot contain a critical or high finding',
    );
  }
  return report;
}

export const parsePlanBuildQaReport = parsePlanBuildQaQaReport;

const scopePrompt = [
  'Define the implementation scope for the objective and repository.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain decision (proceed or needs_clarification), strategy, inScope, outOfScope, acceptanceCriteria, risks, and questions.',
  'Use needs_clarification only when implementation cannot safely proceed. In that case questions must be non-empty; otherwise questions must be empty.',
].join(' ');

const planPrompt = [
  'Create an implementation plan from the objective and validated scope.',
  'Return exactly one JSON object and nothing else.',
  'The object must contain summary, tasks, verification, risks, and questions.',
  'Every task must have a stable unique id, title, description, files, and acceptanceCriteria.',
].join(' ');

const buildPrompt = [
  'Implement the objective using the validated scope and plan.',
  'Run the planned verification commands and declare each command and its status.',
  'Return exactly one JSON object with status, summary, changedFiles, verifications, and commits.',
].join(' ');

const qaPrompt = [
  'Review the repository changes and the declared builder verifications against the objective, scope, and plan.',
  'Do not modify files or execute shell commands.',
  'Return exactly one JSON object with decision (pass or block), summary, and findings.',
  'Each finding must have a stable unique id, severity, category, title, explanation, impact, evidence, suggestedCorrection, and verifications.',
  'Only critical and high findings block; medium and low findings remain in the report without an automatic fix.',
].join(' ');

const fixPrompt = [
  'Fix the validated critical and high QA findings using the objective, plan, build result, and QA report.',
  'Run the planned verification commands again and return the updated build result JSON.',
].join(' ');

export const planBuildQaWorkflow: WorkflowDefinition = {
  version: 1,
  id: 'plan-build-qa',
  input: {
    required: ['objective'],
    properties: {
      objective: { type: 'string', minLength: 1 },
    },
  },
  steps: [
    {
      kind: 'agent',
      id: 'scope',
      profile: 'analyst',
      prompt: scopePrompt,
      dependsOn: [],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
      ],
      outputs: [
        {
          name: 'scope',
          kind: 'artifact',
          format: 'json',
          schema: planBuildQaScopeSchema as unknown as Record<string, unknown>,
          disposition: 'plan-build-qa-scope',
        },
      ],
    },
    {
      kind: 'agent',
      id: 'plan',
      profile: 'planner',
      prompt: planPrompt,
      dependsOn: ['scope'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'scope', source: { kind: 'step-output', stepId: 'scope', output: 'scope' } },
      ],
      outputs: [
        {
          name: 'plan',
          kind: 'artifact',
          format: 'json',
          schema: planBuildQaPlanSchema as unknown as Record<string, unknown>,
        },
      ],
    },
    {
      kind: 'agent',
      id: 'build',
      profile: 'builder',
      prompt: buildPrompt,
      dependsOn: ['plan'],
      inputReferences: [
        { name: 'objective', source: { kind: 'workflow-input', key: 'objective' } },
        { name: 'scope', source: { kind: 'step-output', stepId: 'scope', output: 'scope' } },
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: planBuildQaBuildResultSchema as unknown as Record<string, unknown>,
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
        { name: 'scope', source: { kind: 'step-output', stepId: 'scope', output: 'scope' } },
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
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
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
        { name: 'build', source: { kind: 'step-output', stepId: 'build', output: 'result' } },
        { name: 'qa', source: { kind: 'step-output', stepId: 'qa', output: 'report' } },
      ],
      outputs: [
        {
          name: 'result',
          kind: 'artifact',
          format: 'json',
          schema: planBuildQaBuildResultSchema as unknown as Record<string, unknown>,
        },
      ],
    },
  ],
};

export function validatePlanBuildQaWorkflowDefinition(
  workflow: unknown,
): asserts workflow is WorkflowDefinition {
  validateWorkflowDefinition(workflow);
  if (workflow.id !== planBuildQaWorkflow.id || workflow.version !== planBuildQaWorkflow.version) {
    throw new Error('Invalid plan-build-qa workflow identity');
  }
  const expectedSteps = ['scope', 'plan', 'build', 'qa', 'fix'];
  if (workflow.steps.map((step) => step.id).join(',') !== expectedSteps.join(',')) {
    throw new Error('Invalid plan-build-qa workflow phases');
  }
}

export function serializePlanBuildQaWorkflow(workflow: WorkflowDefinition): string {
  validatePlanBuildQaWorkflowDefinition(workflow);
  return JSON.stringify(workflow);
}

function assertUniqueIds(ids: string[], kind: 'task' | 'finding'): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id))
      throw new Error(`Invalid plan-build-qa contract: duplicate ${kind} id: ${id}`);
    seen.add(id);
  }
}

function validationDetails(errors: Array<{ message?: string }> | null | undefined): string {
  return errors?.map((error) => error.message).join(', ') ?? 'schema validation failed';
}
