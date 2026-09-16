import { access, stat } from 'node:fs/promises';
import type { PortabilityService } from './ports.js';
import {
  generateUpdatedDataDirConfiguration,
  replaceConfigurationAtomically,
} from './config-operations.js';
import type { ProjectCatalogEntry } from '../web/launcher-contracts.js';
import { FileProjectCatalog } from '../web/project-catalog.js';
import {
  digestPackage,
  materializePackageAtomically,
  verifyTransferredPackage,
} from '../web/peer-transfer.js';
import { FileTransferJournal, type TransferJournalRecord } from '../web/transfer-journal.js';

export interface ProjectTransferContext {
  project: ProjectCatalogEntry;
  portability: PortabilityService;
  catalog: FileProjectCatalog;
}

export interface ProjectTransferOptions {
  transferId: string;
  requestId: string;
  source: ProjectTransferContext;
  target: ProjectTransferContext;
  packagePath: string;
  receivedPackagePath: string;
  outputDataDir: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  journal: FileTransferJournal;
}

export interface ReceiveProjectTransferOptions {
  transferId: string;
  requestId: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  packageDigest: string;
  packageBytes: number;
  target: ProjectTransferContext;
  receivedPackagePath: string;
  outputDataDir: string;
  journal: FileTransferJournal;
}

export interface ProjectTransferPreview {
  transferId: string;
  requestId: string;
  projectId: string;
  blockers: string[];
  digest?: string;
  packageBytes?: number;
}

export async function previewProjectTransfer(
  options: ProjectTransferOptions,
): Promise<ProjectTransferPreview> {
  assertTransferIdentity(options);
  const blockers: string[] = [];
  if (options.source.project.ownership.status !== 'active') blockers.push('source-not-active');
  if (options.target.project.projectId !== options.source.project.projectId)
    blockers.push('project-id-mismatch');
  if (options.target.project.ownership.status !== 'active') blockers.push('target-not-active');
  const preview = await options.source.portability.previewExport({
    requestId: options.requestId,
    destination: options.packagePath,
  });
  blockers.push(...preview.blockers.map((blocker) => blocker.code));
  const packageBytes = blockers.length === 0 ? manifestBytes(preview.manifest) : undefined;
  return {
    transferId: options.transferId,
    requestId: options.requestId,
    projectId: options.source.project.projectId,
    blockers: [...new Set(blockers)],
    ...(blockers.length === 0 ? { digest: preview.digest } : {}),
    ...(packageBytes === undefined ? {} : { packageBytes }),
  };
}

