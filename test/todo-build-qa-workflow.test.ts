import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult } from '../src/core/run.js';
import type { AgentProfile } from '../src/config.js';
import { createWorkflowRuntime } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { TodoBuildQaCoordinator } from '../src/application/todo-build-qa-coordinator.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';
import { parseTodoAssessment, todoBuildQaWorkflow } from '../src/workflows/todo-build-qa.js';
import { serializeWorkflow, validateWorkflowDefinition } from '../src/core/workflow.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const profiles: Record<string, AgentProfile> = {
  analyst: profile('analyst', 'read-only'),
  builder: profile('builder', 'read-write'),
  qa: profile('qa', 'read-only'),
};

function profile(model: string, workspaceMode: AgentProfile['workspaceMode']): AgentProfile {
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
    emit: EventSink,
    signal: AbortSignal,
  ): Promise<AgentStepResult> {
    void emit;
    void signal;
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`No fake response for ${request.stepId}`);
    if (response instanceof Error) throw response;
    return response;
  }
}

function json(value: unknown): AgentStepResult {
  return { text: JSON.stringify(value) };
}

function assessment(decision: 'ready' | 'needs_preparation' | 'blocked'): AgentStepResult {
  return json({
    decision,
    summary: decision === 'blocked' ? 'The TODO is ambiguous' : 'The TODO is viable',
    tasks:
      decision === 'blocked'
        ? []
        : [
            {
              id: 'task-1',
              title: 'Implement behavior',
              description: 'Make the focused change.',
              files: ['src/example.ts'],
              acceptanceCriteria: ['The behavior works'],
            },
          ],
    preparationTasks:
      decision === 'needs_preparation'
        ? [
            {
              id: 'prep-1',
              title: 'Prepare dependency',
              description: 'Add the required dependency.',
              files: ['package.json'],
              acceptanceCriteria: ['The dependency is available'],
            },
          ]
        : [],
    verification: decision === 'blocked' ? [] : ['Run tests'],
    risks: [],
    blockers: decision === 'blocked' ? ['Authentication storage is not specified.'] : [],
  });
}

function buildResult(id = 'task-1', title = 'Implement behavior'): AgentStepResult {
  return json({
    status: 'passed',
    summary: `${title} completed`,
    resolvedItems: [
      {
        id,
        title,
        resolution: 'Implemented and verified the requested behavior.',
        evidence: ['src/example.ts'],
      },
    ],
    pendingItems: [],
    changedFiles: ['src/example.ts'],
    verifications: [{ command: 'pnpm test', status: 'passed' }],
  });
}

function qaResult(decision: 'pass' | 'block'): AgentStepResult {
  return json({
    decision,
    summary: decision === 'pass' ? 'No blocking findings' : 'A blocking finding remains',
    findings:
      decision === 'pass'
        ? []
        : [
            {
              id: 'finding-1',
              severity: 'high',
              category: 'correctness',
              title: 'Missing validation',
              explanation: 'Invalid input is accepted.',
              impact: 'Invalid state can be persisted.',
              evidence: ['src/example.ts'],
              suggestedCorrection: 'Reject invalid input.',
              verifications: ['Run tests'],
            },
          ],
  });
}

