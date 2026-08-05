import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import type { ArtifactReference } from '../src/core/run.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function artifact(path: string): ArtifactReference {
  return {
    id: 'artifact-1',
    runId: 'run-1',
    stepId: 'plan',
    name: 'plan',
    kind: 'text',
    path,
    mediaType: 'text/plain',
    sizeBytes: 1,
  };
}

describe('FileArtifactStore containment', () => {
  it('rejects lexical paths outside the root', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-artifact-root-'));
    directories.push(directory);
    const root = join(directory, 'artifacts');
    const outside = join(directory, 'outside.txt');
    await mkdir(root, { recursive: true });
    await writeFile(outside, 'outside', 'utf8');

    await expect(new FileArtifactStore(root).read(artifact(outside))).rejects.toThrow(
      'outside the artifact directory',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symlink escapes for reads and writes',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'binaflow-artifact-symlink-'));
      directories.push(directory);
      const root = join(directory, 'artifacts');
      const outside = join(directory, 'outside');
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8');
      await symlink(outside, join(root, 'run-1'), 'dir');

      const store = new FileArtifactStore(root);
      await expect(store.read(artifact(join(root, 'run-1', 'secret.txt')))).rejects.toThrow(
        'outside the artifact directory',
      );
      await expect(
        store.write('run-1', 'plan', 'plan', 'text', 'secret', 'text/plain'),
      ).rejects.toThrow('outside the artifact directory');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked artifact file for reads',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'binaflow-artifact-file-symlink-'));
      directories.push(directory);
      const root = join(directory, 'artifacts');
      const outside = join(directory, 'secret.txt');
      await mkdir(root, { recursive: true });
      await writeFile(outside, 'secret', 'utf8');
      const linked = join(root, 'run-1', 'plan', 'plan.txt');
      await mkdir(join(root, 'run-1', 'plan'), { recursive: true });
      await symlink(outside, linked, 'file');

      await expect(new FileArtifactStore(root).read(artifact(linked))).rejects.toThrow(
        'outside the artifact directory',
      );
    },
  );

  it.skipIf(process.platform !== 'win32')('rejects paths on another Windows volume', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-artifact-volume-'));
    directories.push(directory);
    const root = resolve(directory, 'artifacts');
    const currentVolume = parse(root).root;
    const otherVolume = currentVolume.toLowerCase() === 'c:\\' ? 'D:\\' : 'C:\\';
    const otherVolumePath = join(otherVolume, 'binaflow-outside.txt');

    await expect(new FileArtifactStore(root).read(artifact(otherVolumePath))).rejects.toThrow(
      'outside the artifact directory',
    );
  });
});
