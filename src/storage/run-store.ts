import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';

export interface RunStore {
  createRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  listRuns(): Promise<WorkflowRun[]>;
  saveRun(run: WorkflowRun): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
}
