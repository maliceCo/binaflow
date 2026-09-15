import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';

export const PORTABILITY_PROTOCOL = 'binaflow-transfer' as const;
export const PORTABILITY_VERSION = 1 as const;
export const PORTABILITY_SCHEMA_VERSIONS = [14, 15] as const;
export const PORTABILITY_SCHEMA_VERSION = 15 as const;
export type PortabilitySchemaVersion = (typeof PORTABILITY_SCHEMA_VERSIONS)[number];
export const PORTABLE_WORKSPACE_MARKER = '$BINAFlow_WORKSPACE' as const;

export const PORTABILITY_LIMITS = {
  maxManifestBytes: 16 * 1024 * 1024,
  maxArtifacts: 100_000,
  maxFileBytes: 16 * 1024 ** 3,
  maxTotalBytes: 128 * 1024 ** 3,
} as const;

export type PortabilityDatasetState = 'active' | 'exporting' | 'exported';

export interface TransferFileHash {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface TransferArtifact extends TransferFileHash {
  runId: string;
  stepId: string;
  artifactId: string;
  kind: 'json' | 'text';
  mediaType: string;
}

export interface TransferManifest {
  protocol: typeof PORTABILITY_PROTOCOL;
  version: typeof PORTABILITY_VERSION;
  transferId: string;
  parentTransferId: string | null;
  datasetId: string;
  requestId: string;
  createdAt: string;
  binaflowVersion: string;
  schemaVersion: PortabilitySchemaVersion;
  counts: {
    runs: number;
    artifacts: number;
    orphanArtifacts: number;
  };
  files: {
    database: TransferFileHash;
    bundle: TransferFileHash;
    artifacts: TransferArtifact[];
  };
  git: {
    branch: string;
    ref: string;
    head: string;
  };
  source: {
    state: PortabilityDatasetState;
  };
  warnings: string[];
}

export interface PortableBackupInspection {
  schemaVersion: number;
  datasetId: string;
  state: PortabilityDatasetState;
  lastTransferId: string | null;
  runs: number;
  artifacts: number;
  workspaces: string[];
}

export interface PortabilityState {
  datasetId: string;
  state: PortabilityDatasetState;
  lastTransferId: string | null;
  pendingExport: {
    requestId: string;
    digest: string;
    destination: string;
    transferId: string;
  } | null;
}

export interface PortabilityTransfer {
  transferId: string;
  parentTransferId: string | null;
  datasetId: string;
  requestId: string;
  digest: string;
  gitFingerprint: string;
  state: 'exported' | 'imported';
  createdAt: string;
  completedAt: string | null;
}

export type PortabilityBlockerCode =
  | 'dataset-not-active'
  | 'active-execution'
  | 'reusable-run'
  | 'dirty-repository'
  | 'invalid-repository'
  | 'missing-artifact'
  | 'invalid-artifact'
  | 'output-exists'
  | 'invalid-destination'
  | 'lineage-divergence';

export interface PortabilityBlocker {
  code: PortabilityBlockerCode;
  detail: string;
}

export interface PortabilityDigestInput {
  manifest: unknown;
  destination: string;
  state: unknown;
  blockers: readonly PortabilityBlocker[];
  gitFingerprint: unknown;
}

export interface PortabilityExportPreview {
  transferId: string;
  parentTransferId: string | null;
  datasetId: string;
  requestId: string;
  destination: string;
  state: PortabilityDatasetState;
  blockers: PortabilityBlocker[];
  manifest: TransferManifest;
  digest: string;
  sensitiveDataWarning: string;
}

export interface PortabilityImportPreview {
  transferId: string;
  datasetId: string;
  parentTransferId: string | null;
  outputDataDir: string;
  blockers: PortabilityBlocker[];
  digest: string;
  sensitiveDataWarning: string;
}

export interface PortabilityExportRequest {
  requestId: string;
  digest: string;
  output: string;
  preview: PortabilityExportPreview;
}

export interface PortabilityImportRequest {
  requestId: string;
  digest: string;
  packagePath: string;
  outputDataDir: string;
}

export class PortabilityContractError extends Error {
  readonly code: PortabilityErrorCode;

