import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult } from '../src/core/run.js';
import type { AgentProfile } from '../src/config.js';
import { WorkflowEngine } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { researchPlanBuildWorkflow } from '../src/workflows/research-plan-build.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const profiles = {
  researcher: profile('researcher', 'read-only'),
  'research-reviewer': profile('reviewer', 'read-only'),
  planner: profile('planner', 'read-only'),
  builder: profile('builder', 'read-write'),
};

function profile(model: string, workspaceMode: 'read-only' | 'read-write'): AgentProfile {
  return {
    driver: 'fake',
    model,
    tools: [],
    workspaceMode,
    timeoutMs: 1000,
    retryLimit: 0,
  };
}

class FakeDriver implements AgentDriver {
  readonly calls: AgentRequest[] = [];

  constructor(private readonly responses: Array<AgentStepResult | Error>) {}

  async execute(
    request: AgentRequest,
    _emit: EventSink,
    _signal: AbortSignal,
  ): Promise<AgentStepResult> {
    void _emit;
    void _signal;
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`No fake response for ${request.stepId}`);
    if (response instanceof Error) throw response;
    return response;
  }
}

function reportResult(summary = 'Repository and web research completed'): AgentStepResult {
  return {
    text: JSON.stringify({
      summary,
      findings: [
        {
          statement: 'The existing workflow engine persists artifacts.',
          evidence: [{ type: 'repository', source: 'src/core/engine.ts', locator: 'line 211' }],
        },
      ],
      relevantFiles: ['src/core/engine.ts'],
      constraints: ['Keep the change sequential'],
      openQuestions: [],
      risks: [],
    }),
  };
}

function reviewResult(decision: 'ready' | 'needs_more_research'): AgentStepResult {
  return {
    text: JSON.stringify({
      decision,
      summary: decision === 'ready' ? 'Enough evidence' : 'More evidence is needed',
      gaps: decision === 'ready' ? [] : ['Check the persistence contract'],
      nextResearchQuestions: decision === 'ready' ? [] : ['How are artifacts persisted?'],
    }),
  };
}

function planResult(): AgentStepResult {
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
  };
}

function createEnvironment(driver: AgentDriver) {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-research-'));
  temporaryDirectories.push(directory);
  const store = new SqliteRunStore(join(directory, 'run.db'));
  const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
  return { store, artifacts, engine: new WorkflowEngine(store, artifacts, driver) };
}

