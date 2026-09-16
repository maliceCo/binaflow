import { createReadStream } from 'node:fs';
import { resolve, relative, sep, join, dirname } from 'node:path';
import { openPortabilityContext } from '../../application/runtime.js';
import { receiveProjectTransfer } from '../../application/project-transfer.js';
import { directoryPackageStore } from '../../portability/directory-package.js';
import { FileProjectCatalog } from '../../web/project-catalog.js';
import {
  createPeerTransport,
  downloadTransferWithResume,
  requestPeerReceive,
  type PeerTransport,
  type PeerTransferPackage,
  type PeerTransportReceiver,
} from '../../web/peer-transport.js';
import { PeerAuth } from '../../web/peer-auth.js';
import type { DeviceIdentity } from '../../web/device-identity.js';
import type { ProjectCatalogEntry } from '../../web/launcher-contracts.js';
import type { WebTransferCapabilities } from '../../web/routes.js';
import { FileTransferJournal, type TransferJournalRecord } from '../../web/transfer-journal.js';
import type { WebSettingsController } from '../../web/settings-store.js';

interface TransferCommand {
  transferId: string;
  requestId: string;
  projectId: string;
  targetProjectId: string;
  targetDeviceId: string;
  confirmed?: boolean;
}

export interface LauncherTransferResources {
  transfers: WebTransferCapabilities;
  peerTransport?: PeerTransport;
  close(): Promise<void>;
}