  constructor(code: PortabilityErrorCode, message: string) {
    super(message);
    this.name = 'PortabilityContractError';
    this.code = code;
  }
}

export type PortabilityErrorCode =
  | 'invalid-input'
  | 'invalid-id'
  | 'invalid-path'
  | 'duplicate-path'
  | 'limit-exceeded'
  | 'invalid-manifest'
  | 'invalid-digest';

const manifestSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'protocol',
    'version',
    'transferId',
    'parentTransferId',
    'datasetId',
    'requestId',
    'createdAt',
    'binaflowVersion',
    'schemaVersion',
    'counts',
    'files',
    'git',
    'source',
    'warnings',
  ],
  properties: {
    protocol: { const: PORTABILITY_PROTOCOL },
    version: { const: PORTABILITY_VERSION },
    transferId: { type: 'string', minLength: 1 },
    parentTransferId: { type: ['string', 'null'] },
    datasetId: { type: 'string', minLength: 1 },
    requestId: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', minLength: 1 },
    binaflowVersion: { type: 'string', minLength: 1 },
    schemaVersion: { enum: [...PORTABILITY_SCHEMA_VERSIONS] },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: ['runs', 'artifacts', 'orphanArtifacts'],
      properties: {
        runs: { type: 'integer', minimum: 0 },
        artifacts: { type: 'integer', minimum: 0 },
        orphanArtifacts: { type: 'integer', minimum: 0 },
      },
    },
    files: {
      type: 'object',
      additionalProperties: false,
      required: ['database', 'bundle', 'artifacts'],
      properties: {
        database: { $ref: '#/$defs/file' },
        bundle: { $ref: '#/$defs/file' },
        artifacts: { type: 'array', items: { $ref: '#/$defs/artifact' } },
      },
    },
    git: {
      type: 'object',
      additionalProperties: false,
      required: ['branch', 'ref', 'head'],
      properties: {
        branch: { type: 'string', minLength: 1 },
        ref: { type: 'string', minLength: 1 },
        head: { type: 'string', minLength: 1 },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['state'],
      properties: { state: { enum: ['active', 'exporting', 'exported'] } },
    },
    warnings: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  $defs: {
    file: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'sha256', 'sizeBytes'],
      properties: {
        path: { type: 'string', minLength: 1 },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        sizeBytes: { type: 'integer', minimum: 0 },
      },
    },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: [
        'path',
        'sha256',
        'sizeBytes',
        'runId',
        'stepId',
        'artifactId',
        'kind',
        'mediaType',
      ],
      properties: {
        path: { type: 'string', minLength: 1 },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        sizeBytes: { type: 'integer', minimum: 0 },
        runId: { type: 'string', minLength: 1 },
        stepId: { type: 'string', minLength: 1 },
        artifactId: { type: 'string', minLength: 1 },
        kind: { enum: ['json', 'text'] },
        mediaType: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateManifest = ajv.compile<TransferManifest>(manifestSchema);

export function parseTransferManifest(value: unknown): TransferManifest {
  if (!validateManifest(value)) {
    const details = validateManifest.errors
      ?.map((error) => `${error.instancePath || '$'} ${error.message ?? 'is invalid'}`)
      .join(', ');
    throw new PortabilityContractError(
      'invalid-manifest',
      `Invalid transfer manifest${details ? `: ${details}` : ''}`,
    );
  }
  const manifest = value as TransferManifest;
  if (
    Buffer.byteLength(canonicalTransferJson(manifest), 'utf8') > PORTABILITY_LIMITS.maxManifestBytes
  ) {
    throw new PortabilityContractError(
      'limit-exceeded',
      'Transfer manifest exceeds the size limit',
    );
  }
  validateTransferManifest(manifest);
  return manifest;
}

export function validateTransferManifest(manifest: TransferManifest): void {
  validateUuidV4(manifest.transferId, 'transferId');
  if (manifest.parentTransferId !== null)
    validateUuidV4(manifest.parentTransferId, 'parentTransferId');
  validateUuidV4(manifest.datasetId, 'datasetId');
  validateUuidV4(manifest.requestId, 'requestId');
  for (const file of [manifest.files.database, manifest.files.bundle]) validateFileHash(file);
  if (manifest.files.artifacts.length > PORTABILITY_LIMITS.maxArtifacts) {
    throw new PortabilityContractError('limit-exceeded', 'Transfer package has too many artifacts');
  }
  if (manifest.files.database.path !== 'runs.db') {
    throw new PortabilityContractError('invalid-manifest', 'Database file must be named runs.db');
  }
  if (manifest.files.bundle.path !== 'repository.bundle') {
    throw new PortabilityContractError(
      'invalid-manifest',
      'Repository bundle must be named repository.bundle',
    );
  }
  const paths = [manifest.files.database.path, manifest.files.bundle.path];
  let totalBytes = manifest.files.database.sizeBytes + manifest.files.bundle.sizeBytes;
  for (const artifact of manifest.files.artifacts) {
    validateFileHash(artifact);
    validatePortablePath(artifact.path);
    if (!artifact.path.startsWith('artifacts/')) {
      throw new PortabilityContractError(
        'invalid-manifest',
        'Artifact file must be inside the artifacts directory',
      );
    }
    paths.push(artifact.path);
    totalBytes += artifact.sizeBytes;
  }
  assertUniquePortablePaths(paths);
  if (manifest.counts.artifacts !== manifest.files.artifacts.length) {
    throw new PortabilityContractError(
      'invalid-manifest',
      'Artifact count does not match the manifest',
    );
  }
  assertTotalFileLimits(totalBytes, 'transfer package');
}

export function canonicalTransferJson(value: unknown): string {
  const sorted = sortJson(value);
  const serialized = JSON.stringify(sorted);
  if (serialized === undefined) {
    throw new PortabilityContractError('invalid-input', 'Value is not JSON serializable');
  }
  return serialized;
}

export function createTransferDigest(input: PortabilityDigestInput): string {
  if (typeof input.destination !== 'string' || input.destination.length === 0) {
    throw new PortabilityContractError('invalid-input', 'Destination must be a non-empty string');
  }
  return createHash('sha256').update(canonicalTransferJson(input)).digest('hex');
}

export const createPortabilityDigest = createTransferDigest;
export const hashTransferDigestInput = createTransferDigest;

export function validateUuidV4(value: string, name = 'id'): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new PortabilityContractError('invalid-id', `${name} must be a canonical UUID v4`);
  }
}

