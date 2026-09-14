import type { AgentProfile } from '../core/agent-profile.js';
import type { ArtifactReference, WorkflowRun } from '../core/run.js';
import { StepExecutionFailure } from '../core/workflow-runtime.js';
import type { AgentStep } from '../core/workflow.js';
import {
  assertGuidedTaskTransition,
  guidedStepId,
  parseGuidedTaskAgentResult,
  type GuidedExecutionClaim,
  type GuidedExecutionCommitIntent,
  type GuidedExecutionProgress,
  type GuidedExecutionSnapshot,
  type GuidedTaskAgentResult,
  type GuidedExecutionGitState,
} from './guided-execution.js';
import type {
  ApplicationArtifactStore,
  ApplicationPreparationArtifactStore,
  ApplicationRunStore,
  GitWorkspace,
  GuidedExecutionStore,
  WorkspaceCommandRunner,
} from './ports.js';
import { guidedTaskBuildWorkflow } from '../workflows/guided-task-build.js';

export interface GuidedExecutionCoordinatorRequest {
  run: WorkflowRun;
  snapshot: GuidedExecutionSnapshot;
  claim: GuidedExecutionClaim;
  profiles: Record<string, AgentProfile>;
  signal?: AbortSignal;
}

type GuidedRuntime = Pick<import('../core/workflow-runtime.js').WorkflowRuntime, 'executeStep'>;

type GuidedArtifacts = ApplicationArtifactStore & ApplicationPreparationArtifactStore;

export class GuidedExecutionCoordinator {
  constructor(
    private readonly runtime: GuidedRuntime,
    private readonly runStore: Pick<ApplicationRunStore, 'getStepRuns' | 'getArtifacts'>,
    private readonly persistence: GuidedExecutionStore,
    private readonly artifacts: GuidedArtifacts,
    private readonly git: GitWorkspace,
    private readonly commands: WorkspaceCommandRunner,
  ) {}

