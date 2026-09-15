import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { createPortabilityService } from '../src/application/portability-operations.js';
import { inspectPortableBackup } from '../src/storage/sqlite-portability.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import type { ArtifactReference, WorkflowRun } from '../src/core/run.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function repository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, 'init', '--initial-branch=main');
  await git(path, 'config', 'user.name', 'Binaflow Test');
  await git(path, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(path, 'README.md'), 'initial\n');
  await git(path, 'add', '--', 'README.md');
  await git(path, 'commit', '-m', 'initial');
}

async function createCompletedRun(
  store: SqliteRunStore,
  id: string,
  artifactPath: string,
  content: string,
): Promise<void> {
  await mkdir(join(artifactPath, '..'), { recursive: true });
  await writeFile(artifactPath, content);
  const run: WorkflowRun = {
    id,
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: id,
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const artifact: ArtifactReference = {
    id: `${id}-artifact`,
    runId: id,
    stepId: 'plan',
    name: 'result',
    kind: 'text',
    path: artifactPath,
    mediaType: 'text/plain',
    sizeBytes: Buffer.byteLength(content),
  };
  await store.createRun(run, [artifact]);
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('portable transfer round trip', () => {
  it('preserves history and artifacts across A -> B -> A', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-roundtrip-'));
    directories.push(root);
    const workspaceA = join(root, 'workspace-a');
    const dataA = join(root, 'data-a');
    const packageT1 = join(root, 'transfer-t1');
    await repository(workspaceA);
    await mkdir(join(dataA, 'artifacts'), { recursive: true });
    const storeA = new SqliteRunStore(join(dataA, 'runs.db'));
    await createCompletedRun(
      storeA,
      'run-a',
      join(dataA, 'artifacts', 'run-a', 'plan', 'a.txt'),
      'from A\n',
    );
    const serviceA = createPortabilityService({
      store: storeA,
      dataDir: dataA,
      workspace: workspaceA,
    });
    const requestT1 = '11111111-1111-4111-8111-111111111111';
    const previewT1 = await serviceA.previewExport({
      requestId: requestT1,
      destination: packageT1,
    });
    await serviceA.exportPackage({
      requestId: requestT1,
      digest: previewT1.digest,
      destination: packageT1,
    });
    storeA.close();

    const workspaceB = join(root, 'workspace-b');
    await git(root, 'clone', '-b', 'main', join(packageT1, 'repository.bundle'), workspaceB);
    const dataB = join(root, 'data-b');
    const serviceBImport = createPortabilityService({
      store: newUnavailableStore(),
      dataDir: join(root, 'empty-baseline'),
      workspace: workspaceB,
    });
    const previewImportB = await serviceBImport.previewImport({
      packagePath: packageT1,
      outputDataDir: dataB,
    });
    expect(previewImportB.blockers).toEqual([]);
    await serviceBImport.importPackage({
      requestId: '22222222-2222-4222-8222-222222222222',
      digest: previewImportB.digest,
      packagePath: packageT1,
      outputDataDir: dataB,
    });
    const storeB = new SqliteRunStore(join(dataB, 'runs.db'));
    expect(await storeB.getRun('run-a')).toMatchObject({ id: 'run-a', objective: 'run-a' });
    const artifactB = (await storeB.getArtifacts('run-a'))[0]!;
    expect(await new FileArtifactStore(join(dataB, 'artifacts')).read(artifactB)).toBe('from A\n');

    await createCompletedRun(
      storeB,
      'run-b',
      join(dataB, 'artifacts', 'run-b', 'plan', 'b.txt'),
      'from B\n',
    );
    await writeFile(join(workspaceB, 'new-work.txt'), 'created on B\n');
    await git(workspaceB, 'add', '--', 'new-work.txt');
    await git(workspaceB, 'commit', '-m', 'work on B');
    const packageT2 = join(root, 'transfer-t2');
    const serviceB = createPortabilityService({
      store: storeB,
      dataDir: dataB,
      workspace: workspaceB,
    });
    const requestT2 = '33333333-3333-4333-8333-333333333333';
    const previewT2 = await serviceB.previewExport({
      requestId: requestT2,
      destination: packageT2,
    });
    expect(previewT2.manifest.parentTransferId).toBe(requestT1);
    await serviceB.exportPackage({
      requestId: requestT2,
      digest: previewT2.digest,
      destination: packageT2,
    });
    const headT2 = previewT2.manifest.git.head;
    storeB.close();

    await git(
      workspaceA,
      'fetch',
      join(packageT2, 'repository.bundle'),
      'refs/heads/main:refs/remotes/binaflow/return',
    );
    await git(workspaceA, 'merge', '--ff-only', 'refs/remotes/binaflow/return');
    expect(await git(workspaceA, 'rev-parse', 'HEAD')).toBe(headT2);
    const dataAReturn = join(root, 'data-a-return');
    const serviceAReturn = createPortabilityService({
      store: newUnavailableStore(),
      dataDir: dataA,
      workspace: workspaceA,
    });
    const previewReturn = await serviceAReturn.previewImport({
      packagePath: packageT2,
      outputDataDir: dataAReturn,
    });
    expect(previewReturn.blockers).toEqual([]);
    await serviceAReturn.importPackage({
      requestId: '44444444-4444-4444-8444-444444444444',
      digest: previewReturn.digest,
      packagePath: packageT2,
      outputDataDir: dataAReturn,
    });

    const returned = new SqliteRunStore(join(dataAReturn, 'runs.db'));
    expect(await returned.getRun('run-a')).toBeDefined();
    expect(await returned.getRun('run-b')).toBeDefined();
    const returnedArtifacts = await returned.getArtifacts('run-b');
    expect(
      await new FileArtifactStore(join(dataAReturn, 'artifacts')).read(returnedArtifacts[0]!),
    ).toBe('from B\n');
    expect(inspectPortableBackup(join(dataAReturn, 'runs.db'))).toMatchObject({
      datasetId: (await returned.getPortabilityState()).datasetId,
      state: 'active',
      lastTransferId: requestT2,
    });
    expect(await readFile(join(workspaceA, 'new-work.txt'), 'utf8')).toBe('created on B\n');
    returned.close();
  });
});

function newUnavailableStore() {
  const unavailable = async (): Promise<never> => {
    throw new Error('store is unavailable for import-only operation');
  };
  return {
    getPortabilityState: unavailable,
    inspectPortabilityBlockers: unavailable,
    beginExportIntent: unavailable,
    finalizeExport: unavailable,
    cancelExportIntent: unavailable,
    backupDatabaseTo: unavailable,
  };
}
