export interface ApiSuccess<T> {
  version: 1;
  data: T;
}

export interface SessionData {
  authenticated: boolean;
  csrfToken?: string;
}

export interface Task {
  id: string;
  revision: number;
  readiness: string;
  phase: string;
  brief: { id: string; version: number; createdAt: string };
  plan: { id: string; version: number; createdAt: string } | null;
  approvedPlan: { id: string; version: number; createdAt: string } | null;
  todo: { id: string; version: number; createdAt: string } | null;
  executionRunId?: string;
}

export interface Operation {
  requestId: string;
  operationId: string;
  kind: string;
  status: string;
  errorCode?: string;
}

export interface LauncherSettings {
  setupRequired: boolean;
  deviceName: string;
  web: { host: string; port: number; origin: string; tlsConfigured: boolean };
  projectRoots: Array<{ id: string; label: string }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  ownership: string;
  updatedAt: string;
}

export interface ProjectDirectory {
  name: string;
  segments: string[];
  hasBinaflowConfig: boolean;
}

export interface DeviceSummary {
  id: string;
  name: string;
  status: 'paired' | 'revoked';
}

export interface ApiClient {
  session(): Promise<SessionData>;
  login(code: string): Promise<SessionData>;
  logout(): Promise<void>;
  listTasks(): Promise<Task[]>;
  getSettings(): Promise<LauncherSettings>;
  updateSettings(input: unknown): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  uploadTls(certificatePem: string, keyPem: string): Promise<LauncherSettings>;
  listProjects(): Promise<ProjectSummary[]>;
  listProjectRoots(): Promise<Array<{ id: string; label: string }>>;
  listProjectDirectory(
    rootId: string,
    segments: string[],
    offset?: number,
  ): Promise<{ items: ProjectDirectory[]; nextOffset: number | null }>;
  registerProject(rootId: string, segments: string[], projectId?: string): Promise<ProjectSummary>;
  getActiveProject(): Promise<ProjectSummary | null>;
  selectProject(projectId: string): Promise<ProjectSummary>;
  closeActiveProject(): Promise<void>;
  listDevices(): Promise<DeviceSummary[]>;
  beginPairing(): Promise<{ pairingId: string; code: string; deviceId: string; expiresAt: number }>;
  revokeDevice(deviceId: string): Promise<void>;
  execute(taskId: string, operation: unknown): Promise<Operation>;
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
      const result = await request<{ items: Task[]; nextAfterId: string | null }>('/api/v1/tasks');
      return result.data.items;
    },
    async getSettings() {
      const result = await request<LauncherSettings>('/api/v1/settings');
      return result.data;
    },
    async updateSettings(input) {
      const result = await request<{ settings: LauncherSettings; restartRequired: boolean }>(
        '/api/v1/settings',
        'PUT',
        input,
        csrfToken,
      );
      return result.data;
    },
    async uploadTls(certificatePem, keyPem) {
      const result = await request<{ settings: LauncherSettings; restartRequired: boolean }>(
        '/api/v1/settings/tls',
        'POST',
        { certificatePem, keyPem },
        csrfToken,
      );
      return result.data.settings;
    },
    async listProjects() {
      const result = await request<{ items: ProjectSummary[] }>('/api/v1/projects');
      return result.data.items;
    },
    async listProjectRoots() {
      const result = await request<{ items: Array<{ id: string; label: string }> }>(
        '/api/v1/project-roots',
      );
      return result.data.items;
    },
    async listProjectDirectory(rootId, segments, offset = 0) {
      const query = new URLSearchParams({ rootId, offset: String(offset), limit: '50' });
      for (const segment of segments) query.append('segment', segment);
      const result = await request<{ items: ProjectDirectory[]; nextOffset: number | null }>(
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
      const result = await request<{ project: ProjectSummary | null }>('/api/v1/projects/current');
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
      const result = await request<{ items: DeviceSummary[] }>('/api/v1/devices');
      return result.data.items;
    },
    async beginPairing() {
      const result = await request<{
        pairingId: string;
        code: string;
        deviceId: string;
        expiresAt: number;
      }>('/api/v1/devices/pairing', 'POST', {}, csrfToken);
      return result.data;
    },
    async revokeDevice(deviceId) {
      await request('/api/v1/devices/revoke', 'POST', { deviceId }, csrfToken);
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
  const payload = (await response.json()) as ApiSuccess<T> & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(payload.error?.message ?? `Request failed (${response.status})`);
  return payload;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
