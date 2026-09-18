import { describe, expect, it, vi } from 'vitest';
import type {
  GuidedTaskDetailView,
  GuidedTaskSummaryView,
} from '../src/application/guided-task-view.js';
import type { TaskContractView } from '../src/application/task-contract.js';
import { handleWebApi } from '../src/web/routes.js';

const contractId = '123e4567-e89b-42d3-a456-426614174000';

function taskView(): TaskContractView {
  return {
    contract: {
      id: contractId,
      revision: 1,
      phase: 'exploration',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    readiness: 'needs-plan',
    currentBrief: {
      id: '123e4567-e89b-42d3-a456-426614174001',
      kind: 'brief',
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    currentPlan: null,
    approvedPlan: null,
    currentTodo: null,
    approval: null,
    activeBlock: null,
  } as TaskContractView;
}

describe('local task API', () => {
  it('serves list, detail, and document pages from the application task view', async () => {
    const summary: GuidedTaskSummaryView = {
      id: contractId,
      revision: 2,
      readiness: 'needs-plan',
      phase: 'planning',
      brief: {
        id: 'brief-1',
        contractId,
        kind: 'brief',
        version: 1,
        sourceDocumentId: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      plan: null,
      approvedPlan: null,
      todo: null,
    };
    const detail: GuidedTaskDetailView = {
      ...summary,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      contractVersion: 1,
      brief: {
        ...summary.brief,
        body: { objective: 'Improve workflow', conclusions: [], constraints: [], outOfScope: [] },
      },
      plan: null,
      approvedPlan: null,
      todo: null,
      actions: { items: [] },
      preparation: {
        revision: 3,
        lastSequence: 8,
        briefConfirmedThroughSequence: 5,
        confirmedSourceIds: ['source-1'],
        messagesCompactedThroughSequence: 0,
        planVersion: null,
        todoVersion: null,
        activeOperation: null,
        messages: {
          items: [
            {
              id: 'message-1',
              sequence: 1,
              role: 'assistant',
              content: 'Hello',
              createdAt: '2025-01-01T00:00:02.000Z',
            },
          ],
        },
        sources: { items: [] },
      },
      execution: null,
    };
    const taskViews = {
      listGuidedTaskViews: vi.fn(async () => ({ items: [summary] })),
      getGuidedTaskView: vi.fn(async () => detail),
    };

    const list = await handleWebApi({ method: 'GET', path: '/api/v1/tasks' }, { taskViews });
    const full = await handleWebApi(
      { method: 'GET', path: `/api/v1/tasks/${contractId}` },
      { taskViews },
    );
    const messages = await handleWebApi(
      {
        method: 'GET',
        path: `/api/v1/tasks/${contractId}/messages`,
        query: new URLSearchParams({ afterSequence: '4', limit: '7' }),
      },
      { taskViews },
    );

    expect(list).toMatchObject({ status: 200, body: { data: { items: [{ id: contractId }] } } });
    expect(full).toMatchObject({
      status: 200,
      body: {
        data: {
          currentBrief: detail.brief.body,
          preparationRevision: 3,
          confirmedSourceIds: ['source-1'],
        },
      },
    });
    expect(messages).toMatchObject({
      status: 200,
      body: { data: { items: [{ id: 'message-1' }] } },
    });
    expect(taskViews.listGuidedTaskViews).toHaveBeenCalledWith({});
    expect(taskViews.getGuidedTaskView).toHaveBeenNthCalledWith(1, contractId);
    expect(taskViews.getGuidedTaskView).toHaveBeenNthCalledWith(2, contractId, {
      messagesAfterSequence: 4,
      limit: 7,
    });
  });

  it('creates the task and its guided preparation state together', async () => {
    const create = vi.fn(async () => taskView());
    const initialize = vi.fn(async () => ({
      contractId,
      revision: 1,
      lastSequence: 0,
      briefConfirmedThroughSequence: 0,
      confirmedSourceIds: [],
      activeRequestId: null,
      planVersion: null,
      todoVersion: null,
    }));
    const response = await handleWebApi(
      {
        method: 'POST',
        path: '/api/v1/tasks',
        body: { contractId, objective: 'Improve the local workflow' },
      },
      {
        taskContracts: { create },
        guidedPreparation: { execute: vi.fn(), create: initialize },
      },
    );

    expect(response).toMatchObject({ status: 201, body: { data: { id: contractId } } });
    expect(create).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledWith(contractId);
  });
});
