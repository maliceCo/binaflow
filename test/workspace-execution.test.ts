import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileWorkspaceExecutionLock,
  lockName,
  resolveWorkspaceIdentity,
} from '../src/workspace/execution-lock.js';
import { runWorkspaceCommand } from '../src/process/workspace-process.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('workspace commands', () => {
  it('captures bounded output and rejects non-zero commands', async () => {
    const directory = await temporaryDirectory('binaflow-workspace-process-');
    const result = await runWorkspaceCommand(
      `${process.execPath} -e 'process.stdout.write("ok")'`,
      [],
      { cwd: directory, timeoutMs: 5_000 },
    );

    expect(result).toMatchObject({ ok: true, exitCode: 0, stdout: 'ok', stderr: '' });

    const failed = await runWorkspaceCommand(`${process.execPath} -e 'process.exit(7)'`, [], {
      cwd: directory,
      timeoutMs: 5_000,
    });
    expect(failed).toMatchObject({ ok: false, exitCode: 7 });
  });

  it('terminates timed-out, aborted, and over-sized commands', async () => {
    const directory = await temporaryDirectory('binaflow-workspace-process-');
    const timedOut = await runWorkspaceCommand(
      `${process.execPath} -e 'setTimeout(() => {}, 10000)'`,
      [],
      { cwd: directory, timeoutMs: 50 },
    );
    expect(timedOut).toMatchObject({ ok: false, timedOut: true });

    const controller = new AbortController();
    const running = runWorkspaceCommand(
      `${process.execPath} -e 'setTimeout(() => {}, 10000)'`,
      [],
      { cwd: directory, timeoutMs: 5_000, signal: controller.signal },
    );
    controller.abort();
    await expect(running).resolves.toMatchObject({ ok: false, aborted: true });

    const large = await runWorkspaceCommand(
      `${process.execPath} -e 'process.stdout.write("x".repeat(2000000))'`,
      [],
      { cwd: directory, timeoutMs: 5_000, maxOutputBytes: 1_024 },
    );
    expect(large).toMatchObject({ ok: false, truncated: true });
    expect(Buffer.byteLength(large.stdout) + Buffer.byteLength(large.stderr)).toBeLessThanOrEqual(
      1_024,
    );
  });
});

describe('workspace execution locks', () => {
  it('shares a lease between a repository root and its subdirectory', async () => {
    const workspace = await temporaryDirectory('binaflow-lock-');
    await mkdir(join(workspace, '.git'));
    const nested = join(workspace, 'src');
    await mkdir(nested);
    const locks = new FileWorkspaceExecutionLock(await temporaryDirectory('binaflow-lock-root-'));

    expect(await resolveWorkspaceIdentity(nested)).toBe(workspace);
    const first = await locks.acquire(workspace);
    await expect(locks.acquire(nested)).rejects.toThrow('already held');
    await first.release();
    await expect(access(join(workspace, '.git'))).resolves.toBeUndefined();
    const second = await locks.acquire(nested);
    await second.release();
  });

  it('fails closed for unknown or incorrect lock ownership', async () => {
    const workspace = await temporaryDirectory('binaflow-lock-');
    const lockRoot = await temporaryDirectory('binaflow-lock-root-');
    const locks = new FileWorkspaceExecutionLock(lockRoot);
    const first = await locks.acquire(workspace);
    const metadataPath = join(lockRoot, lockName(workspace), 'metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { token: string };
    await writeFile(metadataPath, JSON.stringify({ ...metadata, token: 'wrong' }));
    await expect(first.release()).rejects.toThrow('ownership has changed');
    await expect(locks.acquire(workspace)).rejects.toThrow('already held');
  });
});
