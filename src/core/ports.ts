import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from './run.js';

export interface ExecutionClaim {
  readonly runId: string;
  readonly token: string;
}

export interface WorkflowArtifactStore {
  write(
    runId: string,
    stepId: string,
    name: string,
    kind: ArtifactReference['kind'],
    content: string,
    mediaType: string,
  ): Promise<ArtifactReference>;
  remove(artifact: ArtifactReference): Promise<void>;
  read(artifact: ArtifactReference): Promise<string>;
}

export interface WorkflowExecutionStore {
  createRun(run: WorkflowRun, artifacts?: ArtifactReference[]): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  claimRun(runId: string, eligibleStatuses: readonly RunStatus[]): Promise<WorkflowRun | undefined>;
  assertExecutionClaim(claim: ExecutionClaim): Promise<void>;
  saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
}
