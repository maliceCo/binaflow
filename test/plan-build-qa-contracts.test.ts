import { describe, expect, it } from 'vitest';
import {
  parsePlanBuildQaBuildResult,
  parsePlanBuildQaPlan,
  parsePlanBuildQaQaReport,
  parsePlanBuildQaScope,
  planBuildQaWorkflow,
  serializePlanBuildQaWorkflow,
  validatePlanBuildQaWorkflowDefinition,
} from '../src/workflows/plan-build-qa.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';

const scope = {
  decision: 'proceed' as const,
  strategy: 'Implement the smallest compatible change',
  inScope: ['The requested behavior'],
  outOfScope: ['Unrelated refactors'],
  acceptanceCriteria: ['The requested behavior works'],
  risks: [{ description: 'A regression is possible', mitigation: 'Run the focused tests' }],
  questions: [],
};

const plan = {
  summary: 'Implement the requested behavior',
  tasks: [
    {
      id: 'task-1',
      title: 'Implement behavior',
      description: 'Make the smallest focused change.',
      files: ['src/example.ts'],
      acceptanceCriteria: ['The behavior works'],
    },
  ],
  verification: ['Run the focused test'],
  risks: [],
  questions: [],
};

const build = {
  status: 'passed' as const,
  summary: 'Implemented and verified the change',
  changedFiles: ['src/example.ts'],
  verifications: [{ command: 'pnpm test', status: 'passed' as const }],
  commits: ['abc123'],
};

const qaReport = {
  decision: 'block' as const,
  summary: 'A blocking issue remains',
  findings: [
    {
      id: 'finding-1',
      severity: 'high' as const,
      category: 'correctness',
      title: 'Missing validation',
      explanation: 'An invalid input is accepted.',
      impact: 'The workflow can persist invalid state.',
      evidence: ['test/plan-build-qa-contracts.test.ts'],
      suggestedCorrection: 'Reject the invalid input.',
      verifications: ['Add a regression test'],
    },
  ],
};

describe('plan-build-qa contracts', () => {
  it('validates all structured phase outputs and keeps stable IDs', () => {
    expect(parsePlanBuildQaScope(scope)).toEqual(scope);
    expect(parsePlanBuildQaPlan(plan)).toEqual(plan);
    expect(parsePlanBuildQaBuildResult(build)).toEqual(build);
    expect(parsePlanBuildQaQaReport(qaReport)).toEqual(qaReport);

    const serialized = serializePlanBuildQaWorkflow(planBuildQaWorkflow);
    const restored: unknown = JSON.parse(serialized);
    validatePlanBuildQaWorkflowDefinition(restored);
    expect(planBuildQaWorkflow.steps.map((step) => step.id)).toEqual([
      'scope',
      'plan',
      'build',
      'qa',
      'fix',
    ]);
    expect(planBuildQaWorkflow.steps.every((step) => !('driver' in step))).toBe(true);
  });

  it('requires scope clarification questions only for a clarification decision', () => {
    expect(() =>
      parsePlanBuildQaScope({ ...scope, decision: 'needs_clarification', questions: [] }),
    ).toThrow('Invalid plan-build-qa scope');
    expect(() =>
      parsePlanBuildQaScope({ ...scope, questions: ['Should this be included?'] }),
    ).toThrow('Invalid plan-build-qa scope');
  });

  it('rejects duplicate task and finding IDs', () => {
    expect(() =>
      parsePlanBuildQaPlan({
        ...plan,
        tasks: [plan.tasks[0], { ...plan.tasks[0]!, id: plan.tasks[0]!.id }],
      }),
    ).toThrow('duplicate task id');
    expect(() =>
      parsePlanBuildQaQaReport({
        ...qaReport,
        findings: [
          qaReport.findings[0],
          { ...qaReport.findings[0]!, id: qaReport.findings[0]!.id },
        ],
      }),
    ).toThrow('duplicate finding id');
  });

  it('only stops for explicit scope clarification', () => {
    expect(interpretWorkflowDisposition('plan-build-qa-scope', scope)).toEqual({
      content: JSON.stringify(scope, null, 2),
      disposition: { kind: 'continue' },
    });
    expect(
      interpretWorkflowDisposition('plan-build-qa-scope', {
        ...scope,
        decision: 'needs_clarification',
        questions: ['Which workspace is in scope?'],
      }),
    ).toEqual({
      content: expect.any(String),
      disposition: {
        kind: 'stop',
        code: 'SCOPE_NEEDS_CLARIFICATION',
        message: 'Which workspace is in scope?',
      },
    });
  });
});
