import { isIP } from 'node:net';
import type {
  GuidedExecutionService,
  GuidedResumeRequest,
  GuidedStartRequest,
} from '../application/guided-execution.js';
import type { GuidedPreparationService } from '../application/guided-preparation-operations.js';
import type { TaskContractBrief, TaskContractService } from '../application/task-contract.js';
import {
  parseWebOperationRequest,
  parseWebTaskCreateRequest,
  type WebApiError,
  type WebApiSuccess,
  type WebMessageDto,
  type WebSourceDto,
  type WebTaskDetailDto,
  WebContractError,
} from './contracts.js';
import {
  parseDeviceRecord,
  parseLauncherSettings,
  toWebDeviceSummaryDto,
  toWebLauncherSettingsDto,
  toWebProjectSummaryDto,
  type DeviceRecord,
  type LauncherSettings,
  type ProjectCatalogEntry,
} from './launcher-contracts.js';
import type { PairingOffer } from './peer-auth.js';
import type { ProjectDirectoryListing } from './project-catalog.js';
import {
  toWebGuidedExecutionProgress,
  toWebOperationDto,
  toWebTaskDto,
  toWebTransferDto,
  toWebTransferPreviewDto,
} from './dto.js';

export interface WebSettingsCapabilities {
  readonly get: () => LauncherSettings;
  readonly update: (
    value: unknown,
  ) => Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  readonly importTlsMaterial: (
    certificatePem: string,
    keyPem: string,
  ) => Promise<{ certFile: string; keyFile: string }>;
}

export interface WebTransferCapabilities {
  readonly preview: (value: unknown) => Promise<unknown>;
  readonly start: (value: unknown) => Promise<unknown>;
  readonly status: (transferId: string) => Promise<unknown>;
  readonly resume: (transferId: string) => Promise<unknown>;
}

export interface WebDeviceCapabilities {
  readonly list: () => DeviceRecord[];
  readonly beginPairing: () => PairingOffer;
  readonly confirmPeer: (record: DeviceRecord, expectedFingerprint?: string) => DeviceRecord;
  readonly revokePeer: (deviceId: string) => void;
}

export interface WebExecutionCapabilities {
  readonly previewStart: GuidedExecutionService['previewStart'];
  readonly previewResume: GuidedExecutionService['previewResume'];
  readonly get: GuidedExecutionService['get'];
  readonly list: GuidedExecutionService['list'];
  readonly start: GuidedExecutionService['start'];
  readonly resume: GuidedExecutionService['resume'];
  readonly cancelWaiting: GuidedExecutionService['cancelWaiting'];
}

export interface WebProjectRuntimeCapabilities {
  readonly getActiveProject: () => ProjectCatalogEntry | undefined;
  readonly selectProject: (projectId: string) => Promise<ProjectCatalogEntry>;
  readonly closeActiveProject: () => Promise<void>;
}

export interface WebApiCapabilities {
  readonly settings?: WebSettingsCapabilities;
  readonly devices?: WebDeviceCapabilities;
  readonly transfers?: WebTransferCapabilities;
  readonly projectRuntime?: WebProjectRuntimeCapabilities;
  readonly projectCatalog?: {
    getRoots: () => Array<{ id: string; label: string }>;
    listSetupRoots?: () => Promise<Array<{ id: string; label: string }>>;
    authorizeSetupRoot?: (
      candidateId: string,
    ) => Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
    listProjects: () => Promise<ProjectCatalogEntry[]>;
    listDirectory: (
      rootId: string,
      segments: string[],
      offset: number,
      limit: number,
    ) => Promise<ProjectDirectoryListing>;
    register: (
      rootId: string,
      segments: string[],
      projectId?: string,
    ) => Promise<ProjectCatalogEntry>;
  };
  readonly taskContracts?: Pick<TaskContractService, 'list' | 'get' | 'create'> &
    Partial<Pick<TaskContractService, 'getDocument'>>;
  readonly guidedPreparation?: {
    execute: GuidedPreparationService['execute'];
    create?: GuidedPreparationService['create'];
    getState?: GuidedPreparationService['getState'];
    listMessages?: GuidedPreparationService['listMessages'];
    listSources?: GuidedPreparationService['listSources'];
  };
  readonly execution?: WebExecutionCapabilities;
  readonly getTaskDetail?: (contractId: string) => Promise<WebTaskDetailDto>;
  readonly listMessages?: (
    contractId: string,
    afterSequence?: number,
  ) => Promise<{ items: WebMessageDto[]; nextCursor?: number }>;
  readonly listSources?: (
    contractId: string,
    afterSequence?: number,
  ) => Promise<{ items: WebSourceDto[]; nextCursor?: number }>;
}

