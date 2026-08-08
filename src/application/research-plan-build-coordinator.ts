import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { StepRun, WorkflowRun } from '../core/run.js';
import { isStepRetryEligible } from '../core/run.js';
import {
  findArtifact,
  replaceArtifacts,
  StepExecutionFailure,
  type WorkflowRuntime,
  validateWorkflowInput,
} from '../core/workflow-runtime.js';
import { validateWorkflowDefinition, type WorkflowDefinition } from '../core/workflow.js';
import {
  parseResearchReview,
  researchPlanBuildWorkflow,
} from '../workflows/research-plan-build.js';

const MAX_RESEARCH_ITERATIONS = 3;

export class ResearchPlanBuildCoordinator {
  constructor(private readonly runtime: WorkflowRuntime) {}

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validateWorkflowDefinition(workflow);
    if (workflow.id !== researchPlanBuildWorkflow.id) {
      throw new Error(`Research coordinator cannot execute workflow ${workflow.id}`);
    }
    if (!workflow.approval) {
      throw new Error('Invalid research-plan-build workflow definition');
    }

    const initialInput = await this.runtime.resolveInput(request);
    validateWorkflowInput(workflow, initialInput);
    if (request.resume) {
      for (const step of workflow.steps) {
        // Profile resolution happens inside executeStep; keep parity with sequential path.
        void step;
      }
    }

