import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import type { WorkflowRun } from '../src/core/run.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-portability-'));
  directories.push(directory);
  return { directory, databasePath: join(directory, 'runs.db') };
}

const requestId = '33333333-3333-4333-8333-333333333333';
const transferId = '11111111-1111-4111-8111-111111111111';

describe('portable dataset persistence', () => {
  it('creates schema 15 identity once and preserves it on reopen', async () => {
    const { databasePath } = setup();
    const first = new SqliteRunStore(databasePath);
    const initial = await first.getPortabilityState();
    expect(initial.state).toBe('active');
    expect(initial.datasetId).toMatch(/^[0-9a-f-]{36}$/);
    first.close();

    const second = new SqliteRunStore(databasePath);
    expect((await second.getPortabilityState()).datasetId).toBe(initial.datasetId);
    second.close();
  });

  it('applies compare-and-set export intents and supports exact replay only', async () => {
    const { databasePath } = setup();
    const store = new SqliteRunStore(databasePath);
    const exporting = await store.beginExportIntent({
      requestId,
      transferId,
      digest: 'digest-1',
      destination: '/tmp/package',
    });
    expect(exporting.state).toBe('exporting');
    expect(
      await store.beginExportIntent({
        requestId,
        transferId,
        digest: 'digest-1',
        destination: '/tmp/package',
      }),
    ).toEqual(exporting);
    await expect(
      store.beginExportIntent({
        requestId: '44444444-4444-4444-8444-444444444444',
        transferId: '55555555-5555-4555-8555-555555555555',
        digest: 'digest-2',
        destination: '/tmp/other',
      }),
    ).rejects.toThrow(/already active/);

    const finished = await store.finalizeExport({
      requestId,
      transfer: {
        transferId,
        parentTransferId: null,
        datasetId: exporting.datasetId,
        requestId,
        digest: 'digest-1',
        gitFingerprint: 'git-fingerprint',
        state: 'exported',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
      },
    });
    expect(finished.state).toBe('exported');
    expect(
      await store.finalizeExport({
        requestId,
        transfer: {
          transferId,
          parentTransferId: null,
          datasetId: exporting.datasetId,
          requestId,
          digest: 'digest-1',
          gitFingerprint: 'git-fingerprint',
          state: 'exported',
          createdAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z',
        },
      }),
    ).toEqual(finished);
    await expect(
      store.beginExportIntent({
        requestId: '66666666-6666-4666-8666-666666666666',
        transferId: '77777777-7777-4777-8777-777777777777',
        digest: 'digest-3',
        destination: '/tmp/new',
      }),
    ).rejects.toThrow(/Exported dataset/);
    store.close();
  });

  it('reports resumable runs without reading their result content', async () => {
    const { databasePath } = setup();
    const store = new SqliteRunStore(databasePath);
    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'pending objective',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.createRun(run);
    expect(await store.inspectPortabilityBlockers()).toEqual([
      { code: 'reusable-run', detail: '1 run(s) can be resumed' },
    ]);
    store.close();
  });

  it('creates a consistent SQLite backup through better-sqlite3', async () => {
    const { directory, databasePath } = setup();
    const backupPath = join(directory, 'backup.db');
    const store = new SqliteRunStore(databasePath);
    await store.backupDatabaseTo(backupPath);
    store.close();
    const backup = new Database(backupPath, { readonly: true });
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(backup.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({
      version: 17,
    });
    backup.close();
  });
});
