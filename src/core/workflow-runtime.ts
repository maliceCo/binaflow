import { randomUUID } from 'node:crypto';
import { Ajv, type ValidateFunction } from 'ajv';
import type { AgentDriver } from './agent.js';
import type { EventSink, NormalizedEvent } from './events.js';
import type {
  ArtifactReference,
  AgentStepResult,
  StepDisposition,
  StepRun,
  AgentProfileSnapshot,
  StepSkipReason,
  WorkflowRun,
} from './run.js';
import { isStepRetryEligible } from './run.js';
import type { RunStore } from '../storage/run-store.js';
import type { ArtifactStore } from '../artifacts/artifact-store.js';
import { resolveProfile, type AgentProfile } from '../config.js';
import { resolveStepOrder } from './references.js';
import { validateWorkflowDefinition, type AgentStep, type WorkflowDefinition } from './workflow.js';
import type { ExecuteWorkflowRequest } from './execute-request.js';
import { WorkflowVersionMismatchError } from './execute-request.js';

const schemaValidators = new WeakMap<object, ValidateFunction>();
const ajv = new Ajv({ allErrors: true });

export type OutputDispositionInterpreter = (
  disposition: string,
  value: unknown,
) => { content: string; disposition?: StepDisposition };

export interface WorkflowRuntimeOptions {
  interpretDisposition?: OutputDispositionInterpreter;
}

export class WorkflowRuntime {
  constructor(
    readonly runStore: RunStore,
    readonly artifactStore: ArtifactStore,
    private readonly driver: AgentDriver,
    private readonly eventSink: EventSink = () => undefined,
    private readonly options: WorkflowRuntimeOptions = {},
  ) {}

