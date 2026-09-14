import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { WorkspaceExecutionLease } from '../application/guided-execution.js';
import type { WorkspaceExecutionLock } from '../application/ports.js';

interface LockMetadata {
  token: string;
  pid: number;
  processStartedAt: string;
  workspace: string;
}

const processStartedAt = new Date().toISOString();

export class WorkspaceExecutionBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceExecutionBusyError';
  }
}

export class FileWorkspaceExecutionLock implements WorkspaceExecutionLock {
  private readonly lockDirectory: string;

  constructor(
    lockDirectory = join(process.env.HOME ?? process.cwd(), '.binaflow', 'workspace-locks'),
  ) {
    this.lockDirectory = resolve(lockDirectory);
  }

  async acquire(workspace: string): Promise<WorkspaceExecutionLease> {
    const identity = await resolveWorkspaceIdentity(workspace);
    const path = join(this.lockDirectory, lockName(identity));
    await mkdir(this.lockDirectory, { recursive: true, mode: 0o700 });

    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new WorkspaceExecutionBusyError(
          `workspace execution lock is already held for ${identity}`,
        );
      }
      throw error;
    }

    const metadata: LockMetadata = {
      token: randomUUID(),
      pid: process.pid,
      processStartedAt,
      workspace: identity,
    };
    try {
      await writeFile(join(path, 'metadata.json'), `${JSON.stringify(metadata)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    } catch (error) {
      await rm(path, { recursive: true, force: true });
      throw error;
    }

    let released = false;
    return {
      workspace: identity,
      token: metadata.token,
      release: async () => {
        if (released) return;
        released = true;
        await releaseLock(path, metadata);
      },
    };
  }
}

export async function resolveWorkspaceIdentity(workspace: string): Promise<string> {
  const canonical = await realpath(resolve(workspace));
  let current = canonical;
  while (true) {
    if (await hasGitMarker(current)) return current;
    const parent = dirname(current);
    if (parent === current) return canonical;
    current = parent;
  }
}

export function lockName(workspaceIdentity: string): string {
  return createHash('sha256').update(workspaceIdentity).digest('hex');
}

async function releaseLock(path: string, expected: LockMetadata): Promise<void> {
  let metadata: LockMetadata;
  try {
    metadata = JSON.parse(await readFile(join(path, 'metadata.json'), 'utf8')) as LockMetadata;
  } catch (error) {
    throw new WorkspaceExecutionBusyError(
      `cannot safely release workspace execution lock: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.token !== expected.token ||
    metadata.pid !== expected.pid ||
    metadata.processStartedAt !== expected.processStartedAt ||
    metadata.workspace !== expected.workspace
  ) {
    throw new WorkspaceExecutionBusyError('workspace execution lock ownership has changed');
  }
  await rm(path, { recursive: true, force: false });
}

async function hasGitMarker(directory: string): Promise<boolean> {
  try {
    await access(join(directory, '.git'));
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
