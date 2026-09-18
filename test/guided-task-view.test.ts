import { describe, expect, it, vi } from 'vitest';
import type { ArtifactReference } from '../src/core/run.js';
import type {
  GuidedPreparationMessage,
  GuidedPreparationSource,
  GuidedPreparationState,
} from '../src/application/guided-preparation.js';
import type {
  GuidedExecutionProgress,
  GuidedExecutionQueries,
} from '../src/application/guided-execution.js';
import {
  createGuidedTaskViewQueries,
  toGuidedExecutionProgressView,
  type GuidedTaskViewContext,
} from '../src/application/guided-task-view.js';
import type {
  TaskContractAction,
  TaskContractBrief,
  TaskContractDocument,
  TaskContractPlan,
  TaskContractTodo,
  TaskContractView,
} from '../src/application/task-contract.js';
import type { TaskContractQueries } from '../src/application/task-contract.js';

const workspace = '/secret/workspace';
const brief: TaskContractDocument<TaskContractBrief> = {
  id: 'brief-1',
  contractId: 'task-1',
  kind: 'brief',
  version: 1,
  sourceDocumentId: null,
  createdAt: '2026-01-01T00:00:00Z',
  body: {
    objective: 'Improve validation',
    conclusions: [],
    constraints: [],
    outOfScope: [],
  },
};
const plan: TaskContractDocument<TaskContractPlan> = {
  id: 'plan-1',
  contractId: 'task-1',
  kind: 'plan',
  version: 1,
  sourceDocumentId: null,
  createdAt: '2026-01-01T00:00:01Z',
  body: {
    briefVersion: 1,
    summary: 'Implement validation',
    items: [],
    verification: ['pnpm test'],
  },
};
const todo: TaskContractDocument<TaskContractTodo> = {
  id: 'todo-1',
  contractId: 'task-1',
  kind: 'todo',
  version: 1,
  sourceDocumentId: null,
  createdAt: '2026-01-01T00:00:02Z',
  body: { planVersion: 1, phases: [], scopeChanges: [] },
};
const approval: TaskContractAction = {
  id: 'approval-1',
  contractId: 'task-1',
  sequence: 1,
  kind: 'approve-plan',
  targetDocumentId: plan.id,
  relatedActionId: null,
  details: { decision: 'approve' },
  createdAt: '2026-01-01T00:00:03Z',
};
const task: TaskContractView = {
  contract: {
    id: 'task-1',
    kind: 'guided-task',
    workspace,
    contractVersion: 1,
    revision: 4,
    phase: 'todo',
    currentBriefId: brief.id,
    currentPlanId: plan.id,
    approvedPlanId: plan.id,
    currentTodoId: todo.id,
    currentBlockId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:04Z',
  },
  readiness: 'ready',
  execution: { runId: 'guided-run-1' },
  currentBrief: brief,
  currentPlan: plan,
  approvedPlan: plan,
  currentTodo: todo,
  approval,
  activeBlock: null,
};

function createContext(overrides: Partial<GuidedTaskViewContext> = {}): GuidedTaskViewContext {
  const actions: TaskContractAction[] = [approval];
  const taskContracts: TaskContractQueries = {
    get: vi.fn(async () => task),
    list: vi.fn(async () => ({ items: [task.contract], nextCursor: 'task-1' })),
    getDocument: vi.fn(async ({ kind }) =>
      kind === 'brief' ? brief : kind === 'plan' ? plan : todo,
    ),
    listDocuments: vi.fn(async () => ({ items: [] })),
    listActions: vi.fn(async () => ({ items: actions, nextCursor: 7 })),
    getTodoMarkdown: vi.fn(async () => ({
      contractId: task.contract.id,
      planVersion: 1,
      todoVersion: 1,
      current: true,
      readiness: 'ready' as const,
      fileName: 'TODO.md' as const,
      content: '# TODO',
    })),
  };
  return { taskContracts, ...overrides };
}

function preparationState(): GuidedPreparationState {
  return {
    contractId: task.contract.id,
    revision: 3,
    lastSequence: 12,
    briefConfirmedThroughSequence: 10,
    confirmedSourceIds: ['source-1'],
    draftBrief: brief.body,
    activeRequestId: 'private-request-id',
    activeOperation: {
      contractId: task.contract.id,
      requestId: 'private-request-id',
      operationId: 'private-operation-id',
      kind: 'reply',
      requestHash: 'private-request-hash',
      preparationRevision: 3,
      contractRevision: 4,
      status: 'running',
      ownerToken: 'private-owner-token',
      profileSnapshot: { private: true } as never,
    },
    planVersion: 1,
    todoVersion: 1,
  };
}

function executionProgress(): GuidedExecutionProgress {
  const artifact: ArtifactReference = {
    id: 'artifact-1',
    runId: 'guided-run-1',
    stepId: 'p001-t001-a001',
    name: 'result.json',
    kind: 'json',
    path: '/secret/artifacts/result.json',
    mediaType: 'application/json',
    sizeBytes: 12,
  };
  return {
    runId: 'guided-run-1',
    contractId: task.contract.id,
    revision: 8,
    stage: 'changes-review',
    status: 'waiting',
    phases: [
      {
        id: 'phase-1',
        ordinal: 1,
        title: 'Build',
        status: 'completed',
        tasks: [
          {
            id: 'task-1',
            phaseId: 'phase-1',
            ordinal: 1,
            status: 'completed',
            attempt: 1,
            resultArtifact: artifact,
          },
        ],
      },
    ],
    activeBlock: {
      id: 'block-1',
      revision: 8,
      phaseId: 'phase-1',
      type: 'workspace-changed',
      reason: 'Review changes',
      evidence: [artifact],
      fingerprint: {
        workspace,
        branch: 'main',
        head: 'abc123',
        clean: false,
        changes: [{ path: 'src/app.ts', status: 'M', mode: '100644', contentHash: 'hash' }],
      },
    },
    nextAction: 'review-changes',
  };
}

