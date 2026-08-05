import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink, NormalizedEvent } from '../src/core/events.js';
import type { AgentStepResult, WorkflowRun } from '../src/core/run.js';
import type { WorkflowDefinition } from '../src/core/workflow.js';
import { WorkflowEngine } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { planBuildWorkflow } from '../src/workflows/plan-build.js';
import { researchPlanBuildWorkflow } from '../src/workflows/research-plan-build.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const profiles = {
  planner: {
    driver: 'fake',
    model: 'planner-test',
    tools: [],
    workspaceMode: 'read-only' as const,
    timeoutMs: 1000,
    retryLimit: 0,
  },
  builder: {
    driver: 'fake',
    model: 'builder-test',
    tools: [],
    workspaceMode: 'read-write' as const,
    timeoutMs: 1000,
    retryLimit: 1,
  },
};

class FakeDriver implements AgentDriver {
  readonly calls: AgentRequest[] = [];

  constructor(private readonly responses: Array<AgentStepResult | Error>) {}

  async execute(
    request: AgentRequest,
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<AgentStepResult> {
    void signal;
    this.calls.push(request);
    await emit({
      runId: request.runId,
      stepId: request.stepId,
      type: 'text',
      message: `fake ${request.stepId}`,
      occurredAt: new Date().toISOString(),
    });
    const response = this.responses.shift();
    if (!response) throw new Error(`No fake response for ${request.stepId}`);
    if (response instanceof Error) throw response;
    return response;
  }
}

function createEnvironment(driver: AgentDriver, events: NormalizedEvent[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-engine-'));
  temporaryDirectories.push(directory);
  const store = new SqliteRunStore(join(directory, 'run.db'));
  const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
  const engine = new WorkflowEngine(store, artifactStore, driver, (event) => {
    events.push(event);
  });
  return { engine, store, artifactStore };
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

function clarificationResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      decision: 'needs_clarification',
      summary: 'The objective needs clarification',
      tasks: [],
      verification: ['Confirm the clarified behavior'],
      risks: [],
      clarificationQuestions: ['What behavior should change?'],
    }),
  };
}

