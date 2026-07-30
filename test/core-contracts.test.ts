import { describe, expect, it } from 'vitest';
import { parseBuildPlan, planBuildWorkflow } from '../src/workflows/plan-build.js';
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

  it('accepts the planner contract and rejects incomplete output', () => {
    const plan = {
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
    };

    expect(parseBuildPlan(plan)).toEqual(plan);
    expect(() => parseBuildPlan({ summary: 'missing tasks' })).toThrow('Invalid build plan');
  });
});
