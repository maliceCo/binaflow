import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
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
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, path);

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
      return {
        content: buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8'),
        truncated: bytesRead > maxBytes,
      };
    } finally {
      await handle.close();
    }
  }
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
