import { describe, expect, it } from 'vitest';
import type {
  GuidedTaskDetailView,
  GuidedTaskSummaryView,
} from '../src/application/guided-task-view.js';
import { createInitialTuiState } from '../src/tui/model.js';
import { reduce } from '../src/tui/reduce.js';

const summary: GuidedTaskSummaryView = {
  id: 'task-1',
  revision: 2,
  readiness: 'needs-plan',
  phase: 'exploration',
  brief: {
    id: 'brief-1',
    contractId: 'task-1',
    kind: 'brief',
    version: 1,
    sourceDocumentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  plan: null,
  approvedPlan: null,
  todo: null,
};

const detail: GuidedTaskDetailView = {
  ...summary,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  contractVersion: 1,
  brief: {
    ...summary.brief,
    body: { objective: 'Read-only inspection', conclusions: [], constraints: [], outOfScope: [] },
  },
  plan: null,
  approvedPlan: null,
  todo: null,
  actions: { items: [] },
  preparation: null,
  execution: null,
};

describe('guided task TUI state', () => {
  it('lists, opens, refreshes, and returns without exposing mutating events', () => {
    let state = createInitialTuiState({ cwd: '/workspace' });
    state = reduce(state, { type: 'diagnosed', diagnosis: validDiagnosis() });
    state = reduce(state, { type: 'use-folder' });
    state = reduce(state, { type: 'open-guided-tasks' });
    expect(state.focus).toBe('guided-tasks');
    expect(state.status).toContain('Loading guided tasks');

    state = reduce(state, { type: 'guided-tasks-loaded', tasks: [summary] });
    state = reduce(state, { type: 'open-guided-task' });
    expect(state.focus).toBe('detail');
    expect(state.detail).toBe('guided-task');

    state = reduce(state, { type: 'guided-task-set', task: detail });
    state = reduce(state, { type: 'guided-task-refresh' });
    expect(state.detail).toBe('guided-task');
    expect(state.guidedTask?.id).toBe('task-1');

    state = reduce(state, { type: 'guided-task-back' });
    expect(state.focus).toBe('guided-tasks');
    expect(state.detail).toBe('empty');
    expect(state.guidedTask).toBeUndefined();
  });

  it('moves guided task selection independently and scrolls its detail', () => {
    let state = reduce(createInitialTuiState(), { type: 'diagnosed', diagnosis: validDiagnosis() });
    state = reduce(state, { type: 'use-folder' });
    state = reduce(state, {
      type: 'guided-tasks-loaded',
      tasks: [summary, { ...summary, id: 'task-2' }],
    });
    state = reduce(state, { type: 'focus-pane', pane: 'guided-tasks' });
    state = reduce(state, { type: 'move', direction: 1, visibleRows: 1 });
    expect(state.guidedTaskSelected).toBe(1);
    state = reduce(state, { type: 'guided-task-set', task: detail });
    state = reduce(state, { type: 'move', direction: 1, visibleRows: 1 });
    expect(state.offset).toBe(1);
  });
});

function validDiagnosis() {
  return {
    workspacePath: '/workspace',
    configPath: '/workspace/.binaflow/config.json',
    configExists: true,
    configValid: true,
    errors: [],
    profiles: [],
    workflows: [],
    qaHistory: { enabled: false },
    ready: true,
  };
}
