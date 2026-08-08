import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';

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

export interface StepRunQueryOptions {
  includeResult?: boolean;
}

export interface RunStore {
  createRun(run: WorkflowRun, artifacts?: ArtifactReference[]): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  claimRun(runId: string, eligibleStatuses: readonly RunStatus[]): Promise<WorkflowRun | undefined>;
  claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined>;
  markRunInterrupted(runId: string): Promise<WorkflowRun | undefined>;
  releaseExecution(runId: string): Promise<void>;
  listRuns(): Promise<WorkflowRun[]>;
  listRunsPage(query?: RunListQuery): Promise<RunListPage>;
  saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string, options?: StepRunQueryOptions): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  replaceArtifact(artifact: ArtifactReference): Promise<void>;
  checkpointResearchIteration(
    inputArtifact: ArtifactReference,
    researchStep: StepRun,
    reviewStep: StepRun,
    approvalStep?: StepRun,
  ): Promise<void>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
  saveEvent(event: NormalizedEvent): Promise<void>;
  saveEvents(events: NormalizedEvent[]): Promise<void>;
  countEvents(runId: string): Promise<number>;
  getEvents(runId: string): Promise<NormalizedEvent[]>;
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
