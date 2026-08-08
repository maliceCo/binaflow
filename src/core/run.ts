export type RunStatus =
  'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type StepStatus = RunStatus | 'skipped';

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  objective: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StepRun {
  runId: string;
  stepId: string;
  profile: string;
  status: StepStatus;
  attempt: number;
  profileSnapshot?: AgentProfileSnapshot;
  startedAt?: string;
  finishedAt?: string;
  result?: AgentStepResult;
  disposition?: StepDisposition;
  skipReason?: StepSkipReason;
  error?: StepError;
  approval?: ApprovalDecision;
}

export interface AgentProfileSnapshot {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: 'read-only' | 'read-write';
  projectTrust?: 'never' | 'always';
  timeoutMs: number;
  retryLimit: number;
}

export type StepDisposition =
  { kind: 'continue' } | { kind: 'stop'; code: string; message: string };

export interface StepSkipReason {
  code: string;
  message: string;
}

export interface AgentStepResult {
  text: string;
  sessionId?: string;
  usage?: AgentUsage;
  costUsd?: number;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface StepError {
  message: string;
  code?: string;
  retryable: boolean;
}

export interface ApprovalDecision {
  decision?: 'approved' | 'rejected';
  feedback?: string;
  decidedAt?: string;
}

export interface ArtifactReference {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: 'json' | 'text';
  path: string;
  mediaType: string;
  sizeBytes: number;
}

export interface StepAttempt {
  runId: string;
  stepId: string;
  attempt: number;
  status: StepStatus;
  startedAt: string;
  finishedAt?: string;
  externalSessionId?: string;
}

export function isStepRetryEligible(step: StepRun, resume: boolean): boolean {
  if (!resume) return step.status === 'pending';
  return (
    step.status === 'pending' ||
    step.status === 'interrupted' ||
    step.status === 'skipped' ||
    (step.status === 'failed' && step.error?.retryable === true)
  );
}
