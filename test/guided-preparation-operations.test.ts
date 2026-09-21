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

    const plannerPrompts: string[] = [];
    const driver: AgentDriver = {
      execute: async (request) => {
        plannerPrompts.push(request.prompt);
        return {
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
        };
      },
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
    preparationRevision = 3;

    await service.execute({
      ...operationBase(contractId, 1, preparationRevision),
      kind: 'search',
      query: 'flow',
    });
    const sources = await store.listGuidedPreparationSources({ workspace, contractId });
    expect(sources.items).toHaveLength(1);
    preparationRevision = 6;

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
    preparationRevision = 7;

    const plan = await service.execute({
      ...operationBase(contractId, 2, preparationRevision),
      kind: 'generate-plan',
      sourceIds: [sources.items[0]!.id],
    });
    expect(plan.status).toBe('completed');
    preparationRevision = 9;

    await service.execute({
      ...operationBase(contractId, 3, preparationRevision),
      kind: 'approve-plan',
      planVersion: 1,
    });
    preparationRevision = 11;

    const todo = await service.execute({
      ...operationBase(contractId, 4, preparationRevision),
      kind: 'generate-todo',
      planVersion: 1,
    });
    expect(todo.status).toBe('completed');
    expect(
      (await store.getTaskContract(workspace, contractId))?.currentTodo?.body.planVersion,
    ).toBe(1);
    expect(plannerPrompts.at(-1)).toContain('Approved plan document:');
    expect(plannerPrompts.at(-1)).toContain('Implement the guided flow');
  });

  it('continues the last successful planner session on the next reply', async () => {
    const store = new SqliteRunStore(':memory:');
    stores.push(store);
    const contractId = randomUUID();
    await store.createTaskContract({
      contractId,
      workspace,
      brief: {
        objective: 'Continue the chat',
        conclusions: [],
        constraints: [],
        outOfScope: [],
      },
    });
    await store.createGuidedPreparation({ workspace, contractId });
    const requestedSessions: Array<string | undefined> = [];
    const requestedModels: string[] = [];
    const driver: AgentDriver = {
      execute: async (request) => {
        requestedSessions.push(request.sessionId);
        requestedModels.push(`${request.profile.provider ?? ''}/${request.profile.model}`);
        return {
          text: JSON.stringify({
            schemaVersion: 1,
            kind: 'message',
            message: 'The draft is still bounded.',
            questions: [],
            citedSourceIds: [],
          }),
          sessionId: 'session-1',
        };
      },
    };
    const service = createGuidedPreparationService({
      store,
      taskContracts: store,
      sourceReader: {
        search: async () => [],
        readUrl: async () => {
          throw new Error('not used');
        },
      },
      driver,
      plannerProfile: profile,
      workspace,
    });

    const first = await service.execute({
      ...operationBase(contractId, 1, 1),
      kind: 'reply',
      message: 'Start the discussion.',
      sourceIds: [],
    });
    expect(first.status).toBe('completed');
    const preparation = await store.getGuidedPreparation(workspace, contractId);
    expect(preparation).toMatchObject({ externalSessionId: 'session-1', revision: 3 });

    const second = await service.execute({
      ...operationBase(contractId, 1, 3),
      kind: 'reply',
      message: 'Continue with the constraints.',
      sourceIds: [],
    });
    expect(second.status).toBe('completed');

    const third = await service.execute({
      ...operationBase(contractId, 1, 5),
      kind: 'reply',
      message: 'Use another model for this turn.',
      sourceIds: [],
      modelSelection: { provider: 'pi', model: 'planner-alt' },
    });
    expect(third.status).toBe('completed');
    expect(requestedSessions).toEqual([undefined, 'session-1', undefined]);
    expect(requestedModels).toEqual(['/planner-test', '/planner-test', 'pi/planner-alt']);
  });

  it('records invalid planner output and allows a fresh plan request', async () => {
    const store = new SqliteRunStore(':memory:');
    stores.push(store);
    const contractId = randomUUID();
    await store.createTaskContract({
      contractId,
      workspace,
      brief: {
        objective: 'Generate a valid plan',
        conclusions: ['The task is local'],
        constraints: ['Keep the change small'],
        outOfScope: ['Deployment'],
      },
    });
    await store.createGuidedPreparation({ workspace, contractId });
    let attempts = 0;
    const driver: AgentDriver = {
      execute: async () => {
        attempts += 1;
        const plan = {
          briefVersion: 1,
          summary: 'Implement the local change',
          items: [
            {
              id: 'change',
              title: 'Implement change',
              description: 'Make the requested local change.',
              files: [{ path: 'src/change.ts', reason: 'Owns the change' }],
              acceptanceCriteria: ['The change works'],
            },
          ],
          verification: ['Run focused tests'],
        };
        return {
          text: JSON.stringify(
            attempts === 1
              ? { schemaVersion: 1, kind: 'plan', citedSourceIds: [], plan: { summary: 'Invalid' } }
              : { schemaVersion: 1, kind: 'plan', citedSourceIds: [], plan },
          ),
        };
      },
    };
    const service = createGuidedPreparationService({
      store,
      taskContracts: store,
      sourceReader: {
        search: async () => [],
        readUrl: async () => {
          throw new Error('not used');
        },
      },
      driver,
      plannerProfile: profile,
      workspace,
    });
    const task = await store.getTaskContract(workspace, contractId);
    const preparation = await store.getGuidedPreparation(workspace, contractId);
    if (!task || !preparation) throw new Error('test setup failed');
    const firstRequest = operationBase(contractId, task.contract.revision, preparation.revision);

    await expect(
      service.execute({ ...firstRequest, kind: 'generate-plan', sourceIds: [] }),
    ).rejects.toMatchObject({ code: 'planner-output-invalid' });
    expect(
      (
        await store.getGuidedPreparationRequest({
          workspace,
          contractId,
          requestId: firstRequest.requestId,
        })
      )?.errorCode,
    ).toBe('planner-output-invalid');
    expect((await store.getTaskContract(workspace, contractId))?.currentPlan).toBeNull();

    const retryPreparation = await store.getGuidedPreparation(workspace, contractId);
    if (!retryPreparation) throw new Error('test setup failed');
    const second = await service.execute({
      ...operationBase(contractId, task.contract.revision, retryPreparation.revision),
      kind: 'generate-plan',
      sourceIds: [],
    });
    expect(second.status).toBe('completed');
    expect(attempts).toBe(2);
  });
});
