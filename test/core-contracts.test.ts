import { describe, expect, it } from 'vitest';
import { parseBuildPlan, planBuildWorkflow } from '../src/workflows/plan-build.js';
import { researchPlanBuildWorkflow } from '../src/workflows/research-plan-build.js';
import { serializeWorkflow, validateWorkflowDefinition } from '../src/core/workflow.js';

describe('plan-build contracts', () => {
  it('is portable and serializable without harness-specific settings', () => {
    const serialized = serializeWorkflow(planBuildWorkflow);
    const restored: unknown = JSON.parse(serialized);

    validateWorkflowDefinition(restored);

    expect(planBuildWorkflow.steps.map((step) => step.id)).toEqual(['plan', 'build']);
    expect(planBuildWorkflow.steps.every((step) => !('driver' in step) && !('model' in step))).toBe(
      true,
    );
  });

  it('rejects a dependency cycle before execution', () => {
    const cyclic = structuredClone(planBuildWorkflow);
    cyclic.steps[0]!.dependsOn = ['build'];

    expect(() => validateWorkflowDefinition(cyclic)).toThrow('dependency cycle');
  });

  it('rejects duplicate input-reference names and unreachable step-output refs', () => {
    const duplicateInputs = structuredClone(planBuildWorkflow);
    duplicateInputs.steps[1]!.inputReferences.push({
      name: 'objective',
      source: { kind: 'workflow-input', key: 'objective' },
    });
    expect(() => validateWorkflowDefinition(duplicateInputs)).toThrow(
      'duplicate input reference names',
    );

    const unreachable = structuredClone(planBuildWorkflow);
    unreachable.steps.push({
      kind: 'agent',
      id: 'extra',
      profile: 'builder',
      prompt: 'extra',
      dependsOn: [],
      inputReferences: [
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
      ],
      outputs: [{ name: 'result', kind: 'artifact', format: 'text' }],
    });
    expect(() => validateWorkflowDefinition(unreachable)).toThrow(
      'not reachable through dependsOn',
    );

    const transitive = structuredClone(planBuildWorkflow);
    transitive.steps.push({
      kind: 'agent',
      id: 'verify',
      profile: 'builder',
      prompt: 'verify',
      dependsOn: ['build'],
      inputReferences: [
        { name: 'plan', source: { kind: 'step-output', stepId: 'plan', output: 'plan' } },
      ],
      outputs: [{ name: 'result', kind: 'artifact', format: 'text' }],
    });
    expect(() => validateWorkflowDefinition(transitive)).not.toThrow();
  });

  it('accepts the planner contract and rejects incomplete output', () => {
    const plan = {
      decision: 'build',
      summary: 'Add the requested behavior',
      tasks: [
        {
          id: 'implementation',
          title: 'Implement behavior',
          description: 'Make the smallest focused change.',
          files: ['src/example.ts'],
          acceptanceCriteria: ['The behavior works'],
        },
      ],
      verification: ['Run the focused test'],
      risks: [],
      clarificationQuestions: [],
    };

    expect(parseBuildPlan(plan)).toEqual(plan);
    expect(() => parseBuildPlan({ summary: 'missing tasks' })).toThrow('Invalid build plan');
  });
});

describe('research-plan-build contracts', () => {
  it('is serializable and keeps harness tools out of the workflow', () => {
    const serialized = serializeWorkflow(researchPlanBuildWorkflow);
    const restored: unknown = JSON.parse(serialized);

    validateWorkflowDefinition(restored);

    expect(researchPlanBuildWorkflow.approval?.after).toBe('research-review');
    expect(researchPlanBuildWorkflow.steps.every((step) => !('driver' in step))).toBe(true);
  });
});