export async function createLauncherTransferResources(input: {
  settingsPath: string;
  settings: WebSettingsController;
  identity: DeviceIdentity;
  peerAuth: PeerAuth;
  catalog: FileProjectCatalog;
  getActiveProject: () => ProjectCatalogEntry | undefined;
}): Promise<LauncherTransferResources> {
  const journal = new FileTransferJournal(join(dirname(input.settingsPath), 'transfers.json'));
  const pending = new Map<
    string,
    { command: TransferCommand; digest: string; packagePath: string; packageBytes: number }
  >();
  const peerTransport = await createConfiguredPeerTransport(input, journal);
  const transfers: WebTransferCapabilities = {
    preview: async (value) => {
      const command = parseCommand(value);
      const active = input.getActiveProject();
      const peer = input.peerAuth
        .listPeers()
        .find((item) => item.deviceId === command.targetDeviceId);
      const blockers: string[] = [];
      if (!active || active.projectId !== command.projectId) blockers.push('project-not-active');
      if (command.targetProjectId !== command.projectId) blockers.push('project-id-mismatch');
      if (!peer || peer.status !== 'paired') blockers.push('peer-not-paired');
      if (!peerTransport) blockers.push('peer-transport-disabled');
      if (blockers.length > 0)
        return {
          transferId: command.transferId,
          requestId: command.requestId,
          projectId: command.projectId,
          blockers,
        };
      if (!active) throw new Error('No active project is selected');
      const packagePath = join(
        dirname(input.settingsPath),
        'transfers',
        command.transferId,
        'package',
      );
      const context = await openPortabilityContext(active.configPath, active.workspacePath);
      try {
        const preview = await context.portability.previewExport({
          requestId: command.requestId,
          destination: packagePath,
        });
        const packageBytes = manifestBytes(preview.manifest);
        pending.set(command.transferId, {
          command,
          digest: preview.digest,
          packagePath,
          packageBytes,
        });
        return {
          transferId: command.transferId,
          requestId: command.requestId,
          projectId: command.projectId,
          blockers: preview.blockers.map((item) => item.code),
          digest: preview.digest,
          packageBytes,
        };
      } finally {
        context.close();
      }
    },
    start: async (value) => {
      const command = parseCommand(value);
      if (command.confirmed !== true) throw new Error('Transfer confirmation is required');
      const prepared = pending.get(command.transferId);
      if (!prepared || prepared.command.requestId !== command.requestId)
        throw new Error('Transfer preview is missing or stale');
      const active = input.getActiveProject();
      const peer = input.peerAuth
        .listPeers()
        .find((item) => item.deviceId === command.targetDeviceId);
      if (!active || !peer || !peerTransport) throw new Error('Transfer peer is unavailable');
      const context = await openPortabilityContext(active.configPath, active.workspacePath);
      try {
        await context.portability.exportPackage({
          requestId: command.requestId,
          digest: prepared.digest,
          destination: prepared.packagePath,
        });
      } finally {
        context.close();
      }
      await input.catalog.updateOwnership(command.projectId, {
        status: 'exported',
        previousOwnerDeviceId: input.identity.deviceId,
        transferId: command.transferId,
        targetDeviceId: command.targetDeviceId,
      });
      let record: TransferJournalRecord = {
        transferId: command.transferId,
        projectId: command.projectId,
        sourceDeviceId: input.identity.deviceId,
        targetDeviceId: command.targetDeviceId,
        stage: 'sending',
        requestId: command.requestId,
        packageDigest: prepared.digest,
        packagePath: prepared.packagePath,
        bytesSent: 0,
        bytesReceived: 0,
        updatedAt: new Date().toISOString(),
      };
      await journal.save(record);
      const targetResult = await requestPeerReceive({
        endpoint: peer.origin,
        peerId: command.targetDeviceId,
        auth: input.peerAuth,
        request: {
          transferId: command.transferId,
          requestId: command.requestId,
          projectId: command.projectId,
          sourceDeviceId: input.identity.deviceId,
          targetDeviceId: command.targetDeviceId,
          sourceEndpoint: peerTransport.origin,
          packageDigest: prepared.digest,
          packageBytes: prepared.packageBytes,
        },
        mode: 'lan-experimental',
        experimentalLanOptIn: true,
      });
      const targetRecord = transferRecord(targetResult);
      record = {
        ...record,
        stage: 'completed',
        bytesSent: prepared.packageBytes,
        bytesReceived: targetRecord.bytesReceived,
        targetReceipt: command.transferId,
        updatedAt: new Date().toISOString(),
      };
      await journal.save(record);
      return record;
    },
    status: async (transferId) => safeStatus(await journal.get(transferId)),
    resume: async (transferId) => {
      const record = await journal.get(transferId);
      if (!record || !record.packagePath) throw new Error('Transfer is not resumable');
      const peer = input.peerAuth
        .listPeers()
        .find((item) => item.deviceId === record.targetDeviceId);
      if (!peer || !peerTransport) throw new Error('Transfer peer is unavailable');
      const result = await requestPeerReceive({
        endpoint: peer.origin,
        peerId: record.targetDeviceId,
        auth: input.peerAuth,
        request: {
          transferId: record.transferId,
          requestId: record.requestId,
          projectId: record.projectId,
          sourceDeviceId: record.sourceDeviceId,
          targetDeviceId: record.targetDeviceId,
          sourceEndpoint: peerTransport.origin,
          packageDigest: record.packageDigest,
          packageBytes: record.bytesSent,
        },
        mode: 'lan-experimental',
        experimentalLanOptIn: true,
      });
      const received = transferRecord(result);
      const next = {
        ...record,
        stage: 'completed' as const,
        bytesReceived: received.bytesReceived,
        updatedAt: new Date().toISOString(),
      };
      await journal.save(next);
      return next;
    },
  };
  return {
    transfers,
    ...(peerTransport ? { peerTransport } : {}),
    close: async () => peerTransport?.close(),
  };
}

