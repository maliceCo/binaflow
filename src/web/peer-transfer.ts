import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  return sha256(path);
}

export async function verifyTransferredPackage(
  path: string,
  expectedDigest: string,
): Promise<number> {
  const digest = await sha256(path);
  if (digest !== expectedDigest) throw new Error('Transferred package digest does not match');
  return (await stat(path)).size;
}

export async function materializePackageAtomically(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const temporaryPath = `${destinationPath}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  try {
    await sendPackageWithResume({ sourcePath, targetPath: temporaryPath });
    await rename(temporaryPath, destinationPath);
  } finally {
    await rm(temporaryPath, { force: true });
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