  async executeSequential(
    workflow: WorkflowDefinition,
    request: ExecuteWorkflowRequest,
  ): Promise<WorkflowRun> {
    validateWorkflowDefinition(workflow);
    if (workflow.approval) {
      throw new Error(
        'Workflow approval is not supported by the sequential engine; use the experimental research coordinator',
      );
    }
    const input = await this.resolveInput(request);
    validateWorkflowInput(workflow, input);
    if (request.resume) {
      for (const step of workflow.steps)
        resolveProfile({ profiles: request.profiles }, step.profile);
    }

    let run = await this.prepareRun(workflow, request, input);
    if (run.status === 'completed') return run;
    await this.notifyRunStarted(run, request.onRunStarted);

    const stepRuns = new Map(
      (await this.runStore.getStepRuns(run.id)).map((step) => [step.stepId, step]),
    );
    const artifacts = await this.runStore.getArtifacts(run.id);
    const statuses = new Map<string, StepRun['status']>(
      [...stepRuns].map(([stepId, stepRun]) => [stepId, stepRun.status]),
    );
    let failed = false;
    let cancelled = false;

    try {
      for (const step of resolveStepOrder(workflow)) {
        if (request.signal?.aborted) {
          run = await this.saveRunStatus(run, 'cancelled');
          return run;
        }
        const existing = stepRuns.get(step.id);
        if (existing?.status === 'completed') continue;

        const blockedDependency = step.dependsOn.find((dependency) =>
          isBlocked(statuses.get(dependency)),
        );
        if (blockedDependency) {
          const skipped = await this.skipStep(run.id, step, existing, {
            code: 'UPSTREAM_STEP_BLOCKED',
            message: `Dependency ${blockedDependency} did not complete successfully`,
          });
          stepRuns.set(step.id, skipped);
          statuses.set(step.id, skipped.status);
          continue;
        }

        const stoppingDependency = step.dependsOn.find(
          (dependency) => stepRuns.get(dependency)?.disposition?.kind === 'stop',
        );
        if (stoppingDependency) {
          const disposition = stepRuns.get(stoppingDependency)?.disposition;
          const skipped = await this.skipStep(run.id, step, existing, {
            code: disposition?.kind === 'stop' ? disposition.code : 'UPSTREAM_STEP_STOPPED',
            message:
              disposition?.kind === 'stop'
                ? `Dependency ${stoppingDependency} stopped: ${disposition.message}`
                : `Dependency ${stoppingDependency} stopped before this step`,
          });
          stepRuns.set(step.id, skipped);
          statuses.set(step.id, skipped.status);
          continue;
        }

        if (existing && !isStepRetryEligible(existing, request.resume === true)) {
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
    } catch {
      run = await this.saveRunStatus(run, 'failed');
      return run;
    }

    run = await this.saveRunStatus(run, cancelled ? 'cancelled' : failed ? 'failed' : 'completed');
    return run;
  }

  async prepareRun(
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
      if (existing.workflowVersion !== workflow.version) {
        throw new WorkflowVersionMismatchError(
          existing.id,
          existing.workflowVersion,
          workflow.version,
        );
      }
      if (existing.status === 'completed') return existing;
      if (existing.status === 'cancelled') throw new Error(`Run ${existing.id} was cancelled`);

      if (existing.status === 'failed' || existing.status === 'interrupted') {
        const steps = await this.runStore.getStepRuns(existing.id);
        if (!steps.some((step) => isStepRetryEligible(step, true))) {
          throw new Error(
            `Run ${existing.id} has no retryable failed, interrupted, or pending steps`,
          );
        }
      }

      let run = existing;
      if (run.status === 'running') {
        if (!request.runClaimed) throw new Error(`Run ${run.id} is already running`);
        return run;
      }
      if (request.runClaimed) {
        if (run.status === 'failed' || run.status === 'interrupted') {
          run = await this.saveRunStatus(run, 'pending');
        }
        return this.saveRunStatus(run, 'running');
      }
      const claimed = await this.runStore.claimRun(run.id, [run.status]);
      if (!claimed) {
        const current = await this.runStore.getRun(run.id);
        if (!current) throw new Error(`Unknown run: ${run.id}`);
        if (current.status === 'running') throw new Error(`Run ${run.id} is already running`);
        throw new Error(
          `Run ${run.id} is not eligible for execution from status ${current.status}`,
        );
      }
      return claimed;
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
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    const inputArtifact = await this.artifactStore.write(
      run.id,
      'run',
      'input',
      'json',
      JSON.stringify(input),
      'application/json',
    );
    await this.runStore.createRun(run, [inputArtifact]);
    return run;
  }

  async notifyRunStarted(
    run: WorkflowRun,
    callback: ExecuteWorkflowRequest['onRunStarted'],
  ): Promise<void> {
    try {
      await callback?.(run);
    } catch (error) {
      await this.saveRunStatus(run, 'failed');
      throw error;
    }
  }

  async resolveInput(request: ExecuteWorkflowRequest): Promise<Record<string, unknown>> {
    if (!request.resume || request.input !== undefined) {
      return request.input ?? (request.objective ? { objective: request.objective } : {});
    }

    if (!request.runId) throw new Error('A run ID is required to resume a workflow');
    const run = await this.runStore.getRun(request.runId);
    if (!run) throw new Error(`Unknown run: ${request.runId}`);
    const inputArtifact = (await this.runStore.getArtifacts(run.id)).find(
      (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
    );
    if (!inputArtifact) return { objective: run.objective };
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

  async executeStep(
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
      let running: StepRun = {
        ...pending,
        status: 'running',
        startedAt,
      };
      let completedPersisted = false;

      try {
        await this.runStore.saveStepRun(running);
        const profile = resolveProfile({ profiles: request.profiles }, step.profile);
        running = { ...running, profileSnapshot: snapshotProfile(profile) };
        await this.runStore.saveStepRun(running);
        await this.emitStatus(run.id, step.id, `Step ${step.id} started`);
        const resolvedInputs = await resolveInputs(step, input, artifacts, this.artifactStore);
        const eventQueue = createSerializedEventSink(this.eventSink);
        let result: AgentStepResult | undefined;
        let executionError: unknown;
        try {
          result = await this.driver.execute(
            {
              runId: run.id,
              stepId: step.id,
              profile,
              prompt: renderPrompt(step.prompt, resolvedInputs, repairAttempted),
            },
            eventQueue.emit,
            request.signal ?? new AbortController().signal,
          );
        } catch (error) {
          executionError = error;
        }
        try {
          await eventQueue.flush();
        } catch (error) {
          executionError ??= error;
        }
        if (executionError) throw executionError;
        if (!result) throw new Error('Agent driver returned no result');
        const stepOutput = this.createOutputContents(step, result);
        const savedArtifacts = await Promise.all(
          step.outputs.map((outputDefinition) =>
            this.artifactStore.write(
              run.id,
              step.id,
              outputDefinition.name,
              outputDefinition.format === 'json' ? 'json' : 'text',
              stepOutput.contents.get(outputDefinition.name) ?? result.text,
              outputDefinition.format === 'json' ? 'application/json' : 'text/plain',
            ),
          ),
        );
        const completed: StepRun = {
          ...running,
          status: 'completed',
          finishedAt: new Date().toISOString(),
          result: {
            ...result,
            text: stepOutput.contents.get(step.outputs[0]?.name ?? '') ?? result.text,
          },
          ...(stepOutput.disposition ? { disposition: stepOutput.disposition } : {}),
        };
        await this.runStore.completeStep(completed, savedArtifacts);
        completedPersisted = true;
        await this.emitStatus(run.id, step.id, `Step ${step.id} completed`);
        return { stepRun: completed, artifacts: savedArtifacts };
      } catch (error) {
        if (completedPersisted) throw error;
        if (error instanceof PlannerSchemaError && !repairAttempted) {
          await this.recordAttemptFailure(run.id, step, running, error, true);
          pending = createPendingRetry(running);
          await this.runStore.saveStepRun(pending);
          repairAttempted = true;
          continue;
        }
        const failure = await this.recordFailure(run.id, step, running, error, request);
        throw new StepExecutionFailure(failure);
      }
    }
  }

  async skipStep(
    runId: string,
    step: AgentStep,
    existing: StepRun | undefined,
    reason: StepSkipReason,
  ): Promise<StepRun> {
    if (existing?.status === 'cancelled' || existing?.status === 'skipped') return existing;
    const pending: StepRun = existing
      ? existing.status === 'pending'
        ? existing
        : createPendingRetry(existing, existing.attempt)
      : { runId, stepId: step.id, profile: step.profile, status: 'pending', attempt: 1 };
    if (existing?.status === 'running') {
      await this.runStore.saveStepRun({ ...existing, status: 'interrupted' });
    }
    if (existing && existing.status !== 'pending') await this.runStore.saveStepRun(pending);
    if (!existing) await this.runStore.saveStepRun(pending);
    const skipped: StepRun = { ...pending, status: 'skipped', skipReason: reason };
    await this.runStore.saveStepRun(skipped);
    await this.emitStatus(runId, step.id, `Step ${step.id} skipped: ${reason.message}`);
    return skipped;
  }

  async saveRunStatus(run: WorkflowRun, status: WorkflowRun['status']): Promise<WorkflowRun> {
    const updated = { ...run, status, updatedAt: new Date().toISOString() };
    if (run.status === 'pending') await this.runStore.saveRun(updated, run.status);
    else if (run.status !== status) await this.runStore.saveRun(updated, run.status);
    return updated;
  }

  async emitStatus(runId: string, stepId: string, message: string): Promise<void> {
    const event: NormalizedEvent = {
      runId,
      stepId,
      type: 'status',
      message,
      occurredAt: new Date().toISOString(),
    };
    await this.eventSink(event);
  }

  resetLoopStep(step: StepRun): StepRun {
    return {
      runId: step.runId,
      stepId: step.stepId,
      profile: step.profile,
      status: 'pending',
      attempt: step.attempt + 1,
    };
  }

  async writeResearchInputArtifact(
    runId: string,
    input: Record<string, unknown>,
    artifacts: ArtifactReference[],
  ): Promise<ArtifactReference> {
    if (!findArtifact(artifacts, 'run', 'input')) {
      throw new Error('Missing persisted run input artifact');
    }
    return this.artifactStore.write(
      runId,
      'run',
      'input',
      'json',
      JSON.stringify(input),
      'application/json',
    );
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
      const pending = createPendingRetry(existing, attempt);
      await this.runStore.saveStepRun(pending);
      return pending;
    }
    return createPendingRetry(existing, attempt);
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
    void runId;
    const failure: StepRun = {
      ...stepRun,
      status,
      finishedAt: stepRun.finishedAt ?? new Date().toISOString(),
      error: toStepError(error, retryable),
    };
    await this.runStore.saveStepRun(failure);
    await this.eventSink({
      runId: stepRun.runId,
      stepId: step.id,
      type: 'error',
      message: failure.error?.message ?? 'Step failed',
      occurredAt: new Date().toISOString(),
    });
  }

  private createOutputContents(
    step: AgentStep,
    result: AgentStepResult,
  ): { contents: Map<string, string>; disposition?: StepDisposition } {
    const contents = new Map<string, string>();
    let disposition: StepDisposition | undefined;
    for (const output of step.outputs) {
      if (output.format === 'json') {
        try {
          const value = JSON.parse(result.text) as unknown;
          if (output.schema) validateJsonOutput(value, output.schema);
          if (output.disposition) {
            const interpreter = this.options.interpretDisposition;
            if (!interpreter) {
              throw new PlannerSchemaError(
                `No disposition interpreter registered for ${output.disposition}`,
              );
            }
            const interpreted = interpreter(output.disposition, value);
            contents.set(output.name, interpreted.content);
            disposition = interpreted.disposition;
          } else {
            contents.set(output.name, JSON.stringify(value, null, 2));
          }
        } catch (error) {
          throw new PlannerSchemaError(
            error instanceof Error ? error.message : 'Invalid planner output',
          );
        }
      } else {
        contents.set(output.name, result.text);
      }
    }
    return { contents, ...(disposition ? { disposition } : {}) };
  }
}

export class StepExecutionFailure extends Error {
  constructor(readonly stepRun: StepRun) {
    super(stepRun.error?.message ?? 'Step failed');
  }
}

export function validateWorkflowInput(
  workflow: WorkflowDefinition,
  input: Record<string, unknown>,
): void {
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

export function replaceArtifacts(
  existing: ArtifactReference[],
  replacements: ArtifactReference[],
): ArtifactReference[] {
  const result = existing.filter(
    (artifact) =>
      !replacements.some(
        (replacement) =>
          replacement.stepId === artifact.stepId && replacement.name === artifact.name,
      ),
  );
  result.push(...replacements);
  return result;
}

export function findArtifact(
  artifacts: ArtifactReference[],
  stepId: string,
  name: string,
): ArtifactReference | undefined {
  return artifacts.find((artifact) => artifact.stepId === stepId && artifact.name === name);
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

function validateJsonOutput(value: unknown, schema: Record<string, unknown>): void {
  let validate = schemaValidators.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    schemaValidators.set(schema, validate);
  }
  if (!validate(value)) {
    const details = validate.errors?.map((error) => error.message).join(', ');
    throw new PlannerSchemaError(
      `Structured output schema invalid${details ? `: ${details}` : ''}`,
    );
  }
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
    ? '\nThe previous response failed schema validation. Return only valid JSON matching the requested structured output schema.'
    : '';
  return `${prompt}${repairText}\n\nInputs:\n${inputText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const driverError = isAgentDriverError(error) ? error : undefined;
  return {
    message: error instanceof Error ? error.message : String(error),
    code:
      error instanceof PlannerSchemaError
        ? 'PLAN_SCHEMA_INVALID'
        : driverError
          ? driverError.code
          : 'AGENT_EXECUTION_FAILED',
    retryable: retryable && (driverError?.retryable ?? true),
  };
}

function isAgentDriverError(error: unknown): error is Error & { code: string; retryable: boolean } {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  );
}

function createPendingRetry(step: StepRun, attempt = step.attempt + 1): StepRun {
  return {
    runId: step.runId,
    stepId: step.stepId,
    profile: step.profile,
    status: 'pending',
    attempt,
  };
}

function snapshotProfile(profile: AgentProfile): AgentProfileSnapshot {
  const snapshot: AgentProfileSnapshot = {
    driver: profile.driver,
    model: profile.model,
    tools: [...profile.tools],
    workspaceMode: profile.workspaceMode,
    timeoutMs: profile.timeoutMs,
    retryLimit: profile.retryLimit,
  };
  if (profile.provider !== undefined) snapshot.provider = profile.provider;
  if (profile.thinking !== undefined) snapshot.thinking = profile.thinking;
  if (profile.projectTrust !== undefined) snapshot.projectTrust = profile.projectTrust;
  return snapshot;
}

class PlannerSchemaError extends Error {}

function createSerializedEventSink(sink: EventSink): {
  emit: EventSink;
  flush(): Promise<void>;
} {
  let queue = Promise.resolve();
  let failed = false;
  let firstError: unknown;

  const emit: EventSink = (event) => {
    queue = queue.then(async () => {
      if (failed) return;
      try {
        await sink(event);
      } catch (error) {
        failed = true;
        firstError = error;
      }
    });
    return queue;
  };

  return {
    emit,
    async flush(): Promise<void> {
      await queue;
      if (failed) throw firstError;
      await sink.flush?.();
    },
  };
}
