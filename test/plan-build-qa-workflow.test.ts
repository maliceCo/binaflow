import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult, WorkflowRun } from '../src/core/run.js';
import type { AgentProfile } from '../src/config.js';
import { createWorkflowRuntime } from '../src/core/engine.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { PlanBuildQaCoordinator } from '../src/application/plan-build-qa-coordinator.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';
import { planBuildQaWorkflow } from '../src/workflows/plan-build-qa.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const profiles: Record<string, AgentProfile> = {
  analyst: profile('analyst', 'read-only'),
  planner: profile('planner', 'read-only'),
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

function scopeResult(): AgentStepResult {
  return json({
    decision: 'proceed',
    strategy: 'Make the smallest compatible change',
    inScope: ['The requested behavior'],
    outOfScope: ['Unrelated refactors'],
    acceptanceCriteria: ['The requested behavior works'],
    risks: [],
    questions: [],
  });
}

function planResult(): AgentStepResult {
  return json({
    summary: 'Implement the requested behavior',
    tasks: [
      {
        id: 'task-1',
        title: 'Implement behavior',
        description: 'Make the focused change.',
        files: ['src/example.ts'],
        acceptanceCriteria: ['The behavior works'],
      },
    ],
    verification: ['Run the focused test'],
    risks: [],
    questions: [],
  });
}

function buildResult(): AgentStepResult {
  return json({
    status: 'passed',
    summary: 'Implemented and verified the change',
    changedFiles: ['src/example.ts'],
    verifications: [{ command: 'pnpm test', status: 'passed' }],
    commits: [],
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
              explanation: 'An invalid input is accepted.',
              impact: 'Invalid state can be persisted.',
              evidence: ['src/example.ts'],
              suggestedCorrection: 'Reject invalid input.',
              verifications: ['Run the focused test'],
            },
          ],
  });
}

describe('plan-build-qa workflow', () => {
  it('runs bounded QA fixes and does not rerun completed phases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-plan-build-qa-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const driver = new FakeDriver([
      scopeResult(),
      planResult(),
      buildResult(),
      qaResult('block'),
      buildResult(),
      qaResult('pass'),
    ]);
    const runtime = createWorkflowRuntime(store, artifacts, driver, undefined, {
      interpretDisposition: interpretWorkflowDisposition,
    });
    const coordinator = new PlanBuildQaCoordinator(runtime, store, artifacts);

    const run = await coordinator.execute(planBuildQaWorkflow, {
      runId: 'qa-run',
      objective: 'Improve the workflow',
      profiles,
    });

    expect(run.status).toBe('completed');
    expect(driver.calls.map((call) => call.stepId)).toEqual([
      'scope',
      'plan',
      'build',
      'qa',
      'fix-1',
      'qa-2',
    ]);
    expect((await store.getStepRuns(run.id)).map((step) => step.stepId)).toEqual([
      'scope',
      'plan',
      'build',
      'qa',
      'fix-1',
      'qa-2',
    ]);
    const input = (await store.getArtifacts(run.id)).find(
      (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
    );
    expect(input).toBeDefined();
    expect(JSON.parse(await artifacts.read(input!))).toMatchObject({
      objective: 'Improve the workflow',
      qaIteration: 1,
    });
    const coordinatorArtifacts = await store.getArtifacts(run.id);
    expect(
      coordinatorArtifacts
        .filter((artifact) => artifact.stepId === 'coordinator')
        .map((artifact) => artifact.name),
    ).toEqual(['SCOPE.md', 'TODO.md', 'QA-FIXES-1.md', 'FINAL-REPORT.md']);
    const finalReport = coordinatorArtifacts.find(
      (artifact) => artifact.stepId === 'coordinator' && artifact.name === 'FINAL-REPORT.md',
    );
    expect(await artifacts.read(finalReport!)).toContain('finding-1');
    store.close();
  });

  it('rejects an invalid persisted QA iteration without claiming the run', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-plan-build-qa-invalid-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const run: WorkflowRun = {
      id: 'qa-invalid-run',
      workflowId: 'plan-build-qa',
      workflowVersion: 1,
      objective: 'Reject invalid recovery input',
      status: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const input = await artifacts.write(
      run.id,
      'run',
      'input',
      'json',
      JSON.stringify({ objective: run.objective, qaIteration: 99 }),
      'application/json',
    );
    await store.createRun(run, [input]);
    const runtime = createWorkflowRuntime(store, artifacts, new FakeDriver([]), undefined, {
      interpretDisposition: interpretWorkflowDisposition,
    });
    const coordinator = new PlanBuildQaCoordinator(runtime, store, artifacts);

    await expect(
      coordinator.execute(planBuildQaWorkflow, {
        runId: run.id,
        profiles,
        resume: true,
      }),
    ).rejects.toThrow('Persisted QA iteration is invalid');
    expect((await store.getRun(run.id))?.status).toBe('failed');
    store.close();
  });

  it('always persists a final report when an agent phase fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-plan-build-qa-failure-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const driver = new FakeDriver([new Error('scope failed')]);
    const runtime = createWorkflowRuntime(store, artifacts, driver, undefined, {
      interpretDisposition: interpretWorkflowDisposition,
    });
    const coordinator = new PlanBuildQaCoordinator(runtime, store, artifacts);

    const run = await coordinator.execute(planBuildQaWorkflow, {
      runId: 'qa-failure-run',
      objective: 'Report the failure',
      profiles,
    });

    expect(run.status).toBe('failed');
    const finalReport = (await store.getArtifacts(run.id)).find(
      (artifact) => artifact.stepId === 'coordinator' && artifact.name === 'FINAL-REPORT.md',
    );
    expect(finalReport).toBeDefined();
    expect(await artifacts.read(finalReport!)).toContain('Scope was not completed.');
    store.close();
  });
});
