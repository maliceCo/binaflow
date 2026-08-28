import { describe, expect, it } from 'vitest';
import { listWorkflowContracts } from '../src/workflows/catalog.js';
import {
  interactiveTargetKey,
  parseInteractiveScope,
  planBuildQaInteractiveWorkflow,
  reviewOperationTransition,
  validateInteractiveTarget,
  validateInteractiveWorkflowDefinition,
} from '../src/workflows/plan-build-qa-interactive.js';

const scope = {
  strategy: 'Make the smallest compatible change',
  inScope: ['The requested behavior'],
  outOfScope: ['Unrelated cleanup'],
  acceptanceCriteria: ['The behavior works'],
  tasks: [
    {
      id: 'task-1',
      title: 'Implement the behavior',
      description: 'Change the focused module.',
      files: ['src/example.ts'],
      acceptanceCriteria: ['The behavior works'],
    },
  ],
  risks: [],
  questions: [],
};

describe('interactive review contracts', () => {
  it('registers the workflow and validates an enumerated scope', () => {
    expect(parseInteractiveScope(scope)).toEqual(scope);
    validateInteractiveWorkflowDefinition(planBuildQaInteractiveWorkflow);
    expect(
      listWorkflowContracts().find((workflow) => workflow.id === 'plan-build-qa-interactive'),
    ).toMatchObject({
      requiredProfiles: ['analyst', 'planner', 'builder', 'qa'],
      interactiveReview: {
        phases: ['scope', 'changes', 'qa'],
        operations: ['message', 'decide', 'finalize'],
        targetKinds: ['scope', 'task', 'change', 'finding'],
        todoArtifact: 'TODO.md',
      },
    });
  });

  it('rejects duplicate task IDs and invalid or unknown targets', () => {
    expect(() =>
      parseInteractiveScope({ ...scope, tasks: [scope.tasks[0], scope.tasks[0]] }),
    ).toThrow('duplicate task id');
    expect(() => validateInteractiveTarget({ kind: 'scope', id: 'task-1' })).toThrow(
      'scope target must use id scope',
    );
    expect(() =>
      validateInteractiveTarget({ kind: 'task', id: 'task-2' }, { taskIds: ['task-1'] }),
    ).toThrow('Unknown task target');
  });

  it('keeps navigation, explanation, and messages non-transitional', () => {
    const target = { kind: 'task' as const, id: 'task-1' };
    validateInteractiveTarget(target, { taskIds: ['task-1'] });
    expect(interactiveTargetKey(target)).toBe('task:task-1');
    expect(
      reviewOperationTransition({ operation: 'message', target, message: 'Explain this task' }),
    ).toBe('none');
    expect(reviewOperationTransition({ operation: 'navigate' })).toBe('none');
    expect(reviewOperationTransition({ operation: 'explain' })).toBe('none');
    expect(reviewOperationTransition({ operation: 'decide', target, decision: 'approve' })).toBe(
      'decision',
    );
    expect(
      reviewOperationTransition({ operation: 'finalize', target: { kind: 'scope', id: 'scope' } }),
    ).toBe('finalization');
  });
});