async function persistedInput(
  store: SqliteRunStore,
  artifacts: FileArtifactStore,
  runId: string,
): Promise<Record<string, unknown>> {
  const inputArtifact = (await store.getArtifacts(runId)).find(
    (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
  );
  expect(inputArtifact).toBeDefined();
  return JSON.parse(await artifacts.read(inputArtifact!)) as Record<string, unknown>;
}

describe('research-plan-build workflow', () => {
  it('waits for approval and continues after approval without repeating research', async () => {
    const driver = new FakeDriver([
      reportResult(),
      reviewResult('ready'),
      planResult(),
      { text: 'built' },
    ]);
    const { engine, store } = createEnvironment(driver);

    const waiting = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'approval',
      objective: 'Improve the workflow',
      profiles,
    });

    expect(waiting.status).toBe('waiting');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['research', 'research-review']);

    const approval = (await store.getStepRuns('approval')).find(
      (step) => step.stepId === 'research-approval',
    )!;
    await store.saveStepRun({
      ...approval,
      status: 'pending',
      approval: { decision: 'approved', decidedAt: new Date().toISOString() },
    });

    const resumed = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'approval',
      input: { objective: 'Improve the workflow' },
      profiles,
      resume: true,
    });

    expect(resumed.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'research',
      'research-review',
      'plan',
      'build',
    ]);
    store.close();
  });

  it('repeats research after automatic review feedback and stops at approval', async () => {
    const driver = new FakeDriver([
      reportResult('First pass'),
      reviewResult('needs_more_research'),
      reportResult('Second pass'),
      reviewResult('ready'),
    ]);
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'research-loop',
      objective: 'Investigate the workflow',
      profiles,
    });

    expect(run.status).toBe('waiting');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'research',
      'research-review',
      'research',
      'research-review',
    ]);
    expect(driver.calls[2]?.prompt).toContain('How are artifacts persisted?');
    expect(
      (await store.getStepRuns('research-loop')).find((step) => step.stepId === 'research')
        ?.attempt,
    ).toBe(2);
    store.close();
  });

  it('does not start research review after cancellation during research', async () => {
    const controller = new AbortController();
    const driver = new FakeDriver([reportResult()]);
    const originalExecute = driver.execute.bind(driver);
    driver.execute = async (...args) => {
      const result = await originalExecute(...args);
      controller.abort();
      return result;
    };
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'research-cancel-boundary',
      objective: 'Stop between research steps',
      profiles,
      signal: controller.signal,
    });

    expect(run.status).toBe('cancelled');
    expect(driver.calls.map((call) => call.stepId)).toEqual(['research']);
    store.close();
  });

  it('repeats research after a human rejection with feedback', async () => {
    const driver = new FakeDriver([
      reportResult(),
      reviewResult('ready'),
      reportResult('With user feedback'),
      reviewResult('ready'),
    ]);
    const { engine, store } = createEnvironment(driver);

    const waiting = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'rejection',
      objective: 'Investigate the workflow',
      profiles,
    });
    const approval = (await store.getStepRuns('rejection')).find(
      (step) => step.stepId === 'research-approval',
    )!;
    await store.saveStepRun({
      ...approval,
      status: 'pending',
      approval: {
        decision: 'rejected',
        feedback: 'Check the persistence migration too.',
        decidedAt: new Date().toISOString(),
      },
    });

    const resumed = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'rejection',
      input: { objective: 'Investigate the workflow' },
      profiles,
      resume: true,
    });

    expect(waiting.status).toBe('waiting');
    expect(resumed.status).toBe('waiting');
    expect(driver.calls[2]?.prompt).toContain('Check the persistence migration too.');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'research',
      'research-review',
      'research',
      'research-review',
    ]);
    store.close();
  });

  it('fails after three research iterations without approval', async () => {
    const driver = new FakeDriver([
      reportResult(),
      reviewResult('needs_more_research'),
      reportResult(),
      reviewResult('needs_more_research'),
      reportResult(),
      reviewResult('needs_more_research'),
    ]);
    const { engine, store } = createEnvironment(driver);

    const run = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'research-limit',
      objective: 'Investigate the workflow',
      profiles,
    });

    expect(run.status).toBe('failed');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'research',
      'research-review',
      'research',
      'research-review',
      'research',
      'research-review',
    ]);
    store.close();
  });

  it('restores automatic research feedback after an interrupted iteration', async () => {
    const interruptedDriver = new FakeDriver([
      reportResult(),
      reviewResult('needs_more_research'),
      new Error('research process interrupted'),
    ]);
    const { engine, store, artifacts } = createEnvironment(interruptedDriver);

    const failed = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'automatic-feedback-resume',
      objective: 'Investigate the workflow',
      profiles,
    });

    expect(failed.status).toBe('failed');
    expect(await persistedInput(store, artifacts, failed.id)).toMatchObject({
      researchFeedback: 'How are artifacts persisted?',
    });

    const resumedDriver = new FakeDriver([reportResult('Resumed pass'), reviewResult('ready')]);
    const resumed = await new WorkflowEngine(store, artifacts, resumedDriver).execute(
      researchPlanBuildWorkflow,
      {
        runId: failed.id,
        profiles,
        resume: true,
      },
    );

    expect(resumed.status).toBe('waiting');
    expect(resumedDriver.calls[0]?.prompt).toContain('How are artifacts persisted?');
    store.close();
  });

  it('restores human rejection feedback after an interrupted iteration', async () => {
    const initialDriver = new FakeDriver([reportResult(), reviewResult('ready')]);
    const { engine, store, artifacts } = createEnvironment(initialDriver);
    const waiting = await engine.execute(researchPlanBuildWorkflow, {
      runId: 'human-feedback-resume',
      objective: 'Investigate the workflow',
      profiles,
    });
    const approval = (await store.getStepRuns(waiting.id)).find(
      (step) => step.stepId === 'research-approval',
    )!;
    await store.saveStepRun({
      ...approval,
      status: 'pending',
      approval: {
        decision: 'rejected',
        feedback: 'Check the persistence migration too.',
        decidedAt: new Date().toISOString(),
      },
    });

    const interrupted = await new WorkflowEngine(
      store,
      artifacts,
      new FakeDriver([new Error('research process interrupted')]),
    ).execute(researchPlanBuildWorkflow, {
      runId: waiting.id,
      profiles,
      resume: true,
    });

    expect(interrupted.status).toBe('failed');
    expect(await persistedInput(store, artifacts, waiting.id)).toMatchObject({
      researchFeedback: 'Check the persistence migration too.',
    });

    const resumedDriver = new FakeDriver([reportResult('Resumed pass'), reviewResult('ready')]);
    const resumed = await new WorkflowEngine(store, artifacts, resumedDriver).execute(
      researchPlanBuildWorkflow,
      {
        runId: waiting.id,
        profiles,
        resume: true,
      },
    );

    expect(resumed.status).toBe('waiting');
    expect(resumedDriver.calls[0]?.prompt).toContain('Check the persistence migration too.');
    store.close();
  });
});
