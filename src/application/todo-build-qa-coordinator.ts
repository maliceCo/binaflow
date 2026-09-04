import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { WorkflowArtifactStore } from '../core/ports.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import { isStepRetryEligible } from '../core/run.js';
import type { AgentStep, WorkflowDefinition } from '../core/workflow.js';
import type { WorkflowRuntime } from '../core/workflow-runtime.js';
import {
  findArtifact,
  replaceArtifacts,
  StepExecutionFailure,
  validateWorkflowInput,
} from '../core/workflow-runtime.js';
import type { ApplicationRunStore } from './ports.js';
import { MAX_QA_ITERATIONS, QA_ITERATION_INPUT } from './plan-build-qa-coordinator.js';
import { parsePlanBuildQaQaReport, type PlanBuildQaReport } from '../workflows/plan-build-qa.js';
import { renderQaFixes, renderTodo } from '../workflows/plan-build-qa-render.js';
import {
  parseTodoAssessment,
  parseTodoBuildResult,
  validateTodoBuildQaWorkflowDefinition,
  type TodoAssessment,
  type TodoBuildResult,
} from '../workflows/todo-build-qa.js';
import {
  createTodoFinalResult,
  renderTodoFinalReport,
  type TodoQaIterationResult,
} from '../workflows/todo-build-qa-render.js';

export type TodoBuildQaRuntime = Pick<
  WorkflowRuntime,
  | 'resolveInput'
  | 'prepareRun'
  | 'notifyRunStarted'
  | 'executeStep'
  | 'skipStep'
  | 'saveRunStatus'
  | 'emitStatus'
>;

export type TodoBuildQaPersistence = Pick<
  ApplicationRunStore,
  'getStepRuns' | 'getArtifacts' | 'saveCoordinatorArtifacts'
>;

export class TodoBuildQaCoordinator {
  constructor(
    private readonly runtime: TodoBuildQaRuntime,
    private readonly persistence: TodoBuildQaPersistence,
    private readonly artifactStore: WorkflowArtifactStore,
  ) {}

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validateTodoBuildQaWorkflowDefinition(workflow);
    const input =
      request.resume && request.runId
        ? await this.loadPersistedInput(request.runId)
        : { ...(await this.runtime.resolveInput(request)), [QA_ITERATION_INPUT]: 0 };
    validateWorkflowInput(workflow, input);
    validateIteration(input[QA_ITERATION_INPUT]);

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
    const validateStep = requiredStep(workflow, 'validate-todo');
    const prepareStep = requiredStep(workflow, 'prepare');
    const buildStep = requiredStep(workflow, 'build');
    const qaStep = requiredStep(workflow, 'qa');
    const fixStep = requiredStep(workflow, 'fix');
    const builds = await loadBuildResults(artifacts, this.artifactStore);
    const recordedBuildArtifacts = new Set(
      artifacts.filter(isBuildResultArtifact).map((artifact) => artifact.id),
    );
    const qaReports = await loadQaReports(artifacts, this.artifactStore);
    const runtime = this.runtime;
    let assessment: TodoAssessment | undefined;

    if (!findArtifact(artifacts, 'coordinator', 'ORIGINAL-TODO.md')) {
      artifacts = await persistCoordinatorArtifact(
        run.id,
        'ORIGINAL-TODO.md',
        input.todo as string,
        'text',
        artifacts,
        this.artifactStore,
        this.persistence,
      );
    }

