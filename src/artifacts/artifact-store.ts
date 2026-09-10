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
  remove(artifact: ArtifactReference): Promise<void>;
  read(artifact: ArtifactReference): Promise<string>;
  readBounded(artifact: ArtifactReference, maxBytes: number): Promise<BoundedArtifactContent>;
  readPage?(
    artifact: ArtifactReference,
    options: ArtifactPageOptions,
  ): Promise<ArtifactPageContent>;
}

export interface BoundedArtifactContent {
  content: string;
  truncated: boolean;
}

export interface ArtifactPageOptions {
  offset: number;
  maxBytes: number;
  maxLines: number;
}

export interface ArtifactPageContent {
  content: string;
  endOffset: number;
  hasMore: boolean;
  startsMidLine: boolean;
  endsMidLine: boolean;
  version: string;
}
