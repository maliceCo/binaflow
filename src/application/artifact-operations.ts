import type { ArtifactReference } from '../core/run.js';
import type { ApplicationArtifactStore, ApplicationRunStore } from './ports.js';
import type { RunInspection } from './run-operations.js';

const ARTIFACT_PREVIEW_BYTES = 4_000;
const MAX_ARTIFACT_PREVIEW_BYTES = 64_000;

export interface ArtifactContentView {
  artifact: ArtifactReference;
  content?: string;
  truncated: boolean;
  formatted: boolean;
  error?: string;
}

export interface ReadArtifactOptions {
  mode?: 'preview' | 'full';
  maxBytes?: number;
}

interface ArtifactOperationsContext {
  store: Pick<ApplicationRunStore, 'getArtifacts'>;
  artifacts: ApplicationArtifactStore;
}

export async function readArtifact(
  context: ArtifactOperationsContext,
  runId: string,
  artifactKey: string,
  options: ReadArtifactOptions = {},
): Promise<ArtifactContentView> {
  const artifact = (await context.store.getArtifacts(runId)).find(
    (candidate) =>
      candidate.id === artifactKey || `${candidate.stepId}.${candidate.name}` === artifactKey,
  );
  if (!artifact) throw new Error(`Unknown artifact for run ${runId}: ${artifactKey}`);
  const mode = options.mode ?? 'preview';
  try {
    if (mode === 'full') {
      return formatArtifactContent(artifact, await context.artifacts.read(artifact), false);
    }
    const maxBytes = options.maxBytes ?? ARTIFACT_PREVIEW_BYTES;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARTIFACT_PREVIEW_BYTES) {
      throw new Error(
        `Artifact preview limit must be between 1 and ${MAX_ARTIFACT_PREVIEW_BYTES} bytes`,
      );
    }
    const bounded = await context.artifacts.readBounded(artifact, maxBytes);
    return formatArtifactContent(artifact, bounded.content, bounded.truncated);
  } catch (error) {
    return {
      artifact,
      truncated: false,
      formatted: false,
      error: `Artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function loadResearchApprovalPreviews(
  context: ArtifactOperationsContext,
  inspection: Pick<RunInspection, 'run' | 'artifacts'>,
): Promise<ArtifactContentView[]> {
  const selected = inspection.artifacts.filter(
    (artifact) =>
      (artifact.stepId === 'research' && artifact.name === 'report') ||
      (artifact.stepId === 'research-review' && artifact.name === 'review'),
  );
  return Promise.all(
    selected.map(async (artifact) => {
      try {
        return await readArtifact(
          context,
          inspection.run.id,
          `${artifact.stepId}.${artifact.name}`,
        );
      } catch (error) {
        return {
          artifact,
          truncated: false,
          formatted: false,
          error: `Artifact preview cannot be read: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}

function formatArtifactContent(
  artifact: ArtifactReference,
  content: string,
  truncated: boolean,
): ArtifactContentView {
  if (artifact.kind !== 'json') return { artifact, content, truncated, formatted: false };
  if (truncated) {
    return {
      artifact,
      content,
      truncated,
      formatted: false,
      error: 'JSON preview is truncated; use full viewing for formatted JSON.',
    };
  }
  try {
    return {
      artifact,
      content: JSON.stringify(JSON.parse(content) as unknown, null, 2),
      truncated: false,
      formatted: true,
    };
  } catch (error) {
    return {
      artifact,
      content,
      truncated,
      formatted: false,
      error: `Artifact JSON is corrupt: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