export interface WebApiRequest {
  method: string;
  path: string;
  body?: unknown;
  query?: URLSearchParams;
  remoteAddress?: string;
}

export type WebApiResponse =
  { status: number; body: WebApiSuccess<unknown> } | { status: number; body: WebApiError };

export async function handleWebApi(
  request: WebApiRequest,
  api: WebApiCapabilities,
): Promise<WebApiResponse> {
  try {
    if (request.path === '/api/v1/transfers/preview' && request.method === 'POST') {
      if (!api.transfers) return unavailable();
      return ok(
        200,
        toWebTransferPreviewDto(await api.transfers.preview(parseTransferCommand(request.body))),
      );
    }
    if (request.path === '/api/v1/transfers' && request.method === 'POST') {
      if (!api.transfers) return unavailable();
      return ok(
        202,
        toWebTransferDto(await api.transfers.start(parseTransferCommand(request.body))),
      );
    }
    const transferId = request.path.match(/^\/api\/v1\/transfers\/([^/]+)$/)?.[1];
    if (transferId && request.method === 'GET') {
      if (!api.transfers) return unavailable();
      return ok(200, toWebTransferDto(await api.transfers.status(transferId)));
    }
    if (transferId && request.method === 'POST') {
      if (!api.transfers) return unavailable();
      if (request.body !== undefined && JSON.stringify(request.body) !== '{}') {
        throw new WebContractError('invalid-input', 'Transfer resume does not accept a body');
      }
      return ok(202, toWebTransferDto(await api.transfers.resume(transferId)));
    }
    if (request.path === '/api/v1/devices' && request.method === 'GET') {
      if (!api.devices) return unavailable();
      return ok(200, { items: api.devices.list().map(toWebDeviceSummaryDto) });
    }
    if (request.path === '/api/v1/devices/pairing' && request.method === 'POST') {
      if (!api.devices) return unavailable();
      if (request.body !== undefined && JSON.stringify(request.body) !== '{}') {
        throw new WebContractError('invalid-input', 'Pairing start does not accept a body');
      }
      return ok(200, api.devices.beginPairing());
    }
    if (request.path === '/api/v1/devices/pairing/confirm' && request.method === 'POST') {
      if (!api.devices) return unavailable();
      const input = parseDeviceConfirmation(request.body);
      return ok(
        200,
        toWebDeviceSummaryDto(api.devices.confirmPeer(input.record, input.expectedFingerprint)),
      );
    }
    if (request.path === '/api/v1/devices/revoke' && request.method === 'POST') {
      if (!api.devices) return unavailable();
      const deviceId = parseDeviceIdBody(request.body);
      api.devices.revokePeer(deviceId);
      return ok(200, { revoked: true });
    }
    if (request.path === '/api/v1/setup-roots' && request.method === 'GET') {
      if (!api.projectCatalog?.listSetupRoots) return unavailable();
      return ok(200, { items: await api.projectCatalog.listSetupRoots() });
    }
    if (request.path === '/api/v1/setup-roots' && request.method === 'POST') {
      if (!api.projectCatalog?.authorizeSetupRoot) return unavailable();
      if (!isLoopbackSettingsRequest(request)) {
        return error(403, 'forbidden', 'Root authorization requires a local connection');
      }
      const result = await api.projectCatalog.authorizeSetupRoot(parseSetupRootBody(request.body));
      return ok(200, {
        settings: toWebLauncherSettingsDto(result.settings),
        restartRequired: result.restartRequired,
      });
    }
    if (request.path === '/api/v1/project-roots' && request.method === 'GET') {
      if (!api.projectCatalog) return unavailable();
      return ok(200, { items: api.projectCatalog.getRoots() });
    }
    if (request.path === '/api/v1/project-directories' && request.method === 'GET') {
      if (!api.projectCatalog) return unavailable();
      const rootId = request.query?.get('rootId');
      if (!rootId) throw new WebContractError('invalid-input', 'rootId is required');
      const segments = request.query?.getAll('segment') ?? [];
      const offset = parseQueryInteger(request.query?.get('offset'), 0);
      const limit = parseQueryInteger(request.query?.get('limit'), 50);
      return ok(200, await api.projectCatalog.listDirectory(rootId, segments, offset, limit));
    }
    if (request.path === '/api/v1/projects' && request.method === 'GET') {
      if (!api.projectCatalog) return unavailable();
      return ok(200, {
        items: (await api.projectCatalog.listProjects()).map(toWebProjectSummaryDto),
      });
    }
    if (request.path === '/api/v1/projects' && request.method === 'POST') {
      if (!api.projectCatalog) return unavailable();
      const input = parseProjectRegistration(request.body);
      const project = await api.projectCatalog.register(
        input.rootId,
        input.segments,
        input.projectId,
      );
      return ok(201, toWebProjectSummaryDto(project));
    }
    if (request.path === '/api/v1/projects/current' && request.method === 'GET') {
      if (!api.projectRuntime) return unavailable();
      const project = api.projectRuntime.getActiveProject();
      return ok(200, { project: project ? toWebProjectSummaryDto(project) : null });
    }
    const selectProjectId = request.path.match(/^\/api\/v1\/projects\/([^/]+)\/select$/)?.[1];
    if (selectProjectId && request.method === 'POST') {
      if (!api.projectRuntime) return unavailable();
      if (request.body !== undefined && JSON.stringify(request.body) !== '{}') {
        throw new WebContractError('invalid-input', 'Project selection does not accept a body');
      }
      return ok(
        200,
        toWebProjectSummaryDto(await api.projectRuntime.selectProject(selectProjectId)),
      );
    }
    if (request.path === '/api/v1/projects/current/close' && request.method === 'POST') {
      if (!api.projectRuntime) return unavailable();
      if (request.body !== undefined && JSON.stringify(request.body) !== '{}') {
        throw new WebContractError('invalid-input', 'Project close does not accept a body');
      }
      await api.projectRuntime.closeActiveProject();
      return ok(200, { project: null });
    }
    if (request.path === '/api/v1/settings' && request.method === 'GET') {
      if (!api.settings) return unavailable();
      return ok(200, toWebLauncherSettingsDto(api.settings.get()));
    }
    if (request.path === '/api/v1/settings' && request.method === 'PUT') {
      if (!api.settings) return unavailable();
      if (!isLoopbackSettingsRequest(request)) {
        return error(403, 'forbidden', 'Settings changes require a local connection');
      }
      const nextSettings = mergeSettingsUpdate(api.settings.get(), request.body);
      if (!nextSettings.setupRequired && nextSettings.projectRoots.length === 0) {
        throw new WebContractError(
          'invalid-input',
          'At least one project root is required before setup can finish',
        );
      }
      const result = await api.settings.update(nextSettings);
      return ok(200, {
        settings: toWebLauncherSettingsDto(result.settings),
        restartRequired: result.restartRequired,
      });
    }
    if (request.path === '/api/v1/settings/tls' && request.method === 'POST') {
      if (!api.settings) return unavailable();
      if (!isLoopbackSettingsRequest(request)) {
        return error(403, 'forbidden', 'Settings changes require a local connection');
      }
      const body = parseTlsUpload(request.body);
      const files = await api.settings.importTlsMaterial(body.certificatePem, body.keyPem);
      const current = api.settings.get();
      const result = await api.settings.update({
        ...current,
        web: { ...current.web, tls: files },
      });
      return ok(200, {
        settings: toWebLauncherSettingsDto(result.settings),
        restartRequired: result.restartRequired,
      });
    }
    const taskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)$/)?.[1];
    const operationTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/operations$/)?.[1];
    if (request.method === 'GET' && request.path === '/api/v1/tasks') {
      if (!api.taskContracts) return unavailable();
      const result = await api.taskContracts.list({});
      const items = await Promise.all(result.items.map((item) => api.taskContracts!.get(item.id)));
      return ok(200, {
        items: items.map(toWebTaskDto),
        nextAfterId: result.nextCursor ?? null,
      });
    }
    if (request.method === 'POST' && request.path === '/api/v1/tasks') {
      if (!api.taskContracts) return unavailable();
      const input = parseWebTaskCreateRequest(request.body);
      const brief: TaskContractBrief = {
        objective: input.objective,
        conclusions: [],
        constraints: [],
        outOfScope: [],
      };
      const task = await api.taskContracts.create({ contractId: input.contractId, brief });
      if (api.guidedPreparation?.create) await api.guidedPreparation.create(input.contractId);
      return ok(201, toWebTaskDto(task));
    }
    const messagesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/messages$/)?.[1];
    if (messagesTaskId && request.method === 'GET') {
      if (!api.listMessages) return unavailable();
      const afterSequence = parseQueryInteger(request.query?.get('afterSequence'), 0);
      return ok(200, await api.listMessages(messagesTaskId, afterSequence || undefined));
    }
    const sourcesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/sources$/)?.[1];
    if (sourcesTaskId && request.method === 'GET') {
      if (!api.listSources) return unavailable();
      const afterSequence = parseQueryInteger(request.query?.get('afterSequence'), 0);
      return ok(200, await api.listSources(sourcesTaskId, afterSequence || undefined));
    }
    if (taskId && request.method === 'GET') {
      if (api.getTaskDetail) return ok(200, await api.getTaskDetail(taskId));
      if (!api.taskContracts) return unavailable();
      return ok(200, toWebTaskDto(await api.taskContracts.get(taskId)));
    }
    if (operationTaskId && request.method === 'POST') {
      if (!api.guidedPreparation) return unavailable();
      const input = parseWebOperationRequest(request.body);
      if (input.operation.contractId !== operationTaskId) {
        throw new WebContractError('invalid-input', 'Operation target does not match the task');
      }
      const result = await api.guidedPreparation.execute(input.operation);
      return ok(202, toWebOperationDto(result));
    }
    const previewTaskId = request.path.match(
      /^\/api\/v1\/tasks\/([^/]+)\/execution\/preview$/,
    )?.[1];
    if (previewTaskId && request.method === 'POST') {
      if (!api.execution) return unavailable();
      const input = parseExecutionPreviewRequest(request.body);
      const preview = await api.execution.previewStart({
        contractId: previewTaskId,
        expectedRevision: input.expectedRevision,
        todoVersion: input.todoVersion,
      });
      return ok(200, {
        digest: preview.digest,
        todoFileName: preview.todoMarkdown.fileName,
        gitClean: preview.git.clean,
        blockerCount: preview.git.changes.length,
      });
    }
    const taskExecutionId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/execution$/)?.[1];
    if (taskExecutionId && request.method === 'POST') {
      if (!api.execution) return unavailable();
      const input = parseExecutionStartRequest(request.body, taskExecutionId);
      return ok(202, toWebGuidedExecutionProgress(await api.execution.start(input)));
    }
    if (taskExecutionId && request.method === 'GET') {
      if (!api.execution) return unavailable();
      const result = await api.execution.list({ contractId: taskExecutionId, limit: 1 });
      const progress = result.items[0];
      return ok(200, progress ? toWebGuidedExecutionProgress(progress) : null);
    }
    const executionId = request.path.match(/^\/api\/v1\/executions\/([^/]+)$/)?.[1];
    if (executionId && request.method === 'GET') {
      if (!api.execution) return unavailable();
      return ok(200, toWebGuidedExecutionProgress(await api.execution.get(executionId)));
    }
    const cancelExecutionId = request.path.match(/^\/api\/v1\/executions\/([^/]+)\/cancel$/)?.[1];
    if (cancelExecutionId && request.method === 'POST') {
      if (!api.execution) return unavailable();
      const reason = parseCancelReason(request.body);
      return ok(
        200,
        toWebGuidedExecutionProgress(await api.execution.cancelWaiting(cancelExecutionId, reason)),
      );
    }
    const resumeExecutionId = request.path.match(/^\/api\/v1\/executions\/([^/]+)\/resume$/)?.[1];
    if (resumeExecutionId && request.method === 'POST') {
      if (!api.execution) return unavailable();
      return ok(
        202,
        toWebGuidedExecutionProgress(
          await api.execution.resume(parseExecutionResumeRequest(request.body, resumeExecutionId)),
        ),
      );
    }
    return error(404, 'unknown-target', 'Not found');
  } catch (cause) {
    return mapError(cause);
  }
}

