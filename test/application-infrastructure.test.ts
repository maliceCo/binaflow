import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import type { EventSink } from '../src/core/events.js';
import type { AgentStepResult, StepRun } from '../src/core/run.js';
import type { AgentProfile } from '../src/config.js';
import type { ApplicationInternals } from '../src/application/operations.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { WorkflowEngine } from '../src/core/engine.js';
import { runWorkflow } from '../src/application/operations.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { interpretWorkflowDisposition } from '../src/workflows/dispositions.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const profiles: Record<string, AgentProfile> = {
  planner: {
    driver: 'pi',
    model: 'planner',
    tools: [],
    workspaceMode: 'read-only',
    timeoutMs: 1_000,
    retryLimit: 0,
  },
  builder: {
    driver: 'pi',
    model: 'builder',
    tools: [],
    workspaceMode: 'read-write',
    timeoutMs: 1_000,
    retryLimit: 0,
  },
};

class FakeDriver implements AgentDriver {
  constructor(private readonly response: AgentStepResult) {}

  async execute(_request: AgentRequest, _emit: EventSink, _signal: AbortSignal) {
    void _request;
    void _emit;
    void _signal;
    return this.response;
  }
}

class FailingReadArtifactStore extends FileArtifactStore {
  failReads = false;

  override async read(artifact: import('../src/core/run.js').ArtifactReference): Promise<string> {
    if (this.failReads) throw new Error('artifact read failed');
    return super.read(artifact);
  }
}

function context(
  directory: string,
  artifacts: FileArtifactStore,
  driver: AgentDriver,
  onEvent?: EventSink,
): { context: ApplicationInternals; store: SqliteRunStore } {
  const store = new SqliteRunStore(join(directory, 'runs.db'));
  const engine = new WorkflowEngine(store, artifacts, driver, onEvent, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  return {
    store,
    context: {
      config: { profiles },
      store,
      artifacts,
      engine,
      researchCoordinator: undefined as never,
    },
  };
}

function planResult(): AgentStepResult {
  return {
    text: JSON.stringify({
      decision: 'build',
      summary: 'Build it',
      tasks: [
        {
          id: 'change',
          title: 'Make the change',
          description: 'Implement the requested behavior.',
          files: ['src/example.ts'],
          acceptanceCriteria: ['The behavior works'],
        },
      ],
      verification: ['Run tests'],
      risks: [],
      clarificationQuestions: [],
    }),
  };
}

describe('application infrastructure failures', () => {
  it('preserves artifact read failures and marks the run interrupted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-infrastructure-artifact-'));
    directories.push(directory);
    const artifacts = new FailingReadArtifactStore(join(directory, 'artifacts'));
    const driver = new FakeDriver(planResult());
    const originalExecute = driver.execute.bind(driver);
    driver.execute = async (request, emit, signal) => {
      const result = await originalExecute(request, emit, signal);
      if (request.stepId === 'plan') artifacts.failReads = true;
      return result;
    };
    const environment = context(directory, artifacts, driver);

    await expect(
      runWorkflow(environment.context, {
        workflowId: 'plan-build',
        objective: 'Preserve infrastructure errors',
        input: { objective: 'Preserve infrastructure errors' },
      }),
    ).rejects.toThrow('artifact read failed');

    const run = (await environment.store.listRunsPage()).runs[0];
    expect(run?.status).toBe('interrupted');
    const steps = await environment.store.getStepRuns(run!.id);
    expect(steps.find((step: StepRun) => step.stepId === 'plan')?.status).toBe('completed');
    environment.store.close();
  });

  it('preserves event sink failures and marks the owned run interrupted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-infrastructure-event-'));
    directories.push(directory);
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const environment = context(directory, artifacts, new FakeDriver(planResult()), async () => {
      throw new Error('event persistence failed');
    });

    await expect(
      runWorkflow(environment.context, {
        workflowId: 'plan-build',
        objective: 'Preserve event errors',
        input: { objective: 'Preserve event errors' },
      }),
    ).rejects.toThrow('event persistence failed');

    const run = (await environment.store.listRunsPage()).runs[0];
    expect(run?.status).toBe('interrupted');
    environment.store.close();
  });
});
