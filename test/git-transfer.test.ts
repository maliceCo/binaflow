import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertImportWorkspace,
  createRepositoryBundle,
  inspectRepositoryBundle,
  previewRepositoryTransfer,
} from '../src/portability/git-transfer.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-git-transfer-'));
  directories.push(directory);
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Binaflow Test');
  await git(directory, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(directory, 'README.md'), 'initial\n');
  await git(directory, 'add', '--', 'README.md');
  await git(directory, 'commit', '-m', 'initial');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Git transfer adapter', () => {
  it('creates a verified single-branch bundle that can be cloned', async () => {
    const source = await repository();
    const outputRoot = await mkdtemp(join(tmpdir(), 'binaflow-bundle-'));
    directories.push(outputRoot);
    const bundlePath = join(outputRoot, 'repository.bundle');
    const preview = await previewRepositoryTransfer(source);
    expect(preview).toMatchObject({ branch: 'main', ref: 'refs/heads/main', blockers: [] });
    const bundle = await createRepositoryBundle(source, bundlePath);
    expect(bundle).toMatchObject({ path: bundlePath, sizeBytes: expect.any(Number) });
    const inspected = await inspectRepositoryBundle(bundlePath);
    expect(inspected).toMatchObject({
      ref: 'refs/heads/main',
      head: preview.head,
      sha256: bundle.sha256,
    });

    const clone = join(outputRoot, 'clone');
    await git(outputRoot, 'clone', '-b', 'main', bundlePath, clone);
    expect(await git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    await assertImportWorkspace(clone, {
      protocol: 'binaflow-transfer',
      version: 1,
      transferId: '11111111-1111-4111-8111-111111111111',
      parentTransferId: null,
      datasetId: '22222222-2222-4222-8222-222222222222',
      requestId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-01-01T00:00:00.000Z',
      binaflowVersion: '0.1.0',
      schemaVersion: 14,
      counts: { runs: 0, artifacts: 0, orphanArtifacts: 0 },
      files: {
        database: { path: 'runs.db', sha256: 'a'.repeat(64), sizeBytes: 0 },
        bundle: { path: 'repository.bundle', sha256: 'b'.repeat(64), sizeBytes: 0 },
        artifacts: [],
      },
      git: { branch: 'main', ref: 'refs/heads/main', head: preview.head },
      source: { state: 'active' },
      warnings: ['sensitive'],
    });
  });

  it('reports dirty repositories and refuses branch or HEAD divergence', async () => {
    const source = await repository();
    const dirty = await previewRepositoryTransfer(source);
    await writeFile(join(source, 'dirty file.txt'), 'dirty\n');
    const dirtyPreview = await previewRepositoryTransfer(source);
    expect(dirtyPreview.blockers[0]?.code).toBe('invalid-repository');
    expect(dirty.blockers).toEqual([]);
    await expect(createRepositoryBundle(source, join(source, 'out.bundle'))).rejects.toThrow();
  });

  it('rejects tracked Git LFS attributes', async () => {
    const source = await repository();
    await writeFile(join(source, '.gitattributes'), '*.bin filter=lfs\n');
    await writeFile(join(source, 'file.bin'), 'pointer\n');
    await git(source, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f');
    await git(source, 'add', '--', '.gitattributes', 'file.bin');
    await git(source, 'commit', '-m', 'lfs');
    const preview = await previewRepositoryTransfer(source);
    expect(preview.blockers).toEqual([
      { code: 'invalid-repository', detail: 'tracked Git LFS files are not supported' },
    ]);
  });
});