function ok(status: number, data: unknown): WebApiResponse {
  return { status, body: { version: 1, data } };
}

function error(status: number, code: string, message: string): WebApiResponse {
  return { status, body: { version: 1, error: { code, message } } };
}

function unavailable(): WebApiResponse {
  return error(503, 'unavailable', 'Operation is not available');
}

function isLoopbackSettingsRequest(request: WebApiRequest): boolean {
  return request.remoteAddress !== undefined && isLoopbackAddress(request.remoteAddress);
}

function mergeSettingsUpdate(current: LauncherSettings, value: unknown): LauncherSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebContractError('invalid-input', 'Invalid settings update');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        !['deviceName', 'web', 'projectRoots', 'setupRequired', 'peerTransport'].includes(key),
    )
  ) {
    throw new WebContractError('invalid-input', 'Unknown settings field');
  }
  const web = record.web;
  if (web !== undefined && (typeof web !== 'object' || web === null || Array.isArray(web))) {
    throw new WebContractError('invalid-input', 'Invalid web settings');
  }
  return parseLauncherSettings({
    ...current,
    ...(record.setupRequired === undefined ? {} : { setupRequired: record.setupRequired }),
    ...(record.deviceName === undefined ? {} : { deviceName: record.deviceName }),
    ...(web === undefined ? {} : { web: { ...current.web, ...(web as object) } }),
    ...(record.projectRoots === undefined ? {} : { projectRoots: record.projectRoots }),
    ...(record.peerTransport === undefined ? {} : { peerTransport: record.peerTransport }),
  });
}

