import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { WorkflowArtifactStore } from '../core/ports.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import { isStepRetryEligible } from '../core/run.js';
import type { AgentStep, WorkflowDefinition } from '../core/workflow.js';
import type { WorkflowRuntime } from '../core/workflow-runtime.js';
import type { ApplicationRunStore } from './ports.js';
import {
  findArtifact,
  replaceArtifacts,
  StepExecutionFailure,
  validateWorkflowInput,
} from '../core/workflow-runtime.js';
import {
  parsePlanBuildQaQaReport,
  parsePlanBuildQaScope,
  validatePlanBuildQaWorkflowDefinition,
  type PlanBuildQaReport,
} from '../workflows/plan-build-qa.js';

export const MAX_QA_ITERATIONS = 3;
export const QA_ITERATION_INPUT = 'qaIteration';

export type PlanBuildQaRuntime = Pick<
  WorkflowRuntime,
  | 'resolveInput'
  | 'prepareRun'
  | 'notifyRunStarted'
  | 'executeStep'
  | 'skipStep'
  | 'saveRunStatus'
  | 'emitStatus'
>;

export type PlanBuildQaPersistence = Pick<
  ApplicationRunStore,
  'getStepRuns' | 'getArtifacts' | 'saveCoordinatorArtifacts'
>;

export class PlanBuildQaCoordinator {
  constructor(
    private readonly runtime: PlanBuildQaRuntime,
    private readonly persistence: PlanBuildQaPersistence,
    private readonly artifactsStore: WorkflowArtifactStore,
  ) {}

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validatePlanBuildQaWorkflowDefinition(workflow);
    const input =
      request.resume && request.runId
        ? await this.loadPersistedInput(request.runId)
        : { ...(await this.runtime.resolveInput(request)), [QA_ITERATION_INPUT]: 0 };
    validateWorkflowInput(workflow, input);
    if (
      typeof input[QA_ITERATION_INPUT] !== 'number' ||
      !Number.isInteger(input[QA_ITERATION_INPUT]) ||
      input[QA_ITERATION_INPUT] < 0 ||
      input[QA_ITERATION_INPUT] >= MAX_QA_ITERATIONS
    ) {
      throw new Error('Persisted QA iteration is invalid');
    }

