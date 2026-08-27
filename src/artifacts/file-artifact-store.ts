import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import type { ArtifactReference } from '../core/run.js';
import type { ArtifactStore, BoundedArtifactContent } from './artifact-store.js';

export class FileArtifactStore implements ArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async write(
    runId: string,
    stepId: string,
    name: string,
    kind: ArtifactReference['kind'],
    content: string,
    mediaType: string,
  ): Promise<ArtifactReference> {
    const id = randomUUID();
    const directory = resolve(this.root, safeSegment(runId), safeSegment(stepId));
    const extension = kind === 'json' ? 'json' : 'txt';
    const path = resolve(directory, `${id}.${extension}`);
    assertInsideRoot(this.root, path);
    await mkdir(directory, { recursive: true });
    const realRoot = await realpath(this.root);
    const realDirectory = await realpath(directory);
    assertInsideRoot(realRoot, realDirectory);

    const temporaryPath = `${path}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, path);
      await syncDirectory(directory);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }

    return {
      id,
      runId,
      stepId,
      name,
      kind,
      path,
      mediaType,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
  }

  async read(artifact: ArtifactReference): Promise<string> {
    const safePath = await validatedReadPath(this.root, artifact.path);
    return readFile(safePath, 'utf8');
  }

  async remove(artifact: ArtifactReference): Promise<void> {
    const safePath = await validatedReadPath(this.root, artifact.path);
    await rm(safePath, { force: true });
    await syncDirectory(parse(safePath).dir);
  }

  async readBounded(
    artifact: ArtifactReference,
    maxBytes: number,
  ): Promise<BoundedArtifactContent> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new Error('Artifact read limit must be a positive integer');
    }
    const safePath = await validatedReadPath(this.root, artifact.path);
    const handle = await open(safePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      let contentBytes = Math.min(bytesRead, maxBytes);
      let truncated = bytesRead > maxBytes;
      const incompleteBytes = trailingIncompleteUtf8Bytes(buffer.subarray(0, contentBytes));
      if (incompleteBytes > 0) {
        contentBytes -= incompleteBytes;
        truncated = true;
      }
      const safeBytes = contentBytes;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        decoder.decode(buffer.subarray(0, safeBytes));
      } catch (error) {
        throw new Error(
          `Artifact contains invalid UTF-8: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        content: buffer.subarray(0, safeBytes).toString('utf8'),
        truncated,
      };
    } finally {
      await handle.close();
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function trailingIncompleteUtf8Bytes(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 3);
  for (let index = bytes.length - 1; index >= start; index -= 1) {
    const byte = bytes[index]!;
    const expected =
      byte >= 0xc2 && byte <= 0xdf
        ? 2
        : byte >= 0xe0 && byte <= 0xef
          ? 3
          : byte >= 0xf0 && byte <= 0xf4
            ? 4
            : 0;
    if (expected === 0) continue;
    const available = bytes.length - index;
    if (available >= expected) return 0;
    for (let continuation = index + 1; continuation < bytes.length; continuation += 1) {
      const continuationByte = bytes[continuation]!;
      if (continuationByte < 0x80 || continuationByte > 0xbf) return 0;
    }
    return available;
  }
  return 0;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function assertInsideRoot(root: string, path: string): void {
  if (!isAbsolute(path)) throw new Error(`Artifact path must be absolute: ${path}`);
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (parse(resolvedRoot).root.toLowerCase() !== parse(resolvedPath).root.toLowerCase()) {
    throw new Error(`Artifact path is outside the artifact directory: ${path}`);
  }
  const caseNormalizedRoot =
    process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const caseNormalizedPath =
    process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  const pathRelativeToRoot = relative(caseNormalizedRoot, caseNormalizedPath);
  if (
    pathRelativeToRoot === '..' ||
    pathRelativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathRelativeToRoot)
  ) {
    throw new Error(`Artifact path is outside the artifact directory: ${path}`);
  }
}

async function validatedReadPath(root: string, path: string): Promise<string> {
  assertInsideRoot(root, path);
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path)]);
  assertInsideRoot(realRoot, realPath);
  return realPath;
}
