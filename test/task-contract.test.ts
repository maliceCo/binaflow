import { describe, expect, it } from 'vitest';
import {
  applyTaskContractTransition,
  assertTaskContractTodoMatchesPlan,
  getTaskContractReadiness,
  parseTaskContractBrief,
  parseTaskContractPlan,
  parseTaskContractTodo,
  TaskContractError,
  validateTaskContractTodoScope,
  type TaskContractBrief,
  type TaskContractPlan,
  type TaskContractTodo,
} from '../src/application/task-contract.js';

const brief: TaskContractBrief = {
  objective: 'Persist a guided task contract',
  conclusions: ['The contract is separate from workflow runs'],
  constraints: ['Keep the existing CLI and TUI compatible'],
  outOfScope: ['Executing tasks in this milestone'],
};

const plan: TaskContractPlan = {
  briefVersion: 1,
  summary: 'Add the persisted contract model and validation rules',
  items: [
    {
      id: 'contract-model',
      title: 'Define the contract model',
      description: 'Represent versioned guided task documents.',
      files: [{ path: 'src/application/task-contract.ts', reason: 'Owns the pure contract rules' }],
      acceptanceCriteria: ['The documents have strict schemas'],
    },
  ],
  verification: ['Run the focused contract tests'],
};

const todo: TaskContractTodo = {
  planVersion: 1,
  phases: [
    {
      id: 'contract',
      title: 'Implement the contract',
      tasks: [
        {
          id: 'validate-contract',
          planItemId: 'contract-model',
          instructions: ['Implement strict document parsers'],
          files: ['src/application/task-contract.ts'],
          acceptanceCriteria: ['Invalid documents are rejected'],
          verification: ['Run pnpm exec vitest run test/task-contract.test.ts'],
          stopConditions: ['Stop if the existing workflow schemas must change'],
        },
      ],
    },
  ],
  scopeChanges: [],
};

describe('guided task contract rules', () => {
  it('parses the minimum valid brief, plan, and TODO', () => {
    expect(parseTaskContractBrief(brief)).toEqual(brief);
    expect(parseTaskContractPlan(plan)).toEqual(plan);
    expect(parseTaskContractTodo(todo)).toEqual(todo);
  });

  it('rejects whitespace-only content, invalid paths, duplicate IDs, and extra fields', () => {
    expect(() => parseTaskContractBrief({ ...brief, objective: '  ' })).toThrow(TaskContractError);
    expect(() =>
      parseTaskContractPlan({
        ...plan,
        items: [plan.items[0]!, { ...plan.items[0]!, title: 'Duplicate', id: plan.items[0]!.id }],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      parseTaskContractTodo({
        ...todo,
        phases: [
          {
            ...todo.phases[0]!,
            tasks: [{ ...todo.phases[0]!.tasks[0]!, files: ['../outside.ts'] }],
          },
        ],
      }),
    ).toThrow(/path/i);
    expect(() => parseTaskContractBrief({ ...brief, unexpected: true } as never)).toThrow(
      TaskContractError,
    );
  });

  it('reports TODO scope differences without comparing prose semantically', () => {
    expect(validateTaskContractTodoScope(todo, plan)).toEqual({
      compatible: true,
      differences: [],
    });
    expect(
      validateTaskContractTodoScope(
        {
          ...todo,
          scopeChanges: ['Add a generated web endpoint'],
        },
        plan,
      ),
    ).toMatchObject({ compatible: false, differences: [{ kind: 'scope-change' }] });
    expect(
      validateTaskContractTodoScope(
        {
          ...todo,
          phases: [
            {
              ...todo.phases[0]!,
              tasks: [{ ...todo.phases[0]!.tasks[0]!, files: ['docs/other.md'] }],
            },
          ],
        },
        plan,
      ),
    ).toMatchObject({ compatible: false, differences: [{ kind: 'extra-file' }] });
  });

  it('rejects oversized documents and TODOs based on an obsolete plan version', () => {
    expect(() => parseTaskContractBrief({ ...brief, objective: 'x'.repeat(20_000) })).toThrow(
      /bytes/,
    );
    expect(() => assertTaskContractTodoMatchesPlan({ ...todo, planVersion: 1 }, 2)).toThrow(
      TaskContractError,
    );
  });

  it('applies conservative invalidation rules for comments and blocks', () => {
    const state = {
      phase: 'todo' as const,
      currentPlanId: 'plan-1',
      approvedPlanId: 'plan-1',
      currentTodoId: 'todo-1',
      activeBlockId: null,
    };
    const afterComment = applyTaskContractTransition(state, { kind: 'comment-plan' });
    expect(afterComment).toMatchObject({
      phase: 'planning',
      approvedPlanId: null,
      currentTodoId: null,
    });
    const afterBlock = applyTaskContractTransition(state, { kind: 'block', blockId: 'block-1' });
    expect(afterBlock).toMatchObject({
      phase: 'planning',
      approvedPlanId: null,
      currentTodoId: null,
      activeBlockId: 'block-1',
    });
    expect(applyTaskContractTransition(afterBlock, { kind: 'resolve-block' })).toMatchObject({
      phase: 'planning',
      approvedPlanId: null,
      currentTodoId: null,
      activeBlockId: null,
    });
  });

  it('projects readiness conservatively and blocks stale approval', () => {
    expect(
      getTaskContractReadiness({
        brief: { id: 'brief-1', version: 1 },
        plan: null,
        approvedPlan: null,
        todo: null,
        activeBlock: null,
      }),
    ).toBe('needs-plan');
    expect(
      getTaskContractReadiness({
        brief: { id: 'brief-1', version: 2 },
        plan: { id: 'plan-1', version: 1, briefVersion: 1 },
        approvedPlan: { id: 'plan-1', version: 1, briefVersion: 1 },
        todo: { id: 'todo-1', version: 1, planVersion: 1 },
        activeBlock: null,
      }),
    ).toBe('needs-plan');
    expect(
      getTaskContractReadiness({
        brief: { id: 'brief-1', version: 1 },
        plan: { id: 'plan-1', version: 1, briefVersion: 1 },
        approvedPlan: { id: 'plan-1', version: 1, briefVersion: 1 },
        todo: { id: 'todo-1', version: 1, planVersion: 1 },
        activeBlock: { id: 'block-1' },
      }),
    ).toBe('blocked');
    expect(
      getTaskContractReadiness({
        brief: { id: 'brief-1', version: 1 },
        plan: { id: 'plan-1', version: 1, briefVersion: 1 },
        approvedPlan: { id: 'plan-1', version: 1, briefVersion: 1 },
        todo: { id: 'todo-1', version: 1, planVersion: 1 },
        activeBlock: null,
      }),
    ).toBe('ready');
  });
});
