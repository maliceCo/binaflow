import { randomUUID } from 'node:crypto';
import type { AgentDriver } from './agent.js';
import type { EventSink, NormalizedEvent } from './events.js';
import type { ArtifactReference, AgentStepResult, StepRun, WorkflowRun } from './run.js';
import type { RunStore } from '../storage/run-store.js';
import type { ArtifactStore } from '../artifacts/artifact-store.js';
import { resolveProfile, type AgentProfile } from '../config.js';
import { parseBuildPlan } from '../workflows/plan-build.js';
import { resolveStepOrder } from './references.js';
import { validateWorkflowDefinition, type AgentStep, type WorkflowDefinition } from './workflow.js';

export interface ExecuteWorkflowRequest {
  objective?: string;
  input?: Record<string, unknown>;
  profiles: Record<string, AgentProfile>;
  runId?: string;
  resume?: boolean;
  signal?: AbortSignal;
}

export class WorkflowEngine {
  constructor(
    private readonly runStore: RunStore,
    private readonly artifactStore: ArtifactStore,
    private readonly driver: AgentDriver,
    private readonly eventSink: EventSink = () => undefined,
  ) {}

  async execute(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validateWorkflowDefinition(workflow);
    const input = request.input ?? (request.objective ? { objective: request.objective } : {});
    validateInput(workflow, input);

    let run = await this.prepareRun(workflow, request, input);
    if (run.status === 'completed') return run;

    const stepRuns = new Map(
      (await this.runStore.getStepRuns(run.id)).map((step) => [step.stepId, step]),
    );
    const artifacts = await this.runStore.getArtifacts(run.id);
    const statuses = new Map<string, StepRun['status']>(
      [...stepRuns].map(([stepId, stepRun]) => [stepId, stepRun.status]),
    );
    let failed = false;
    let cancelled = false;

    for (const step of resolveStepOrder(workflow)) {
      const existing = stepRuns.get(step.id);
      if (existing?.status === 'completed') continue;

      if (step.dependsOn.some((dependency) => isBlocked(statuses.get(dependency)))) {
        await this.skipStep(run.id, step, existing);
        statuses.set(step.id, 'skipped');
        continue;
      }

      if (existing && !canRetry(existing, request.resume === true)) {
        failed = true;
        statuses.set(step.id, existing.status);
        await this.emitStatus(run.id, step.id, `Step ${step.id} is not retryable`);
        continue;
      }

      try {
        const result = await this.executeStep(run, step, existing, input, artifacts, request);
        stepRuns.set(step.id, result.stepRun);
        statuses.set(step.id, result.stepRun.status);
        artifacts.push(...result.artifacts);
      } catch (error) {
        if (!(error instanceof StepExecutionFailure)) throw error;
        const failure = error.stepRun;
        cancelled ||= failure.status === 'cancelled';
        failed ||= failure.status === 'failed';
        stepRuns.set(step.id, failure);
        statuses.set(step.id, failure.status);
      }
    }

    run = await this.saveRunStatus(run, cancelled ? 'cancelled' : failed ? 'failed' : 'completed');
    return run;
  }

