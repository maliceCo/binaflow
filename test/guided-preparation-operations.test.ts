import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver } from '../src/core/agent.js';
import { createGuidedPreparationService } from '../src/application/guided-preparation-operations.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import type { PublicSourceReader } from '../src/application/ports.js';

const stores: SqliteRunStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const workspace = '/tmp/guided-preparation-operations';
const profile = {
  driver: 'fake',
  model: 'planner-test',
  tools: ['read'],
  workspaceMode: 'read-only' as const,
  projectTrust: 'never' as const,
  timeoutMs: 1000,
  retryLimit: 0,
  skills: { mode: 'none' as const },
};

function operationBase(
  contractId: string,
  expectedRevision: number,
  expectedPreparationRevision: number,
) {
  return {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    contractId,
    expectedRevision,
    expectedPreparationRevision,
  };
}

describe('guided preparation operations', () => {
  it('coordinates bounded chat, source search, plan approval, and TODO generation', async () => {
    const store = new SqliteRunStore(':memory:');
    stores.push(store);
    const contractId = randomUUID();
    await store.createTaskContract({
      contractId,
      workspace,
      brief: {
        objective: 'Add the guided preparation flow',
        conclusions: ['The planner is read-only'],
        constraints: ['Preserve existing workflows'],
        outOfScope: ['A remote service'],
      },
    });
    await store.createGuidedPreparation({ workspace, contractId });

    const driver: AgentDriver = {
      execute: async (request) => ({
        text:
          request.stepId === 'reply'
            ? JSON.stringify({
                schemaVersion: 1,
                kind: 'message',
                message: 'The scope is bounded.',
                questions: [],
                citedSourceIds: [],
              })
            : request.stepId === 'generate-plan'
              ? JSON.stringify({
                  schemaVersion: 1,
                  kind: 'plan',
                  citedSourceIds: [],
                  plan: {
                    briefVersion: 2,
                    summary: 'Implement the guided flow',
                    items: [
                      {
                        id: 'flow',
                        title: 'Implement flow',
                        description: 'Add the requested behavior.',
                        files: [{ path: 'src/flow.ts', reason: 'Owns the behavior' }],
                        acceptanceCriteria: ['The flow is explicit'],
                      },
                    ],
                    verification: ['Run focused tests'],
                  },
                })
              : JSON.stringify({
                  schemaVersion: 1,
                  kind: 'todo',
                  citedSourceIds: [],
                  todo: {
                    planVersion: 1,
                    phases: [
                      {
                        id: 'build',
                        title: 'Build',
                        tasks: [
                          {
                            id: 'flow-task',
                            planItemId: 'flow',
                            instructions: ['Implement the flow'],
                            files: ['src/flow.ts'],
                            acceptanceCriteria: ['The flow works'],
                            verification: ['Run focused tests'],
                            stopConditions: ['Stop on scope change'],
                          },
                        ],
                      },
                    ],
                    scopeChanges: [],
                  },
                }),
      }),
    };
    const sourceReader: PublicSourceReader = {
      search: async () => [
        {
          kind: 'search-result',
          url: 'https://example.com/flow',
          title: 'Flow reference',
          excerpt: 'A bounded reference',
          query: 'flow',
          retrievedAt: new Date().toISOString(),
          contentHash: 'a'.repeat(64),
          truncated: false,
        },
      ],
      readUrl: async () => {
        throw new Error('not used');
      },
    };
    const service = createGuidedPreparationService({
      store,
      taskContracts: store,
      sourceReader,
      driver,
      plannerProfile: profile,
      workspace,
    });

    let preparationRevision = 1;
    const reply = await service.execute({
      ...operationBase(contractId, 1, preparationRevision),
      kind: 'reply',
      message: 'What is in scope?',
      sourceIds: [],
    });
    expect(reply.status).toBe('completed');
    preparationRevision = 4;

    await service.execute({
      ...operationBase(contractId, 1, preparationRevision),
      kind: 'search',
      query: 'flow',
    });
    const sources = await store.listGuidedPreparationSources({ workspace, contractId });
    expect(sources.items).toHaveLength(1);
    preparationRevision = 7;

    await service.confirmBrief({
      ...operationBase(contractId, 1, preparationRevision),
      kind: 'confirm-brief',
      brief: {
        objective: 'Add the guided preparation flow',
        conclusions: ['The planner is read-only'],
        constraints: ['Preserve existing workflows'],
        outOfScope: ['A remote service'],
      },
      throughSequence: 3,
      sourceIds: [sources.items[0]!.id],
    });
    preparationRevision = 8;

    const plan = await service.execute({
      ...operationBase(contractId, 2, preparationRevision),
      kind: 'generate-plan',
      sourceIds: [sources.items[0]!.id],
    });
    expect(plan.status).toBe('completed');
    preparationRevision = 10;

    await service.execute({
      ...operationBase(contractId, 3, preparationRevision),
      kind: 'approve-plan',
      planVersion: 1,
    });
    preparationRevision = 12;

    const todo = await service.execute({
      ...operationBase(contractId, 4, preparationRevision),
      kind: 'generate-todo',
      planVersion: 1,
    });
    expect(todo.status).toBe('completed');
    expect(
      (await store.getTaskContract(workspace, contractId))?.currentTodo?.body.planVersion,
    ).toBe(1);
  });
});
