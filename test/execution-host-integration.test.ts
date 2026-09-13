import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult, WorkflowRun } from '../src/core/run.js';
import type { RunWorkflowRequest } from '../src/application/execution-operations.js';
import { createExecutionHost } from '../src/application/execution-host.js';
import { createApplicationService, type ApplicationService } from '../src/application/service.js';
import { createRuntimeEventSink } from '../src/application/runtime.js';
import { createWorkflowRuntime, WorkflowEngine } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { ResearchPlanBuildCoordinator } from '../src/application/research-plan-build-coordinator.js';
import { PlanBuildQaCoordinator } from '../src/application/plan-build-qa-coordinator.js';
import { TodoBuildQaCoordinator } from '../src/application/todo-build-qa-coordinator.js';
import { InteractivePlanBuildQaCoordinator } from '../src/application/interactive-plan-build-qa-coordinator.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';

const temporaryDirectories: string[] = [];
const request = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  workflowId: 'plan-build',
  objective: 'Implement hosted reconnection',
};

const profiles = {
  planner: {
    driver: 'pi',
    model: 'planner-test',
    tools: [],
    workspaceMode: 'read-only' as const,
    timeoutMs: 1000,
    retryLimit: 0,
  },
  builder: {
    driver: 'pi',
    model: 'builder-test',
    tools: [],
    workspaceMode: 'read-write' as const,
    timeoutMs: 1000,
    retryLimit: 1,
  },
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('hosted execution integration', () => {
  it('keeps execution alive while one client disconnects and another reconnects', async () => {
    const environment = createEnvironment();
    try {
      const receipt = await environment.host.client.start(request);
      await environment.driver.planStarted();
      expect(receipt).toEqual({ runId: `host-${request.requestId}` });
      expect(environment.driver.calls.map((call) => call.stepId)).toEqual(['plan']);

      const running = await environment.host.client.getRunView(receipt.runId);
      expect(running.status).toBe('running');
      const events = await environment.host.client.listRunEvents(receipt.runId, { afterId: 0 });
      expect(events.events.some((event) => event.stepId === 'plan')).toBe(true);

      environment.driver.releaseBuilder();
      const completed = await environment.workflowFinished.promise;
      expect(completed?.status).toBe('completed');
      expect(environment.driver.calls.map((call) => call.stepId)).toEqual(['plan', 'build']);

      const reconnected = await environment.host.client.getRunView(receipt.runId);
      expect(reconnected.status).toBe('completed');
      expect(reconnected.artifacts.some((artifact) => artifact.stepId === 'build')).toBe(true);
    } finally {
      environment.driver.releaseBuilder();
      await environment.host.close();
    }
  });

  it('replays a completed persisted run after recreating the host without calling the agent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-host-integration-'));
    temporaryDirectories.push(directory);
    const first = createEnvironment({}, directory);
    try {
      const firstRun = await first.host.client.start(request);
      first.driver.releaseBuilder();
      await first.workflowFinished.promise;
      await first.host.close();

      const second = createEnvironment({}, directory);
      try {
        const replay = await second.host.client.start(request);
        expect(replay).toEqual(firstRun);
        expect(second.driver.calls).toHaveLength(0);
        await expect(
          second.host.client.start({ ...request, objective: 'A different objective' }),
        ).rejects.toThrow(/conflict|objective/i);
        expect(second.driver.calls).toHaveLength(0);
      } finally {
        second.driver.releaseBuilder();
        await second.host.close();
      }
    } finally {
      first.driver.releaseBuilder();
    }
  });

  it('uses the existing explicit resume path without rerunning the completed plan', async () => {
    const environment = createEnvironment({ failBuilderOnce: true });
    try {
      const receipt = await environment.host.client.start(request);
      const failed = await environment.workflowFinished.promise;
      expect(failed?.status).toBe('failed');
      expect(environment.driver.calls.map((call) => call.stepId)).toEqual(['plan', 'build']);

      environment.driver.releaseBuilder();
      const resumed = await environment.application.resumeWorkflow({ runId: receipt.runId });
      expect(resumed.run.status).toBe('completed');
      expect(environment.driver.calls.map((call) => call.stepId)).toEqual([
        'plan',
        'build',
        'build',
      ]);
    } finally {
      environment.driver.releaseBuilder();
      await environment.host.close();
    }
  });

  it('cancels during the builder and preserves the completed plan', async () => {
    const environment = createEnvironment();
    try {
      const receipt = await environment.host.client.start(request);
      await environment.driver.builderStarted();
      const cancellation = environment.host.client.cancel(receipt.runId);
      await cancellation;
      const view = await environment.host.client.getRunView(receipt.runId);
      expect(view.status).toBe('cancelled');
      expect(view.phases.find((phase) => phase.id === 'plan')?.status).toBe('completed');
      expect(environment.driver.calls.map((call) => call.stepId)).toEqual(['plan', 'build']);
    } finally {
      environment.driver.releaseBuilder();
      await environment.host.close();
    }
  });
});