function isLoopbackAddress(address: string): boolean {
  if (address === '::ffff:127.0.0.1') return true;
  if (isIP(address) === 4) return address === '127.0.0.1';
  return (
    isIP(address) === 6 && (address === '::1' || address.toLowerCase().startsWith('::ffff:127.'))
  );
}

function parseExecutionPreviewRequest(value: unknown): {
  expectedRevision: number;
  todoVersion: number;
} {
  if (!isRecordValue(value) || !hasOnlyKeysValue(value, ['expectedRevision', 'todoVersion'])) {
    throw new WebContractError('invalid-input', 'Invalid execution preview request');
  }
  if (!positiveIntegerValue(value.expectedRevision) || !positiveIntegerValue(value.todoVersion)) {
    throw new WebContractError('invalid-input', 'Invalid execution preview values');
  }
  return { expectedRevision: value.expectedRevision, todoVersion: value.todoVersion };
}

function parseExecutionStartRequest(value: unknown, contractId: string): GuidedStartRequest {
  if (
    !isRecordValue(value) ||
    !hasOnlyKeysValue(value, [
      'requestId',
      'contractId',
      'expectedRevision',
      'todoVersion',
      'previewDigest',
    ])
  ) {
    throw new WebContractError('invalid-input', 'Invalid execution start request');
  }
  if (
    value.contractId !== contractId ||
    !isUuidValue(value.requestId) ||
    !positiveIntegerValue(value.expectedRevision) ||
    !positiveIntegerValue(value.todoVersion) ||
    typeof value.previewDigest !== 'string' ||
    !value.previewDigest
  ) {
    throw new WebContractError('invalid-input', 'Invalid execution start values');
  }
  return {
    requestId: value.requestId,
    contractId,
    expectedRevision: value.expectedRevision,
    todoVersion: value.todoVersion,
    previewDigest: value.previewDigest,
  };
}

