import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import { createWorkflowRuntime } from '../src/core/engine.js';
import type { AgentProfile } from '../src/core/agent-profile.js';
import { InteractivePlanBuildQaCoordinator } from '../src/application/interactive-plan-build-qa-coordinator.js';
import { decideReview, getReview } from '../src/application/review-operations.js';
import type { ApplicationInternals } from '../src/application/context.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { planBuildQaInteractiveWorkflow } from '../src/workflows/plan-build-qa-interactive.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('interactive plan-build-qa workflow', () => {
  it('pauses at scope, changes, and QA checkpoints and resumes only after decisions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-interactive-workflow-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const driver = new InteractiveDriver();
    const runtime = createWorkflowRuntime(store, artifacts, driver);
    const coordinator = new InteractivePlanBuildQaCoordinator(runtime, store, artifacts);
    const profiles = Object.fromEntries(
      ['analyst', 'planner', 'builder', 'qa'].map((name) => [name, profile(name)]),
    );
    const context = {
      config: { profiles },
      store,
      artifacts,
      reviewStore: store,
      interactivePlanBuildQaCoordinator: coordinator,
    } as unknown as ApplicationInternals;
    const first = await coordinator.execute(planBuildQaInteractiveWorkflow, {
      objective: 'Review this change',
      input: { objective: 'Review this change' },
      profiles,
    });
    expect(first.status).toBe('waiting');
    const scopeReview = await getReview(context, first.id);
    expect(scopeReview.threads.map((entry) => entry.thread.target)).toEqual([
      { kind: 'scope', id: 'scope' },
    ]);

    const afterScope = await decideReview(context, {
      runId: first.id,
      threadId: scopeReview.threads[0]!.thread.id,
      target: { kind: 'scope', id: 'scope' },
      decision: 'approve',
    });
    expect(afterScope.status).toBe('waiting');
    expect(driver.steps).toEqual(['scope', 'plan', 'build']);

    const afterChangesReview = await getReview(context, first.id);
    const changes = afterChangesReview.threads.find((entry) => entry.thread.phase === 'changes')!;
    const afterChanges = await decideReview(context, {
      runId: first.id,
      threadId: changes.thread.id,
      target: changes.thread.target,
      decision: 'approve',
    });
    expect(afterChanges.status).toBe('waiting');
    expect(driver.steps).toEqual(['scope', 'plan', 'build', 'qa']);

    const beforeQa = await getReview(context, first.id);
    const qa = beforeQa.threads.find((entry) => entry.thread.phase === 'qa')!;
    const completed = await decideReview(context, {
      runId: first.id,
      threadId: qa.thread.id,
      target: qa.thread.target,
      decision: 'approve',
    });
    expect(completed.status).toBe('completed');
    expect((await store.getRun(first.id))?.status).toBe('completed');
    expect((await getReview(context, first.id)).threads).toHaveLength(3);
    store.close();
  });
});

class InteractiveDriver implements AgentDriver {
  readonly steps: string[] = [];

  async execute(request: AgentRequest) {
    this.steps.push(request.stepId);
    const outputs: Record<string, unknown> = {
      scope: {
        strategy: 'Use the smallest safe change',
        inScope: ['The requested behavior'],
        outOfScope: ['Unrelated cleanup'],
        acceptanceCriteria: ['The behavior works'],
        tasks: [
          {
            id: 'task-1',
            title: 'Implement behavior',
            description: 'Update the module.',
            files: ['src/example.ts'],
            acceptanceCriteria: ['The behavior works'],
          },
        ],
        risks: [],
        questions: [],
      },
      plan: {
        summary: 'Implement the behavior',
        tasks: [
          {
            id: 'task-1',
            title: 'Implement behavior',
            description: 'Update the module.',
            files: ['src/example.ts'],
            acceptanceCriteria: ['The behavior works'],
          },
        ],
        verification: ['pnpm test'],
        risks: [],
        questions: [],
      },
      build: {
        status: 'passed',
        summary: 'Built and verified',
        changedFiles: ['src/example.ts'],
        verifications: [{ command: 'pnpm test', status: 'passed' }],
        commits: [],
      },
      qa: { decision: 'pass', summary: 'No blocking findings', findings: [] },
      fix: {
        status: 'passed',
        summary: 'Fixed and verified',
        changedFiles: ['src/example.ts'],
        verifications: [{ command: 'pnpm test', status: 'passed' }],
        commits: [],
      },
    };
    return { text: JSON.stringify(outputs[request.stepId] ?? outputs.qa) };
  }
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    model,
    tools: ['read'],
    workspaceMode: 'read-only',
    timeoutMs: 1000,
    retryLimit: 0,
  };
}
