import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createPortabilityService } from '../src/application/portability-operations.js';
import { directoryPackageStore } from '../src/portability/directory-package.js';
import { gitTransfer } from '../src/portability/git-transfer.js';
import {
  activateImportedBackup,
  inspectPortableBackup,
  normalizePortableBackup,
} from '../src/storage/sqlite-portability.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const tsxEntry = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, shell: false });
  return String(result.stdout).trim();
}

async function createRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await git(path, 'init', '--initial-branch=main');
  await git(path, 'config', 'user.name', 'Binaflow Test');
  await git(path, 'config', 'user.email', 'binaflow@example.test');
  await writeFile(join(path, 'README.md'), 'initial\n');
  await git(path, 'add', '--', 'README.md');
  await git(path, 'commit', '-m', 'initial');
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [tsxEntry, cliEntry, ...args],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: false,
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code && typeof error.code === 'number' ? error.code : 0,
          stdout,
          stderr,
        });
      },
    );
    child.on('error', reject);
  });
}

async function writeConfig(directory: string, dataDir: string): Promise<string> {
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, `${JSON.stringify({ dataDir, profiles: {} })}\n`);
  return configPath;
}

const database = { normalizePortableBackup, inspectPortableBackup, activateImportedBackup };

describe('portability process boundary', { timeout: 30_000 }, () => {
  it('accepts an export confirmed by a separate CLI process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-process-'));
    directories.push(root);
    const workspace = join(root, 'workspace');
    const dataDir = join(root, 'data');
    const output = join(root, 'transfer');
    await createRepository(workspace);
    const config = await writeConfig(root, dataDir);

    const previewResult = await runCli([
      '--cwd',
      workspace,
      '--config',
      config,
      '--json',
      'preview-export',
      '--request-id',
      '11111111-1111-4111-8111-111111111111',
      '--output',
      output,
    ]);
    const preview = JSON.parse(previewResult.stdout) as { data: { digest: string } };
    expect(previewResult.code).toBe(0);

    const exportResult = await runCli([
      '--cwd',
      workspace,
      '--config',
      config,
      '--json',
      'export',
      '--request-id',
      '11111111-1111-4111-8111-111111111111',
      '--digest',
      preview.data.digest,
      '--output',
      output,
    ]);

    expect(exportResult.code).toBe(0);
  });

  it('resumes an exporting intent from a separate CLI process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-process-'));
    directories.push(root);
    const workspace = join(root, 'workspace');
    const dataDir = join(root, 'data');
    const output = join(root, 'transfer');
    await createRepository(workspace);
    const config = await writeConfig(root, dataDir);
    const requestId = '33333333-3333-4333-8333-333333333333';

    const previewResult = await runCli([
      '--cwd',
      workspace,
      '--config',
      config,
      '--json',
      'preview-export',
      '--request-id',
      requestId,
      '--output',
      output,
    ]);
    const preview = JSON.parse(previewResult.stdout) as { data: { digest: string } };
    const store = new SqliteRunStore(join(dataDir, 'runs.db'));
    const state = await store.getPortabilityState();
    await store.beginExportIntent({
      requestId,
      digest: preview.data.digest,
      destination: output,
      transferId: requestId,
    });
    store.close();

    const result = await runCli([
      '--cwd',
      workspace,
      '--config',
      config,
      '--json',
      'export',
      '--request-id',
      requestId,
      '--digest',
      preview.data.digest,
      '--output',
      output,
    ]);

    expect(state.state).toBe('active');
    expect(result.code).toBe(0);
  });

  it('allows importing into a configured data directory with no previous database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-portability-process-'));
    directories.push(root);
    const workspaceA = join(root, 'workspace-a');
    const workspaceB = join(root, 'workspace-b');
    const dataA = join(root, 'data-a');
    const packagePath = join(root, 'transfer');
    const outputDataDir = join(root, 'data-b');
    await createRepository(workspaceA);
    await mkdir(dataA, { recursive: true });
    const store = new SqliteRunStore(join(dataA, 'runs.db'));
    const service = createPortabilityService({
      store,
      database,
      packageStore: directoryPackageStore,
      git: gitTransfer,
      dataDir: dataA,
      workspace: workspaceA,
    });
    const requestId = '22222222-2222-4222-8222-222222222222';
    const preview = await service.previewExport({ requestId, destination: packagePath });
    await service.exportPackage({ requestId, digest: preview.digest, destination: packagePath });
    store.close();
    await git(root, 'clone', '-b', 'main', join(packagePath, 'repository.bundle'), workspaceB);
    const config = await writeConfig(root, join(root, 'configured-but-empty'));

    const result = await runCli([
      '--cwd',
      workspaceB,
      '--config',
      config,
      '--json',
      'preview-import',
      '--package',
      packagePath,
      '--output-data-dir',
      outputDataDir,
    ]);
    const payload = JSON.parse(result.stdout) as {
      data: { blockers: Array<unknown>; digest: string };
    };

    expect(result.code).toBe(0);
    expect(payload.data.blockers).toEqual([]);

    const importResult = await runCli([
      '--cwd',
      workspaceB,
      '--config',
      config,
      '--json',
      'import',
      '--request-id',
      '44444444-4444-4444-8444-444444444444',
      '--digest',
      payload.data.digest,
      '--package',
      packagePath,
      '--output-data-dir',
      outputDataDir,
    ]);
    expect(importResult.code).toBe(0);
  });
});