function parseExecutionResumeRequest(value: unknown, runId: string): GuidedResumeRequest {
  if (
    !isRecordValue(value) ||
    !hasOnlyKeysValue(value, ['runId', 'expectedRevision', 'previewDigest', 'decision', 'reason'])
  ) {
    throw new WebContractError('invalid-input', 'Invalid execution resume request');
  }
  const decisions = ['retry-task', 'retry-verification', 'continue', 'reconcile-commit', 'cancel'];
  if (
    value.runId !== runId ||
    !positiveIntegerValue(value.expectedRevision) ||
    typeof value.previewDigest !== 'string' ||
    !value.previewDigest ||
    typeof value.decision !== 'string' ||
    !decisions.includes(value.decision) ||
    typeof value.reason !== 'string' ||
    !value.reason.trim()
  ) {
    throw new WebContractError('invalid-input', 'Invalid execution resume values');
  }
  return {
    runId,
    expectedRevision: value.expectedRevision,
    previewDigest: value.previewDigest,
    decision: value.decision as GuidedResumeRequest['decision'],
    reason: value.reason,
  };
}

function parseCancelReason(value: unknown): string {
  if (!isRecordValue(value) || !hasOnlyKeysValue(value, ['reason'])) {
    throw new WebContractError('invalid-input', 'Invalid execution cancellation request');
  }
  if (typeof value.reason !== 'string' || !value.reason.trim()) {
    throw new WebContractError('invalid-input', 'Cancellation reason is required');
  }
  return value.reason;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeysValue(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function positiveIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isUuidValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

function parseTransferCommand(value: unknown): {
  transferId: string;
  requestId: string;
  projectId: string;
  targetDeviceId: string;
  targetProjectId: string;
  confirmed?: boolean;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebContractError('invalid-input', 'Invalid transfer request');
  }
  const record = value as Record<string, unknown>;
  const allowed = [
    'transferId',
    'requestId',
    'projectId',
    'targetDeviceId',
    'targetProjectId',
    'confirmed',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new WebContractError('invalid-input', 'Unknown transfer request field');
  }
  for (const key of ['transferId', 'requestId', 'projectId', 'targetDeviceId', 'targetProjectId']) {
    if (typeof record[key] !== 'string' || !record[key]) {
      throw new WebContractError('invalid-input', 'Transfer identifiers are required');
    }
  }
  if (record.confirmed !== undefined && typeof record.confirmed !== 'boolean') {
    throw new WebContractError('invalid-input', 'Transfer confirmation is invalid');
  }
  return {
    transferId: record.transferId as string,
    requestId: record.requestId as string,
    projectId: record.projectId as string,
    targetDeviceId: record.targetDeviceId as string,
    targetProjectId: record.targetProjectId as string,
    ...(record.confirmed === undefined ? {} : { confirmed: record.confirmed }),
  };
}

function parseDeviceConfirmation(value: unknown): {
  record: DeviceRecord;
  expectedFingerprint?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebContractError('invalid-input', 'Invalid device confirmation');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['record', 'expectedFingerprint'].includes(key))) {
    throw new WebContractError('invalid-input', 'Unknown device confirmation field');
  }
  if (
    record.expectedFingerprint !== undefined &&
    (typeof record.expectedFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(record.expectedFingerprint))
  ) {
    throw new WebContractError('invalid-input', 'Invalid certificate fingerprint');
  }
  return {
    record: parseDeviceRecord(record.record),
    ...(record.expectedFingerprint === undefined
      ? {}
      : { expectedFingerprint: record.expectedFingerprint }),
  };
}