function environment(driver: AgentDriver) {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-todo-build-qa-'));
  directories.push(directory);
  const store = new SqliteRunStore(join(directory, 'run.db'));
  const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
  const runtime = createWorkflowRuntime(store, artifacts, driver, undefined, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  return {
    store,
    artifacts,
    coordinator: new TodoBuildQaCoordinator(runtime, store, artifacts),
  };
}

describe('todo-build-qa contracts', () => {
  it('is serializable, portable, and requires only analyst, builder, and QA profiles', () => {
    const restored: unknown = JSON.parse(serializeWorkflow(todoBuildQaWorkflow));
    validateWorkflowDefinition(restored);

    expect([...new Set(todoBuildQaWorkflow.steps.map((step) => step.profile))]).toEqual([
      'analyst',
      'builder',
      'qa',
    ]);
    expect(todoBuildQaWorkflow.steps.every((step) => !('model' in step))).toBe(true);
  });

  it('enforces preparation and blocker consistency', () => {
    const ready = JSON.parse(assessment('ready').text) as Record<string, unknown>;
    expect(parseTodoAssessment(ready).decision).toBe('ready');
    expect(() =>
      parseTodoAssessment({ ...ready, decision: 'needs_preparation', preparationTasks: [] }),
    ).toThrow('Invalid TODO assessment');
    expect(() => parseTodoAssessment({ ...ready, decision: 'blocked', blockers: [] })).toThrow(
      'Invalid TODO assessment',
    );
  });
});

describe('todo-build-qa workflow', () => {
  it('skips unnecessary preparation, fixes blocking QA, and persists human and JSON results', async () => {
    const driver = new FakeDriver([
      assessment('ready'),
      buildResult(),
      qaResult('block'),
      buildResult('finding-1', 'Missing validation'),
      qaResult('pass'),
    ]);
    const { coordinator, store, artifacts } = environment(driver);

    const run = await coordinator.execute(todoBuildQaWorkflow, {
      runId: 'todo-ready',
      objective: 'Execute the reviewed TODO',
      input: {
        objective: 'Execute the reviewed TODO',
        todo: '# TODO\n- [ ] Implement behavior',
        todoPath: 'TODO.md',
      },
      profiles,
    });

    expect(run.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'validate-todo',
      'build',
      'qa',
      'fix-1',
      'qa-2',
    ]);
    expect(
      (await store.getStepRuns(run.id)).find((step) => step.stepId === 'prepare'),
    ).toMatchObject({ status: 'skipped', skipReason: { code: 'TODO_PREPARATION_NOT_REQUIRED' } });
    const savedArtifacts = await store.getArtifacts(run.id);
    expect(
      savedArtifacts
        .filter((artifact) => artifact.stepId === 'coordinator')
        .map((artifact) => artifact.name),
    ).toEqual(['ORIGINAL-TODO.md', 'QA-FIXES-1.md', 'FINAL-RESULT.json', 'FINAL-REPORT.md']);
    const finalJson = savedArtifacts.find((artifact) => artifact.name === 'FINAL-RESULT.json')!;
    const result = JSON.parse(await artifacts.read(finalJson)) as {
      status: string;
      implementation: { resolvedItems: Array<{ id: string }> };
      qa: { status: string; corrected: number; pending: unknown[] };
    };
    expect(result).toMatchObject({
      status: 'completed',
      qa: { status: 'passed', corrected: 1, pending: [] },
    });
    expect(result.implementation.resolvedItems.map((item) => item.id)).toEqual([
      'task-1',
      'finding-1',
    ]);
    const finalReport = savedArtifacts.find((artifact) => artifact.name === 'FINAL-REPORT.md')!;
    expect(await artifacts.read(finalReport)).toContain('## What was resolved');
    store.close();
  });

  it('resumes after a QA correction without letting older build results replace it', async () => {
    const driver = new FakeDriver([
      assessment('ready'),
      buildResult(),
      qaResult('block'),
      buildResult('finding-1', 'QA correction'),
      new Error('QA transport failed'),
      qaResult('pass'),
    ]);
    const { coordinator, store, artifacts } = environment(driver);
    const retryProfiles = {
      ...profiles,
      qa: { ...profiles.qa!, retryLimit: 1 },
    };

    const first = await coordinator.execute(todoBuildQaWorkflow, {
      runId: 'todo-resume',
      objective: 'Execute TODO',
      input: { objective: 'Execute TODO', todo: '# TODO' },
      profiles: retryProfiles,
    });
    expect(first.status).toBe('failed');

    const resumed = await coordinator.execute(todoBuildQaWorkflow, {
      runId: first.id,
      profiles: retryProfiles,
      resume: true,
    });

    expect(resumed.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'validate-todo',
      'build',
      'qa',
      'fix-1',
      'qa-2',
      'qa-2',
    ]);
    const finalResult = (await store.getArtifacts(resumed.id)).find(
      (artifact) => artifact.name === 'FINAL-RESULT.json',
    )!;
    expect(JSON.parse(await artifacts.read(finalResult))).toMatchObject({
      status: 'completed',
      implementation: { summary: 'QA correction completed' },
    });
    store.close();
  });

  it('executes preparation before the reviewed TODO and stops safely when validation blocks', async () => {
    const prepareDriver = new FakeDriver([
      assessment('needs_preparation'),
      buildResult('prep-1', 'Prepare dependency'),
      buildResult(),
      qaResult('pass'),
    ]);
    const prepared = environment(prepareDriver);
    const preparedRun = await prepared.coordinator.execute(todoBuildQaWorkflow, {
      runId: 'todo-preparation',
      objective: 'Execute TODO',
      input: { objective: 'Execute TODO', todo: '# TODO' },
      profiles,
    });
    expect(preparedRun.status).toBe('completed');
    expect(prepareDriver.calls.map((call) => call.stepId)).toEqual([
      'validate-todo',
      'prepare',
      'build',
      'qa',
    ]);
    expect(
      (await prepared.store.getArtifacts(preparedRun.id)).some(
        (artifact) => artifact.name === 'PREPARATION-TODO.md',
      ),
    ).toBe(true);
    prepared.store.close();

    const blockedDriver = new FakeDriver([assessment('blocked')]);
    const blocked = environment(blockedDriver);
    const blockedRun = await blocked.coordinator.execute(todoBuildQaWorkflow, {
      runId: 'todo-blocked',
      objective: 'Execute TODO',
      input: { objective: 'Execute TODO', todo: '# TODO' },
      profiles,
    });
    expect(blockedRun.status).toBe('completed');
    const resultArtifact = (await blocked.store.getArtifacts(blockedRun.id)).find(
      (artifact) => artifact.name === 'FINAL-RESULT.json',
    )!;
    expect(JSON.parse(await blocked.artifacts.read(resultArtifact))).toMatchObject({
      status: 'blocked',
      assessment: { blockers: ['Authentication storage is not specified.'] },
      qa: { status: 'not_run' },
    });
    blocked.store.close();
  });
});
