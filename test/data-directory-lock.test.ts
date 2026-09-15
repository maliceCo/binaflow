import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DataDirectoryBusyError,
  FileDataDirectoryLock,
  dataDirectoryLockPath,
  resolveDataDirectoryIdentity,
} from '../src/storage/data-directory-lock.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('data directory lease', () => {
  it('allows one owner per canonical data directory and different owners elsewhere', async () => {
    const root = mkdtempSync(join(tmpdir(), 'binaflow-data-lock-'));
    directories.push(root);
    const locks = new FileDataDirectoryLock(join(root, 'locks'));
    const firstDir = join(root, 'one');
    const secondDir = join(root, 'two');
    mkdirSync(firstDir);
    mkdirSync(secondDir);

    const first = await locks.acquire(firstDir);
    await expect(locks.acquire(firstDir)).rejects.toBeInstanceOf(DataDirectoryBusyError);
    const second = await locks.acquire(secondDir);
    await second.release();
    await first.release();
    const reopened = await locks.acquire(firstDir);
    await reopened.release();
  });

  it('fails closed when lock ownership metadata changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'binaflow-data-lock-'));
    directories.push(root);
    const locksPath = join(root, 'locks');
    const locks = new FileDataDirectoryLock(locksPath);
    const dataDir = join(root, 'data');
    mkdirSync(dataDir);
    const lease = await locks.acquire(dataDir);
    const identity = resolveDataDirectoryIdentity(dataDir);
    const metadataPath = join(dataDirectoryLockPath(locksPath, identity), 'metadata.json');
    writeFileSync(metadataPath, '{}');

    expect(() => lease.release()).toThrow(DataDirectoryBusyError);
    await expect(locks.acquire(dataDir)).rejects.toBeInstanceOf(DataDirectoryBusyError);
  });
});
