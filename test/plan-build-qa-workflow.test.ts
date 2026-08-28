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

  constructor(private readonly responses: AgentStepResult[]) {}

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
    store.close();
  });
});
