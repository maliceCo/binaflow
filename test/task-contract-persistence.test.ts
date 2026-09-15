import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskContractError } from '../src/application/task-contract.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const brief = {
  objective: 'Persist a guided task contract',
  conclusions: ['The contract is independent from runs'],
  constraints: ['Keep legacy workflows unchanged'],
  outOfScope: ['Executing tasks'],
};

const plan = {
  briefVersion: 1,
  summary: 'Define the persisted contract',
  items: [
    {
      id: 'contract',
      title: 'Define contract',
      description: 'Add the contract storage boundary.',
      files: [{ path: 'src/application/task-contract.ts', reason: 'Stores pure rules' }],
      acceptanceCriteria: ['The contract is versioned'],
    },
  ],
  verification: ['Run the contract tests'],
};

const todo = {
  planVersion: 1,
  phases: [
    {
      id: 'phase-1',
      title: 'Implement contract',
      tasks: [
        {
          id: 'task-1',
          planItemId: 'contract',
          instructions: ['Implement the persisted contract'],
          files: ['src/application/task-contract.ts'],
          acceptanceCriteria: ['The contract is durable'],
          verification: ['Run focused tests'],
          stopConditions: ['Stop if legacy tables change'],
        },
      ],
    },
  ],
  scopeChanges: [],
};

function setup(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-task-contract-'));
  directories.push(directory);
  return { directory, path: join(directory, 'runs.db') };
}

describe('SQLite task contract persistence', () => {
  it('persists versions, approval, TODO, and legacy data across reopening', async () => {
    const { path } = setup();
    const workspace = '/workspace/project';
    const contractId = '11111111-1111-4111-8111-111111111111';
    const store = new SqliteRunStore(path);
    const created = await store.createTaskContract({ contractId, workspace, brief });
    expect(created.contract.revision).toBe(1);
    expect(created.contract.phase).toBe('exploration');

    const repeated = await store.createTaskContract({ contractId, workspace, brief });
    expect(repeated.contract.revision).toBe(1);
    expect(repeated.currentBrief.body).toEqual(brief);

    const planned = await store.publishTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: 1,
      plan,
    });
    expect(planned.contract.revision).toBe(2);
    expect(planned.contract.currentPlanId).toBeTruthy();

    const approved = await store.approveTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: 2,
      planVersion: 1,
    });
    expect(approved.contract.revision).toBe(3);
    expect(approved.contract.approvedPlanId).toBe(approved.contract.currentPlanId);

    const ready = await store.publishTaskContractTodo({
      contractId,
      workspace,
      expectedRevision: 3,
      todo,
    });
    expect(ready.contract.revision).toBe(4);
    expect(ready.currentTodo?.body).toEqual(todo);

    await expect(
      store.commentTaskContractPlan({
        contractId,
        workspace,
        expectedRevision: 3,
        planVersion: 1,
        content: 'stale comment',
      }),
    ).rejects.toMatchObject({ code: 'stale-revision' });
    store.close();

    const reopened = new SqliteRunStore(path);
    const persisted = await reopened.getTaskContract(workspace, contractId);
    expect(persisted?.contract.revision).toBe(4);
    expect(persisted?.approval?.kind).toBe('approve-plan');
    expect((await reopened.listTaskContractActions({ contractId, workspace })).items).toHaveLength(
      1,
    );
    reopened.close();

    const database = new Database(path);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get(),
    ).toEqual({ version: 14 });
    database.close();
  });

  it('keeps an incompatible TODO as a blocked candidate with evidence', async () => {
    const { path } = setup();
    const workspace = '/workspace/project';
    const contractId = '44444444-4444-4444-8444-444444444444';
    const store = new SqliteRunStore(path);
    await store.createTaskContract({ contractId, workspace, brief });
    await store.publishTaskContractPlan({ contractId, workspace, expectedRevision: 1, plan });
    await store.approveTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: 2,
      planVersion: 1,
    });
    const blocked = await store.publishTaskContractTodo({
      contractId,
      workspace,
      expectedRevision: 3,
      todo: { ...todo, scopeChanges: ['Add another file'] },
    });
    expect(blocked.contract.currentBlockId).toBeTruthy();
    expect(blocked.activeBlock?.details).toMatchObject({ reason: 'TODO scope requires review' });
    expect(blocked.contract.phase).toBe('planning');
    store.close();
  });

  it('allows only one writer to mutate the same expected revision', async () => {
    const { path } = setup();
    const workspace = '/workspace/project';
    const contractId = '22222222-2222-4222-8222-222222222222';
    const first = new SqliteRunStore(path);
    const second = new SqliteRunStore(path);
    await first.createTaskContract({ contractId, workspace, brief });
    const results = await Promise.allSettled([
      first.publishTaskContractPlan({ contractId, workspace, expectedRevision: 1, plan }),
      second.publishTaskContractPlan({ contractId, workspace, expectedRevision: 1, plan }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({
      reason: expect.objectContaining({ code: 'stale-revision' }),
    });
    expect(
      (await first.listTaskContractDocuments({ contractId, workspace, kind: 'plan' })).items,
    ).toHaveLength(1);
    first.close();
    second.close();
  });

  it('rejects a contract from another workspace without mutation', async () => {
    const { path } = setup();
    const store = new SqliteRunStore(path);
    const contractId = '33333333-3333-4333-8333-333333333333';
    await store.createTaskContract({ contractId, workspace: '/workspace/a', brief });
    await expect(store.getTaskContract('/workspace/b', contractId)).rejects.toMatchObject({
      code: 'invalid-target',
    });
    await expect(
      store.publishTaskContractPlan({
        contractId,
        workspace: '/workspace/b',
        expectedRevision: 1,
        plan,
      }),
    ).rejects.toBeInstanceOf(TaskContractError);
    expect((await store.getTaskContract('/workspace/a', contractId))?.contract.revision).toBe(1);
    store.close();
  });
});