    return this.executeResearchPlanBuild(workflow, request, initialInput);
  }

  private async executeResearchPlanBuild(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
    initialInput: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    const run = await this.runtime.prepareRun(workflow, request, initialInput);
    if (run.status === 'completed') return run;
    await this.runtime.notifyRunStarted(run, request.onRunStarted);

    const stepRuns = new Map(
      (await this.runtime.runStore.getStepRuns(run.id)).map((step) => [step.stepId, step]),
    );
    let artifacts = await this.runtime.runStore.getArtifacts(run.id);
    let input = {
      ...initialInput,
      researchFeedback:
        typeof initialInput.researchFeedback === 'string' ? initialInput.researchFeedback : '',
    };
    const researchStep = workflow.steps.find((step) => step.id === 'research');
    const reviewStep = workflow.steps.find((step) => step.id === 'research-review');
    const planStep = workflow.steps.find((step) => step.id === 'plan');
    const buildStep = workflow.steps.find((step) => step.id === 'build');
    if (!researchStep || !reviewStep || !planStep || !buildStep || !workflow.approval) {
      throw new Error('Invalid research-plan-build workflow definition');
    }

    try {
      while (true) {
        if (request.signal?.aborted) return this.runtime.saveRunStatus(run, 'cancelled');
        let research = stepRuns.get(researchStep.id);
        if (!research || research.status !== 'completed') {
          if (research && !isStepRetryEligible(research, request.resume === true)) {
            await this.runtime.emitStatus(
              run.id,
              researchStep.id,
              `Step ${researchStep.id} is not retryable`,
            );
            return this.runtime.saveRunStatus(run, 'failed');
          }
          const result = await this.runtime.executeStep(
            run,
            researchStep,
            research,
            input,
            artifacts,
            request,
          );
          research = result.stepRun;
          stepRuns.set(researchStep.id, research);
          artifacts = replaceArtifacts(artifacts, result.artifacts);
        }

        if (request.signal?.aborted) return this.runtime.saveRunStatus(run, 'cancelled');

        let review = stepRuns.get(reviewStep.id);
        if (!review || review.status !== 'completed') {
          if (review && !isStepRetryEligible(review, request.resume === true)) {
            await this.runtime.emitStatus(
              run.id,
              reviewStep.id,
              `Step ${reviewStep.id} is not retryable`,
            );
            return this.runtime.saveRunStatus(run, 'failed');
          }
          const result = await this.runtime.executeStep(
            run,
            reviewStep,
            review,
            input,
            artifacts,
            request,
          );
          review = result.stepRun;
          stepRuns.set(reviewStep.id, review);
          artifacts = replaceArtifacts(artifacts, result.artifacts);
        }

        const reviewArtifact = findArtifact(artifacts, reviewStep.id, 'review');
        if (!reviewArtifact) throw new Error('Missing research review artifact');
        const researchReview = parseResearchReview(
          JSON.parse(await this.runtime.artifactStore.read(reviewArtifact)),
        );

        if (researchReview.decision === 'needs_more_research') {
          if (research.attempt >= MAX_RESEARCH_ITERATIONS) {
            await this.runtime.emitStatus(
              run.id,
              reviewStep.id,
              `Research stopped after ${MAX_RESEARCH_ITERATIONS} iterations`,
            );
            return this.runtime.saveRunStatus(run, 'failed');
          }
          input = {
            ...input,
            researchFeedback: researchReview.nextResearchQuestions.join('\n'),
          };
          const inputArtifact = await this.runtime.writeResearchInputArtifact(
            run.id,
            input,
            artifacts,
          );
          const resetResearch = this.runtime.resetLoopStep(research);
          const resetReview = this.runtime.resetLoopStep(review);
          const approval = stepRuns.get(workflow.approval.id);
          await this.runtime.runStore.checkpointResearchIteration(
            inputArtifact,
            resetResearch,
            resetReview,
            approval,
          );
          artifacts = replaceArtifacts(artifacts, [inputArtifact]);
          stepRuns.set(researchStep.id, resetResearch);
          stepRuns.set(reviewStep.id, resetReview);
          continue;
        }

        let approval = stepRuns.get(workflow.approval.id);
        if (!approval) {
          approval = {
            runId: run.id,
            stepId: workflow.approval.id,
            profile: 'human',
            status: 'pending',
            attempt: 1,
          };
          await this.runtime.runStore.saveStepRun(approval);
        }

        if (approval.approval?.decision === 'rejected') {
          if (research.attempt >= MAX_RESEARCH_ITERATIONS) {
            await this.runtime.emitStatus(
              run.id,
              workflow.approval.id,
              'Research approval limit reached',
            );
            return this.runtime.saveRunStatus(run, 'failed');
          }
          input = {
            ...input,
            researchFeedback:
              approval.approval.feedback ?? 'The user requested another research iteration.',
          };
          const inputArtifact = await this.runtime.writeResearchInputArtifact(
            run.id,
            input,
            artifacts,
          );
          const resetResearch = this.runtime.resetLoopStep(research);
          const resetReview = this.runtime.resetLoopStep(review);
          const resetApproval: StepRun = {
            runId: approval.runId,
            stepId: approval.stepId,
            profile: approval.profile,
            status: 'pending',
            attempt: approval.attempt + 1,
            approval: { feedback: input.researchFeedback as string },
          };
          await this.runtime.runStore.checkpointResearchIteration(
            inputArtifact,
            resetResearch,
            resetReview,
            resetApproval,
          );
          artifacts = replaceArtifacts(artifacts, [inputArtifact]);
          approval = resetApproval;
          stepRuns.set(researchStep.id, resetResearch);
          stepRuns.set(reviewStep.id, resetReview);
          stepRuns.set(workflow.approval.id, approval);
          continue;
        }

        if (approval.approval?.decision !== 'approved') {
          if (approval.status !== 'waiting') {
            approval = { ...approval, status: 'waiting' };
            await this.runtime.runStore.saveStepRun(approval);
          }
          stepRuns.set(workflow.approval.id, approval);
          return this.runtime.saveRunStatus(run, 'waiting');
        }

        if (approval.status !== 'completed') {
          approval = {
            ...approval,
            status: 'completed',
            finishedAt: new Date().toISOString(),
          };
          await this.runtime.runStore.saveStepRun(approval);
          stepRuns.set(workflow.approval.id, approval);
        }
        break;
      }

      let plan = stepRuns.get(planStep.id);
      if (request.signal?.aborted) return this.runtime.saveRunStatus(run, 'cancelled');
      if (!plan || plan.status !== 'completed') {
        if (plan && !isStepRetryEligible(plan, request.resume === true)) {
          await this.runtime.emitStatus(
            run.id,
            planStep.id,
            `Step ${planStep.id} is not retryable`,
          );
          return this.runtime.saveRunStatus(run, 'failed');
        }
        const result = await this.runtime.executeStep(
          run,
          planStep,
          plan,
          input,
          artifacts,
          request,
        );
        plan = result.stepRun;
        stepRuns.set(planStep.id, plan);
        artifacts = replaceArtifacts(artifacts, result.artifacts);
      }
      if (plan.disposition?.kind === 'stop') {
        const skipped = await this.runtime.skipStep(run.id, buildStep, stepRuns.get(buildStep.id), {
          code: plan.disposition.code,
          message: `Dependency plan stopped: ${plan.disposition.message}`,
        });
        stepRuns.set(buildStep.id, skipped);
        return this.runtime.saveRunStatus(run, 'completed');
      }

      const build = stepRuns.get(buildStep.id);
      if (request.signal?.aborted) return this.runtime.saveRunStatus(run, 'cancelled');
      if (!build || build.status !== 'completed') {
        if (build && !isStepRetryEligible(build, request.resume === true)) {
          await this.runtime.emitStatus(
            run.id,
            buildStep.id,
            `Step ${buildStep.id} is not retryable`,
          );
          return this.runtime.saveRunStatus(run, 'failed');
        }
        const result = await this.runtime.executeStep(
          run,
          buildStep,
          build,
          input,
          artifacts,
          request,
        );
        stepRuns.set(buildStep.id, result.stepRun);
      }
      return this.runtime.saveRunStatus(run, 'completed');
    } catch (error) {
      if (!(error instanceof StepExecutionFailure))
        return this.runtime.saveRunStatus(run, 'failed');
      for (const step of workflow.steps) {
        const existing = stepRuns.get(step.id);
        if (
          existing?.status === 'completed' ||
          existing?.status === 'pending' ||
          step.id === error.stepRun.stepId
        )
          continue;
        await this.runtime.skipStep(run.id, step, existing, {
          code: 'UPSTREAM_STEP_BLOCKED',
          message: `Dependency ${error.stepRun.stepId} failed`,
        });
      }
      return this.runtime.saveRunStatus(
        run,
        error.stepRun.status === 'cancelled' ? 'cancelled' : 'failed',
      );
    }
  }
}
