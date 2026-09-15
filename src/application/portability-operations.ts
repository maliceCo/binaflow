import { lstat } from 'node:fs/promises';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  PORTABILITY_PROTOCOL,
  PORTABILITY_SCHEMA_VERSION,
  PORTABILITY_VERSION,
  PortabilityContractError,
  createTransferDigest,
  type PortabilityBlocker,
  type PortabilityExportPreview,
  type PortabilityImportPreview,
  type PortabilityState,
  type PortableBackupInspection,
  type PortabilityTransfer,
  type TransferArtifact,
  type TransferManifest,
} from './portability.js';
import type {
  ApplicationPortabilityStore,
  PortabilityDatabase,
  PortabilityGit,
  PortabilityPackageStore,
  PortabilityService,
} from './ports.js';
import { VERSION } from '../version.js';

const SENSITIVE_DATA_WARNING =
  'Transfer packages are not encrypted and may contain sensitive user-provided data.';

export interface PortabilityOperationsOptions {
  store: ApplicationPortabilityStore;
  database: PortabilityDatabase;
  packageStore: PortabilityPackageStore;
  git: PortabilityGit;
  dataDir: string;
  workspace: string;
  baselineWasAbsent?: boolean;
}

export function createPortabilityService(
  options: PortabilityOperationsOptions,
): PortabilityService {
  const previews = new Map<string, PortabilityExportPreview>();
  return {
    previewExport: async (request) => {
      const preview = await previewExport(options, request);
      previews.set(request.requestId, preview);
      return preview;
    },
    exportPackage: (request) => exportPackage(options, request, previews.get(request.requestId)),
    cancelExportIntent: (request) => cancelExportIntent(options, request),
    inspectTransfer: (packagePath) => options.packageStore.inspectPackage(packagePath),
    previewImport: (request) => previewImport(options, request),
    importPackage: (request) => importPackage(options, request),
  };
}

