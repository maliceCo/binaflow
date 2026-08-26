import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';

export const DEFAULT_RUN_EVENT_LIMIT = 50;
export const MAX_RUN_EVENT_LIMIT = 100;

export interface RunListQuery {
  limit?: number;
  status?: RunStatus;
  statuses?: readonly RunStatus[];
  workflowId?: string;
  cursor?: string;
}

export interface RunListPage {
  runs: WorkflowRun[];
  nextCursor?: string;
}

export interface PersistedRunEvent extends NormalizedEvent {
  id: number;
}

export interface RunEventPageQuery {
  afterId?: number;
  limit?: number;
}

export interface RunEventPage {
  events: PersistedRunEvent[];
  nextCursor?: number;
}

export type StepResultInclude = boolean | 'usage';

export interface StepRunQueryOptions {
  /** Default includes full results. false omits bodies; 'usage' keeps usage/cost only. */
  includeResult?: StepResultInclude;
}

export interface RunStore {
  createRun(run: WorkflowRun, artifacts?: ArtifactReference[]): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  claimRun(runId: string, eligibleStatuses: readonly RunStatus[]): Promise<WorkflowRun | undefined>;
  claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined>;
  markRunInterrupted(runId: string): Promise<WorkflowRun | undefined>;
  releaseExecution(runId: string): Promise<void>;
  listRunsPage(query?: RunListQuery): Promise<RunListPage>;
  saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string, options?: StepRunQueryOptions): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
  saveEvent(event: NormalizedEvent): Promise<void>;
  saveEvents(events: NormalizedEvent[]): Promise<void>;
  countEvents(runId: string): Promise<number>;
  getEvents(runId: string): Promise<NormalizedEvent[]>;
  listRunEventsPage(runId: string, query?: RunEventPageQuery): Promise<RunEventPage>;
}

export class RunExecutionOwnedError extends Error {
  readonly code = 'RUN_EXECUTION_OWNED';

  constructor(runId: string) {
    super(`Run ${runId} is owned by a live execution`);
    this.name = 'RunExecutionOwnedError';
  }
}

export class RunStatusConflictError extends Error {
  readonly code = 'RUN_STATUS_CONFLICT';

  constructor(runId: string, expectedStatus: RunStatus, actualStatus: RunStatus) {
    super(
      `Run ${runId} changed from the expected status ${expectedStatus}; current status is ${actualStatus}`,
    );
    this.name = 'RunStatusConflictError';
  }
}
