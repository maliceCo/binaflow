import { isIP } from 'node:net';
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
  parseLauncherSettings,
  toWebLauncherSettingsDto,
  toWebProjectSummaryDto,
  type LauncherSettings,
  type ProjectCatalogEntry,
} from './launcher-contracts.js';
import type { ProjectDirectoryListing } from './project-catalog.js';
import { toWebOperationDto, toWebTaskDto } from './dto.js';

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

export interface WebProjectRuntimeCapabilities {
  readonly getActiveProject: () => ProjectCatalogEntry | undefined;
  readonly selectProject: (projectId: string) => Promise<ProjectCatalogEntry>;
  readonly closeActiveProject: () => Promise<void>;
}

export interface WebApiCapabilities {
  readonly settings?: WebSettingsCapabilities;
  readonly projectRuntime?: WebProjectRuntimeCapabilities;
  readonly projectCatalog?: {
    getRoots: () => Array<{ id: string; label: string }>;
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
  readonly taskContracts?: Pick<TaskContractService, 'list' | 'get' | 'create'>;
  readonly guidedPreparation?: Pick<GuidedPreparationService, 'execute'>;
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
      const result = await api.settings.update(
        mergeSettingsUpdate(api.settings.get(), request.body),
      );
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
      return ok(
        201,
        toWebTaskDto(await api.taskContracts.create({ contractId: input.contractId, brief })),
      );
    }
    const messagesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/messages$/)?.[1];
    if (messagesTaskId && request.method === 'GET') {
      if (!api.listMessages) return unavailable();
      return ok(200, await api.listMessages(messagesTaskId));
    }
    const sourcesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/sources$/)?.[1];
    if (sourcesTaskId && request.method === 'GET') {
      if (!api.listSources) return unavailable();
      return ok(200, await api.listSources(sourcesTaskId));
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
  return request.remoteAddress === undefined || isLoopbackAddress(request.remoteAddress);
}

function mergeSettingsUpdate(current: LauncherSettings, value: unknown): LauncherSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebContractError('invalid-input', 'Invalid settings update');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['deviceName', 'web', 'projectRoots', 'setupRequired'].includes(key),
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
  });
}

function isLoopbackAddress(address: string): boolean {
  if (address === '::ffff:127.0.0.1') return true;
  if (isIP(address) === 4) return address === '127.0.0.1';
  return (
    isIP(address) === 6 && (address === '::1' || address.toLowerCase().startsWith('::ffff:127.'))
  );
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
      : 'operation-failed';
  const status =
    code === 'invalid-target' || code === 'not-found'
      ? 404
      : code === 'conflict' ||
          code === 'stale-revision' ||
          code === 'project-busy' ||
          code === 'project-inactive'
        ? 409
        : 422;
  return error(status, code, cause instanceof Error ? cause.message : 'Operation failed');
}