    const run = await this.runtime.prepareRun(workflow, request, input);
    if (run.status === 'completed') return run;
    await this.runtime.notifyRunStarted(run, request.onRunStarted);
    return this.executePhases(workflow, request, run, input);
  }

  private async executePhases(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
    run: WorkflowRun,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    const stepRuns = new Map(
      (await this.persistence.getStepRuns(run.id)).map((step) => [step.stepId, step]),
    );
    let artifacts = await this.persistence.getArtifacts(run.id);
    let iteration = input[QA_ITERATION_INPUT] as number;
    const scopeStep = requiredStep(workflow, 'scope');
    const planStep = requiredStep(workflow, 'plan');
    const buildStep = requiredStep(workflow, 'build');
    const qaStep = requiredStep(workflow, 'qa');
    const fixStep = requiredStep(workflow, 'fix');
    const runtime = this.runtime;

    try {
      const scope = await runStep(scopeStep);
      const scopeArtifact = requiredArtifact(artifacts, scopeStep.id, 'scope');
      const scopeValue = parsePlanBuildQaScope(
        JSON.parse(await this.artifactsStore.read(scopeArtifact)),
      );
      if (scope.disposition?.kind === 'stop' || scopeValue.decision === 'needs_clarification') {
        for (const step of [planStep, buildStep, qaStep, fixStep]) {
          const skipped = await this.runtime.skipStep(run.id, step, stepRuns.get(step.id), {
            code: 'SCOPE_NEEDS_CLARIFICATION',
            message: 'Scope clarification is required before implementation',
          });
          stepRuns.set(step.id, skipped);
        }
        return this.runtime.saveRunStatus(run, 'completed');
      }

      await runStep(planStep);
      await runStep(buildStep);

      while (true) {
        if (request.signal?.aborted) return this.runtime.saveRunStatus(run, 'cancelled');
        const currentQaStep = iteration === 0 ? qaStep : phaseStep(qaStep, iteration);
        await runStep(currentQaStep);
        const qaArtifact = requiredArtifact(artifacts, currentQaStep.id, 'report');
        const report = parsePlanBuildQaQaReport(
          JSON.parse(await this.artifactsStore.read(qaArtifact)),
        );
        if (!isBlockingReport(report)) return this.runtime.saveRunStatus(run, 'completed');
        if (iteration >= MAX_QA_ITERATIONS - 1) {
          await this.runtime.emitStatus(
            run.id,
            currentQaStep.id,
            `QA stopped after ${MAX_QA_ITERATIONS} iterations`,
          );
          return this.runtime.saveRunStatus(run, 'failed');
        }

        const currentFixStep = phaseStep(fixStep, iteration);
        const fix = await runStep({
          ...currentFixStep,
          dependsOn: [currentQaStep.id],
          inputReferences: currentFixStep.inputReferences.map((reference) =>
            reference.source.kind === 'step-output' && reference.source.stepId === qaStep.id
              ? { ...reference, source: { ...reference.source, stepId: currentQaStep.id } }
              : reference,
          ),
        });
        if (fix.status !== 'completed') return this.runtime.saveRunStatus(run, 'failed');

        iteration += 1;
        const nextInput = { ...input, [QA_ITERATION_INPUT]: iteration };
        const inputArtifact = await this.artifactsStore.write(
          run.id,
          'run',
          'input',
          'json',
          JSON.stringify(nextInput),
          'application/json',
        );
        await this.persistence.saveCoordinatorArtifacts(
          run.id,
          inputArtifact ? [inputArtifact] : [],
        );
        const previousInput = findArtifact(artifacts, 'run', 'input');
        artifacts = replaceArtifacts(artifacts, [inputArtifact]);
        if (previousInput && previousInput.id !== inputArtifact.id) {
          await this.artifactsStore.remove(previousInput).catch(() => undefined);
        }
        input[QA_ITERATION_INPUT] = iteration;
      }
    } catch (error) {
      if (!(error instanceof StepExecutionFailure)) throw error;
      const failedStep = error.stepRun;
      for (const step of [planStep, buildStep, qaStep, fixStep]) {
        if (step.id === failedStep.stepId || stepRuns.get(step.id)?.status === 'completed')
          continue;
        await this.runtime.skipStep(run.id, step, stepRuns.get(step.id), {
          code: 'UPSTREAM_STEP_BLOCKED',
          message: `Dependency ${failedStep.stepId} failed`,
        });
      }
      return this.runtime.saveRunStatus(
        run,
        failedStep.status === 'cancelled' ? 'cancelled' : 'failed',
      );
    }
    async function runStep(step: AgentStep): Promise<StepRun> {
      const existing = stepRuns.get(step.id);
      if (existing?.status === 'completed') return existing;
      if (existing && !isStepRetryEligible(existing, request.resume === true)) {
        throw new StepExecutionFailure(existing);
      }
      const result = await runtime.executeStep(run, step, existing, input, artifacts, request);
      stepRuns.set(step.id, result.stepRun);
      artifacts = replaceArtifacts(artifacts, result.artifacts);
      return result.stepRun;
    }
  }

  private async loadPersistedInput(runId: string): Promise<Record<string, unknown>> {
    const inputArtifact = (await this.persistence.getArtifacts(runId)).find(
      (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
    );
    if (!inputArtifact) throw new Error('Missing persisted run input artifact');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.artifactsStore.read(inputArtifact));
    } catch (error) {
      throw new Error(
        `Persisted run input is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(parsed)) throw new Error('Persisted run input must be a JSON object');
    return parsed;
  }
}

function requiredStep(workflow: WorkflowDefinition, id: string): AgentStep {
  const step = workflow.steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Invalid plan-build-qa workflow: missing ${id} step`);
  return step;
}

function phaseStep(step: AgentStep, iteration: number): AgentStep {
  return { ...step, id: `${step.id}-${iteration + 1}` };
}

function requiredArtifact(
  artifacts: ArtifactReference[],
  stepId: string,
  name: string,
): ArtifactReference {
  const artifact = findArtifact(artifacts, stepId, name);
  if (!artifact) throw new Error(`Missing ${stepId} ${name} artifact`);
  return artifact;
}

function isBlockingReport(report: PlanBuildQaReport): boolean {
  return (
    report.decision === 'block' &&
    report.findings.some(
      (finding) => finding.severity === 'critical' || finding.severity === 'high',
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
