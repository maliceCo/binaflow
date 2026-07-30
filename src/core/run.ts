export type RunStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
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
  startedAt?: string;
  finishedAt?: string;
  result?: AgentStepResult;
  error?: StepError;
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
