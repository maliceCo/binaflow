import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export interface PackageTransferProgress {
  sentBytes: number;
  totalBytes: number;
}

export interface PackageTransferResult {
  bytes: number;
  digest: string;
}

export async function sendPackageWithResume(input: {
  sourcePath: string;
  targetPath: string;
  offset?: number;
  onProgress?: (progress: PackageTransferProgress) => void;
}): Promise<PackageTransferResult> {
  const sourceStats = await stat(input.sourcePath);
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > sourceStats.size) {
    throw new Error('Invalid package transfer offset');
  }
  await mkdir(dirname(input.targetPath), { recursive: true, mode: 0o700 });
  const output = createWriteStream(input.targetPath, {
    flags: offset === 0 ? 'w' : 'r+',
    start: offset,
  });
  await pipeStream(createReadStream(input.sourcePath, { start: offset }), output, (bytes) => {
    input.onProgress?.({ sentBytes: offset + bytes, totalBytes: sourceStats.size });
  });
  const digest = await sha256(input.targetPath);
  const targetStats = await stat(input.targetPath);
  if (targetStats.size !== sourceStats.size) throw new Error('Transferred package is incomplete');
  return { bytes: targetStats.size, digest };
}

export async function digestPackage(path: string): Promise<string> {
  const info = await lstat(path);
  return info.isDirectory() ? digestDirectory(path) : sha256(path);
}

export async function verifyTransferredPackage(
  path: string,
  expectedDigest: string,
): Promise<number> {
  const digest = await digestPackage(path);
  if (digest !== expectedDigest) throw new Error('Transferred package digest does not match');
  return packageBytes(path);
}

export async function materializePackageAtomically(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const temporaryPath = `${destinationPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  try {
    if ((await lstat(sourcePath)).isDirectory()) {
      await copyDirectory(sourcePath, temporaryPath);
    } else {
      await sendPackageWithResume({ sourcePath, targetPath: temporaryPath });
    }
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { recursive: true, force: true });
  }
}

async function packageBytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) total += await packageBytes(join(path, entry.name));
  return total;
}

async function digestDirectory(path: string): Promise<string> {
  const hash = createHash('sha256');
  await digestDirectoryEntries(path, path, hash);
  return hash.digest('hex');
}

async function digestDirectoryEntries(
  root: string,
  path: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await digestDirectoryEntries(root, entryPath, hash);
    } else if (entry.isFile()) {
      hash.update(`${relative(root, entryPath)}\\0`);
      hash.update(await sha256(entryPath));
    } else {
      throw new Error('Package contains an unsupported filesystem entry');
    }
  }
}

async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
    const sourceEntry = join(sourcePath, entry.name);
    const targetEntry = join(targetPath, entry.name);
    if (entry.isDirectory()) await copyDirectory(sourceEntry, targetEntry);
    else if (entry.isFile())
      await sendPackageWithResume({ sourcePath: sourceEntry, targetPath: targetEntry });
    else throw new Error('Package contains an unsupported filesystem entry');
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function pipeStream(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  onChunk: (bytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    input.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      onChunk(bytes);
    });
    input.once('error', reject);
    output.once('error', reject);
    output.once('finish', resolve);
    input.pipe(output);
  });
}
