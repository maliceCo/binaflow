import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import {
  activateImportedBackup,
  inspectPortableBackup,
  normalizePortableBackup,
} from '../src/storage/sqlite-portability.js';
import type { ArtifactReference, WorkflowRun } from '../src/core/run.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('portable SQLite backups', () => {
  it('round-trips technical paths and workspaces without rewriting document history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'binaflow-sqlite-portability-'));
    directories.push(root);
    const sourceDataDir = join(root, 'data-a');
    const sourceWorkspace = join(root, 'workspace-a');
    const destinationDataDir = join(root, 'data-b');
    const destinationWorkspace = join(root, 'workspace-b');
    mkdirSync(join(sourceDataDir, 'artifacts', 'run', 'step'), { recursive: true });
    mkdirSync(sourceWorkspace);
    mkdirSync(destinationDataDir, { recursive: true });
    mkdirSync(destinationWorkspace);
    const artifactPath = join(sourceDataDir, 'artifacts', 'run', 'step', 'result.json');
    writeFileSync(artifactPath, '{"result":true}\n');
    const databasePath = join(sourceDataDir, 'runs.db');
    const run: WorkflowRun = {
      id: 'run-1',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'objective',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const artifact: ArtifactReference = {
      id: 'artifact-1',
      runId: run.id,
      stepId: 'plan',
      name: 'plan',
      kind: 'json',
      path: artifactPath,
      mediaType: 'application/json',
      sizeBytes: 17,
    };
    const store = new SqliteRunStore(databasePath);
    await store.createRun(run, [artifact]);
    await store.createTaskContract({
      contractId: '44444444-4444-4444-8444-444444444444',
      workspace: sourceWorkspace,
      brief: { objective: 'objective', conclusions: ['done'], constraints: [], outOfScope: [] },
    });
    store.close();

    const transferId = '11111111-1111-4111-8111-111111111111';
    const normalized = normalizePortableBackup(databasePath, { sourceDataDir, transferId });
    expect(normalized).toMatchObject({
      state: 'exported',
      artifacts: 1,
      workspaces: ['$BINAFlow_WORKSPACE'],
    });
    const normalizedDb = new Database(databasePath, { readonly: true });
    expect(normalizedDb.prepare('SELECT path FROM artifacts').get()).toEqual({
      path: 'artifacts/run/step/result.json',
    });
    expect(normalizedDb.prepare('SELECT workspace FROM task_contracts').get()).toEqual({
      workspace: '$BINAFlow_WORKSPACE',
    });
    normalizedDb.close();

    const importedDb = join(destinationDataDir, 'runs.db');
    copyFileSync(databasePath, importedDb);
    mkdirSync(join(destinationDataDir, 'artifacts', 'run', 'step'), { recursive: true });
    copyFileSync(artifactPath, join(destinationDataDir, 'artifacts', 'run', 'step', 'result.json'));
    const imported = activateImportedBackup(importedDb, {
      destinationDataDir,
      destinationWorkspace,
      transfer: {
        transferId,
        parentTransferId: null,
        datasetId: normalized.datasetId,
        requestId: transferId,
        digest: 'digest',
        gitFingerprint: 'git-head',
        state: 'imported',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
      },
    });
    expect(imported).toMatchObject({ state: 'active', datasetId: normalized.datasetId });
    expect(inspectPortableBackup(importedDb).state).toBe('active');

    const restored = new SqliteRunStore(importedDb);
    expect((await restored.getArtifacts(run.id))[0]?.path).toBe(
      join(destinationDataDir, 'artifacts', 'run', 'step', 'result.json'),
    );
    expect(
      (await restored.getTaskContract(destinationWorkspace, '44444444-4444-4444-8444-444444444444'))
        ?.contract.workspace,
    ).toBe(destinationWorkspace);
    const artifacts = new FileArtifactStore(join(destinationDataDir, 'artifacts'));
    expect(await artifacts.read((await restored.getArtifacts(run.id))[0]!)).toBe(
      '{"result":true}\n',
    );
    restored.close();
  });

  it('rejects a non-portable artifact path and a backup with the wrong schema', async () => {
    const root = mkdtempSync(join(tmpdir(), 'binaflow-sqlite-portability-'));
    directories.push(root);
    const dataDir = join(root, 'data');
    mkdirSync(dataDir);
    const databasePath = join(dataDir, 'runs.db');
    const store = new SqliteRunStore(databasePath);
    store.close();
    const database = new Database(databasePath);
    database.exec(
      "INSERT INTO runs VALUES ('run', 'plan-build', 1, 'x', 'completed', 'now', 'now')",
    );
    database.exec(
      "INSERT INTO artifacts VALUES ('a', 'run', 'step', 'a', 'text', '/outside/a.txt', 'text/plain', 1)",
    );
    database.close();
    expect(() => normalizePortableBackup(databasePath, dataDir)).toThrow(/outside|data directory/);

    const empty = join(root, 'empty.db');
    new Database(empty).close();
    expect(() => inspectPortableBackup(empty)).toThrow(/schema version 14/);
  });
});