async function createConfiguredPeerTransport(
  input: {
    settings: WebSettingsController;
    peerAuth: PeerAuth;
    catalog: FileProjectCatalog;
    identity: DeviceIdentity;
    settingsPath: string;
  },
  journal: FileTransferJournal,
): Promise<PeerTransport | undefined> {
  const settings = input.settings.get();
  const peer = settings.peerTransport;
  if (!peer || peer.mode !== 'lan-experimental' || !peer.warningAccepted) return undefined;
  const receiver: PeerTransportReceiver = {
    receive: async (request) => {
      const project = (await input.catalog.list()).projects.find(
        (item) => item.projectId === request.projectId,
      );
      if (!project) throw new Error('Target project is not registered on this device');
      const outputRoot = join(dirname(input.settingsPath), 'transfers', request.transferId);
      const receivedPackagePath = join(outputRoot, 'package');
      const outputDataDir = join(outputRoot, 'data');
      const downloaded = await downloadTransferWithResume({
        endpoint: request.sourceEndpoint,
        peerId: request.sourceDeviceId,
        auth: input.peerAuth,
        transferId: request.transferId,
        requestId: request.requestId,
        destination: receivedPackagePath,
        expectedDigest: request.packageDigest,
        expectedBytes: request.packageBytes,
        mode: 'lan-experimental',
        experimentalLanOptIn: true,
      });
      const targetContext = await openPortabilityContext(project.configPath, project.workspacePath);
      try {
        return await receiveProjectTransfer({
          transferId: request.transferId,
          requestId: request.requestId,
          projectId: request.projectId,
          sourceDeviceId: request.sourceDeviceId,
          targetDeviceId: request.targetDeviceId,
          packageDigest: downloaded.digest,
          packageBytes: downloaded.bytesReceived,
          target: { project, portability: targetContext.portability, catalog: input.catalog },
          receivedPackagePath,
          outputDataDir,
          journal,
        });
      } finally {
        targetContext.close();
      }
    },
  };
  return createPeerTransport({
    host: peer.host,
    port: peer.port,
    mode: peer.mode,
    experimentalLanOptIn: peer.warningAccepted,
    auth: input.peerAuth,
    source: {
      getPackage: async (transferId) => packageSource(await journal.get(transferId)),
    },
    receiver,
  });
}

async function packageSource(
  record: TransferJournalRecord | undefined,
): Promise<PeerTransferPackage | undefined> {
  if (!record?.packagePath) return undefined;
  const manifest = await directoryPackageStore.inspectPackage(record.packagePath);
  const files = [manifest.files.database, manifest.files.bundle, ...manifest.files.artifacts].map(
    (file) => ({ path: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256 }),
  );
  return {
    transferId: record.transferId,
    digest: record.packageDigest,
    files,
    open: (path, start, end) =>
      createReadStream(safePackageFile(record.packagePath!, path), { start, end }),
  };
}

function safePackageFile(packagePath: string, filePath: string): string {
  const root = resolve(packagePath);
  const target = resolve(root, filePath);
  if (relative(root, target).startsWith(`..${sep}`)) throw new Error('Package file path is unsafe');
  return target;
}

function parseCommand(value: unknown): TransferCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid transfer command');
  const record = value as Record<string, unknown>;
  for (const key of ['transferId', 'requestId', 'projectId', 'targetProjectId', 'targetDeviceId'])
    if (typeof record[key] !== 'string' || !record[key])
      throw new Error('Transfer identifiers are required');
  return {
    transferId: record.transferId as string,
    requestId: record.requestId as string,
    projectId: record.projectId as string,
    targetProjectId: record.targetProjectId as string,
    targetDeviceId: record.targetDeviceId as string,
    ...(record.confirmed === undefined ? {} : { confirmed: record.confirmed === true }),
  };
}

function manifestBytes(manifest: {
  files: {
    database: { sizeBytes: number };
    bundle: { sizeBytes: number };
    artifacts: Array<{ sizeBytes: number }>;
  };
}): number {
  return (
    manifest.files.database.sizeBytes +
    manifest.files.bundle.sizeBytes +
    manifest.files.artifacts.reduce((sum, file) => sum + file.sizeBytes, 0)
  );
}

function transferRecord(value: unknown): { bytesReceived: number } {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { bytesReceived?: unknown }).bytesReceived !== 'number'
  )
    throw new Error('Peer receipt is invalid');
  return value as { bytesReceived: number };
}

function safeStatus(record: TransferJournalRecord | undefined): Record<string, unknown> {
  if (!record) throw new Error('Transfer not found');
  return {
    transferId: record.transferId,
    projectId: record.projectId,
    stage: record.stage,
    bytesSent: record.bytesSent,
    bytesReceived: record.bytesReceived,
    packageDigest: record.packageDigest,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  };
}