describe('guided task views', () => {
  it('composes a complete detail without leaking private fields', async () => {
    const execution = executionProgress();
    const executions: GuidedExecutionQueries = {
      previewStart: vi.fn(),
      previewResume: vi.fn(),
      get: vi.fn(async () => execution),
      list: vi.fn(async () => ({ items: [execution] })),
    };
    const context = createContext({
      preparation: {
        getState: vi.fn(async () => preparationState()),
        listMessages: vi.fn(
          async (): Promise<{ items: GuidedPreparationMessage[]; nextCursor?: number }> => ({
            items: [
              {
                id: 'message-1',
                contractId: task.contract.id,
                sequence: 1,
                role: 'assistant',
                content: 'Plan ready',
                requestId: 'private-message-request',
                createdAt: '2026-01-01T00:00:05Z',
              },
            ],
            nextCursor: 2,
          }),
        ),
        listSources: vi.fn(
          async (): Promise<{ items: GuidedPreparationSource[]; nextCursor?: number }> => ({
            items: [
              {
                id: 'source-1',
                contractId: task.contract.id,
                sequence: 2,
                kind: 'page',
                url: 'https://example.test/source',
                title: 'Source',
                excerpt: 'Evidence',
                retrievedAt: '2026-01-01T00:00:06Z',
                contentHash: 'private-content-hash',
                truncated: false,
              },
            ],
          }),
        ),
      },
      executions,
    });

    const view = await createGuidedTaskViewQueries(context).getGuidedTaskView('task-1');
    const serialized = JSON.stringify(view);

    expect(view).toMatchObject({
      id: 'task-1',
      revision: 4,
      readiness: 'ready',
      phase: 'todo',
      preparation: {
        revision: 3,
        messages: { items: [{ id: 'message-1', sequence: 1 }] },
        sources: { items: [{ id: 'source-1', sequence: 2 }] },
      },
      execution: { runId: 'guided-run-1', activeBlock: { id: 'block-1' } },
    });
    expect(serialized).not.toContain('private-message-request');
    expect(serialized).not.toContain('private-content-hash');
    expect(serialized).not.toContain('private-request-hash');
    expect(serialized).not.toContain('private-owner-token');
    expect(serialized).not.toContain('private/artifacts');
    expect(serialized).not.toContain('secret/workspace');
    expect(view.execution?.activeBlock?.fingerprint).not.toHaveProperty('workspace');
    expect(view.execution?.phases[0]?.tasks[0]?.resultArtifact).not.toHaveProperty('path');
  });

  it('supports a task without preparation or execution', async () => {
    const taskWithoutExecution = { ...task };
    delete taskWithoutExecution.execution;
    const context = createContext({
      taskContracts: {
        ...createContext().taskContracts,
        get: vi.fn(async (): Promise<TaskContractView> => taskWithoutExecution),
      },
    });

    const view = await createGuidedTaskViewQueries(context).getGuidedTaskView('task-1');

    expect(view.preparation).toBeNull();
    expect(view.execution).toBeNull();
  });

  it('passes pagination limits and cursors to existing queries', async () => {
    const context = createContext();
    const list = vi.spyOn(context.taskContracts, 'list');
    const actions = vi.spyOn(context.taskContracts, 'listActions');
    const messages = vi.fn(async () => ({ items: [], nextCursor: 11 }));
    const sources = vi.fn(async () => ({ items: [], nextCursor: 13 }));
    context.preparation = {
      getState: vi.fn(async () => preparationState()),
      listMessages: messages,
      listSources: sources,
    };

    const queries = createGuidedTaskViewQueries(context);
    await queries.listGuidedTaskViews({ afterId: 'task-0', limit: 2 });
    await queries.getGuidedTaskView('task-1', {
      actionsAfterSequence: 5,
      messagesAfterSequence: 6,
      sourcesAfterSequence: 7,
      limit: 3,
    });

    expect(list).toHaveBeenCalledWith({ afterId: 'task-0', limit: 2 });
    expect(actions).toHaveBeenCalledWith({ contractId: 'task-1', afterSequence: 5, limit: 3 });
    expect(messages).toHaveBeenCalledWith('task-1', 6, 3);
    expect(sources).toHaveBeenCalledWith('task-1', 7, 3);
  });

  it('propagates an unknown contract instead of fabricating a view', async () => {
    const context = createContext({
      taskContracts: {
        ...createContext().taskContracts,
        get: vi.fn(async () => {
          throw new Error('Unknown task contract: missing');
        }),
      },
    });

    await expect(createGuidedTaskViewQueries(context).getGuidedTaskView('missing')).rejects.toThrow(
      'Unknown task contract',
    );
  });

  it('projects execution artifacts without filesystem paths', () => {
    const view = toGuidedExecutionProgressView(executionProgress());

    expect(view).not.toHaveProperty('workspace');
    expect(view.activeBlock?.evidence[0]).not.toHaveProperty('path');
    expect(view.phases[0]?.tasks[0]?.resultArtifact).not.toHaveProperty('path');
  });
});