export function isCanonicalUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function validatePortablePath(value: string): void {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new PortabilityContractError(
      'invalid-path',
      'Path must be a non-empty relative POSIX path',
    );
  }
}

export function isPortablePath(value: string): boolean {
  try {
    validatePortablePath(value);
    return true;
  } catch {
    return false;
  }
}

export function assertUniquePortablePaths(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    validatePortablePath(path);
    const folded = path.toLocaleLowerCase('en-US');
    if (seen.has(folded)) {
      throw new PortabilityContractError(
        'duplicate-path',
        'Transfer package contains duplicate paths',
      );
    }
    seen.add(folded);
  }
}

export function assertFileLimits(sizeBytes: number, name: string): void {
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > PORTABILITY_LIMITS.maxFileBytes
  ) {
    throw new PortabilityContractError('limit-exceeded', `${name} exceeds the per-file size limit`);
  }
}

export function assertTotalFileLimits(sizeBytes: number, name: string): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new PortabilityContractError('limit-exceeded', `${name} has an invalid total size`);
  }
  if (sizeBytes > PORTABILITY_LIMITS.maxTotalBytes) {
    throw new PortabilityContractError('limit-exceeded', `${name} exceeds the package size limit`);
  }
}

function validateFileHash(file: TransferFileHash): void {
  validatePortablePath(file.path);
  if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new PortabilityContractError(
      'invalid-input',
      'File hash must be a lowercase SHA-256 digest',
    );
  }
  assertFileLimits(file.sizeBytes, file.path);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, sortJson(record[key])]),
    );
  }
  return value;
}