  async execute(request: GuidedExecutionCoordinatorRequest): Promise<GuidedExecutionProgress> {
    let progress = await this.requireProgress(request.run.id);
    const workflowStep = guidedTaskBuildWorkflow.steps[0]!;

    for (const phase of request.snapshot.todo.body.phases) {
      const phaseProgress = progress.phases.find((candidate) => candidate.id === phase.id);
      if (!phaseProgress || phaseProgress.status === 'completed') continue;
      const phaseStart = await this.git.inspect(request.snapshot.workspace);
      for (const task of phase.tasks) {
        const taskProgress = phaseProgress.tasks.find((candidate) => candidate.id === task.id);
        if (!taskProgress || taskProgress.status === 'completed') continue;
        if (request.signal?.aborted) return this.finishCancelled(progress, request.claim);

        assertGuidedTaskTransition(taskProgress.status, 'running');
        progress = await this.saveProgress(
          {
            ...progress,
            status: 'running',
            phases: replaceTask(progress, phase.id, task.id, { status: 'running' }),
          },
          request.claim,
        );
        const attempt = taskProgress.attempt;
        const stepId = guidedStepId(phaseProgress.ordinal, taskProgress.ordinal, attempt);
        const step: AgentStep = { ...workflowStep, id: stepId };
        const input = {
          objective: request.snapshot.objective,
          task: JSON.stringify(task),
          phase: JSON.stringify({ id: phase.id, title: phase.title }),
          constraints: JSON.stringify(request.snapshot.brief.body.constraints),
          verification: JSON.stringify(task.verification),
          stopConditions: JSON.stringify(task.stopConditions),
          previousCheckpoint: '',
        };
        let stepResult: Awaited<ReturnType<GuidedRuntime['executeStep']>>;
        try {
          const stepRuns = await this.runStore.getStepRuns(request.run.id, { includeResult: true });
          const existing = stepRuns.find((candidate) => candidate.stepId === stepId);
          stepResult = await this.runtime.executeStep(
            request.run,
            step,
            existing,
            input,
            await this.runStore.getArtifacts(request.run.id),
            {
              profiles: request.profiles,
              resume: true,
              executionClaim: request.claim,
              runId: request.run.id,
              input,
              ...(request.signal ? { signal: request.signal } : {}),
            },
          );
        } catch (error) {
          const failed = error instanceof StepExecutionFailure ? error.stepRun : undefined;
          progress = await this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'agent-blocked',
            failed?.error?.message ?? (error instanceof Error ? error.message : String(error)),
            [],
          );
          return progress;
        }

        const resultArtifact = stepResult.artifacts.find(
          (artifact) => artifact.stepId === stepId && artifact.name === 'result',
        );
        if (!resultArtifact) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'agent-blocked',
            'Guided task result artifact is missing',
            stepResult.artifacts,
          );
        }
        let result: GuidedTaskAgentResult;
        try {
          result = parseGuidedTaskAgentResult(
            JSON.parse(await this.artifacts.read(resultArtifact)),
          );
        } catch (error) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'agent-blocked',
            error instanceof Error ? error.message : String(error),
            [resultArtifact],
          );
        }
        if (result.decision === 'blocked') {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'agent-blocked',
            result.blockReason ?? result.summary,
            [resultArtifact],
          );
        }

        const afterAgent = await this.git.inspect(request.snapshot.workspace);
        const changedPaths = changedPathsForTask(afterAgent, task.files);
        if (changedPaths.some((path) => !task.files.includes(path))) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'workspace-changed',
            `Agent changed files outside task scope: ${changedPaths.join(', ')}`,
            [resultArtifact],
            afterAgent,
          );
        }
        const verification = await this.verifyTask(request, task.verification);
        const verificationArtifact = await this.artifacts.write(
          request.run.id,
          stepId,
          'verification',
          'json',
          JSON.stringify(verification),
          'application/json',
        );
        if (!verification.every((entry) => entry.ok)) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'verification-failed',
            verification.find((entry) => !entry.ok)?.error ?? 'Guided verification failed',
            [resultArtifact, verificationArtifact],
            afterAgent,
          );
        }
        const afterVerification = await this.git.inspect(request.snapshot.workspace);
        const actualPaths = changedPathsForTask(afterVerification, task.files);
        if (actualPaths.some((path) => !task.files.includes(path))) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            task.id,
            'workspace-changed',
            `Verification changed files outside task scope: ${actualPaths.join(', ')}`,
            [resultArtifact, verificationArtifact],
            afterVerification,
          );
        }
        const checkpoint = {
          runId: request.run.id,
          phaseId: phase.id,
          taskId: task.id,
          fingerprint: afterVerification,
          artifactIds: [resultArtifact.id, verificationArtifact.id],
          revision: progress.revision,
        };
        progress = await this.persistence.saveGuidedCheckpoint(checkpoint, request.claim);
        progress = {
          ...progress,
          phases: replaceTask(progress, phase.id, task.id, {
            status: 'completed',
            agentStepId: stepId,
            resultArtifact: resultArtifact,
            verificationArtifact,
          }),
        };
        progress = await this.saveProgress(progress, request.claim);
      }

      const phaseVerification = unique(phase.tasks.flatMap((task) => task.verification));
      const phaseResults = await this.verifyTask(request, phaseVerification);
      if (phaseResults.some((entry) => !entry.ok)) {
        return this.block(
          progress,
          request.claim,
          phase.id,
          undefined,
          'verification-failed',
          phaseResults.find((entry) => !entry.ok)?.error ?? 'Phase verification failed',
          [],
        );
      }
      const phasePaths = unique(phase.tasks.flatMap((task) => task.files));
      try {
        await this.git.validatePaths(request.snapshot.workspace, phasePaths);
        await this.git.stagePaths(request.snapshot.workspace, phasePaths);
        const staged = await this.git.inspectStagedTree(request.snapshot.workspace);
        const intent: GuidedExecutionCommitIntent = {
          runId: request.run.id,
          phaseId: phase.id,
          token: `${request.run.id}-${phaseProgress.ordinal}`,
          branch: phaseStart.branch,
          parent: phaseStart.head,
          tree: staged.tree,
          fingerprint: phaseStart,
          paths: phasePaths,
          message: `binaflow: ${phase.id}`,
          evidenceArtifactIds: [],
        };
        progress = await this.persistence.saveGuidedCommitIntent(intent, request.claim);
        const commitSha = await this.git.commitPhase(request.snapshot.workspace, intent);
        const commit = await this.git.inspectCommit(request.snapshot.workspace, commitSha);
        if (commit.parent !== intent.parent || commit.tree !== intent.tree) {
          return this.block(
            progress,
            request.claim,
            phase.id,
            undefined,
            'commit-unconfirmed',
            'Created commit does not match the commit intent',
            [],
            commit.fingerprint,
          );
        }
        progress = await this.persistence.completeGuidedPhase(
          request.run.id,
          phase.id,
          commitSha,
          request.claim,
        );
      } catch (error) {
        return this.block(
          progress,
          request.claim,
          phase.id,
          undefined,
          'commit-unconfirmed',
          error instanceof Error ? error.message : String(error),
          [],
        );
      }
    }

    const complete = {
      ...progress,
      stage: 'changes-review' as const,
      status: 'waiting' as const,
      nextAction: 'review-changes' as const,
    };
    return this.saveProgress(complete, request.claim);
  }

  private async verifyTask(
    request: GuidedExecutionCoordinatorRequest,
    commands: readonly string[],
  ): Promise<Array<{ command: string; ok: boolean; output: string; error?: string }>> {
    const results: Array<{ command: string; ok: boolean; output: string; error?: string }> = [];
    for (const command of commands) {
      const result = await this.commands.run(command, [], {
        cwd: request.snapshot.workspace,
        timeoutMs: request.snapshot.profile.timeoutMs,
        maxOutputBytes: 1024 * 1024,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      results.push({
        command,
        ok: result.ok,
        output: `${result.stdout}${result.stderr}`,
        ...(result.error ? { error: result.error } : {}),
      });
    }
    return results;
  }

  private async requireProgress(runId: string): Promise<GuidedExecutionProgress> {
    const progress = await this.persistence.getGuidedExecution(runId);
    if (!progress) throw new Error(`Unknown guided execution: ${runId}`);
    return progress;
  }

  private async saveProgress(
    progress: GuidedExecutionProgress,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    const current = await this.requireProgress(progress.runId);
    const next =
      progress.revision === current.revision
        ? { ...progress, revision: current.revision + 1 }
        : progress;
    await this.persistence.saveGuidedProgress(next, current.revision, claim);
    return next;
  }

  private async block(
    progress: GuidedExecutionProgress,
    claim: GuidedExecutionClaim,
    phaseId: string,
    taskId: string | undefined,
    type: import('./guided-execution.js').GuidedExecutionBlockType,
    reason: string,
    evidence: ArtifactReference[],
    fingerprint?: GuidedExecutionGitState,
  ): Promise<GuidedExecutionProgress> {
    const block = {
      id: `${progress.runId}-${progress.revision + 1}`,
      revision: progress.revision + 1,
      phaseId,
      ...(taskId ? { taskId } : {}),
      type,
      reason,
      evidence,
      ...(fingerprint ? { fingerprint } : {}),
    };
    const next = {
      ...progress,
      status: 'waiting' as const,
      activeBlock: block,
      nextAction: 'resume' as const,
      phases: taskId
        ? progress.phases.map((phase) =>
            phase.id === phaseId
              ? {
                  ...phase,
                  status: 'waiting' as const,
                  tasks: phase.tasks.map((task) =>
                    task.id === taskId ? { ...task, status: 'waiting' as const } : task,
                  ),
                }
              : phase,
          )
        : progress.phases,
    };
    return this.saveProgress(next, claim);
  }

  private async finishCancelled(
    progress: GuidedExecutionProgress,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    return this.saveProgress({ ...progress, status: 'cancelled', nextAction: 'none' }, claim);
  }
}

function replaceTask(
  progress: GuidedExecutionProgress,
  phaseId: string,
  taskId: string,
  patch: Partial<GuidedExecutionProgress['phases'][number]['tasks'][number]>,
): GuidedExecutionProgress['phases'] {
  return progress.phases.map((phase) =>
    phase.id !== phaseId
      ? phase
      : {
          ...phase,
          tasks: phase.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
        },
  );
}

function changedPathsForTask(state: GuidedExecutionGitState, allowed: readonly string[]): string[] {
  return state.changes.map((change) => change.path).filter((path) => !allowed.includes(path));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
