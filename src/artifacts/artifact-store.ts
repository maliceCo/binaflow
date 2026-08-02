import type { ArtifactReference } from '../core/run.js';

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
