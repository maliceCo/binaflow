import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createPortabilityService } from '../src/application/portability-operations.js';
import { directoryPackageStore } from '../src/portability/directory-package.js';
import { gitTransfer } from '../src/portability/git-transfer.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import {
  activateImportedBackup,
  inspectPortableBackup,
  normalizePortableBackup,
} from '../src/storage/sqlite-portability.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function git(cwd: string, ...args: string[]) {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-export-'));
  directories.push(root);
  const workspace = join(root, 'workspace');
  const dataDir = join(root, 'data');
  const output = join(root, 'transfer');
  await mkdirFor(workspace);
  await mkdirFor(dataDir);
  await git(workspace, 'init', '--initial-branch=main');
  await git(workspace, 'config', 'user.name', 'Binaflow Test');
  await git(workspace, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(workspace, 'README.md'), 'initial\n');
  await git(workspace, 'add', '--', 'README.md');
  await git(workspace, 'commit', '-m', 'initial');
  const store = new SqliteRunStore(join(dataDir, 'runs.db'));
  const service = createPortabilityService({
    store,
    database: { normalizePortableBackup, inspectPortableBackup, activateImportedBackup },
    packageStore: directoryPackageStore,
    git: gitTransfer,
    dataDir,
    workspace,
  });
  return { root, workspace, dataDir, output, store, service };
}

async function mkdirFor(path: string) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path, { recursive: true });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('portability export operations', () => {
  it('previews without mutating and exports a verified package once', async () => {
    const fixtureData = await fixture();
    const requestId = '11111111-1111-4111-8111-111111111111';
    const preview = await fixtureData.service.previewExport({
      requestId,
      destination: fixtureData.output,
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.manifest.files.database.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await fixtureData.store.getPortabilityState()).state).toBe('active');

    const result = await fixtureData.service.exportPackage({
      requestId,
      digest: preview.digest,
      destination: fixtureData.output,
    });
    expect(result.packagePath).toBe(fixtureData.output);
    expect(result.transfer.state).toBe('exported');
    await expect(
      fixtureData.service.exportPackage({
        requestId,
        digest: preview.digest,
        destination: fixtureData.output,
      }),
    ).resolves.toMatchObject({ packagePath: fixtureData.output });
    expect((await fixtureData.store.getPortabilityState()).state).toBe('exported');
    await expect(fixtureData.service.inspectTransfer(fixtureData.output)).resolves.toMatchObject({
      transferId: requestId,
    });
    fixtureData.store.close();
  });

  it('recovers a published package when finalization was interrupted', async () => {
    const fixtureData = await fixture();
    const requestId = '33333333-3333-4333-8333-333333333333';
    const preview = await fixtureData.service.previewExport({
      requestId,
      destination: fixtureData.output,
    });
    const originalFinalizeExport = fixtureData.store.finalizeExport.bind(fixtureData.store);
    fixtureData.store.finalizeExport = async () => {
      throw new Error('simulated finalization interruption');
    };

    await expect(
      fixtureData.service.exportPackage({
        requestId,
        digest: preview.digest,
        destination: fixtureData.output,
      }),
    ).rejects.toThrow(/interruption/);
    expect((await fixtureData.store.getPortabilityState()).state).toBe('exporting');
    await expect(
      fixtureData.service.cancelExportIntent({ requestId, digest: preview.digest }),
    ).rejects.toThrow(/already been published/);

    fixtureData.store.finalizeExport = originalFinalizeExport;
    await expect(
      fixtureData.service.exportPackage({
        requestId,
        digest: preview.digest,
        destination: fixtureData.output,
      }),
    ).resolves.toMatchObject({ packagePath: fixtureData.output });
    expect((await fixtureData.store.getPortabilityState()).state).toBe('exported');
    fixtureData.store.close();
  });

  it('cancels an unpublished export intent without creating a package', async () => {
    const fixtureData = await fixture();
    const requestId = '44444444-4444-4444-8444-444444444444';
    const preview = await fixtureData.service.previewExport({
      requestId,
      destination: fixtureData.output,
    });
    await fixtureData.store.beginExportIntent({
      requestId,
      digest: preview.digest,
      destination: fixtureData.output,
      transferId: preview.transferId,
    });

    await expect(
      fixtureData.service.cancelExportIntent({ requestId, digest: preview.digest }),
    ).resolves.toMatchObject({ state: 'active' });
    expect((await fixtureData.store.getPortabilityState()).state).toBe('active');
    fixtureData.store.close();
  });

  it('rejects a stale preview digest and leaves the source active', async () => {
    const fixtureData = await fixture();
    const requestId = '22222222-2222-4222-8222-222222222222';
    const preview = await fixtureData.service.previewExport({
      requestId,
      destination: fixtureData.output,
    });
    await expect(
      fixtureData.service.exportPackage({
        requestId,
        digest: `${preview.digest.slice(0, -1)}${preview.digest.endsWith('0') ? '1' : '0'}`,
        destination: fixtureData.output,
      }),
    ).rejects.toThrow(/stale/);
    expect((await fixtureData.store.getPortabilityState()).state).toBe('active');
    fixtureData.store.close();
  });
});