  private async prepareRun(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
    input: Record<string, unknown>,
  ): Promise<WorkflowRun> {
    if (request.resume) {
      if (!request.runId) throw new Error('A run ID is required to resume a workflow');
      const existing = await this.runStore.getRun(request.runId);
      if (!existing) throw new Error(`Unknown run: ${request.runId}`);
      if (existing.workflowId !== workflow.id) {
        throw new Error(`Run ${existing.id} belongs to workflow ${existing.workflowId}`);
      }
      if (existing.status === 'completed') return existing;
      if (existing.status === 'cancelled') throw new Error(`Run ${existing.id} was cancelled`);

      let run = existing;
      if (run.status === 'running') run = await this.saveRunStatus(run, 'interrupted');
      if (run.status === 'failed' || run.status === 'interrupted') {
        run = await this.saveRunStatus(run, 'pending');
      }
      return this.saveRunStatus(run, 'running');
    }

    if (request.objective === undefined || typeof input.objective !== 'string') {
      throw new Error('An objective is required to start a workflow');
    }

    const now = new Date().toISOString();
    const run: WorkflowRun = {
      id: request.runId ?? randomUUID(),
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      objective: request.objective,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await this.runStore.createRun(run);
    return this.saveRunStatus(run, 'running');
  }

  private async executeStep(
    run: WorkflowRun,
    step: AgentStep,
    existing: StepRun | undefined,
    input: Record<string, unknown>,
    artifacts: ArtifactReference[],
    request: ExecuteWorkflowRequest,
  ): Promise<{ stepRun: StepRun; artifacts: ArtifactReference[] }> {
    let pending = await this.prepareStep(run.id, step, existing);
    let repairAttempted = false;

    while (true) {
      const startedAt = new Date().toISOString();
      const running: StepRun = { ...pending, status: 'running', startedAt };
      await this.runStore.saveStepRun(running);
      await this.emitStatus(run.id, step.id, `Step ${step.id} started`);

      try {
        const resolvedInputs = await resolveInputs(step, input, artifacts, this.artifactStore);
        const profile = resolveProfile({ profiles: request.profiles }, step.profile);
        const result = await this.driver.execute(
          {
            runId: run.id,
            stepId: step.id,
            profile,
            prompt: renderPrompt(step.prompt, resolvedInputs, repairAttempted),
          },
          this.eventSink,
          request.signal ?? new AbortController().signal,
        );
        const outputContents = createOutputContents(step, result);
        const savedArtifacts = await Promise.all(
          step.outputs.map((output) =>
            this.artifactStore.write(
              run.id,
              step.id,
              output.name,
              output.format === 'json' ? 'json' : 'text',
              outputContents.get(output.name) ?? result.text,
              output.format === 'json' ? 'application/json' : 'text/plain',
            ),
          ),
        );
        const completed: StepRun = {
          ...running,
          status: 'completed',
          finishedAt: new Date().toISOString(),
          result: {
            ...result,
            text: outputContents.get(step.outputs[0]?.name ?? '') ?? result.text,
          },
        };
        await this.runStore.completeStep(completed, savedArtifacts);
        await this.emitStatus(run.id, step.id, `Step ${step.id} completed`);
        return { stepRun: completed, artifacts: savedArtifacts };
      } catch (error) {
        if (error instanceof PlannerSchemaError && !repairAttempted) {
          await this.recordAttemptFailure(run.id, step, running, error, true);
          pending = { ...running, status: 'pending', attempt: running.attempt + 1 };
          await this.runStore.saveStepRun(pending);
          repairAttempted = true;
          continue;
        }
        const failure = await this.recordFailure(run.id, step, running, error, request);
        throw new StepExecutionFailure(failure);
      }
    }
  }

  private async prepareStep(runId: string, step: AgentStep, existing?: StepRun): Promise<StepRun> {
    if (!existing) {
      const pending: StepRun = {
        runId,
        stepId: step.id,
        profile: step.profile,
        status: 'pending',
        attempt: 1,
      };
      await this.runStore.saveStepRun(pending);
      return pending;
    }

    let attempt = existing.attempt;
    if (
      existing.status === 'failed' ||
      existing.status === 'interrupted' ||
      existing.status === 'running'
    ) {
      attempt += 1;
      if (existing.status === 'running') {
        await this.runStore.saveStepRun({ ...existing, status: 'interrupted' });
      }
      const pending: StepRun = { ...existing, status: 'pending', attempt };
      await this.runStore.saveStepRun(pending);
      return pending;
    }
    return { ...existing, status: 'pending', attempt };
  }

  private async recordFailure(
    runId: string,
    step: AgentStep,
    running: StepRun,
    error: unknown,
    request: ExecuteWorkflowRequest,
  ): Promise<StepRun> {
    const isCancelled = request.signal?.aborted === true;
    const stepError = toStepError(
      error,
      !isCancelled && running.attempt <= (request.profiles[step.profile]?.retryLimit ?? 0),
    );
    const failure: StepRun = {
      ...running,
      status: isCancelled ? 'cancelled' : 'failed',
      finishedAt: new Date().toISOString(),
      error: stepError,
    };
    await this.recordAttemptFailure(
      runId,
      step,
      failure,
      error,
      stepError.retryable,
      failure.status,
    );
    return failure;
  }

  private async recordAttemptFailure(
    runId: string,
    step: AgentStep,
    stepRun: StepRun,
    error: unknown,
    retryable: boolean,
    status: StepRun['status'] = 'failed',
  ): Promise<void> {
    const failure: StepRun = {
      ...stepRun,
      status,
      finishedAt: stepRun.finishedAt ?? new Date().toISOString(),
      error: toStepError(error, retryable),
    };
    await this.runStore.saveStepRun(failure);
    await this.eventSink({
      runId,
      stepId: step.id,
      type: 'error',
      message: failure.error?.message ?? 'Step failed',
      occurredAt: new Date().toISOString(),
    });
  }

  private async skipStep(runId: string, step: AgentStep, existing?: StepRun): Promise<void> {
    if (existing?.status === 'cancelled') return;
    const pending = existing
      ? existing.status === 'pending'
        ? existing
        : { ...existing, status: 'pending' as const }
      : { runId, stepId: step.id, profile: step.profile, status: 'pending' as const, attempt: 1 };
    if (existing?.status === 'running') {
      await this.runStore.saveStepRun({ ...existing, status: 'interrupted' });
    }
    if (existing && existing.status !== 'pending') await this.runStore.saveStepRun(pending);
    if (!existing) await this.runStore.saveStepRun(pending);
    await this.runStore.saveStepRun({ ...pending, status: 'skipped' });
    await this.emitStatus(runId, step.id, `Step ${step.id} skipped because a dependency failed`);
  }

  private async saveRunStatus(
    run: WorkflowRun,
    status: WorkflowRun['status'],
  ): Promise<WorkflowRun> {
    const updated = { ...run, status, updatedAt: new Date().toISOString() };
    if (run.status === 'pending') await this.runStore.saveRun(updated);
    else if (run.status !== status) await this.runStore.saveRun(updated);
    return updated;
  }

  private async emitStatus(runId: string, stepId: string, message: string): Promise<void> {
    const event: NormalizedEvent = {
      runId,
      stepId,
      type: 'status',
      message,
      occurredAt: new Date().toISOString(),
    };
    await this.eventSink(event);
  }
}

async function resolveInputs(
  step: AgentStep,
  input: Record<string, unknown>,
  artifacts: ArtifactReference[],
  artifactStore: ArtifactStore,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const reference of step.inputReferences) {
    const source = reference.source;
    if (source.kind === 'workflow-input') {
      const value = input[source.key];
      if (typeof value !== 'string') throw new Error(`Workflow input is not text: ${source.key}`);
      values[reference.name] = value;
      continue;
    }

    const artifact = artifacts.find(
      (candidate) => candidate.stepId === source.stepId && candidate.name === source.output,
    );
    if (!artifact) {
      throw new Error(`Missing artifact ${source.stepId}.${source.output}`);
    }
    values[reference.name] = await artifactStore.read(artifact);
  }
  return values;
}

