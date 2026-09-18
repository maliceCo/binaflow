import type {
  WebApiSuccess,
  WebDeviceSummaryDto,
  WebExecutionArtifactDto,
  WebExecutionPreviewDto,
  WebExecutionProgressDto,
  WebExecutionResumePreviewDto,
  WebLauncherSettingsDto,
  WebMessagePageResponse,
  WebMessageDto,
  WebOperationDto,
  WebPairingDto,
  WebProjectDirectoryDto,
  WebProjectDirectoryPageDto,
  WebProjectSummaryDto,
  WebProjectCurrentDto,
  WebSessionDto,
  WebSettingsUpdateDto,
  WebSetupRootCandidateDto,
  WebSourcePageResponse,
  WebSourceDto,
  WebTaskDetailDto,
  WebTaskListResponse,
  WebTaskDto,
  WebTransferDto,
  WebItemsResponse,
} from '../api-contract.js';

export type ApiSuccess<T> = WebApiSuccess<T>;
export type SessionData = WebSessionDto;
export type Message = WebMessageDto;
export type Source = WebSourceDto;
export type TaskDetail = WebTaskDetailDto;
export type Task = WebTaskDto;
export type Operation = WebOperationDto;
export type LauncherSettings = WebLauncherSettingsDto;
export type ProjectSummary = WebProjectSummaryDto;
export type SetupRootCandidate = WebSetupRootCandidateDto;
export type ProjectDirectory = WebProjectDirectoryDto;
export type DeviceSummary = WebDeviceSummaryDto;
export type ExecutionPreview = WebExecutionPreviewDto;
export type ExecutionResumePreview = WebExecutionResumePreviewDto;
export type ExecutionArtifact = WebExecutionArtifactDto;
export type ExecutionProgress = WebExecutionProgressDto;
export type TransferStatus = WebTransferDto;
export type ProjectDirectoryPage = WebProjectDirectoryPageDto;
export type Pairing = WebPairingDto;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiClient {
  session(): Promise<SessionData>;
  login(code: string): Promise<SessionData>;
  logout(): Promise<void>;
  listTasks(): Promise<Task[]>;
  createTask(objective: string, contractId?: string): Promise<Task>;
  getTaskDetail(taskId: string): Promise<TaskDetail>;
  listMessages(
    taskId: string,
    afterSequence?: number,
  ): Promise<{ items: Message[]; nextCursor?: number }>;
  listSources(
    taskId: string,
    afterSequence?: number,
  ): Promise<{ items: Source[]; nextCursor?: number }>;
  getSettings(): Promise<LauncherSettings>;
  updateSettings(input: unknown): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  uploadTls(certificatePem: string, keyPem: string): Promise<LauncherSettings>;
  listProjects(): Promise<ProjectSummary[]>;
  listProjectRoots(): Promise<Array<{ id: string; label: string }>>;
  listSetupRoots?(): Promise<SetupRootCandidate[]>;
  authorizeSetupRoot?(
    candidateId: string,
  ): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  revokeProjectRoot?(
    rootId: string,
  ): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  listProjectDirectory(
    rootId: string,
    segments: string[],
    offset?: number,
  ): Promise<{
    hasBinaflowConfig: boolean;
    items: ProjectDirectory[];
    nextOffset: number | null;
  }>;
  registerProject(rootId: string, segments: string[], projectId?: string): Promise<ProjectSummary>;
  getActiveProject(): Promise<ProjectSummary | null>;
  selectProject(projectId: string): Promise<ProjectSummary>;
  closeActiveProject(): Promise<void>;
  listDevices(): Promise<DeviceSummary[]>;
  beginPairing(): Promise<{ pairingId: string; code: string; deviceId: string; expiresAt: number }>;
  revokeDevice(deviceId: string): Promise<void>;
  previewTransfer(input: Record<string, unknown>): Promise<unknown>;
  startTransfer(input: Record<string, unknown>): Promise<TransferStatus>;
  getTransfer(transferId: string): Promise<TransferStatus>;
  resumeTransfer(transferId: string): Promise<TransferStatus>;
  execute(taskId: string, operation: unknown): Promise<Operation>;
  recover(taskId: string, requestId: string): Promise<Operation>;
  previewTaskExecution(
    taskId: string,
    expectedRevision: number,
    todoVersion: number,
  ): Promise<ExecutionPreview>;
  startTaskExecution(input: {
    requestId: string;
    contractId: string;
    expectedRevision: number;
    todoVersion: number;
    previewDigest: string;
  }): Promise<ExecutionProgress>;
  getTaskExecution(taskId: string): Promise<ExecutionProgress | null>;
  previewTaskExecutionResume(runId: string): Promise<ExecutionResumePreview>;
  cancelTaskExecution(runId: string, reason: string): Promise<ExecutionProgress>;
  resumeTaskExecution(input: {
    runId: string;
    expectedRevision: number;
    previewDigest: string;
    decision: string;
    reason: string;
  }): Promise<ExecutionProgress>;
}

