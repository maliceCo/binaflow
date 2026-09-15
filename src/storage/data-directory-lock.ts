import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { accessSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DataDirectoryLock } from '../application/ports.js';

interface DataLockMetadata {
  token: string;
  pid: number;
  processStartedAt: string;
  dataDir: string;
}

export interface PortableDatabaseState {
  schemaVersion: number;
  state: 'active' | 'exporting' | 'exported';
}

const processStartedAt = new Date().toISOString();

export class DataDirectoryBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataDirectoryBusyError';
  }
}

export class FileDataDirectoryLock implements DataDirectoryLock {
  private readonly lockDirectory: string;

  constructor(lockDirectory = join(homedir(), '.binaflow', 'data-locks')) {
    this.lockDirectory = resolve(lockDirectory);
  }

  async acquire(dataDir: string): Promise<{ token: string; release(): Promise<void> }> {
    const identity = resolveDataDirectoryIdentity(dataDir);
    const lockPath = join(this.lockDirectory, dataDirectoryLockName(identity));
    mkdirSync(this.lockDirectory, { recursive: true, mode: 0o700 });
    try {
      mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new DataDirectoryBusyError(`data directory is already in use: ${identity}`);
      }
      throw error;
    }

    const metadata: DataLockMetadata = {
      token: randomUUID(),
      pid: process.pid,
      processStartedAt,
      dataDir: identity,
    };
    try {
      writeFileSync(join(lockPath, 'metadata.json'), `${JSON.stringify(metadata)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    } catch (error) {
      rmSync(lockPath, { recursive: true, force: true });
      throw error;
    }

    let released = false;
    return {
      token: metadata.token,
      release: () => {
        if (released) return Promise.resolve();
        released = true;
        releaseDataDirectoryLock(lockPath, metadata);
        return Promise.resolve();
      },
    };
  }
}

export function resolveDataDirectoryIdentity(dataDir: string): string {
  return realpathSync(resolve(dataDir));
}

export function dataDirectoryLockName(dataDirIdentity: string): string {
  return createHash('sha256').update(dataDirIdentity).digest('hex');
}

export function inspectPortableDatabaseState(
  databasePath: string,
): PortableDatabaseState | undefined {
  try {
    accessSync(databasePath);
  } catch {
    return undefined;
  }
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const hasMigrations = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (!hasMigrations) return { schemaVersion: 0, state: 'active' };
    const version =
      (
        database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
          version: number | null;
        }
      ).version ?? 0;
    if (version < 14) return { schemaVersion: version, state: 'active' };
    const row = database
      .prepare('SELECT state FROM portability_state WHERE singleton_id = 1')
      .get() as { state: PortableDatabaseState['state'] } | undefined;
    if (!row) throw new Error('portability state is missing');
    return { schemaVersion: version, state: row.state };
  } finally {
    database.close();
  }
}

function releaseDataDirectoryLock(path: string, expected: DataLockMetadata): void {
  let metadata: DataLockMetadata;
  try {
    metadata = JSON.parse(readFileSync(join(path, 'metadata.json'), 'utf8')) as DataLockMetadata;
  } catch (error) {
    throw new DataDirectoryBusyError(
      `cannot safely release data directory lock: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    metadata.token !== expected.token ||
    metadata.pid !== expected.pid ||
    metadata.processStartedAt !== expected.processStartedAt ||
    metadata.dataDir !== expected.dataDir
  ) {
    throw new DataDirectoryBusyError('data directory lock ownership has changed');
  }
  rmSync(path, { recursive: true, force: false });
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

export function dataDirectoryLockPath(lockDirectory: string, dataDirIdentity: string): string {
  return join(resolve(lockDirectory), dataDirectoryLockName(dataDirIdentity));
}

export function dataDirectoryLockParent(lockPath: string): string {
  return dirname(lockPath);
}

export function assertActivePortableDatabase(databasePath: string): void {
  const state = inspectPortableDatabaseState(databasePath);
  if (state && state.state !== 'active') {
    throw new Error(`Binaflow data directory is ${state.state} and cannot be opened normally`);
  }
}
