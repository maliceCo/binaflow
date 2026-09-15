import { WebContractError } from './contracts.js';

export const LAUNCHER_SCHEMA_VERSION = 1 as const;

export const LAUNCHER_LIMITS = {
  maxProjectRoots: 16,
  maxProjects: 500,
  maxDevices: 32,
  maxNameBytes: 120,
  maxPathBytes: 4096,
  maxOriginBytes: 512,
  maxBranchBytes: 256,
  maxPackageBytes: 1024 * 1024 * 1024 * 4,
} as const;

export type ProjectOwnership =
  | { status: 'active'; ownerDeviceId: string }
  | {
      status: 'exporting';
      ownerDeviceId: string;
      transferId: string;
      targetDeviceId: string;
    }
  | {
      status: 'exported';
      previousOwnerDeviceId: string;
      transferId: string;
      targetDeviceId: string;
    }
  | {
      status: 'importing';
      ownerDeviceId: string;
      transferId: string;
      sourceDeviceId: string;
    };

export interface LauncherProjectRoot {
  rootId: string;
  label: string;
  path: string;
}

export interface LauncherSettings {
  schemaVersion: typeof LAUNCHER_SCHEMA_VERSION;
  setupRequired: boolean;
  deviceName: string;
  web: {
    host: string;
    port: number;
    origin: string;
    tls?: { certFile: string; keyFile: string };
  };
  projectRoots: LauncherProjectRoot[];
}

export interface ProjectCatalogEntry {
  projectId: string;
  name: string;
  workspacePath: string;
  configPath: string;
  dataDirPath: string;
  ownership: ProjectOwnership;
  updatedAt: string;
}

export interface ProjectCatalog {
  schemaVersion: typeof LAUNCHER_SCHEMA_VERSION;
  projects: ProjectCatalogEntry[];
}

export type DeviceStatus = 'paired' | 'revoked';

export interface DeviceRecord {
  schemaVersion: typeof LAUNCHER_SCHEMA_VERSION;
  deviceId: string;
  name: string;
  origin: string;
  publicKey: string;
  certificateFingerprint: string;
  status: DeviceStatus;
  pairedAt: string;
  revokedAt?: string;
}

export interface PeerTransferRequest {
  schemaVersion: typeof LAUNCHER_SCHEMA_VERSION;
  transferId: string;
  requestId: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  branch: string;
  headCommit: string;
  packageDigest: string;
  packageBytes: number;
}

export type PeerTransferStatus =
  'pending' | 'exporting' | 'importing' | 'completed' | 'failed' | 'interrupted';

export interface PeerTransferReceipt {
  schemaVersion: typeof LAUNCHER_SCHEMA_VERSION;
  transferId: string;
  requestId: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  status: PeerTransferStatus;
  packageDigest: string;
  receivedBytes: number;
  completedAt?: string;
  errorCode?: string;
}

export interface WebProjectSummaryDto {
  id: string;
  name: string;
  ownership: ProjectOwnership['status'];
  updatedAt: string;
}

export interface WebDeviceSummaryDto {
  id: string;
  name: string;
  status: DeviceStatus;
}

export interface WebTransferSummaryDto {
  id: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  status: PeerTransferStatus;
  receivedBytes: number;
}

export interface WebLauncherSettingsDto {
  setupRequired: boolean;
  deviceName: string;
  web: { host: string; port: number; origin: string; tlsConfigured: boolean };
  projectRoots: Array<{ id: string; label: string }>;
}

export function parseLauncherSettings(value: unknown): LauncherSettings {
  const record = asStrictRecord(value, 'launcher settings');
  assertVersion(record);
  assertKeys(record, ['schemaVersion', 'setupRequired', 'deviceName', 'web', 'projectRoots']);
  const setupRequired = record.setupRequired;
  assertBoolean(setupRequired, 'setupRequired');
  const deviceName = parseName(record.deviceName, 'deviceName');
  const web = parseWebLauncherSettings(record.web);
  const projectRoots = parseArray(
    record.projectRoots,
    'projectRoots',
    LAUNCHER_LIMITS.maxProjectRoots,
  );
  return {
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
    setupRequired,
    deviceName,
    web,
    projectRoots: projectRoots.map(parseProjectRoot),
  };
}