function parseDeviceIdBody(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as Record<string, unknown>).deviceId !== 'string' ||
    !/^[0-9a-f]{64}$/.test((value as Record<string, unknown>).deviceId as string)
  ) {
    throw new WebContractError('invalid-input', 'Invalid device ID');
  }
  return (value as Record<string, unknown>).deviceId as string;
}

function parseSetupRootBody(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as Record<string, unknown>).candidateId !== 'string' ||
    !/^[a-z0-9-]{1,80}$/.test((value as Record<string, unknown>).candidateId as string)
  ) {
    throw new WebContractError('invalid-input', 'Invalid setup root');
  }
  return (value as Record<string, unknown>).candidateId as string;
}

function parseProjectRegistration(value: unknown): {
  rootId: string;
  segments: string[];
  projectId?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebContractError('invalid-input', 'Invalid project registration');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['rootId', 'segments', 'projectId'].includes(key))) {
    throw new WebContractError('invalid-input', 'Unknown project registration field');
  }
  if (
    typeof record.rootId !== 'string' ||
    !Array.isArray(record.segments) ||
    record.segments.some((segment) => typeof segment !== 'string')
  ) {
    throw new WebContractError('invalid-input', 'Invalid project registration');
  }
  if (record.projectId !== undefined && typeof record.projectId !== 'string') {
    throw new WebContractError('invalid-input', 'Invalid project ID');
  }
  return {
    rootId: record.rootId,
    segments: record.segments,
    ...(record.projectId === undefined ? {} : { projectId: record.projectId }),
  };
}

