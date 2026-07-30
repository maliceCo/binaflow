import type { ArtifactReference, StepRun, WorkflowRun } from './run.js';

export interface RunStore {
  createRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string): Promise<StepRun[]>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
}

export interface ArtifactStore {
  write(
    runId: string,
    stepId: string,
    name: string,
    kind: ArtifactReference['kind'],
    content: string,
    mediaType: string,
  ): Promise<ArtifactReference>;
  read(artifact: ArtifactReference): Promise<string>;
}
