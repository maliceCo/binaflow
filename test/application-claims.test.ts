import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult } from '../src/core/run.js';
import type { AgentProfile } from '../src/config.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { createWorkflowRuntime, WorkflowEngine } from '../src/core/engine.js';
import { ResearchPlanBuildCoordinator } from '../src/application/research-plan-build-coordinator.js';
import {
  decideApproval,
  resumeWorkflow,
  runWorkflow,
  type ApplicationInternals,
} from '../src/application/operations.js';
import { AgentDriverError } from '../src/drivers/contract.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const profiles: Record<string, AgentProfile> = {
  researcher: profile('researcher'),
  'research-reviewer': profile('research-reviewer'),
  planner: profile('planner'),
  builder: { ...profile('builder'), retryLimit: 1 },
};

class FakeDriver implements AgentDriver {
  readonly calls: AgentRequest[] = [];

  constructor(private readonly responses: Array<AgentStepResult | Error>) {}

  async execute(request: AgentRequest, _emit: EventSink, _signal: AbortSignal) {
    void _emit;
    void _signal;
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`No fake response for ${request.stepId}`);
    if (response instanceof Error) throw response;
    return response;
  }
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    model,
    tools: [],
    workspaceMode: 'read-only',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function context(
  databasePath: string,
  artifactPath: string,
  driver: AgentDriver,
): { context: ApplicationInternals; store: SqliteRunStore } {
  const store = new SqliteRunStore(databasePath);
  const artifacts = new FileArtifactStore(artifactPath);
  const engine = new WorkflowEngine(store, artifacts, driver, undefined, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  return {
    store,
    context: {
      config: { profiles },
      store,
      artifacts,
      engine,
      researchCoordinator: new ResearchPlanBuildCoordinator(
        createWorkflowRuntime(store, artifacts, driver, undefined, {
          interpretDisposition: interpretWorkflowDisposition,
        }),
        store,
        artifacts,
      ),
    },
  };
}

function planResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      decision: 'build',
      summary: 'Implement the change',
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

function reportResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      summary: 'Research completed',
      findings: [
        {
          statement: 'The workflow persists execution state.',
          evidence: [{ type: 'repository', source: 'src/core/engine.ts' }],
        },
      ],
      relevantFiles: ['src/core/engine.ts'],
      constraints: [],
      openQuestions: [],
      risks: [],
    }),
  };
}

function reviewResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      decision: 'ready',
      summary: 'Enough evidence',
      gaps: [],
      nextResearchQuestions: [],
    }),
  };
}

describe('application claim handoff', () => {
  it('allows only one real SQLite resume to reach the driver', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-claims-resume-'));
    directories.push(directory);
    const initial = context(
      join(directory, 'runs.db'),
      join(directory, 'artifacts'),
      new FakeDriver([planResult(), new AgentDriverError('retry', 'BUILD_FAILED', true)]),
    );
    const failed = await runWorkflow(initial.context, {
      workflowId: 'plan-build',
      objective: 'Resume safely',
      input: { objective: 'Resume safely' },
    });
    initial.store.close();
    expect(failed.status).toBe('failed');

    const firstDriver = new FakeDriver([{ text: 'built' }]);
    const secondDriver = new FakeDriver([{ text: 'built' }]);
    const first = context(join(directory, 'runs.db'), join(directory, 'artifacts'), firstDriver);
    const second = context(join(directory, 'runs.db'), join(directory, 'artifacts'), secondDriver);
    try {
      const results = await Promise.allSettled([
        resumeWorkflow(first.context, { runId: failed.id }),
        resumeWorkflow(second.context, { runId: failed.id }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: new Error(`Run ${failed.id} is already running`),
      });
      expect(firstDriver.calls.length + secondDriver.calls.length).toBe(1);
    } finally {
      first.store.close();
      second.store.close();
    }
  });

  it('atomically hands approval execution to one real SQLite claimant', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-claims-approval-'));
    directories.push(directory);
    const initialDriver = new FakeDriver([reportResult(), reviewResult()]);
    const initial = context(
      join(directory, 'runs.db'),
      join(directory, 'artifacts'),
      initialDriver,
    );
    const waiting = await runWorkflow(initial.context, {
      workflowId: 'research-plan-build',
      objective: 'Approve safely',
      input: { objective: 'Approve safely' },
    });
    initial.store.close();
    expect(waiting.status).toBe('waiting');

    const firstDriver = new FakeDriver([planResult(), { text: 'built' }]);
    const secondDriver = new FakeDriver([planResult(), { text: 'built' }]);
    const first = context(join(directory, 'runs.db'), join(directory, 'artifacts'), firstDriver);
    const second = context(join(directory, 'runs.db'), join(directory, 'artifacts'), secondDriver);
    try {
      const results = await Promise.allSettled([
        decideApproval(first.context, { runId: waiting.id, decision: 'approved' }),
        decideApproval(second.context, { runId: waiting.id, decision: 'approved' }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toMatchObject({
        message: expect.stringMatching(/already running|not waiting for approval/),
      });
      expect(firstDriver.calls.length + secondDriver.calls.length).toBe(2);
    } finally {
      first.store.close();
      second.store.close();
    }
  });
});
