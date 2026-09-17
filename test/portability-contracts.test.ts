import { describe, expect, it } from 'vitest';
import {
  PORTABILITY_LIMITS,
  PortabilityContractError,
  assertFileLimits,
  assertTotalFileLimits,
  assertUniquePortablePaths,
  canonicalTransferJson,
  createTransferDigest,
  parseTransferManifest,
  validatePortablePath,
} from '../src/application/portability.js';

const ids = {
  transfer: '11111111-1111-4111-8111-111111111111',
  dataset: '22222222-2222-4222-8222-222222222222',
  request: '33333333-3333-4333-8333-333333333333',
};

function manifest() {
  return {
    protocol: 'binaflow-transfer',
    version: 1,
    transferId: ids.transfer,
    parentTransferId: null,
    datasetId: ids.dataset,
    requestId: ids.request,
    createdAt: '2026-01-01T00:00:00.000Z',
    binaflowVersion: '0.1.0',
    schemaVersion: 14,
    counts: { runs: 2, artifacts: 1, orphanArtifacts: 0 },
    files: {
      database: { path: 'runs.db', sha256: 'a'.repeat(64), sizeBytes: 10 },
      bundle: { path: 'repository.bundle', sha256: 'b'.repeat(64), sizeBytes: 20 },
      artifacts: [
        {
          path: 'artifacts/run/step/result.json',
          sha256: 'c'.repeat(64),
          sizeBytes: 30,
          runId: 'run',
          stepId: 'step',
          artifactId: 'artifact',
          kind: 'json',
          mediaType: 'application/json',
        },
      ],
    },
    git: { branch: 'main', ref: 'refs/heads/main', head: 'd'.repeat(40) },
    source: { state: 'active' },
    warnings: ['Package may contain sensitive user data'],
  };
}

describe('portable transfer contracts', () => {
  it('parses a valid v1 manifest and rejects tampering', () => {
    expect(parseTransferManifest(manifest()).files.artifacts).toHaveLength(1);
    expect(() => parseTransferManifest({ ...manifest(), version: 2 })).toThrow(
      PortabilityContractError,
    );
    expect(() =>
      parseTransferManifest({ ...manifest(), counts: { ...manifest().counts, artifacts: 2 } }),
    ).toThrow(/Artifact count/);
  });

  it('accepts schema 14, 15, 16, and 17 but rejects unknown future schemas', () => {
    expect(parseTransferManifest({ ...manifest(), schemaVersion: 15 }).schemaVersion).toBe(15);
    expect(parseTransferManifest({ ...manifest(), schemaVersion: 16 }).schemaVersion).toBe(16);
    expect(parseTransferManifest({ ...manifest(), schemaVersion: 17 }).schemaVersion).toBe(17);
    expect(() => parseTransferManifest({ ...manifest(), schemaVersion: 18 })).toThrow(
      PortabilityContractError,
    );
  });

  it('rejects POSIX and Windows traversal paths and case collisions', () => {
    for (const path of ['/runs.db', '../runs.db', 'a/../runs.db', 'C:/runs.db', 'a\\runs.db']) {
      expect(() => validatePortablePath(path)).toThrow(PortabilityContractError);
    }
    expect(() => assertUniquePortablePaths(['artifacts/A.json', 'artifacts/a.json'])).toThrow(
      /duplicate/,
    );
  });

  it('canonicalizes object keys while preserving array order', () => {
    expect(canonicalTransferJson({ z: 1, a: { d: 2, c: 3 }, list: [2, 1] })).toBe(
      '{"a":{"c":3,"d":2},"list":[2,1],"z":1}',
    );
  });

  it('creates a stable digest that changes with transfer inputs', () => {
    const input = {
      manifest: manifest(),
      destination: '/tmp/transfer',
      state: { state: 'active' },
      blockers: [],
      gitFingerprint: { branch: 'main', head: 'd'.repeat(40) },
    };
    expect(createTransferDigest(input)).toBe(
      createTransferDigest({ ...input, manifest: { ...input.manifest } }),
    );
    expect(createTransferDigest({ ...input, destination: '/tmp/other' })).not.toBe(
      createTransferDigest(input),
    );
  });

  it('enforces per-file and total package limits independently', () => {
    expect(() => assertFileLimits(PORTABILITY_LIMITS.maxFileBytes + 1, 'file')).toThrow(/limit/);
    expect(() => assertFileLimits(PORTABILITY_LIMITS.maxFileBytes, 'file')).not.toThrow();
    expect(() => assertTotalFileLimits(PORTABILITY_LIMITS.maxTotalBytes + 1, 'package')).toThrow(
      /limit/,
    );
    expect(() => assertTotalFileLimits(PORTABILITY_LIMITS.maxTotalBytes, 'package')).not.toThrow();
  });
});
