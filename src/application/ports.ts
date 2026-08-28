import type { NormalizedEvent } from '../core/events.js';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { ExecutionClaim } from '../core/ports.js';
import type { WorkflowDefinition } from '../core/workflow.js';
import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { WorkflowRuntime } from '../core/workflow-runtime.js';

export interface ApplicationArtifactStore {
  read(artifact: ArtifactReference): Promise<string>;
  readBounded(
    artifact: ArtifactReference,
    maxBytes: number,
  ): Promise<{
    content: string;
    truncated: boolean;
  }>;
}

export interface WorkflowExecutor {
  execute(workflow: WorkflowDefinition, request: ExecuteWorkflowRequest): Promise<WorkflowRun>;
}

export type ResearchWorkflowRuntime = Pick<
  WorkflowRuntime,
  | 'resolveInput'
  | 'prepareRun'
  | 'notifyRunStarted'
  | 'executeStep'
  | 'skipStep'
  | 'saveRunStatus'
  | 'emitStatus'
>;

export interface ApplicationRunListQuery {
  limit?: number;
  status?: RunStatus;
  statuses?: readonly RunStatus[];
  workflowId?: string;
  cursor?: string;
}

export interface ApplicationRunListPage {
  runs: WorkflowRun[];
  nextCursor?: string;
}

export interface ApplicationRunEventPageQuery {
  afterId?: number;
  limit?: number;
}

export interface ApplicationRunEventPage {
  events: Array<NormalizedEvent & { id: number }>;
  nextCursor?: number;
}

export interface ApplicationRunStore {
  createRun(run: WorkflowRun, artifacts?: ArtifactReference[]): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  claimRun(runId: string, eligibleStatuses: readonly RunStatus[]): Promise<WorkflowRun | undefined>;
  claimRunForExecution(
    runId: string,
    eligibleStatuses: readonly RunStatus[],
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined>;
  claimApprovalForExecution(
    runId: string,
    approvalStep: StepRun,
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined>;
  assertExecutionClaim(claim: ExecutionClaim): Promise<void>;
  claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined>;
  markRunInterrupted(runId: string): Promise<WorkflowRun | undefined>;
  releaseExecution(runId: string): Promise<void>;
  assertExecutionOwner(runId: string): Promise<void>;
  listRunsPage(query?: ApplicationRunListQuery): Promise<ApplicationRunListPage>;
  saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string, options?: { includeResult?: boolean | 'usage' }): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  saveCoordinatorArtifacts(runId: string, artifacts: ArtifactReference[]): Promise<void>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
  saveEvent(event: NormalizedEvent): Promise<void>;
  saveEvents(events: NormalizedEvent[]): Promise<void>;
  countEvents(runId: string): Promise<number>;
  getEvents(runId: string): Promise<NormalizedEvent[]>;
  listRunEventsPage(
    runId: string,
    query?: ApplicationRunEventPageQuery,
  ): Promise<ApplicationRunEventPage>;
}

export interface ResearchPersistence extends Pick<
  ApplicationRunStore,
  'getRun' | 'getStepRuns' | 'getArtifacts' | 'saveStepRun'
> {
  checkpointResearchIteration(
    inputArtifact: ArtifactReference,
    researchStep: StepRun,
    reviewStep: StepRun,
    approvalStep?: StepRun,
  ): Promise<void>;
}
