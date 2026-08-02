import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ArtifactReference } from '../core/run.js';
import type { ArtifactStore } from './artifact-store.js';

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
    assertInsideRoot(this.root, artifact.path);
    return readFile(artifact.path, 'utf8');
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function assertInsideRoot(root: string, path: string): void {
  if (!isAbsolute(path)) throw new Error(`Artifact path must be absolute: ${path}`);
  const pathRelativeToRoot = relative(root, resolve(path));
  if (pathRelativeToRoot === '..' || pathRelativeToRoot.startsWith(`..${sep}`)) {
    throw new Error(`Artifact path is outside the artifact directory: ${path}`);
  }
}
