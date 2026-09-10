import type { ArtifactReference, WorkflowRun } from '../core/run.js';
import type { ApplicationInternals } from './operations.js';
import {
  parsePlanBuildQaBuildResult,
  parsePlanBuildQaQaReport,
  type PlanBuildQaReport,
} from '../workflows/plan-build-qa.js';
import { parseTodoBuildResult } from '../workflows/todo-build-qa.js';

const MAX_OUTCOME_PREVIEW_BYTES = 64_000;

export interface TaskOutcomeBuilderDeclaration {
  phase: string;
  artifact: ArtifactReference;
  preview?: string;
  truncated: boolean;
  structured?: {
    summary: string;
    changedFiles: string[];
    verifications: Array<{ command: string; status: string }>;
    commits: string[];
  };
  limitations: string[];
}

export interface TaskOutcome {
  run: Pick<WorkflowRun, 'id' | 'workflowId' | 'objective' | 'status'>;
  builderDeclarations: TaskOutcomeBuilderDeclaration[];
  qaRoundIds: string[];
  limitations: string[];
}

export interface TaskQaRound {
  runId: string;
  roundId: string;
  iteration: number;
  artifact?: ArtifactReference;
  report?: PlanBuildQaReport;
  limitations: string[];
}

type TaskOutcomeContext = Pick<ApplicationInternals, 'store' | 'artifacts'>;

export async function getTaskOutcome(
  context: TaskOutcomeContext,
  runId: string,
): Promise<TaskOutcome> {
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const artifacts = await context.store.getArtifacts(runId);
  const declarations = await Promise.all(
    artifacts
      .filter(
        (artifact) => artifact.name === 'result' && isBuilderPhase(artifact.stepId, run.workflowId),
      )
      .map((artifact) => readBuilderDeclaration(context, artifact, run.workflowId)),
  );
  const qaRoundIds = artifacts
    .filter((artifact) => artifact.name === 'report' && isQaRoundId(artifact.stepId))
    .map((artifact) => artifact.stepId)
    .filter((roundId, index, all) => all.indexOf(roundId) === index)
    .sort(compareRoundIds);
  return {
    run: {
      id: run.id,
      workflowId: run.workflowId,
      objective: run.objective,
      status: run.status,
    },
    builderDeclarations: declarations,
    qaRoundIds,
    limitations: declarations.flatMap((declaration) => declaration.limitations),
  };
}

export async function getTaskQaRound(
  context: TaskOutcomeContext,
  runId: string,
  roundId: string,
): Promise<TaskQaRound> {
  if (!isQaRoundId(roundId)) throw new Error(`Invalid QA round id: ${roundId}`);
  const run = await context.store.getRun(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  const artifact = (await context.store.getArtifacts(runId)).find(
    (candidate) => candidate.stepId === roundId && candidate.name === 'report',
  );
  if (!artifact) {
    return {
      runId,
      roundId,
      iteration: roundIteration(roundId),
      limitations: ['The persisted QA report artifact is missing.'],
    };
  }
  try {
    const bounded = await context.artifacts.readBounded(artifact, MAX_OUTCOME_PREVIEW_BYTES);
    if (bounded.truncated) {
      return {
        runId,
        roundId,
        iteration: roundIteration(roundId),
        artifact,
        limitations: ['The QA report is larger than the bounded outcome limit.'],
      };
    }
    return {
      runId,
      roundId,
      iteration: roundIteration(roundId),
      artifact,
      report: parsePlanBuildQaQaReport(JSON.parse(bounded.content)),
      limitations: [],
    };
  } catch (error) {
    return {
      runId,
      roundId,
      iteration: roundIteration(roundId),
      artifact,
      limitations: [`The QA report could not be interpreted: ${errorMessage(error)}`],
    };
  }
}

async function readBuilderDeclaration(
  context: TaskOutcomeContext,
  artifact: ArtifactReference,
  workflowId: string,
): Promise<TaskOutcomeBuilderDeclaration> {
  try {
    const bounded = await context.artifacts.readBounded(artifact, MAX_OUTCOME_PREVIEW_BYTES);
    if (isPlanBuildQaBuilderArtifact(artifact)) {
      if (bounded.truncated) {
        return {
          phase: artifact.stepId,
          artifact,
          truncated: true,
          limitations: ['The structured builder result is larger than the bounded outcome limit.'],
        };
      }
      const result =
        workflowId === 'todo-build-qa'
          ? parseTodoBuildResult(JSON.parse(bounded.content))
          : parsePlanBuildQaBuildResult(JSON.parse(bounded.content));
      return {
        phase: artifact.stepId,
        artifact,
        truncated: false,
        structured: {
          summary: result.summary,
          changedFiles: result.changedFiles,
          verifications: result.verifications,
          commits: 'commits' in result ? result.commits : [],
        },
        limitations: [],
      };
    }
    return {
      phase: artifact.stepId,
      artifact,
      preview: bounded.content,
      truncated: bounded.truncated,
      limitations: bounded.truncated
        ? ['The builder declaration is a bounded preview and may be incomplete.']
        : [],
    };
  } catch (error) {
    return {
      phase: artifact.stepId,
      artifact,
      truncated: false,
      limitations: [`The builder declaration could not be read: ${errorMessage(error)}`],
    };
  }
}

function isBuilderPhase(stepId: string, workflowId: string): boolean {
  if (workflowId === 'plan-build') return stepId === 'build';
  return stepId === 'build' || /^fix-\d+$/.test(stepId);
}

function isPlanBuildQaBuilderArtifact(artifact: ArtifactReference): boolean {
  return (
    artifact.kind === 'json' && (artifact.stepId === 'build' || /^fix-\d+$/.test(artifact.stepId))
  );
}

function isQaRoundId(value: string): boolean {
  return value === 'qa' || /^qa-[1-9]\d*$/.test(value);
}

function roundIteration(roundId: string): number {
  return roundId === 'qa' ? 1 : Number(roundId.slice(3));
}

function compareRoundIds(left: string, right: string): number {
  return roundIteration(left) - roundIteration(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