class ControlledDriver implements AgentDriver {
  readonly calls: AgentRequest[] = [];
  private readonly planStartedGate = deferred<void>();
  private readonly builderStartedGate = deferred<void>();
  private readonly builderGate = deferred<void>();
  private builderFailuresRemaining: number;

  constructor(options: { failBuilderOnce?: boolean } = {}) {
    this.builderFailuresRemaining = options.failBuilderOnce ? 1 : 0;
  }

  async execute(
    request: AgentRequest,
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<AgentStepResult> {
    this.calls.push(request);
    await emit({
      runId: request.runId,
      stepId: request.stepId,
      type: 'text',
      message: `controlled ${request.stepId}`,
      occurredAt: new Date().toISOString(),
    });
    if (request.stepId === 'plan') this.planStartedGate.resolve();
    if (request.stepId === 'build') {
      this.builderStartedGate.resolve();
      if (this.builderFailuresRemaining > 0) {
        this.builderFailuresRemaining -= 1;
        throw new Error('controlled builder failure');
      }
      const cancelled = new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      await Promise.race([this.builderGate.promise, cancelled]);
    }
    if (signal.aborted) throw new Error('driver cancelled');
    if (request.stepId === 'plan') return plannerResult();
    return { text: 'Build completed', sessionId: 'builder-session' };
  }

  planStarted(): Promise<void> {
    return this.planStartedGate.promise;
  }

  builderStarted(): Promise<void> {
    return this.builderStartedGate.promise;
  }

  releaseBuilder(): void {
    this.builderGate.resolve();
  }
}

function createEnvironment(
  options: { failBuilderOnce?: boolean } = {},
  directory = mkdtempSync(join(tmpdir(), 'binaflow-host-integration-')),
) {
  if (!temporaryDirectories.includes(directory)) temporaryDirectories.push(directory);
  const store = new SqliteRunStore(join(directory, 'run.db'));
  const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
  const driver = new ControlledDriver(options);
  const eventSink = createRuntimeEventSink(store);
  const runtime = createWorkflowRuntime(store, artifactStore, driver, eventSink, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  const engine = new WorkflowEngine(store, artifactStore, driver, eventSink, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  const application = createApplicationService({
    config: {
      profiles,
      qaHistory: { enabled: false },
      preparation: { reviewMode: 'human' },
    },
    store,
    artifacts: artifactStore,
    engine,
    researchCoordinator: new ResearchPlanBuildCoordinator(runtime, store, artifactStore),
    planBuildQaCoordinator: new PlanBuildQaCoordinator(runtime, store, artifactStore),
    todoBuildQaCoordinator: new TodoBuildQaCoordinator(runtime, store, artifactStore),
    interactivePlanBuildQaCoordinator: new InteractivePlanBuildQaCoordinator(
      runtime,
      store,
      artifactStore,
    ),
    reviewStore: store,
    preparationStore: store,
    preparationArtifacts: artifactStore,
    preparationDriver: driver,
    readPreparationReviewMode: async () => 'human',
    modelDiscovery: { discoverModels: async () => [] },
    subscribeEvents: () => () => undefined,
  });
  const workflowFinished = deferred<WorkflowRun | undefined>();
  const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input: RunWorkflowRequest) => {
    const operation = application.runWorkflow(input);
    void operation.then(
      (run) => workflowFinished.resolve(run),
      () => workflowFinished.resolve(undefined),
    );
    return operation;
  });
  const host = createExecutionHost({
    application: { ...application, runWorkflow },
    findRun: (runId) => store.getRun(runId),
    close: () => store.close(),
  });
  return { host, application, driver, workflowFinished, runWorkflow };
}

function plannerResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      decision: 'build',
      summary: 'Implement the objective',
      tasks: [
        {
          id: 'change',
          title: 'Make the change',
          description: 'Implement the requested behavior.',
          files: ['src/example.ts'],
          acceptanceCriteria: ['The behavior works'],
        },
      ],
      verification: ['Run the focused test'],
      risks: [],
      clarificationQuestions: [],
    }),
    sessionId: 'planner-session',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
