import type { AgentProfile } from '../config.js';
import type { WorkflowRun } from './run.js';

export interface ExecuteWorkflowRequest {
  objective?: string;
  input?: Record<string, unknown>;
  profiles: Record<string, AgentProfile>;
  runId?: string;
  resume?: boolean;
  runClaimed?: boolean;
  signal?: AbortSignal;
  onRunStarted?: (run: WorkflowRun) => Promise<void> | void;
}

export class WorkflowVersionMismatchError extends Error {
  readonly code = 'WORKFLOW_VERSION_MISMATCH';

  constructor(runId: string, persistedVersion: number, installedVersion: number) {
    super(
      `Run ${runId} uses workflow version ${persistedVersion}; installed version is ${installedVersion}. Resume is not supported across workflow versions`,
    );
    this.name = 'WorkflowVersionMismatchError';
  }
}