export function parseProjectCatalog(value: unknown): ProjectCatalog {
  const record = asStrictRecord(value, 'project catalog');
  assertVersion(record);
  assertKeys(record, ['schemaVersion', 'projects']);
  const projects = parseArray(record.projects, 'projects', LAUNCHER_LIMITS.maxProjects).map(
    parseProjectCatalogEntry,
  );
  const ids = new Set<string>();
  for (const project of projects) {
    if (ids.has(project.projectId)) {
      throw invalid('project catalog contains duplicate project IDs');
    }
    ids.add(project.projectId);
  }
  return { schemaVersion: LAUNCHER_SCHEMA_VERSION, projects };
}

export function parseDeviceRecord(value: unknown): DeviceRecord {
  const record = asStrictRecord(value, 'device record');
  assertVersion(record);
  assertKeys(record, [
    'schemaVersion',
    'deviceId',
    'name',
    'origin',
    'publicKey',
    'certificateFingerprint',
    'status',
    'pairedAt',
    'revokedAt',
  ]);
  const deviceId = parseDeviceId(record.deviceId, 'deviceId');
  const name = parseName(record.name, 'name');
  const origin = parseOrigin(record.origin);
  const publicKey = parsePem(record.publicKey, 'publicKey');
  const certificateFingerprint = parseDigest(
    record.certificateFingerprint,
    'certificateFingerprint',
  );
  const status = parseEnum(record.status, ['paired', 'revoked'] as const, 'status');
  const pairedAt = parseTimestamp(record.pairedAt, 'pairedAt');
  const revokedAt =
    record.revokedAt === undefined ? undefined : parseTimestamp(record.revokedAt, 'revokedAt');
  if (status === 'paired' && revokedAt !== undefined) {
    throw invalid('paired device cannot have revokedAt');
  }
  if (status === 'revoked' && revokedAt === undefined) {
    throw invalid('revoked device must have revokedAt');
  }
  return {
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
    deviceId,
    name,
    origin,
    publicKey,
    certificateFingerprint,
    status,
    pairedAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

export function parsePeerTransferRequest(value: unknown): PeerTransferRequest {
  const record = asStrictRecord(value, 'peer transfer request');
  assertVersion(record);
  assertKeys(record, [
    'schemaVersion',
    'transferId',
    'requestId',
    'projectId',
    'sourceDeviceId',
    'targetDeviceId',
    'branch',
    'headCommit',
    'packageDigest',
    'packageBytes',
  ]);
  const sourceDeviceId = parseDeviceId(record.sourceDeviceId, 'sourceDeviceId');
  const targetDeviceId = parseDeviceId(record.targetDeviceId, 'targetDeviceId');
  if (sourceDeviceId === targetDeviceId) {
    throw invalid('source and target devices must differ');
  }
  const packageBytes = parseSafeInteger(record.packageBytes, 'packageBytes');
  if (packageBytes > LAUNCHER_LIMITS.maxPackageBytes) {
    throw tooLarge('packageBytes exceeds its limit');
  }
  return {
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
    transferId: parseUuid(record.transferId, 'transferId'),
    requestId: parseUuid(record.requestId, 'requestId'),
    projectId: parseUuid(record.projectId, 'projectId'),
    sourceDeviceId,
    targetDeviceId,
    branch: parseBoundedString(record.branch, 'branch', LAUNCHER_LIMITS.maxBranchBytes),
    headCommit: parseHex(record.headCommit, 40, 'headCommit'),
    packageDigest: parseDigest(record.packageDigest, 'packageDigest'),
    packageBytes,
  };
}

export function parsePeerTransferReceipt(value: unknown): PeerTransferReceipt {
  const record = asStrictRecord(value, 'peer transfer receipt');
  assertVersion(record);
  assertKeys(record, [
    'schemaVersion',
    'transferId',
    'requestId',
    'projectId',
    'sourceDeviceId',
    'targetDeviceId',
    'status',
    'packageDigest',
    'receivedBytes',
    'completedAt',
    'errorCode',
  ]);
  const status = parseEnum(
    record.status,
    ['pending', 'exporting', 'importing', 'completed', 'failed', 'interrupted'] as const,
    'status',
  );
  const receivedBytes = parseSafeInteger(record.receivedBytes, 'receivedBytes');
  if (receivedBytes > LAUNCHER_LIMITS.maxPackageBytes) {
    throw tooLarge('receivedBytes exceeds its limit');
  }
  if (status === 'completed' && record.completedAt === undefined) {
    throw invalid('completed transfer must have completedAt');
  }
  if (status === 'failed' && typeof record.errorCode !== 'string') {
    throw invalid('failed transfer must have errorCode');
  }
  return {
    schemaVersion: LAUNCHER_SCHEMA_VERSION,
    transferId: parseUuid(record.transferId, 'transferId'),
    requestId: parseUuid(record.requestId, 'requestId'),
    projectId: parseUuid(record.projectId, 'projectId'),
    sourceDeviceId: parseDeviceId(record.sourceDeviceId, 'sourceDeviceId'),
    targetDeviceId: parseDeviceId(record.targetDeviceId, 'targetDeviceId'),
    status,
    packageDigest: parseDigest(record.packageDigest, 'packageDigest'),
    receivedBytes,
    ...(record.completedAt === undefined
      ? {}
      : { completedAt: parseTimestamp(record.completedAt, 'completedAt') }),
    ...(record.errorCode === undefined
      ? {}
      : { errorCode: parseBoundedString(record.errorCode, 'errorCode', 120) }),
  };
}

export function toWebLauncherSettingsDto(settings: LauncherSettings): WebLauncherSettingsDto {
  return {
    setupRequired: settings.setupRequired,
    deviceName: settings.deviceName,
    web: {
      host: settings.web.host,
      port: settings.web.port,
      origin: settings.web.origin,
      tlsConfigured: settings.web.tls !== undefined,
    },
    projectRoots: settings.projectRoots.map(({ rootId, label }) => ({ id: rootId, label })),
  };
}

export function toWebProjectSummaryDto(project: ProjectCatalogEntry): WebProjectSummaryDto {
  return {
    id: project.projectId,
    name: project.name,
    ownership: project.ownership.status,
    updatedAt: project.updatedAt,
  };
}

export function toWebDeviceSummaryDto(device: DeviceRecord): WebDeviceSummaryDto {
  return { id: device.deviceId, name: device.name, status: device.status };
}

export function toWebTransferSummaryDto(receipt: PeerTransferReceipt): WebTransferSummaryDto {
  return {
    id: receipt.transferId,
    projectId: receipt.projectId,
    sourceDeviceId: receipt.sourceDeviceId,
    targetDeviceId: receipt.targetDeviceId,
    status: receipt.status,
    receivedBytes: receipt.receivedBytes,
  };
}

function parseWebLauncherSettings(value: unknown): LauncherSettings['web'] {
  const record = asStrictRecord(value, 'web settings');
  assertKeys(record, ['host', 'port', 'origin', 'tls']);
  const host = parseBoundedString(record.host, 'host', 255);
  const port = parseSafeInteger(record.port, 'port');
  if (port < 1 || port > 65535) throw invalid('port must be between 1 and 65535');
  const origin = parseOrigin(record.origin);
  const tls = record.tls === undefined ? undefined : parseTlsSettings(record.tls);
  return { host, port, origin, ...(tls === undefined ? {} : { tls }) };
}

function parseTlsSettings(value: unknown): { certFile: string; keyFile: string } {
  const record = asStrictRecord(value, 'TLS settings');
  assertKeys(record, ['certFile', 'keyFile']);
  return {
    certFile: parseBoundedString(record.certFile, 'certFile', LAUNCHER_LIMITS.maxPathBytes),
    keyFile: parseBoundedString(record.keyFile, 'keyFile', LAUNCHER_LIMITS.maxPathBytes),
  };
}

function parseProjectRoot(value: unknown): LauncherProjectRoot {
  const record = asStrictRecord(value, 'project root');
  assertKeys(record, ['rootId', 'label', 'path']);
  return {
    rootId: parseUuid(record.rootId, 'rootId'),
    label: parseName(record.label, 'label'),
    path: parseBoundedString(record.path, 'path', LAUNCHER_LIMITS.maxPathBytes),
  };
}

function parseProjectCatalogEntry(value: unknown): ProjectCatalogEntry {
  const record = asStrictRecord(value, 'project catalog entry');
  assertKeys(record, [
    'projectId',
    'name',
    'workspacePath',
    'configPath',
    'dataDirPath',
    'ownership',
    'updatedAt',
  ]);
  return {
    projectId: parseUuid(record.projectId, 'projectId'),
    name: parseName(record.name, 'name'),
    workspacePath: parseBoundedString(
      record.workspacePath,
      'workspacePath',
      LAUNCHER_LIMITS.maxPathBytes,
    ),
    configPath: parseBoundedString(record.configPath, 'configPath', LAUNCHER_LIMITS.maxPathBytes),
    dataDirPath: parseBoundedString(
      record.dataDirPath,
      'dataDirPath',
      LAUNCHER_LIMITS.maxPathBytes,
    ),
    ownership: parseOwnership(record.ownership),
    updatedAt: parseTimestamp(record.updatedAt, 'updatedAt'),
  };
}

function parseOwnership(value: unknown): ProjectOwnership {
  const record = asStrictRecord(value, 'project ownership');
  const status = parseEnum(
    record.status,
    ['active', 'exporting', 'exported', 'importing'] as const,
    'ownership.status',
  );
  if (status === 'active') {
    assertKeys(record, ['status', 'ownerDeviceId']);
    return { status, ownerDeviceId: parseDeviceId(record.ownerDeviceId, 'ownerDeviceId') };
  }
  if (status === 'exporting') {
    assertKeys(record, ['status', 'ownerDeviceId', 'transferId', 'targetDeviceId']);
    const ownerDeviceId = parseDeviceId(record.ownerDeviceId, 'ownerDeviceId');
    const targetDeviceId = parseDeviceId(record.targetDeviceId, 'targetDeviceId');
    if (ownerDeviceId === targetDeviceId) throw invalid('exporting devices must differ');
    return {
      status,
      ownerDeviceId,
      transferId: parseUuid(record.transferId, 'transferId'),
      targetDeviceId,
    };
  }
  if (status === 'exported') {
    assertKeys(record, ['status', 'previousOwnerDeviceId', 'transferId', 'targetDeviceId']);
    const previousOwnerDeviceId = parseDeviceId(
      record.previousOwnerDeviceId,
      'previousOwnerDeviceId',
    );
    const targetDeviceId = parseDeviceId(record.targetDeviceId, 'targetDeviceId');
    if (previousOwnerDeviceId === targetDeviceId) throw invalid('exported devices must differ');
    return {
      status,
      previousOwnerDeviceId,
      transferId: parseUuid(record.transferId, 'transferId'),
      targetDeviceId,
    };
  }
  assertKeys(record, ['status', 'ownerDeviceId', 'transferId', 'sourceDeviceId']);
  const ownerDeviceId = parseDeviceId(record.ownerDeviceId, 'ownerDeviceId');
  const sourceDeviceId = parseDeviceId(record.sourceDeviceId, 'sourceDeviceId');
  if (ownerDeviceId === sourceDeviceId) throw invalid('importing devices must differ');
  return {
    status,
    ownerDeviceId,
    transferId: parseUuid(record.transferId, 'transferId'),
    sourceDeviceId,
  };
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw invalid(`${label} must be a boolean`);
}

function assertVersion(record: Record<string, unknown>): void {
  if (record.schemaVersion !== LAUNCHER_SCHEMA_VERSION) throw invalid('unsupported schemaVersion');
}

function assertKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw invalid(`unknown field: ${key}`);
  }
}

function asStrictRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`Expected ${label} object`);
  }
  return value as Record<string, unknown>;
}

function parseArray(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${label} must be an array`);
  if (value.length > max) throw tooLarge(`${label} exceeds its limit`);
  return value;
}

function parseName(value: unknown, label: string): string {
  return parseBoundedString(value, label, LAUNCHER_LIMITS.maxNameBytes);
}

function parseBoundedString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim())
    throw invalid(`${label} must be a non-empty string`);
  if (new TextEncoder().encode(value).byteLength > maxBytes)
    throw tooLarge(`${label} exceeds its limit`);
  return value;
}

function parseUuid(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    throw invalid(`${label} must be a UUID v4`);
  }
  return value;
}

function parseDeviceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw invalid(`${label} must be a device ID`);
  return value;
}

function parseDigest(value: unknown, label: string): string {
  return parseHex(value, 64, label);
}

function parseHex(value: unknown, length: number, label: string): string {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw invalid(`${label} must be lowercase hexadecimal`);
  }
  return value;
}

function parseOrigin(value: unknown): string {
  const origin = parseBoundedString(value, 'origin', LAUNCHER_LIMITS.maxOriginBytes);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw invalid('origin must be an absolute URL');
  }
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'http:' && url.protocol !== 'https:')
  ) {
    throw invalid('origin must be an HTTP origin');
  }
  return origin;
}

function parsePem(value: unknown, label: string): string {
  const pem = parseBoundedString(value, label, 16 * 1024);
  if (!pem.includes('BEGIN PUBLIC KEY') || !pem.includes('END PUBLIC KEY')) {
    throw invalid(`${label} must contain a public key PEM`);
  }
  return pem;
}

function parseTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw invalid(`${label} must be an ISO timestamp`);
  return value;
}

function parseSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalid(`${label} must be a non-negative integer`);
  return value;
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value))
    throw invalid(`${label} has an invalid value`);
  return value as T[number];
}

function invalid(message: string): WebContractError {
  return new WebContractError('invalid-input', message);
}

function tooLarge(message: string): WebContractError {
  return new WebContractError('too-large', message);
}