describe('WorkflowEngine', () => {
  it('rejects approval metadata on unsupported workflows', async () => {
    const { engine, store } = createEnvironment(new FakeDriver([]));
    const workflow = {
      ...planBuildWorkflow,
      approval: { id: 'approval', after: 'plan', message: 'Review first' },
    };

    await expect(
      engine.execute(workflow, { objective: 'Reject unsupported approval', profiles }),
    ).rejects.toThrow('approval is only supported');
    store.close();
  });

  it('does not start the next step after cancellation', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const driver: AgentDriver = {
      async execute(request, emit, signal) {
        void emit;
        void signal;
        calls.push(request.stepId);
        controller.abort();
        return plannerResult();
      },
    };
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(planBuildWorkflow, {
      objective: 'Stop before building',
      profiles,
      signal: controller.signal,
    });

    expect(run.status).toBe('cancelled');
    expect(calls).toEqual(['plan']);
    store.close();
  });

  it('records a missing profile as a failed step and run', async () => {
    const driver = new FakeDriver([plannerResult()]);
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(planBuildWorkflow, {
      objective: 'Missing builder profile',
      profiles: { planner: profiles.planner },
    });

    expect(run.status).toBe('failed');
    expect((await store.getStepRuns(run.id)).find((step) => step.stepId === 'build')).toMatchObject(
      {
        status: 'failed',
      },
    );
    store.close();
  });

  it('keeps a terminal run when status event persistence fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-engine-event-failure-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
    const engine = new WorkflowEngine(
      store,
      artifactStore,
      new FakeDriver([plannerResult()]),
      async (event) => {
        if (event.type === 'status' && event.message.includes('started')) {
          throw new Error('event persistence failed');
        }
      },
    );

    const run = await engine.execute(planBuildWorkflow, {
      objective: 'Fail status persistence',
      profiles,
    });

    expect(run.status).toBe('failed');
    expect((await store.getStepRuns(run.id)).find((step) => step.stepId === 'plan')).toMatchObject({
      status: 'failed',
    });
    store.close();
  });

  it('persists a failed run when the start callback rejects', async () => {
    const { engine, store } = createEnvironment(new FakeDriver([]));

    await expect(
      engine.execute(planBuildWorkflow, {
        runId: 'start-callback-failure',
        objective: 'Reject start',
        profiles,
        onRunStarted: () => {
          throw new Error('start callback failed');
        },
      }),
    ).rejects.toThrow('start callback failed');

    expect((await store.getRun('start-callback-failure'))?.status).toBe('failed');
    store.close();
  });

  it('preserves a completed step and artifacts when its completion event fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-post-commit-event-failure-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
    const engine = new WorkflowEngine(
      store,
      artifactStore,
      new FakeDriver([plannerResult()]),
      async (event) => {
        if (event.type === 'status' && event.message.includes('completed')) {
          throw new Error('completion event failed');
        }
      },
    );

    const run = await engine.execute(planBuildWorkflow, {
      runId: 'post-commit-event-failure',
      objective: 'Preserve the committed step',
      profiles,
    });

    expect(run.status).toBe('failed');
    expect((await store.getStepRuns(run.id)).find((step) => step.stepId === 'plan')).toMatchObject({
      status: 'completed',
    });
    expect((await store.getArtifacts(run.id)).some((artifact) => artifact.stepId === 'plan')).toBe(
      true,
    );
    store.close();
  });

  it('persists a failed research run when the start callback rejects', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-research-start-failure-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
    const researchProfiles = {
      researcher: { ...profiles.planner, model: 'researcher' },
      'research-reviewer': { ...profiles.planner, model: 'reviewer' },
      planner: profiles.planner,
      builder: profiles.builder,
    };

    await expect(
      new WorkflowEngine(store, artifactStore, new FakeDriver([])).execute(
        researchPlanBuildWorkflow,
        {
          runId: 'research-start-callback-failure',
          objective: 'Reject research start',
          profiles: researchProfiles,
          onRunStarted: () => {
            throw new Error('research start callback failed');
          },
        },
      ),
    ).rejects.toThrow('research start callback failed');

    expect((await store.getRun('research-start-callback-failure'))?.status).toBe('failed');
    store.close();
  });

  it('notifies run start only after the run is persisted', async () => {
    const driver = new FakeDriver([
      plannerResult(),
      { text: 'Build completed', sessionId: 'builder-session' },
    ]);
    const { engine, store, artifactStore } = createEnvironment(driver);
    let persistedRun: WorkflowRun | undefined;

    const run = await engine.execute(planBuildWorkflow, {
      objective: 'Persist before announcing',
      input: { objective: 'Persist before announcing', extra: 'preserve me' },
      profiles,
      onRunStarted: async (startedRun) => {
        persistedRun = await store.getRun(startedRun.id);
        const inputArtifact = (await store.getArtifacts(startedRun.id)).find(
          (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
        );
        expect(inputArtifact).toBeDefined();
        expect(JSON.parse(await artifactStore.read(inputArtifact!))).toEqual({
          objective: 'Persist before announcing',
          extra: 'preserve me',
        });
      },
    });

    expect(persistedRun).toMatchObject({
      id: run.id,
      workflowId: 'plan-build',
      status: 'running',
    });
    store.close();
  });

  it('runs plan before build and gives the builder the validated artifact', async () => {
    const events: NormalizedEvent[] = [];
    const driver = new FakeDriver([
      plannerResult(),
      { text: 'Build completed', sessionId: 'builder-session' },
    ]);
    const { engine, store, artifactStore } = createEnvironment(driver, events);

    const run = await engine.execute(planBuildWorkflow, {
      runId: 'success',
      objective: 'Add a useful change',
      profiles,
    });

    expect(run.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['plan', 'build']);
    expect(driver.calls[0]!.prompt).toContain('Every task must be an object');
    expect(driver.calls[0]!.prompt).toContain('For decision=build, tasks must be non-empty');
    expect(driver.calls[1]!.prompt).toContain('objective:\nAdd a useful change');
    expect(driver.calls[1]!.prompt).toContain('plan:\n{');
    expect(events.filter((event) => event.type === 'status').length).toBe(4);
    const savedSteps = await store.getStepRuns('success');
    expect(savedSteps.every((step) => step.status === 'completed')).toBe(true);
    expect(savedSteps[0]?.profileSnapshot).toMatchObject({
      driver: 'fake',
      model: 'planner-test',
      tools: [],
      workspaceMode: 'read-only',
      timeoutMs: 1000,
      retryLimit: 0,
    });
    const inputArtifact = (await store.getArtifacts('success')).find(
      (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
    );
    expect(inputArtifact).toBeDefined();
    expect(JSON.parse(await artifactStore.read(inputArtifact!))).toEqual({
      objective: 'Add a useful change',
    });
    store.close();
  });

  it('serializes events from drivers that emit concurrently', async () => {
    const events: string[] = [];
    const driver: AgentDriver = {
      async execute(request, emit) {
        await Promise.all([
          emit({
            runId: request.runId,
            stepId: request.stepId,
            type: 'text',
            message: 'first',
            occurredAt: new Date().toISOString(),
          }),
          emit({
            runId: request.runId,
            stepId: request.stepId,
            type: 'text',
            message: 'second',
            occurredAt: new Date().toISOString(),
          }),
        ]);
        return request.stepId === 'plan' ? plannerResult() : { text: 'built' };
      },
    };
    const { store, artifactStore } = createEnvironment(driver);
    const orderedEngine = new WorkflowEngine(store, artifactStore, driver, async (event) => {
      if (event.type !== 'text') return;
      if (event.message === 'first') await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(event.message);
    });

    const run = await orderedEngine.execute(planBuildWorkflow, {
      runId: 'concurrent-events',
      objective: 'Preserve event order',
      profiles,
    });

    expect(run.status).toBe('completed');
    expect(events).toEqual(['first', 'second', 'first', 'second']);
    store.close();
  });

  it('rejects resume when the persisted workflow version is incompatible', async () => {
    const { engine, store } = createEnvironment(new FakeDriver([]));
    const revisedWorkflow = { ...planBuildWorkflow, version: 2 };
    const run: WorkflowRun = {
      id: 'old-workflow',
      workflowId: planBuildWorkflow.id,
      workflowVersion: 1,
      objective: 'Resume an old run',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);

    await expect(
      engine.execute(revisedWorkflow, {
        runId: run.id,
        input: { objective: run.objective },
        profiles,
        resume: true,
      }),
    ).rejects.toThrow('workflow version 1; installed version is 2');
    store.close();
  });

  it('rejects resume of a live running run without converting it to interrupted', async () => {
    const { engine, store } = createEnvironment(new FakeDriver([]));
    await store.createRun({
      id: 'live-run',
      workflowId: planBuildWorkflow.id,
      workflowVersion: planBuildWorkflow.version,
      objective: 'Keep this run live',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(
      engine.execute(planBuildWorkflow, {
        runId: 'live-run',
        input: { objective: 'Keep this run live' },
        profiles,
        resume: true,
      }),
    ).rejects.toThrow('Run live-run is already running');
    expect((await store.getRun('live-run'))?.status).toBe('running');
    store.close();
  });

  it('restores structured input from the persisted input artifact on resume', async () => {
    const driver = new FakeDriver([
      new Error('temporary failure'),
      plannerResult(),
      { text: 'built' },
    ]);
    const { engine, store } = createEnvironment(driver);
    const workflow: WorkflowDefinition = {
      ...planBuildWorkflow,
      id: 'input-resume',
      input: {
        required: ['objective'],
        properties: {
          objective: { type: 'string', minLength: 1 },
          feedback: { type: 'string' },
        },
      },
      steps: [
        {
          ...planBuildWorkflow.steps[0]!,
          inputReferences: [
            ...planBuildWorkflow.steps[0]!.inputReferences,
            { name: 'feedback', source: { kind: 'workflow-input', key: 'feedback' } },
          ],
        },
      ],
    };
    const retryProfiles = {
      ...profiles,
      planner: { ...profiles.planner, retryLimit: 1 },
    };

    const first = await engine.execute(workflow, {
      runId: 'input-resume',
      objective: 'Add the change',
      input: { objective: 'Add the change', feedback: 'Preserve this feedback' },
      profiles: retryProfiles,
    });
    expect(first.status).toBe('failed');

    const resumed = await engine.execute(workflow, {
      runId: 'input-resume',
      profiles: retryProfiles,
      resume: true,
    });

    expect(resumed.status).toBe('completed');
    expect(driver.calls[1]?.prompt).toContain('Preserve this feedback');
    store.close();
  });

  it('attempts one planner schema repair and fails without starting the builder', async () => {
    const driver = new FakeDriver([{ text: '{invalid' }, { text: '{still invalid' }]);
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(planBuildWorkflow, {
      runId: 'repair-failure',
      objective: 'Add a useful change',
      profiles,
    });
    const steps = await store.getStepRuns('repair-failure');

    expect(run.status).toBe('failed');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['plan', 'plan']);
    expect(steps.find((step) => step.stepId === 'plan')?.error?.code).toBe('PLAN_SCHEMA_INVALID');
    expect(steps.find((step) => step.stepId === 'build')?.status).toBe('skipped');
    store.close();
  });

  it('skips the builder when the completed plan explicitly needs clarification', async () => {
    const driver = new FakeDriver([clarificationResult()]);
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(planBuildWorkflow, {
      runId: 'clarification',
      objective: 'hola',
      profiles,
    });
    const steps = await store.getStepRuns('clarification');

    expect(run.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['plan']);
    expect(steps[0]?.disposition).toEqual({
      kind: 'stop',
      code: 'PLAN_NEEDS_CLARIFICATION',
      message: 'What behavior should change?',
    });
    expect(steps[1]?.status).toBe('skipped');
    expect(steps[1]?.skipReason?.code).toBe('PLAN_NEEDS_CLARIFICATION');
    store.close();
  });

  it('resumes a failed builder without rerunning the completed planner', async () => {
    const driver = new FakeDriver([
      plannerResult(),
      new Error('builder failed'),
      { text: 'Build completed' },
    ]);
    const { engine, store } = createEnvironment(driver);

    const firstRun = await engine.execute(planBuildWorkflow, {
      runId: 'resume',
      objective: 'Add a useful change',
      profiles,
    });
    const resumedRun = await engine.execute(planBuildWorkflow, {
      runId: 'resume',
      input: { objective: 'Add a useful change' },
      profiles,
      resume: true,
    });

    expect(firstRun.status).toBe('failed');
    expect(resumedRun.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['plan', 'build', 'build']);
    expect((await store.getStepRuns('resume')).map((step) => step.status)).toEqual([
      'completed',
      'completed',
    ]);
    store.close();
  });
});