    const finish = async (status: 'completed' | 'failed' | 'cancelled'): Promise<WorkflowRun> => {
      const result = createTodoFinalResult({
        objective: run.objective,
        ...(typeof input.todoPath === 'string' ? { todoSource: input.todoPath } : {}),
        ...(assessment ? { assessment } : {}),
        builds,
        qaReports,
        executionStatus: status,
      });
      try {
        artifacts = await persistCoordinatorArtifact(
          run.id,
          'FINAL-RESULT.json',
          JSON.stringify(result, null, 2),
          'json',
          artifacts,
          this.artifactStore,
          this.persistence,
        );
        artifacts = await persistCoordinatorArtifact(
          run.id,
          'FINAL-REPORT.md',
          renderTodoFinalReport(result),
          'text',
          artifacts,
          this.artifactStore,
          this.persistence,
        );
      } catch (error) {
        await this.runtime
          .emitStatus(
            run.id,
            'coordinator',
            `Final result persistence failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          .catch(() => undefined);
      }
      return this.runtime.saveRunStatus(run, status);
    };

    try {
      await runStep(validateStep);
      assessment = parseTodoAssessment(
        JSON.parse(
          await this.artifactStore.read(requiredArtifact(artifacts, validateStep.id, 'assessment')),
        ),
      );

      if (assessment.decision === 'blocked') {
        for (const step of [prepareStep, buildStep, qaStep]) {
          const skipped = await this.runtime.skipStep(run.id, step, stepRuns.get(step.id), {
            code: 'TODO_BLOCKED',
            message: assessment.blockers.join(' '),
          });
          stepRuns.set(step.id, skipped);
        }
        return finish('completed');
      }

      if (assessment.decision === 'needs_preparation') {
        if (!findArtifact(artifacts, 'coordinator', 'PREPARATION-TODO.md')) {
          artifacts = await persistCoordinatorArtifact(
            run.id,
            'PREPARATION-TODO.md',
            renderTodo({
              summary: assessment.summary,
              tasks: assessment.preparationTasks,
              verification: assessment.verification,
              risks: assessment.risks,
              questions: [],
            }),
            'text',
            artifacts,
            this.artifactStore,
            this.persistence,
          );
        }
        await runStep(prepareStep);
        await recordBuildResult(
          builds,
          requiredArtifact(artifacts, prepareStep.id, 'result'),
          this.artifactStore,
          recordedBuildArtifacts,
        );
      } else {
        const skipped = await this.runtime.skipStep(
          run.id,
          prepareStep,
          stepRuns.get(prepareStep.id),
          {
            code: 'TODO_PREPARATION_NOT_REQUIRED',
            message: 'The reviewed TODO is viable without repository preparation',
          },
        );
        stepRuns.set(prepareStep.id, skipped);
      }

      await runStep(buildStep);
      await recordBuildResult(
        builds,
        requiredArtifact(artifacts, buildStep.id, 'result'),
        this.artifactStore,
        recordedBuildArtifacts,
      );
      let latestBuildStep = iteration === 0 ? buildStep : { ...fixStep, id: `fix-${iteration}` };

      while (true) {
        if (request.signal?.aborted) return finish('cancelled');
        const currentQaStep = qaForIteration(qaStep, iteration, latestBuildStep);
        await runStep(currentQaStep);
        const report = parsePlanBuildQaQaReport(
          JSON.parse(
            await this.artifactStore.read(requiredArtifact(artifacts, currentQaStep.id, 'report')),
          ),
        );
        recordQaReport(qaReports, iteration + 1, report);
        if (!isBlockingReport(report)) return finish('completed');

        artifacts = await persistCoordinatorArtifact(
          run.id,
          `QA-FIXES-${iteration + 1}.md`,
          renderQaFixes(iteration + 1, report),
          'text',
          artifacts,
          this.artifactStore,
          this.persistence,
        );
        if (iteration >= MAX_QA_ITERATIONS - 1) {
          await this.runtime.emitStatus(
            run.id,
            currentQaStep.id,
            `QA stopped after ${MAX_QA_ITERATIONS} iterations`,
          );
          return finish('failed');
        }

        const currentFixStep = fixForIteration(fixStep, iteration, currentQaStep, latestBuildStep);
        await runStep(currentFixStep);
        await recordBuildResult(
          builds,
          requiredArtifact(artifacts, currentFixStep.id, 'result'),
          this.artifactStore,
          recordedBuildArtifacts,
        );
        latestBuildStep = currentFixStep;
        iteration += 1;
        await this.persistIteration(run.id, input, iteration, artifacts).then(
          (nextArtifacts) => (artifacts = nextArtifacts),
        );
      }
    } catch (error) {
      if (!(error instanceof StepExecutionFailure)) throw error;
      const failedStep = error.stepRun;
      for (const step of [validateStep, prepareStep, buildStep, qaStep]) {
        if (step.id === failedStep.stepId || stepRuns.get(step.id)?.status === 'completed')
          continue;
        const skipped = await this.runtime.skipStep(run.id, step, stepRuns.get(step.id), {
          code: 'UPSTREAM_STEP_BLOCKED',
          message: `Dependency ${failedStep.stepId} failed`,
        });
        stepRuns.set(step.id, skipped);
      }
      return finish(failedStep.status === 'cancelled' ? 'cancelled' : 'failed');
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

  private async persistIteration(
    runId: string,
    input: Record<string, unknown>,
    iteration: number,
    artifacts: ArtifactReference[],
  ): Promise<ArtifactReference[]> {
    const nextInput = { ...input, [QA_ITERATION_INPUT]: iteration };
    const inputArtifact = await this.artifactStore.write(
      runId,
      'run',
      'input',
      'json',
      JSON.stringify(nextInput),
      'application/json',
    );
    await this.persistence.saveCoordinatorArtifacts(runId, [inputArtifact]);
    const previousInput = findArtifact(artifacts, 'run', 'input');
    const nextArtifacts = replaceArtifacts(artifacts, [inputArtifact]);
    if (previousInput && previousInput.id !== inputArtifact.id) {
      await this.artifactStore.remove(previousInput).catch(() => undefined);
    }
    Object.assign(input, nextInput);
    return nextArtifacts;
  }

  private async loadPersistedInput(runId: string): Promise<Record<string, unknown>> {
    const inputArtifact = (await this.persistence.getArtifacts(runId)).find(
      (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
    );
    if (!inputArtifact) throw new Error('Missing persisted run input artifact');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.artifactStore.read(inputArtifact));
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
  if (!step) throw new Error(`Invalid todo-build-qa workflow: missing ${id} step`);
  return step;
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

function qaForIteration(qa: AgentStep, iteration: number, build: AgentStep): AgentStep {
  if (iteration === 0) return qa;
  return {
    ...qa,
    id: `qa-${iteration + 1}`,
    dependsOn: [build.id],
    inputReferences: qa.inputReferences.map((reference) =>
      reference.source.kind === 'step-output' && reference.source.stepId === 'build'
        ? { ...reference, source: { ...reference.source, stepId: build.id } }
        : reference,
    ),
  };
}

function fixForIteration(
  fix: AgentStep,
  iteration: number,
  qa: AgentStep,
  build: AgentStep,
): AgentStep {
  return {
    ...fix,
    id: `fix-${iteration + 1}`,
    dependsOn: [qa.id],
    inputReferences: fix.inputReferences.map((reference) => {
      if (reference.source.kind !== 'step-output') return reference;
      if (reference.source.stepId === 'qa') {
        return { ...reference, source: { ...reference.source, stepId: qa.id } };
      }
      if (reference.source.stepId === 'build') {
        return { ...reference, source: { ...reference.source, stepId: build.id } };
      }
      return reference;
    }),
  };
}

function validateIteration(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= MAX_QA_ITERATIONS
  ) {
    throw new Error('Persisted QA iteration is invalid');
  }
}

function isBlockingReport(report: PlanBuildQaReport): boolean {
  return (
    report.decision === 'block' &&
    report.findings.some(
      (finding) => finding.severity === 'critical' || finding.severity === 'high',
    )
  );
}

async function persistCoordinatorArtifact(
  runId: string,
  name: string,
  content: string,
  kind: 'json' | 'text',
  artifacts: ArtifactReference[],
  artifactStore: WorkflowArtifactStore,
  persistence: TodoBuildQaPersistence,
): Promise<ArtifactReference[]> {
  const artifact = await artifactStore.write(
    runId,
    'coordinator',
    name,
    kind,
    content,
    kind === 'json' ? 'application/json' : 'text/markdown',
  );
  await persistence.saveCoordinatorArtifacts(runId, [artifact]);
  const previous = findArtifact(artifacts, 'coordinator', name);
  if (previous && previous.id !== artifact.id) {
    await artifactStore.remove(previous).catch(() => undefined);
  }
  return replaceArtifacts(artifacts, [artifact]);
}

async function loadBuildResults(
  artifacts: ArtifactReference[],
  artifactStore: WorkflowArtifactStore,
): Promise<TodoBuildResult[]> {
  const results: TodoBuildResult[] = [];
  for (const artifact of artifacts.filter(isBuildResultArtifact)) {
    try {
      results.push(parseTodoBuildResult(JSON.parse(await artifactStore.read(artifact))));
    } catch {
      // A failed or interrupted phase may not have a valid result.
    }
  }
  return results;
}

async function loadQaReports(
  artifacts: ArtifactReference[],
  artifactStore: WorkflowArtifactStore,
): Promise<TodoQaIterationResult[]> {
  const results: TodoQaIterationResult[] = [];
  for (const artifact of artifacts.filter(
    (candidate) =>
      candidate.name === 'report' &&
      (candidate.stepId === 'qa' || /^qa-\d+$/.test(candidate.stepId)),
  )) {
    try {
      results.push({
        iteration: artifact.stepId === 'qa' ? 1 : Number(artifact.stepId.slice(3)),
        report: parsePlanBuildQaQaReport(JSON.parse(await artifactStore.read(artifact))),
      });
    } catch {
      // A failed or interrupted phase may not have a valid report.
    }
  }
  return results.sort((left, right) => left.iteration - right.iteration);
}

async function recordBuildResult(
  builds: TodoBuildResult[],
  artifact: ArtifactReference,
  artifactStore: WorkflowArtifactStore,
  recordedArtifacts: Set<string>,
): Promise<void> {
  if (recordedArtifacts.has(artifact.id)) return;
  builds.push(parseTodoBuildResult(JSON.parse(await artifactStore.read(artifact))));
  recordedArtifacts.add(artifact.id);
}

function isBuildResultArtifact(artifact: ArtifactReference): boolean {
  return (
    artifact.name === 'result' &&
    (artifact.stepId === 'prepare' ||
      artifact.stepId === 'build' ||
      /^fix-\d+$/.test(artifact.stepId))
  );
}

function recordQaReport(
  reports: TodoQaIterationResult[],
  iteration: number,
  report: PlanBuildQaReport,
): void {
  const existing = reports.findIndex((entry) => entry.iteration === iteration);
  if (existing === -1) reports.push({ iteration, report });
  else reports[existing] = { iteration, report };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
