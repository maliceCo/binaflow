import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  digestPackage,
  sendPackageWithResume,
  verifyTransferredPackage,
} from '../src/web/peer-transfer.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('peer package transfer', () => {
  it('streams and resumes a package with source integrity verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-peer-transfer-'));
    directories.push(directory);
    const source = join(directory, 'source.pkg');
    const target = join(directory, 'target.pkg');
    await writeFile(source, '0123456789'.repeat(10_000));
    await writeFile(target, '01234');
    const progress: number[] = [];
    const result = await sendPackageWithResume({
      sourcePath: source,
      targetPath: target,
      offset: 5,
      onProgress: (value) => progress.push(value.sentBytes),
    });
    expect(result.bytes).toBe((await readFile(source)).byteLength);
    expect(progress.at(-1)).toBe(result.bytes);
    expect(await verifyTransferredPackage(target, await digestPackage(source))).toBe(result.bytes);
    expect(await readFile(target)).toEqual(await readFile(source));
  });
});
