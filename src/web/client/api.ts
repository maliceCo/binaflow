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

export interface ApiClient {
  session(): Promise<SessionData>;
  login(code: string): Promise<SessionData>;
  logout(): Promise<void>;
  listTasks(): Promise<Task[]>;
  getSettings(): Promise<LauncherSettings>;
  updateSettings(input: unknown): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  uploadTls(certificatePem: string, keyPem: string): Promise<LauncherSettings>;
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
