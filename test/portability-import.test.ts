import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createPortabilityService } from '../src/application/portability-operations.js';
import { inspectPortableBackup } from '../src/storage/sqlite-portability.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, 'init', '--initial-branch=main');
  await git(path, 'config', 'user.name', 'Binaflow Test');
  await git(path, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(path, 'README.md'), 'initial\n');
  await git(path, 'add', '--', 'README.md');
  await git(path, 'commit', '-m', 'initial');
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('portability import operations', () => {
  it('imports into a new data directory and leaves the previous baseline untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-import-'));
    directories.push(root);
    const workspaceA = join(root, 'workspace-a');
    const dataA = join(root, 'data-a');
    const packagePath = join(root, 'transfer');
    await createRepository(workspaceA);
    await mkdir(dataA, { recursive: true });
    const storeA = new SqliteRunStore(join(dataA, 'runs.db'));
    const serviceA = createPortabilityService({
      store: storeA,
      dataDir: dataA,
      workspace: workspaceA,
    });
    const requestId = '11111111-1111-4111-8111-111111111111';
    const exportPreview = await serviceA.previewExport({ requestId, destination: packagePath });
    await serviceA.exportPackage({
      requestId,
      digest: exportPreview.digest,
      destination: packagePath,
    });

    const workspaceB = join(root, 'workspace-b');
    await git(root, 'clone', '-b', 'main', join(packagePath, 'repository.bundle'), workspaceB);
    const outputDataDir = join(root, 'data-b');
    const serviceB = createPortabilityService({
      store: storeA,
      dataDir: join(root, 'empty-baseline'),
      workspace: workspaceB,
    });
    const preview = await serviceB.previewImport({ packagePath, outputDataDir });
    expect(preview.blockers).toEqual([]);
    const imported = await serviceB.importPackage({
      requestId: '22222222-2222-4222-8222-222222222222',
      digest: preview.digest,
      packagePath,
      outputDataDir,
    });
    expect(imported.dataDir).toBe(outputDataDir);
    expect(inspectPortableBackup(join(dataA, 'runs.db')).state).toBe('exported');
    expect(inspectPortableBackup(join(outputDataDir, 'runs.db')).state).toBe('active');
    storeA.close();
  });

  it('rejects an existing import output without modifying it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-import-'));
    directories.push(root);
    const workspace = join(root, 'workspace');
    await createRepository(workspace);
    const dataDir = join(root, 'data');
    await mkdir(dataDir, { recursive: true });
    const store = new SqliteRunStore(join(dataDir, 'runs.db'));
    const service = createPortabilityService({ store, dataDir: join(root, 'empty'), workspace });
    const preview = await service.previewExport({
      requestId: '33333333-3333-4333-8333-333333333333',
      destination: join(root, 'transfer'),
    });
    await service.exportPackage({
      requestId: preview.requestId,
      digest: preview.digest,
      destination: join(root, 'transfer'),
    });
    const output = join(root, 'existing');
    await mkdir(output);
    await writeFile(join(output, 'sentinel'), 'keep');
    const importPreview = await service.previewImport({
      packagePath: join(root, 'transfer'),
      outputDataDir: output,
    });
    expect(importPreview.blockers).toEqual([
      { code: 'output-exists', detail: 'Import output data directory already exists' },
    ]);
    await expect(
      service.importPackage({
        requestId: '44444444-4444-4444-8444-444444444444',
        digest: importPreview.digest,
        packagePath: join(root, 'transfer'),
        outputDataDir: output,
      }),
    ).rejects.toThrow(/already exists/);
    expect(await readFile(join(output, 'sentinel'), 'utf8')).toBe('keep');
    store.close();
  });
});