export async function startProjectTransfer(
  options: ProjectTransferOptions,
): Promise<TransferJournalRecord> {
  const existing = await options.journal.get(options.transferId);
  if (existing?.stage === 'completed') return existing;
  const preview = await previewProjectTransfer(options);
  if (preview.blockers.length > 0 || !preview.digest) {
    throw new ProjectTransferError(
      'preflight-failed',
      preview.blockers.join(', ') || 'Transfer preview is invalid',
    );
  }
  let record: TransferJournalRecord = {
    transferId: options.transferId,
    projectId: options.source.project.projectId,
    sourceDeviceId: options.sourceDeviceId,
    targetDeviceId: options.targetDeviceId,
    stage: 'exporting',
    requestId: options.requestId,
    packageDigest: preview.digest,
    bytesSent: 0,
    bytesReceived: 0,
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  await options.source.portability.exportPackage({
    requestId: options.requestId,
    digest: preview.digest,
    destination: options.packagePath,
  });
  record = {
    ...record,
    stage: 'sending',
    packagePath: options.packagePath,
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  const packageDigest = await digestPackage(options.packagePath);
  await materializePackageAtomically(options.packagePath, options.receivedPackagePath);
  const packageBytes = await verifyTransferredPackage(options.receivedPackagePath, packageDigest);
  record = {
    ...record,
    packageDigest: packageDigest,
    bytesSent: packageBytes,
    bytesReceived: packageBytes,
    receivedPackagePath: options.receivedPackagePath,
    stage: 'importing',
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  const importPreview = await options.target.portability.previewImport({
    packagePath: options.receivedPackagePath,
    outputDataDir: options.outputDataDir,
  });
  if (importPreview.blockers.length > 0) {
    throw new ProjectTransferError(
      'import-preflight-failed',
      importPreview.blockers.map((item) => item.code).join(','),
    );
  }
  const imported = await options.target.portability.importPackage({
    requestId: options.requestId,
    digest: importPreview.digest,
    packagePath: options.receivedPackagePath,
    outputDataDir: options.outputDataDir,
  });
  const generated = await generateUpdatedDataDirConfiguration({
    configPath: options.target.project.configPath,
    dataDir: imported.dataDir,
    cwd: options.target.project.workspacePath,
  });
  await replaceConfigurationAtomically(generated);
  await options.source.catalog.updateOwnership(options.source.project.projectId, {
    status: 'exported',
    previousOwnerDeviceId: options.sourceDeviceId,
    transferId: options.transferId,
    targetDeviceId: options.targetDeviceId,
  });
  await options.target.catalog.updateOwnership(options.target.project.projectId, {
    status: 'active',
    ownerDeviceId: options.targetDeviceId,
  });
  record = {
    ...record,
    stage: 'completed',
    targetReceipt: imported.transfer.transferId,
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  return record;
}

export async function receiveProjectTransfer(
  options: ReceiveProjectTransferOptions,
): Promise<TransferJournalRecord> {
  if (options.target.project.projectId !== options.projectId) {
    throw new ProjectTransferError(
      'project-id-mismatch',
      'Target project ID does not match transfer',
    );
  }
  if (options.target.project.ownership.status !== 'active') {
    throw new ProjectTransferError('target-not-active', 'Target project is not active');
  }
  const current = await options.journal.get(options.transferId);
  let record: TransferJournalRecord = {
    transferId: options.transferId,
    projectId: options.projectId,
    sourceDeviceId: options.sourceDeviceId,
    targetDeviceId: options.targetDeviceId,
    stage: 'importing',
    requestId: options.requestId,
    packageDigest: options.packageDigest,
    bytesSent: current?.bytesSent ?? options.packageBytes,
    bytesReceived: options.packageBytes,
    receivedPackagePath: options.receivedPackagePath,
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  const preview = await options.target.portability.previewImport({
    packagePath: options.receivedPackagePath,
    outputDataDir: options.outputDataDir,
  });
  if (preview.blockers.length > 0) {
    throw new ProjectTransferError(
      'import-preflight-failed',
      preview.blockers.map((item) => item.code).join(','),
    );
  }
  const imported = await options.target.portability.importPackage({
    requestId: options.requestId,
    digest: preview.digest,
    packagePath: options.receivedPackagePath,
    outputDataDir: options.outputDataDir,
  });
  const generated = await generateUpdatedDataDirConfiguration({
    configPath: options.target.project.configPath,
    dataDir: imported.dataDir,
    cwd: options.target.project.workspacePath,
  });
  await replaceConfigurationAtomically(generated);
  await options.target.catalog.updateOwnership(options.projectId, {
    status: 'active',
    ownerDeviceId: options.targetDeviceId,
  });
  record = {
    ...record,
    stage: 'completed',
    targetReceipt: imported.transfer.transferId,
    updatedAt: new Date().toISOString(),
  };
  await options.journal.save(record);
  return record;
}

export async function resumeProjectTransfer(
  options: ProjectTransferOptions,
): Promise<TransferJournalRecord> {
  const record = await options.journal.get(options.transferId);
  if (!record) return startProjectTransfer(options);
  if (record.stage === 'completed') return record;
  return startProjectTransfer(options);
}

export class ProjectTransferError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectTransferError';
    this.code = code;
  }
}

function assertTransferIdentity(options: ProjectTransferOptions): void {
  if (options.source.project.projectId !== options.target.project.projectId) {
    throw new ProjectTransferError('project-id-mismatch', 'Source and target project IDs differ');
  }
  if (options.sourceDeviceId === options.targetDeviceId) {
    throw new ProjectTransferError('device-id-mismatch', 'Source and target devices must differ');
  }
}

function manifestBytes(manifest: {
  files?: {
    database?: { sizeBytes?: number };
    bundle?: { sizeBytes?: number };
    artifacts?: Array<{ sizeBytes?: number }>;
  };
}): number | undefined {
  if (!manifest.files) return undefined;
  return (
    (manifest.files.database?.sizeBytes ?? 0) +
    (manifest.files.bundle?.sizeBytes ?? 0) +
    (manifest.files.artifacts ?? []).reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0)
  );
}

export async function assertTargetPathIsNew(path: string): Promise<void> {
  try {
    await access(path);
    throw new ProjectTransferError('output-exists', 'Transfer output already exists');
  } catch (error) {
    if (error instanceof ProjectTransferError) throw error;
  }
}

export async function packageSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
