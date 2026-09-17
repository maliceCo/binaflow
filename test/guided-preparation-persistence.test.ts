import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const stores: SqliteRunStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function createStore(): SqliteRunStore {
  const store = new SqliteRunStore(':memory:');
  stores.push(store);
  return store;
}

function brief(objective: string) {
  return {
    objective,
    conclusions: ['The task has a bounded scope'],
    constraints: ['Keep persisted state compatible'],
    outOfScope: ['Unrelated cleanup'],
  };
}

describe('guided preparation persistence', () => {
  it('creates one preparation, admits a message idempotently, and closes its request', async () => {
    const store = createStore();
    const workspace = '/tmp/guided-preparation-workspace';
    const contractId = randomUUID();
    const requestId = randomUUID();

    await store.createTaskContract({ contractId, workspace, brief: brief('Initial objective') });
    expect(await store.createGuidedPreparation({ workspace, contractId })).toMatchObject({
      contractId,
      revision: 1,
      lastSequence: 0,
      activeRequestId: null,
    });
    expect(await store.createGuidedPreparation({ workspace, contractId })).toMatchObject({
      revision: 1,
    });

    const operation = {
      schemaVersion: 1 as const,
      requestId,
      contractId,
      expectedRevision: 1,
      expectedPreparationRevision: 1,
      kind: 'reply' as const,
      message: 'Please clarify the acceptance criteria.',
      sourceIds: [],
    };
    const admitted = await store.beginGuidedPreparationRequest({
      workspace,
      operation,
      operationId: randomUUID(),
      requestHash: 'hash-1',
      ownerToken: 'owner-1',
    });
    expect(admitted).toMatchObject({ requestId, status: 'pending', kind: 'reply' });
    expect(
      await store.beginGuidedPreparationRequest({
        workspace,
        operation,
        operationId: randomUUID(),
        requestHash: 'hash-1',
        ownerToken: 'owner-1',
      }),
    ).toMatchObject({ requestId, status: 'pending' });
    await expect(
      store.beginGuidedPreparationRequest({
        workspace,
        operation,
        operationId: randomUUID(),
        requestHash: 'different',
        ownerToken: 'owner-1',
      }),
    ).rejects.toThrow(/different body/i);

    expect(await store.listGuidedPreparationMessages({ workspace, contractId })).toMatchObject({
      items: [{ sequence: 1, role: 'user', content: operation.message }],
    });
    await store.finishGuidedPreparationRequest({
      workspace,
      operation,
      operationId: admitted.operationId,
      ownerToken: 'owner-1',
      status: 'completed',
      result: {
        schemaVersion: 1,
        kind: 'message',
        message: 'The acceptance criteria should describe observable behavior.',
        questions: [],
        citedSourceIds: [],
      },
    });
    expect(await store.getGuidedPreparation(workspace, contractId)).toMatchObject({
      revision: 3,
      lastSequence: 1,
      activeRequestId: null,
    });
    const sourceId = randomUUID();
    await store.saveGuidedPreparationSources({
      workspace,
      contractId,
      sources: [
        {
          id: sourceId,
          contractId,
          sequence: 2,
          kind: 'page',
          url: 'https://example.com/reference',
          title: 'Reference',
          excerpt: 'Bounded source extract',
          retrievedAt: new Date().toISOString(),
          contentHash: 'a'.repeat(64),
          truncated: false,
        },
      ],
    });
    expect(await store.listGuidedPreparationSources({ workspace, contractId })).toMatchObject({
      items: [{ id: sourceId, sequence: 2, kind: 'page' }],
    });
  });

  it('confirms a brief atomically and invalidates older plan pointers', async () => {
    const store = createStore();
    const workspace = '/tmp/guided-preparation-workspace';
    const contractId = randomUUID();
    await store.createTaskContract({ contractId, workspace, brief: brief('Initial objective') });
    await store.createGuidedPreparation({ workspace, contractId });

    const state = await store.confirmGuidedBrief({
      workspace,
      contractId,
      expectedPreparationRevision: 1,
      brief: brief('Reviewed objective'),
      throughSequence: 0,
      sourceIds: [],
    });
    expect(state).toMatchObject({
      revision: 2,
      briefConfirmedThroughSequence: 0,
      confirmedSourceIds: [],
    });
    expect((await store.getTaskContract(workspace, contractId))?.currentBrief.body).toEqual(
      brief('Reviewed objective'),
    );
  });

  it('persists assistant metadata, the draft brief, and the active operation', async () => {
    const store = createStore();
    const workspace = '/tmp/guided-preparation-workspace';
    const contractId = randomUUID();
    const requestId = randomUUID();
    await store.createTaskContract({ contractId, workspace, brief: brief('Initial objective') });
    await store.createGuidedPreparation({ workspace, contractId });

    const draft = brief('Draft objective');
    await store.appendGuidedPreparationMessage({
      workspace,
      contractId,
      role: 'assistant',
      content: 'I have a draft for review.',
      requestId,
      metadata: {
        questions: ['Which users are affected?'],
        citedSourceIds: ['source-1'],
        briefSuggestion: draft,
      },
      draftBrief: draft,
    });

    expect(await store.listGuidedPreparationMessages({ workspace, contractId })).toMatchObject({
      items: [
        {
          content: 'I have a draft for review.',
          metadata: {
            questions: ['Which users are affected?'],
            citedSourceIds: ['source-1'],
            briefSuggestion: draft,
          },
        },
      ],
    });
    expect((await store.getGuidedPreparation(workspace, contractId))?.draftBrief).toEqual(draft);

    const operation = {
      schemaVersion: 1 as const,
      requestId,
      contractId,
      expectedRevision: 1,
      expectedPreparationRevision: 2,
      kind: 'reply' as const,
      message: 'Please continue.',
      sourceIds: [],
    };
    await store.beginGuidedPreparationRequest({
      workspace,
      operation,
      operationId: randomUUID(),
      requestHash: 'hash-active',
      ownerToken: 'owner-active',
    });

    expect(
      (await store.getGuidedPreparation(workspace, contractId))?.activeOperation,
    ).toMatchObject({
      requestId,
      kind: 'reply',
      status: 'pending',
    });
  });

  it('keeps at most 50 messages after the confirmed history is compacted', async () => {
    const store = createStore();
    const workspace = '/tmp/guided-preparation-workspace';
    const contractId = randomUUID();
    await store.createTaskContract({ contractId, workspace, brief: brief('Bounded history') });
    await store.createGuidedPreparation({ workspace, contractId });

    for (let sequence = 1; sequence <= 50; sequence += 1) {
      await store.appendGuidedPreparationMessage({
        workspace,
        contractId,
        role: 'assistant',
        content: `Message ${sequence}`,
        requestId: randomUUID(),
      });
    }
    await store.confirmGuidedBrief({
      workspace,
      contractId,
      expectedPreparationRevision: 51,
      brief: brief('Bounded history'),
      throughSequence: 50,
      sourceIds: [],
    });
    await store.appendGuidedPreparationMessage({
      workspace,
      contractId,
      role: 'assistant',
      content: 'Message 51',
      requestId: randomUUID(),
    });

    const messages = await store.listGuidedPreparationMessages({
      workspace,
      contractId,
      limit: 50,
    });
    expect(messages.items).toHaveLength(50);
    expect(messages.items[0]).toMatchObject({ sequence: 2, content: 'Message 2' });
    expect(messages.items.at(-1)).toMatchObject({ sequence: 51, content: 'Message 51' });
    expect(await store.getGuidedPreparation(workspace, contractId)).toMatchObject({
      messagesCompactedThroughSequence: 1,
    });
  });
});
