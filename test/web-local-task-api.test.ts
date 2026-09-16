import { describe, expect, it, vi } from 'vitest';
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
        taskContracts: { list: vi.fn(), get: vi.fn(), create },
        guidedPreparation: { execute: vi.fn(), create: initialize },
      },
    );

    expect(response).toMatchObject({ status: 201, body: { data: { id: contractId } } });
    expect(create).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledWith(contractId);
  });
});