function createOutputContents(step: AgentStep, result: AgentStepResult): Map<string, string> {
  const contents = new Map<string, string>();
  for (const output of step.outputs) {
    if (output.format === 'json' && output.name === 'plan') {
      try {
        contents.set(output.name, JSON.stringify(parseBuildPlan(JSON.parse(result.text)), null, 2));
      } catch (error) {
        throw new PlannerSchemaError(
          error instanceof Error ? error.message : 'Invalid planner output',
        );
      }
    } else {
      contents.set(output.name, result.text);
    }
  }
  return contents;
}

function renderPrompt(
  prompt: string,
  inputs: Record<string, string>,
  repairAttempted: boolean,
): string {
  const inputText = Object.entries(inputs)
    .map(([name, value]) => `${name}:\n${value}`)
    .join('\n\n');
  const repairText = repairAttempted
    ? '\nThe previous response failed schema validation. Return only valid JSON matching the requested BuildPlan schema.'
    : '';
  return `${prompt}${repairText}\n\nInputs:\n${inputText}`;
}

function validateInput(workflow: WorkflowDefinition, input: Record<string, unknown>): void {
  for (const required of workflow.input.required) {
    if (!(required in input)) throw new Error(`Missing workflow input: ${required}`);
  }
  for (const [name, property] of Object.entries(workflow.input.properties)) {
    const value = input[name];
    if (value !== undefined && property.type === 'string' && typeof value !== 'string') {
      throw new Error(`Workflow input ${name} must be a string`);
    }
    if (
      typeof value === 'string' &&
      property.minLength !== undefined &&
      value.length < property.minLength
    ) {
      throw new Error(`Workflow input ${name} is too short`);
    }
  }
}

function canRetry(step: StepRun, resume: boolean): boolean {
  if (!resume) return step.status === 'pending';
  return (
    step.status === 'pending' ||
    step.status === 'interrupted' ||
    (step.status === 'failed' && step.error?.retryable === true)
  );
}

function isBlocked(status: StepRun['status'] | undefined): boolean {
  return (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted' ||
    status === 'skipped'
  );
}

function toStepError(error: unknown, retryable: boolean): NonNullable<StepRun['error']> {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof PlannerSchemaError ? 'PLAN_SCHEMA_INVALID' : 'AGENT_EXECUTION_FAILED',
    retryable,
  };
}

class PlannerSchemaError extends Error {}

class StepExecutionFailure extends Error {
  constructor(readonly stepRun: StepRun) {
    super(stepRun.error?.message ?? 'Step failed');
  }
}
