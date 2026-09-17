import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupOwnedStaging,
  copyAndHashArtifact,
  createStagingPackage,
  finalizePackage,
  inspectPackage,
  materializeImportStaging,
  writeManifestLast,
} from '../src/portability/directory-package.js';
import type { TransferManifest } from '../src/application/portability.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function hash(path: string) {
  const content = readFileSync(path);
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: content.byteLength,
  };
}

async function makePackage() {
  const root = mkdtempSync(join(tmpdir(), 'binaflow-package-'));
  directories.push(root);
  const source = join(root, 'source');
  mkdirSync(source);
  const database = join(source, 'runs.db');
  const bundle = join(source, 'repository.bundle');
  const artifact = join(source, 'result.json');
  writeFileSync(database, 'database');
  writeFileSync(bundle, 'bundle');
  writeFileSync(artifact, '{"ok":true}\n');
  const destination = join(root, 'transfer');
  const staging = await createStagingPackage({
    destination,
    requestId: '33333333-3333-4333-8333-333333333333',
    transferId: '11111111-1111-4111-8111-111111111111',
  });
  await copyAndHashArtifact(database, join(staging, 'runs.db'));
  await copyAndHashArtifact(bundle, join(staging, 'repository.bundle'));
  await copyAndHashArtifact(artifact, join(staging, 'artifacts', 'run', 'step', 'result.json'));
  const databaseHash = hash(database);
  const bundleHash = hash(bundle);
  const artifactHash = hash(artifact);
  const manifest: TransferManifest = {
    protocol: 'binaflow-transfer',
    version: 1,
    transferId: '11111111-1111-4111-8111-111111111111',
    parentTransferId: null,
    datasetId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-01-01T00:00:00.000Z',
    binaflowVersion: '0.1.0',
    schemaVersion: 14,
    counts: { runs: 1, artifacts: 1, orphanArtifacts: 0 },
    files: {
      database: { path: 'runs.db', ...databaseHash },
      bundle: { path: 'repository.bundle', ...bundleHash },
      artifacts: [
        {
          path: 'artifacts/run/step/result.json',
          artifactId: 'artifact',
          runId: 'run',
          stepId: 'step',
          kind: 'json',
          mediaType: 'application/json',
          ...artifactHash,
        },
      ],
    },
    git: { branch: 'main', ref: 'refs/heads/main', head: 'd'.repeat(40) },
    source: { state: 'active' },
    warnings: ['sensitive'],
  };
  return { root, source, destination, staging, manifest, artifact };
}

describe('transfer directory package', () => {
  it('writes manifest last, validates hashes, and publishes atomically', async () => {
    const fixture = await makePackage();
    await writeManifestLast(fixture.staging, fixture.manifest);
    await expect(inspectPackage(fixture.staging)).resolves.toMatchObject({
      transferId: fixture.manifest.transferId,
    });
    await expect(finalizePackage(fixture.staging, fixture.destination)).resolves.toBe(
      fixture.destination,
    );
    await expect(inspectPackage(fixture.destination)).resolves.toMatchObject({
      datasetId: fixture.manifest.datasetId,
    });
  });

  it('rejects a changed file, symlink, and unlisted package content', async () => {
    const fixture = await makePackage();
    await writeManifestLast(fixture.staging, fixture.manifest);
    writeFileSync(join(fixture.staging, 'runs.db'), 'tampered');
    await expect(inspectPackage(fixture.staging)).rejects.toThrow(/match manifest/);
    writeFileSync(join(fixture.staging, 'runs.db'), 'database');
    writeFileSync(join(fixture.staging, 'unexpected.txt'), 'unexpected');
    await expect(inspectPackage(fixture.staging)).rejects.toThrow(/manifest|unexpected/i);

    const symlinkStaging = await createStagingPackage({
      destination: join(fixture.root, 'symlink-transfer'),
      requestId: fixture.manifest.requestId,
      transferId: '44444444-4444-4444-8444-444444444444',
    });
    const linkedSource = join(fixture.source, 'linked.json');
    symlinkSync(fixture.artifact, linkedSource);
    await expect(
      copyAndHashArtifact(linkedSource, join(symlinkStaging, 'runs.db')),
    ).rejects.toThrow(/symlink|regular|linked/i);
    await expect(inspectPackage(symlinkStaging)).rejects.toThrow(/manifest|ENOENT/i);
  });

  it('does not replace existing output and cleans only owned staging', async () => {
    const fixture = await makePackage();
    writeFileSync(fixture.destination, 'keep');
    await expect(finalizePackage(fixture.staging, fixture.destination)).rejects.toThrow(
      /already exists/,
    );
    expect(readFileSync(fixture.destination, 'utf8')).toBe('keep');
    await cleanupOwnedStaging(fixture.staging, fixture.manifest.requestId);
    expect(() => lstatSync(fixture.staging)).toThrow();
  });

  it('materializes a verified package into a new staging directory', async () => {
    const fixture = await makePackage();
    await writeManifestLast(fixture.staging, fixture.manifest);
    await finalizePackage(fixture.staging, fixture.destination);
    const imported = await materializeImportStaging(
      fixture.destination,
      join(fixture.root, 'imported'),
    );
    expect(readFileSync(join(imported, 'artifacts', 'run', 'step', 'result.json'), 'utf8')).toBe(
      '{"ok":true}\n',
    );
    expect(readFileSync(join(imported, 'manifest.json'), 'utf8')).toContain('binaflow-transfer');
  });
});
