import type { ChangeSet } from '../application/change-set.js';
import type {
  GuidedPreparationOperationRequest,
  GuidedPreparationRequestStatus,
} from '../application/guided-preparation.js';
import type {
  TaskContractBrief,
  TaskContractDocumentHeader,
  TaskContractPlan,
  TaskContractReadiness,
} from '../application/task-contract.js';

export type { ChangeSet } from '../application/change-set.js';

export const WEB_API_VERSION = 1 as const;

export interface WebApiSuccess<T> {
  version: typeof WEB_API_VERSION;
  data: T;
}

export interface WebApiError {
  version: typeof WEB_API_VERSION;
  error: { code: string; message: string };
}

export interface WebSessionDto {
  authenticated: boolean;
  csrfToken?: string;
}

export interface WebTaskDto {
  id: string;
  revision: number;
  readiness: TaskContractReadiness;
  phase: 'exploration' | 'planning' | 'todo';
  brief: TaskContractDocumentHeader;
  plan: TaskContractDocumentHeader | null;
  approvedPlan: TaskContractDocumentHeader | null;
  todo: TaskContractDocumentHeader | null;
  executionRunId?: string;
}

export interface WebMessageDto {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: {
    questions: string[];
    citedSourceIds: string[];
    briefSuggestion?: TaskContractBrief;
  };
}

export interface WebSourceDto {
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

export interface WebOperationDto {
  requestId: string;
  operationId: string;
  kind: string;
  status: GuidedPreparationRequestStatus;
  errorCode?: string;
  publishedDocumentId?: string;
  result?: unknown;
}

export interface WebTaskDetailDto extends WebTaskDto {
  currentBrief: TaskContractBrief;
  draftBrief: TaskContractBrief;
  planDocument: TaskContractPlan | null;
  briefConfirmedThroughSequence: number;
  messagesCompactedThroughSequence: number;
  sessionRecoveredAt?: string;
  messages: WebMessageDto[];
  sources: WebSourceDto[];
  preparationRevision: number;
  lastSequence: number;
  confirmedSourceIds: string[];
  activeOperation: WebOperationDto | null;
}

export interface WebTaskCreateRequest {
  contractId: string;
  objective: string;
}

export interface WebOperationRequest {
  operation: GuidedPreparationOperationRequest;
}

export interface WebTaskListResponse {
  items: WebTaskDto[];
  nextAfterId: string | null;
}

export interface WebMessagePageResponse {
  items: WebMessageDto[];
  nextCursor?: number;
}

export interface WebSourcePageResponse {
  items: WebSourceDto[];
  nextCursor?: number;
}

export interface WebLauncherSettingsDto {
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

export type WebProjectOwnershipStatus = 'active' | 'exporting' | 'exported' | 'importing';

export interface WebProjectSummaryDto {
  id: string;
  name: string;
  ownership: WebProjectOwnershipStatus;
  updatedAt: string;
}

export interface WebSetupRootCandidateDto {
  id: string;
  label: string;
}

export interface WebProjectDirectoryDto {
  name: string;
  segments: string[];
  hasBinaflowConfig: boolean;
}

export interface WebProjectDirectoryPageDto {
  hasBinaflowConfig: boolean;
  items: WebProjectDirectoryDto[];
  nextOffset: number | null;
}

export interface WebLocalFilesystemRootDto {
  label: string;
  path: string;
}

export interface WebLocalDirectoryItemDto {
  name: string;
  path: string;
  hasBinaflowConfig: boolean;
}

export interface WebAgentSkillOptionDto {
  name: string;
  description: string;
  path: string;
  source: 'project' | 'global';
}

export interface WebAgentOptionsDto {
  models: Array<{ provider: string; model: string; displayName?: string }>;
  thinkingLevels: string[];
  tools: Array<{
    id: string;
    label: string;
    description: string;
    writeCapable: boolean;
  }>;
  skills: WebAgentSkillOptionDto[];
}

export interface WebLocalDirectoryPageDto {
  currentPath: string;
  parentPath: string | null;
  hasBinaflowConfig: boolean;
  items: WebLocalDirectoryItemDto[];
  nextOffset: number | null;
}

export type WebDeviceStatus = 'paired' | 'revoked';

export interface WebDeviceSummaryDto {
  id: string;
  name: string;
  status: WebDeviceStatus;
}

export interface WebPairingDto {
  pairingId: string;
  code: string;
  deviceId: string;
  expiresAt: number;
}

export interface WebTransferDto {
  transferId: string;
  projectId: string;
  stage: string;
  bytesSent: number;
  bytesReceived: number;
  totalBytes?: number;
  packageDigest?: string;
  errorCode?: string;
}

export interface WebTransferPreviewDto {
  transferId: string;
  requestId: string;
  projectId: string;
  blockers: string[];
  digest?: string;
  totalBytes?: number;
}

export type WebTransferStatus =
  'pending' | 'exporting' | 'importing' | 'completed' | 'failed' | 'interrupted';

export interface WebTransferSummaryDto {
  id: string;
  projectId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  status: WebTransferStatus;
  receivedBytes: number;
}

export interface WebExecutionPreviewDto {
  digest: string;
  todoFileName: 'TODO.md';
  gitClean: boolean;
  blockerCount: number;
}

export interface WebExecutionResumePreviewDto {
  runId: string;
  revision: number;
  status: string;
  allowedDecisions: string[];
  digest: string;
}

export interface WebExecutionArtifactDto {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: 'json' | 'text';
  mediaType: string;
  sizeBytes: number;
}

export interface WebExecutionProgressDto {
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
      phaseId: string;
      ordinal: number;
      status: string;
      attempt: number;
      agentStepId?: string;
      resultArtifact?: WebExecutionArtifactDto;
      verificationArtifact?: WebExecutionArtifactDto;
    }>;
    commitSha?: string;
    noChanges?: boolean;
  }>;
  activeBlock: {
    id: string;
    revision: number;
    phaseId: string;
    taskId?: string;
    type: string;
    reason: string;
    evidence: WebExecutionArtifactDto[];
  } | null;
  nextAction: 'execute' | 'review-changes' | 'resume' | 'cancel' | 'none';
  changeSet?: ChangeSet;
}

export interface WebSettingsUpdateDto {
  settings: WebLauncherSettingsDto;
  restartRequired: boolean;
}

export interface WebProjectCurrentDto {
  project: WebProjectSummaryDto | null;
}

export interface WebItemsResponse<T> {
  items: T[];
}