async function previewExport(
  options: PortabilityOperationsOptions,
  request: { requestId: string; destination: string },
): Promise<PortabilityExportPreview> {
  const state = await options.store.getPortabilityState();
  const previewState = resumableExportState(state, request);
  const blockers = await exportBlockers(options, previewState, request.destination);
  const git = await options.git.previewRepositoryTransfer(options.workspace);
  blockers.push(...git.blockers);
  const manifest = emptyManifest(previewState, request.requestId, git);
  if (blockers.length > 0) {
    return {
      transferId: request.requestId,
      parentTransferId: state.lastTransferId,
      datasetId: state.datasetId,
      requestId: request.requestId,
      destination: resolve(request.destination),
      state: previewState.state,
      blockers,
      manifest,
      digest: createDigest(manifest, request.destination, previewState, blockers, git.fingerprint),
      sensitiveDataWarning: SENSITIVE_DATA_WARNING,
    };
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'binaflow-export-preview-'));
  let staging: string | undefined;
  try {
    const built = await buildPackage(
      options,
      request.requestId,
      request.destination,
      temporaryRoot,
      git,
      undefined,
      state.lastTransferId,
    );
    staging = built.staging;
    const digest = createDigest(
      built.manifest,
      request.destination,
      previewState,
      blockers,
      git.fingerprint,
    );
    return {
      transferId: request.requestId,
      parentTransferId: state.lastTransferId,
      datasetId: state.datasetId,
      requestId: request.requestId,
      destination: resolve(request.destination),
      state: previewState.state,
      blockers,
      manifest: built.manifest,
      digest,
      sensitiveDataWarning: SENSITIVE_DATA_WARNING,
    };
  } finally {
    if (staging)
      await options.packageStore
        .cleanupOwnedStaging(staging, request.requestId)
        .catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function exportPackage(
  options: PortabilityOperationsOptions,
  request: { requestId: string; digest: string; destination: string },
  cachedPreview?: PortabilityExportPreview,
): Promise<{ transfer: PortabilityTransfer; packagePath: string }> {
  const replay = await replayCompletedExport(options, request);
  if (replay) return replay;
  const preview =
    cachedPreview && cachedPreview.destination === resolve(request.destination)
      ? cachedPreview
      : await previewExport(options, request);
  if (preview.digest !== request.digest) {
    throw new PortabilityContractError('invalid-digest', 'Export preview digest is stale');
  }
  if (preview.blockers.length > 0) {
    throw new PortabilityContractError(
      'invalid-input',
      preview.blockers.map((item) => item.detail).join('; '),
    );
  }
  await options.store.beginExportIntent({
    requestId: request.requestId,
    digest: request.digest,
    destination: resolve(request.destination),
    transferId: preview.transferId,
  });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'binaflow-export-'));
  let staging: string | undefined;
  try {
    const git = await options.git.previewRepositoryTransfer(options.workspace);
    const built = await buildPackage(
      options,
      request.requestId,
      request.destination,
      dirname(resolve(request.destination)),
      git,
      preview.manifest,
      preview.parentTransferId,
    );
    staging = built.staging;
    await options.packageStore.inspectPackage(staging);
    const packagePath = await options.packageStore.finalizePackage(staging, request.destination);
    staging = undefined;
    const transfer: PortabilityTransfer = {
      transferId: preview.transferId,
      parentTransferId: preview.parentTransferId,
      datasetId: preview.datasetId,
      requestId: request.requestId,
      digest: request.digest,
      gitFingerprint: git.fingerprint,
      state: 'exported',
      createdAt: preview.manifest.createdAt,
      completedAt: new Date().toISOString(),
    };
    await options.store.finalizeExport({ requestId: request.requestId, transfer });
    return { transfer, packagePath };
  } finally {
    if (staging)
      await options.packageStore
        .cleanupOwnedStaging(staging, request.requestId)
        .catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function cancelExportIntent(
  options: PortabilityOperationsOptions,
  request: { requestId: string; digest: string },
): Promise<PortabilityState> {
  const state = await options.store.getPortabilityState();
  if (
    state.pendingExport?.requestId === request.requestId &&
    state.pendingExport.digest === request.digest &&
    (await pathExists(state.pendingExport.destination))
  ) {
    throw new PortabilityContractError(
      'invalid-input',
      'An export with this intent has already been published and cannot be cancelled',
    );
  }
  return options.store.cancelExportIntent(request);
}

async function replayCompletedExport(
  options: PortabilityOperationsOptions,
  request: { requestId: string; digest: string; destination: string },
): Promise<{ transfer: PortabilityTransfer; packagePath: string } | undefined> {
  const state = await options.store.getPortabilityState();
  const exportedReplay = state.state === 'exported' && state.lastTransferId === request.requestId;
  const exportingReplay =
    state.state === 'exporting' &&
    state.pendingExport?.requestId === request.requestId &&
    state.pendingExport.digest === request.digest &&
    state.pendingExport.destination === resolve(request.destination);
  if (!exportedReplay && !exportingReplay) return undefined;
  const packagePath = resolve(request.destination);
  if (!(await pathExists(packagePath))) return undefined;
  const manifest = await options.packageStore.inspectPackage(packagePath);
  if (manifest.transferId !== request.requestId || manifest.datasetId !== state.datasetId) {
    throw new PortabilityContractError(
      'invalid-input',
      'Published export does not match its intent',
    );
  }
  const git = await options.git.previewRepositoryTransfer(options.workspace);
  const expectedDigest = createDigest(
    manifest,
    request.destination,
    {
      datasetId: state.datasetId,
      state: 'active',
      lastTransferId: manifest.parentTransferId,
      pendingExport: null,
    },
    [],
    git.fingerprint,
  );
  if (expectedDigest !== request.digest) {
    throw new PortabilityContractError('invalid-digest', 'Export replay digest is stale');
  }
  const transfer: PortabilityTransfer = {
    transferId: manifest.transferId,
    parentTransferId: manifest.parentTransferId,
    datasetId: manifest.datasetId,
    requestId: manifest.requestId,
    digest: request.digest,
    gitFingerprint: manifest.git.head,
    state: 'exported',
    createdAt: manifest.createdAt,
    completedAt: new Date().toISOString(),
  };
  if (exportingReplay)
    await options.store.finalizeExport({ requestId: request.requestId, transfer });
  return { packagePath, transfer };
}

async function previewImport(
  options: PortabilityOperationsOptions,
  request: { packagePath: string; outputDataDir: string },
): Promise<PortabilityImportPreview> {
  const manifest = await options.packageStore.inspectPackage(request.packagePath);
  const baseline = options.baselineWasAbsent
    ? undefined
    : await inspectBaseline(options.database, options.dataDir);
  const blockers: PortabilityBlocker[] = [];
  if (await pathExists(request.outputDataDir)) {
    blockers.push({ code: 'output-exists', detail: 'Import output data directory already exists' });
  }
  if (baseline) {
    if (baseline.state !== 'exported') {
      blockers.push({ code: 'lineage-divergence', detail: 'Import baseline is not exported' });
    } else if (
      baseline.datasetId !== manifest.datasetId ||
      baseline.lastTransferId !== manifest.parentTransferId
    ) {
      blockers.push({
        code: 'lineage-divergence',
        detail: 'Import parent transfer does not match the baseline',
      });
    }
  }
  try {
    await options.git.assertImportWorkspace(options.workspace, manifest);
  } catch (error) {
    blockers.push({
      code: 'invalid-repository',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const git = await options.git.previewRepositoryTransfer(options.workspace);
  const digest = createDigest(
    manifest,
    request.outputDataDir,
    baseline ?? { state: 'active', datasetId: null },
    blockers,
    git.fingerprint,
  );
  return {
    transferId: manifest.transferId,
    datasetId: manifest.datasetId,
    parentTransferId: manifest.parentTransferId,
    outputDataDir: resolve(request.outputDataDir),
    blockers,
    digest,
    sensitiveDataWarning: SENSITIVE_DATA_WARNING,
  };
}

async function importPackage(
  options: PortabilityOperationsOptions,
  request: { requestId: string; digest: string; packagePath: string; outputDataDir: string },
): Promise<{ transfer: PortabilityTransfer; dataDir: string }> {
  const preview = await previewImport(options, request);
  if (preview.digest !== request.digest) {
    throw new PortabilityContractError('invalid-digest', 'Import preview digest is stale');
  }
  if (preview.blockers.length > 0) {
    throw new PortabilityContractError(
      'invalid-input',
      preview.blockers.map((item) => item.detail).join('; '),
    );
  }
  const staging = await options.packageStore.materializeImportStaging(
    request.packagePath,
    request.outputDataDir,
  );
  try {
    const manifest = await options.packageStore.inspectPackage(request.packagePath);
    options.database.activateImportedBackup(join(staging, 'runs.db'), {
      destinationDataDir: request.outputDataDir,
      destinationWorkspace: options.workspace,
      transfer: {
        transferId: manifest.transferId,
        parentTransferId: manifest.parentTransferId,
        datasetId: manifest.datasetId,
        requestId: manifest.requestId,
        digest: request.digest,
        gitFingerprint: manifest.git.head,
        state: 'imported',
        createdAt: manifest.createdAt,
        completedAt: new Date().toISOString(),
      },
    });
    const dataDir = await options.packageStore.finalizePackage(staging, request.outputDataDir);
    const transfer: PortabilityTransfer = {
      transferId: manifest.transferId,
      parentTransferId: manifest.parentTransferId,
      datasetId: manifest.datasetId,
      requestId: requestIdForImport(request.requestId),
      digest: request.digest,
      gitFingerprint: manifest.git.head,
      state: 'imported',
      createdAt: manifest.createdAt,
      completedAt: new Date().toISOString(),
    };
    return { transfer, dataDir };
  } catch (error) {
    await options.packageStore.cleanupOwnedStaging(staging, 'import').catch(() => undefined);
    throw error;
  }
}

async function buildPackage(
  options: PortabilityOperationsOptions,
  requestId: string,
  destination: string,
  stagingParent: string,
  git: Awaited<ReturnType<PortabilityGit['previewRepositoryTransfer']>>,
  expectedManifest?: TransferManifest,
  parentTransferId: string | null = null,
): Promise<{ staging: string; manifest: TransferManifest }> {
  await mkdir(stagingParent, { recursive: true });
  const staging = await options.packageStore.createStagingPackage({
    destination: join(stagingParent, `.binaflow-${requestId}`),
    requestId,
    transferId: requestId,
  });
  const databasePath = join(staging, 'runs.db');
  await options.store.backupDatabaseTo(databasePath);
  options.database.normalizePortableBackup(databasePath, {
    sourceDataDir: options.dataDir,
    transferId: requestId,
  });
  const databaseFile = await hashFile(databasePath);
  const bundleFile = await options.git.createRepositoryBundle(
    options.workspace,
    join(staging, 'repository.bundle'),
    git.ref,
  );
  const artifacts = (await options.store.listPortabilityArtifacts?.()) ?? [];
  const transferArtifacts: TransferArtifact[] = [];
  for (const artifact of artifacts) {
    const path = artifactPackagePath(artifact.path, options.dataDir);
    const copied = await options.packageStore.copyAndHashArtifact({
      sourcePath: artifact.path,
      destinationPath: join(staging, path),
    });
    transferArtifacts.push({
      path,
      sha256: copied.sha256,
      sizeBytes: copied.sizeBytes,
      runId: artifact.runId,
      stepId: artifact.stepId,
      artifactId: artifact.id,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
    });
  }
  const inspection = options.database.inspectPortableBackup(databasePath);
  const manifest: TransferManifest = {
    protocol: PORTABILITY_PROTOCOL,
    version: PORTABILITY_VERSION,
    transferId: requestId,
    parentTransferId,
    datasetId: (await options.store.getPortabilityState()).datasetId,
    requestId,
    createdAt: expectedManifest?.createdAt ?? new Date().toISOString(),
    binaflowVersion: VERSION,
    schemaVersion: PORTABILITY_SCHEMA_VERSION,
    counts: {
      runs: inspection.runs,
      artifacts: transferArtifacts.length,
      orphanArtifacts: 0,
    },
    files: {
      database: { path: 'runs.db', ...databaseFile },
      bundle: {
        path: 'repository.bundle',
        sha256: bundleFile.sha256,
        sizeBytes: bundleFile.sizeBytes,
      },
      artifacts: transferArtifacts,
    },
    git: { branch: git.branch, ref: git.ref, head: git.head },
    source: { state: 'active' },
    warnings: [SENSITIVE_DATA_WARNING],
  };
  if (expectedManifest) {
    if (JSON.stringify(manifest.files) !== JSON.stringify(expectedManifest.files)) {
      throw new PortabilityContractError(
        'invalid-input',
        `Export contents changed after preview: ${JSON.stringify({ actual: manifest.files, expected: expectedManifest.files })}`,
      );
    }
  }
  await options.packageStore.writeManifestLast(staging, manifest);
  await options.packageStore.inspectPackage(staging);
  return { staging, manifest };
}

function resumableExportState(
  state: PortabilityState,
  request: { requestId: string; destination: string },
): PortabilityState {
  if (
    state.state === 'exporting' &&
    state.pendingExport?.requestId === request.requestId &&
    state.pendingExport.destination === resolve(request.destination)
  ) {
    return { ...state, state: 'active', pendingExport: null };
  }
  return state;
}

async function exportBlockers(
  options: PortabilityOperationsOptions,
  state: PortabilityState,
  destination: string,
): Promise<PortabilityBlocker[]> {
  const blockers = await options.store.inspectPortabilityBlockers();
  if (state.state !== 'active') {
    blockers.unshift({ code: 'dataset-not-active', detail: `Dataset is ${state.state}` });
  }
  if (await pathExists(destination))
    blockers.push({ code: 'output-exists', detail: 'Transfer output already exists' });
  return blockers;
}

async function inspectBaseline(
  database: PortabilityDatabase,
  dataDir: string,
): Promise<PortableBackupInspection | undefined> {
  try {
    return database.inspectPortableBackup(join(resolve(dataDir), 'runs.db'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    if (error instanceof Error && /ENOENT|no such file/i.test(error.message)) return undefined;
    throw error;
  }
}

function emptyManifest(
  state: PortabilityState,
  requestId: string,
  git: { branch: string; ref: string; head: string },
): TransferManifest {
  return {
    protocol: PORTABILITY_PROTOCOL,
    version: PORTABILITY_VERSION,
    transferId: requestId,
    parentTransferId: state.lastTransferId,
    datasetId: state.datasetId,
    requestId,
    createdAt: new Date().toISOString(),
    binaflowVersion: VERSION,
    schemaVersion: PORTABILITY_SCHEMA_VERSION,
    counts: { runs: 0, artifacts: 0, orphanArtifacts: 0 },
    files: {
      database: { path: 'runs.db', sha256: '0'.repeat(64), sizeBytes: 0 },
      bundle: { path: 'repository.bundle', sha256: '0'.repeat(64), sizeBytes: 0 },
      artifacts: [],
    },
    git,
    source: { state: state.state },
    warnings: [SENSITIVE_DATA_WARNING],
  };
}

function createDigest(
  manifest: TransferManifest,
  destination: string,
  state: unknown,
  blockers: readonly PortabilityBlocker[],
  gitFingerprint: unknown,
): string {
  return createTransferDigest({
    manifest: { ...manifest, createdAt: undefined },
    destination: resolve(destination),
    state,
    blockers,
    gitFingerprint,
  });
}

function artifactPackagePath(path: string, dataDir: string): string {
  const root = resolve(dataDir);
  const candidate = isAbsolutePath(path) ? relative(root, path).split(sep).join('/') : path;
  if (!candidate || candidate === '..' || candidate.startsWith('../')) {
    throw new PortabilityContractError('invalid-path', 'Artifact is outside the data directory');
  }
  const portable = candidate.startsWith('artifacts/') ? candidate : `artifacts/${candidate}`;
  if (
    !portable.startsWith('artifacts/') ||
    portable.split('/').some((part) => part === '..' || !part)
  ) {
    throw new PortabilityContractError('invalid-path', 'Artifact path is not portable');
  }
  return portable;
}

async function hashFile(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of (await import('node:fs')).createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    sizeBytes += buffer.byteLength;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function requestIdForImport(requestId: string): string {
  return requestId;
}
