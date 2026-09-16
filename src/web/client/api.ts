export interface ApiSuccess<T> {
  version: 1;
  data: T;
}

export interface SessionData {
  authenticated: boolean;
  csrfToken?: string;
}

export interface Message {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Source {
  id: string;
  sequence: number;
  kind: 'search-result' | 'page';
  url: string;
  title: string;
  excerpt: string;
  query?: string;
  retrievedAt: string;
  truncated: boolean;
}

export interface TaskDetail extends Task {
  currentBrief: {
    objective: string;
    conclusions: string[];
    constraints: string[];
    outOfScope: string[];
  };
  messages: Message[];
  sources: Source[];
  preparationRevision: number;
  lastSequence: number;
  confirmedSourceIds: string[];
  activeOperation: Operation | null;
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
  peerTransport?: {
    mode: 'off' | 'lan-experimental';
    host: string;
    port: number;
    warningAccepted: boolean;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  ownership: string;
  updatedAt: string;
}

export interface SetupRootCandidate {
  id: string;
  label: string;
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

export interface ExecutionPreview {
  digest: string;
  todoFileName: 'TODO.md';
  gitClean: boolean;
  blockerCount: number;
}

export interface ExecutionArtifact {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: 'json' | 'text';
  mediaType: string;
  sizeBytes: number;
}

export interface ExecutionProgress {
  runId: string;
  contractId: string;
  revision: number;
  stage: 'execution' | 'changes-review';
  status: string;
  phases: Array<{
    id: string;
    ordinal: number;
    title: string;
    status: string;
    tasks: Array<{
      id: string;
      status: string;
      attempt: number;
      resultArtifact?: ExecutionArtifact;
      verificationArtifact?: ExecutionArtifact;
    }>;
    commitSha?: string;
    noChanges?: boolean;
  }>;
  activeBlock: { type: string; reason: string; evidence: ExecutionArtifact[] } | null;
  nextAction: 'execute' | 'review-changes' | 'resume' | 'cancel' | 'none';
}

export interface TransferStatus {
  transferId: string;
  projectId: string;
  stage: string;
  bytesSent: number;
  bytesReceived: number;
  totalBytes?: number;
  packageDigest?: string;
  errorCode?: string;
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
  previewTransfer(input: Record<string, unknown>): Promise<unknown>;
  startTransfer(input: Record<string, unknown>): Promise<TransferStatus>;
  getTransfer(transferId: string): Promise<TransferStatus>;
  resumeTransfer(transferId: string): Promise<TransferStatus>;
  execute(taskId: string, operation: unknown): Promise<Operation>;
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
      const result = await request<{ items: Task[]; nextAfterId: string | null }>('/api/v1/tasks');
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
      const result = await request<{ items: Message[]; nextCursor?: number }>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/messages${query}`,
      );
      return result.data;
    },
    async listSources(taskId, afterSequence) {
      const query = afterSequence === undefined ? '' : `?afterSequence=${afterSequence}`;
      const result = await request<{ items: Source[]; nextCursor?: number }>(
        `/api/v1/tasks/${encodeURIComponent(taskId)}/sources${query}`,
      );
      return result.data;
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
    async listSetupRoots() {
      const result = await request<{ items: SetupRootCandidate[] }>('/api/v1/setup-roots');
      return result.data.items;
    },
    async authorizeSetupRoot(candidateId) {
      const result = await request<{
        settings: LauncherSettings;
        restartRequired: boolean;
      }>('/api/v1/setup-roots', 'POST', { candidateId }, csrfToken);
      return result.data;
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
  const payload = (await response.json()) as ApiSuccess<T> & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(payload.error?.message ?? `Request failed (${response.status})`);
  return payload;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