export function createApiClient(): ApiClient {
  let csrfToken: string | undefined;

  return {
    async session() {
      const result = await request<SessionData>('/session');
      csrfToken = result.data.csrfToken;
      return result.data;
    },
    async login(code) {
      const result = await request<SessionData>('/login', 'POST', { code });
      csrfToken = result.data.csrfToken;
      return result.data;
    },
    async logout() {
      await request('/logout', 'POST', {}, csrfToken);
      csrfToken = undefined;
    },
    async listTasks() {
      const result = await request<WebTaskListResponse>('/api/v1/tasks');
      return result.data.items;
    },
    async createTask(objective, contractId = crypto.randomUUID()) {
      const result = await request<Task>(
        '/api/v1/tasks',
        'POST',
        { contractId, objective },
        csrfToken,
      );
      return result.data;
    },
    async getTaskDetail(taskId) {
      const result = await request<TaskDetail>(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
      return result.data;
    },
    async listMessages(taskId, afterSequence) {
      const query = afterSequence === undefined ? '' : `?afterSequence=${afterSequence}`;
      const result = await request<WebMessagePageResponse>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/messages${query}`,
      );
      return result.data;
    },
    async listSources(taskId, afterSequence) {
      const query = afterSequence === undefined ? '' : `?afterSequence=${afterSequence}`;
      const result = await request<WebSourcePageResponse>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/sources${query}`,
      );
      return result.data;
    },
    async getSettings() {
      const result = await request<LauncherSettings>('/api/v1/settings');
      return result.data;
    },
    async updateSettings(input) {
      const result = await request<WebSettingsUpdateDto>(
        '/api/v1/settings',
        'PUT',
        input,
        csrfToken,
      );
      return result.data;
    },
    async uploadTls(certificatePem, keyPem) {
      const result = await request<WebSettingsUpdateDto>(
        '/api/v1/settings/tls',
        'POST',
        { certificatePem, keyPem },
        csrfToken,
      );
      return result.data.settings;
    },
    async listProjects() {
      const result = await request<WebItemsResponse<ProjectSummary>>('/api/v1/projects');
      return result.data.items;
    },
    async listProjectRoots() {
      const result =
        await request<WebItemsResponse<{ id: string; label: string }>>('/api/v1/project-roots');
      return result.data.items;
    },
    async listSetupRoots() {
      const result = await request<WebItemsResponse<SetupRootCandidate>>('/api/v1/setup-roots');
      return result.data.items;
    },
    async authorizeSetupRoot(candidateId) {
      const result = await request<WebSettingsUpdateDto>(
        '/api/v1/setup-roots',
        'POST',
        { candidateId },
        csrfToken,
      );
      return result.data;
    },
    async revokeProjectRoot(rootId) {
      const result = await request<WebSettingsUpdateDto>(
        `/api/v1/project-roots/${encodeURIComponent(rootId)}`,
        'DELETE',
        {},
        csrfToken,
      );
      return result.data;
    },
    async listProjectDirectory(rootId, segments, offset = 0) {
      const query = new URLSearchParams({ rootId, offset: String(offset), limit: '50' });
      for (const segment of segments) query.append('segment', segment);
      const result = await request<WebProjectDirectoryPageDto>(
        `/api/v1/project-directories?${query.toString()}`,
      );
      return result.data;
    },
    async registerProject(rootId, segments, projectId) {
      const result = await request<ProjectSummary>(
        '/api/v1/projects',
        'POST',
        { rootId, segments, ...(projectId ? { projectId } : {}) },
        csrfToken,
      );
      return result.data;
    },
    async getActiveProject() {
      const result = await request<WebProjectCurrentDto>('/api/v1/projects/current');
      return result.data.project;
    },
    async selectProject(projectId) {
      const result = await request<ProjectSummary>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/select`,
        'POST',
        {},
        csrfToken,
      );
      return result.data;
    },
    async closeActiveProject() {
      await request('/api/v1/projects/current/close', 'POST', {}, csrfToken);
    },
    async listDevices() {
      const result = await request<WebItemsResponse<DeviceSummary>>('/api/v1/devices');
      return result.data.items;
    },
    async beginPairing() {
      const result = await request<WebPairingDto>('/api/v1/devices/pairing', 'POST', {}, csrfToken);
      return result.data;
    },
    async revokeDevice(deviceId) {
      await request('/api/v1/devices/revoke', 'POST', { deviceId }, csrfToken);
    },
    async previewTransfer(input) {
      const result = await request<unknown>('/api/v1/transfers/preview', 'POST', input, csrfToken);
      return result.data;
    },
    async startTransfer(input) {
      const result = await request<TransferStatus>('/api/v1/transfers', 'POST', input, csrfToken);
      return result.data;
    },
    async getTransfer(transferId) {
      const result = await request<TransferStatus>(
        `/api/v1/transfers/${encodeURIComponent(transferId)}`,
      );
      return result.data;
    },
    async resumeTransfer(transferId) {
      const result = await request<TransferStatus>(
        `/api/v1/transfers/${encodeURIComponent(transferId)}`,
        'POST',
        {},
        csrfToken,
      );
      return result.data;
    },
    async execute(taskId, operation) {
      const result = await request<Operation>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/operations`,
        'POST',
        { operation },
        csrfToken,
      );
      return result.data;
    },
    async recover(taskId, requestId) {
      const result = await request<Operation>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/operations/${encodeURIComponent(requestId)}/recover`,
        'POST',
        {},
        csrfToken,
      );
      return result.data;
    },
    async previewTaskExecution(taskId, expectedRevision, todoVersion) {
      const result = await request<ExecutionPreview>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/execution/preview`,
        'POST',
        { expectedRevision, todoVersion },
        csrfToken,
      );
      return result.data;
    },
    async startTaskExecution(input) {
      const result = await request<ExecutionProgress>(
        `/api/v1/tasks/${encodeURIComponent(input.contractId)}/execution`,
        'POST',
        input,
        csrfToken,
      );
      return result.data;
    },
    async getTaskExecution(taskId) {
      const result = await request<ExecutionProgress | null>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/execution`,
      );
      return result.data;
    },
    async previewTaskExecutionResume(runId) {
      const result = await request<ExecutionResumePreview>(
        `/api/v1/executions/${encodeURIComponent(runId)}/resume/preview`,
      );
      return result.data;
    },
    async cancelTaskExecution(runId, reason) {
      const result = await request<ExecutionProgress>(
        `/api/v1/executions/${encodeURIComponent(runId)}/cancel`,
        'POST',
        { reason },
        csrfToken,
      );
      return result.data;
    },
    async resumeTaskExecution(input) {
      const result = await request<ExecutionProgress>(
        `/api/v1/executions/${encodeURIComponent(input.runId)}/resume`,
        'POST',
        input,
        csrfToken,
      );
      return result.data;
    },
  };
}

async function request<T = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
  csrf?: string,
): Promise<ApiSuccess<T>> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload: (ApiSuccess<T> & { error?: { code?: string; message?: string } }) | undefined;
  try {
    payload = (await response.json()) as ApiSuccess<T> & {
      error?: { code?: string; message?: string };
    };
  } catch {
    throw new ApiRequestError(
      response.status,
      'invalid-response',
      `Request failed (${response.status})`,
    );
  }
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      payload.error?.code ?? 'request-failed',
      payload.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