function parseQueryInteger(value: string | null | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WebContractError('invalid-input', 'Invalid directory pagination');
  }
  return parsed;
}

function parseTlsUpload(value: unknown): { certificatePem: string; keyPem: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'certificatePem' && key !== 'keyPem')
  ) {
    throw new WebContractError('invalid-input', 'Invalid TLS upload');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.certificatePem !== 'string' || typeof record.keyPem !== 'string') {
    throw new WebContractError('invalid-input', 'Invalid TLS upload');
  }
  if (
    new TextEncoder().encode(record.certificatePem).byteLength > 64 * 1024 ||
    new TextEncoder().encode(record.keyPem).byteLength > 64 * 1024
  ) {
    throw new WebContractError('too-large', 'TLS material exceeds its size limit');
  }
  return { certificatePem: record.certificatePem, keyPem: record.keyPem };
}

function mapError(cause: unknown): WebApiResponse {
  if (cause instanceof WebContractError)
    return error(cause.code === 'too-large' ? 413 : 400, cause.code, cause.message);
  const code =
    cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : undefined;
  const publicCode = isPublicErrorCode(code) ? code : 'operation-failed';
  return error(publicErrorStatus(publicCode), publicCode, publicErrorMessage(publicCode));
}

const PUBLIC_ERROR_MESSAGES = {
  'invalid-input': 'Invalid request',
  'too-large': 'Request is too large',
  'invalid-target': 'The requested resource was not found',
  'not-found': 'The requested resource was not found',
  conflict: 'The operation conflicts with the current state',
  'stale-revision': 'The resource changed; refresh and try again',
  'project-busy': 'The project is busy',
  'project-inactive': 'The project is not active',
  'runtime-closed': 'The web runtime is closed',
  'preflight-failed': 'The transfer preflight failed',
  'import-preflight-failed': 'The transfer import preflight failed',
  'operation-failed': 'Operation failed',
} as const;

type PublicErrorCode = keyof typeof PUBLIC_ERROR_MESSAGES;

function isPublicErrorCode(code: string | undefined): code is PublicErrorCode {
  return code !== undefined && code in PUBLIC_ERROR_MESSAGES;
}

function publicErrorStatus(code: PublicErrorCode): number {
  if (code === 'invalid-input') return 400;
  if (code === 'too-large') return 413;
  if (code === 'invalid-target' || code === 'not-found') return 404;
  if (
    code === 'conflict' ||
    code === 'stale-revision' ||
    code === 'project-busy' ||
    code === 'project-inactive' ||
    code === 'runtime-closed'
  )
    return 409;
  return 422;
}

function publicErrorMessage(code: PublicErrorCode): string {
  return PUBLIC_ERROR_MESSAGES[code];
}
