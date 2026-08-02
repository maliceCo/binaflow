import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink, NormalizedEvent } from '../src/core/events.js';
import type { AgentStepResult } from '../src/core/run.js';
import { WorkflowEngine } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { planBuildWorkflow } from '../src/workflows/plan-build.js';
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
  return { engine, store };
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
  it('runs plan before build and gives the builder the validated artifact', async () => {
    const events: NormalizedEvent[] = [];
    const driver = new FakeDriver([
      plannerResult(),
      { text: 'Build completed', sessionId: 'builder-session' },
    ]);
    const { engine, store } = createEnvironment(driver, events);

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
    expect((await store.getStepRuns('success')).every((step) => step.status === 'completed')).toBe(
      true,
    );
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
