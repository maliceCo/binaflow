import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTaskContractService } from '../src/application/task-contract-operations.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const brief = {
  objective: 'Persist a guided task contract',
  conclusions: ['The plan is approved separately'],
  constraints: ['Do not execute agents'],
  outOfScope: ['Web UI'],
};
const plan = {
  briefVersion: 1,
  summary: 'Define the guided contract',
  items: [
    {
      id: 'model',
      title: 'Define model',
      description: 'Store the structured contract.',
      files: [{ path: 'src/application/task-contract.ts', reason: 'Contract types live here' }],
      acceptanceCriteria: ['The schema is strict'],
    },
  ],
  verification: ['Run the focused tests'],
};
const todo = {
  planVersion: 1,
  phases: [
    {
      id: 'phase-1',
      title: 'Implement model',
      tasks: [
        {
          id: 'task-1',
          planItemId: 'model',
          instructions: ['Implement the model'],
          files: ['src/application/task-contract.ts'],
          acceptanceCriteria: ['The model persists'],
          verification: ['Run focused tests'],
          stopConditions: ['Stop if workflow runs must change'],
        },
      ],
    },
  ],
  scopeChanges: [],
};

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-task-contract-app-'));
  directories.push(directory);
  const store = new SqliteRunStore(join(directory, 'runs.db'));
  const service = createTaskContractService({ store, workspace: '/workspace/project' });
  return { store, service };
}

describe('task contract application operations', () => {
  it('keeps workspace context server-owned through the full approval flow', async () => {
    const { store, service } = setup();
    const contractId = randomUUID();
    const created = await service.create({ contractId, brief });
    expect(created.readiness).toBe('needs-plan');
    const planned = await service.publishPlan({ contractId, expectedRevision: 1, plan });
    expect(planned.readiness).toBe('needs-approval');
    const commented = await service.commentPlan({
      contractId,
      expectedRevision: 2,
      planVersion: 1,
      content: 'Please preserve this boundary.',
    });
    expect(commented.readiness).toBe('needs-approval');
    expect(commented.approval).toBeNull();
    const approved = await service.approvePlan({
      contractId,
      expectedRevision: 3,
      planVersion: 1,
    });
    expect(approved.readiness).toBe('needs-todo');
    const ready = await service.publishTodo({ contractId, expectedRevision: 4, todo });
    expect(ready.readiness).toBe('ready');
    expect((await service.listDocuments({ contractId, kind: 'plan' })).items).toHaveLength(1);
    expect((await service.listActions({ contractId })).items.map((action) => action.kind)).toEqual([
      'comment',
      'approve-plan',
    ]);
    await expect(service.get(contractId)).resolves.toMatchObject({
      contract: { workspace: '/workspace/project' },
    });
    store.close();
  });

  it('preserves a scope-review block and rejects malformed requests before storage', async () => {
    const { store, service } = setup();
    const contractId = randomUUID();
    await service.create({ contractId, brief });
    await service.publishPlan({ contractId, expectedRevision: 1, plan });
    await service.approvePlan({ contractId, expectedRevision: 2, planVersion: 1 });
    const blocked = await service.publishTodo({
      contractId,
      expectedRevision: 3,
      todo: { ...todo, scopeChanges: ['Additional work'] },
    });
    expect(blocked.readiness).toBe('blocked');
    expect(blocked.activeBlock?.details).toMatchObject({ reason: 'TODO scope requires review' });
    await expect(
      service.publishPlan({
        contractId,
        expectedRevision: 4,
        plan: { ...plan, unexpected: true } as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect((await service.get(contractId)).contract.revision).toBe(4);
    store.close();
  });
});
