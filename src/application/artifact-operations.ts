import type { ArtifactReference } from '../core/run.js';
import type { DocumentPage } from './preparation.js';
import type { ApplicationArtifactStore, ApplicationRunStore } from './ports.js';
import type { RunInspection } from './run-operations.js';

const ARTIFACT_PREVIEW_BYTES = 4_000;
const MAX_ARTIFACT_PREVIEW_BYTES = 64_000;
const MAX_CLARIFICATION_PLAN_BYTES = 64_000;

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

export interface ReadArtifactPageOptions {
  cursor?: string;
  maxBytes?: number;
  maxLines?: number;
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

export async function readArtifactPage(
  context: ArtifactOperationsContext,
  runId: string,
  artifactKey: string,
  options: ReadArtifactPageOptions = {},
): Promise<DocumentPage> {
  if (!context.artifacts.readPage) throw new Error('Bounded artifact pages are not supported');
  const maxBytes = options.maxBytes ?? 65_536;
  const maxLines = options.maxLines ?? 200;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65_536) {
    throw new Error('Artifact page byte limit must be between 1 and 65536');
  }
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 200) {
    throw new Error('Artifact page line limit must be between 1 and 200');
  }
  const artifact = (await context.store.getArtifacts(runId)).find(
    (candidate) =>
      candidate.id === artifactKey || `${candidate.stepId}.${candidate.name}` === artifactKey,
  );
  if (!artifact) throw new Error(`Unknown artifact for run ${runId}: ${artifactKey}`);
  const cursor = options.cursor ? decodeArtifactPageCursor(options.cursor, artifact.id) : undefined;
  const page = await context.artifacts.readPage(artifact, {
    offset: cursor?.offset ?? 0,
    maxBytes,
    maxLines,
  });
  if (cursor && cursor.version !== page.version) {
    throw new Error('Artifact changed since the page cursor was created');
  }
  return {
    documentId: artifact.id,
    version: page.version,
    content: page.content,
    startOffset: cursor?.offset ?? 0,
    endOffset: page.endOffset,
    ...((cursor?.offset ?? 0) > 0
      ? {
          previousCursor: encodeArtifactPageCursor(
            artifact.id,
            page.version,
            Math.max(0, (cursor?.offset ?? 0) - maxBytes),
          ),
        }
      : {}),
    ...(page.hasMore
      ? { nextCursor: encodeArtifactPageCursor(artifact.id, page.version, page.endOffset) }
      : {}),
    startsMidLine: page.startsMidLine,
    endsMidLine: page.endsMidLine,
    format: artifact.kind === 'json' ? 'json' : 'text',
    limitations: [],
  };
}

function encodeArtifactPageCursor(artifactId: string, version: string, offset: number): string {
  return Buffer.from(
    JSON.stringify({ source: 'artifact', artifactId, version, offset }),
    'utf8',
  ).toString('base64url');
}

function decodeArtifactPageCursor(
  encoded: string,
  artifactId: string,
): {
  version: string;
  offset: number;
} {
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      value.source !== 'artifact' ||
      value.artifactId !== artifactId ||
      typeof value.version !== 'string' ||
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 0
    ) {
      throw new Error('cursor does not match the artifact');
    }
    return { version: value.version, offset: value.offset as number };
  } catch (error) {
    throw new Error(
      `Invalid artifact page cursor: ${error instanceof Error ? error.message : String(error)}`,
    );
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

export async function clarificationQuestions(
  context: ArtifactOperationsContext,
  inspection: Pick<RunInspection, 'steps' | 'artifacts'>,
): Promise<string[]> {
  const disposition = inspection.steps.find(
    (step) => step.disposition?.kind === 'stop',
  )?.disposition;
  if (
    !disposition ||
    disposition.kind !== 'stop' ||
    disposition.code !== 'PLAN_NEEDS_CLARIFICATION'
  ) {
    return [];
  }
  const plan = inspection.artifacts.find((artifact) => artifact.name === 'plan');
  if (plan) {
    try {
      const bounded = await context.artifacts.readBounded(plan, MAX_CLARIFICATION_PLAN_BYTES);
      if (!bounded.truncated) {
        const value = JSON.parse(bounded.content) as Record<string, unknown>;
        if (Array.isArray(value.clarificationQuestions)) {
          const questions = value.clarificationQuestions.filter(
            (question): question is string =>
              typeof question === 'string' && question.trim().length > 0,
          );
          if (questions.length > 0) return questions;
        }
      }
    } catch {
      // The artifact view reports corrupt content separately.
    }
  }
  const message = disposition.message;
  return message ? [message] : [];
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
