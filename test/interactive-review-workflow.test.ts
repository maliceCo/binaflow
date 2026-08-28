import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import type { AgentDriver, AgentRequest } from '../src/core/agent.js';
import { createWorkflowRuntime } from '../src/core/engine.js';
import type { AgentProfile } from '../src/core/agent-profile.js';
import type { WorkflowRun } from '../src/core/run.js';
import { InteractivePlanBuildQaCoordinator } from '../src/application/interactive-plan-build-qa-coordinator.js';
import {
  adjudicateReview,
  decideReview,
  explainReview,
  getReview,
} from '../src/application/review-operations.js';
import type { ApplicationInternals } from '../src/application/context.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { planBuildQaInteractiveWorkflow } from '../src/workflows/plan-build-qa-interactive.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('interactive plan-build-qa workflow', () => {
  it('keeps QA adjudication open and requires new evidence for another adjudication', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-interactive-adjudication-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const run: WorkflowRun = {
      id: 'adjudication-run',
      workflowId: 'plan-build-qa-interactive',
      workflowVersion: 1,
      objective: 'Review a finding',
      status: 'waiting',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    await store.createReviewThread({
      id: 'qa-thread',
      runId: run.id,
      phase: 'qa',
      target: { kind: 'finding', id: 'finding-1' },
      artifactRevision: 1,
      state: 'waiting',
      revision: 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
    const context = { store, artifacts, reviewStore: store } as unknown as ApplicationInternals;
    const request = {
      runId: run.id,
      threadId: 'qa-thread',
      target: { kind: 'finding' as const, id: 'finding-1' },
      decision: 'needs-human-decision' as const,
      issue: 'The finding may be intentional.',
      evidence: ['The public API documents this behavior.'],
      scope: 'The requested API behavior.',
      clarification: 'Confirm whether compatibility is required.',
    };
    const review = await adjudicateReview(context, request);
    expect(review.threads.find((entry) => entry.thread.id === 'qa-thread')?.thread.state).toBe(
      'waiting',
    );
    expect(review.threads.flatMap((entry) => entry.decisions)[0]?.decision).toBe(
      'needs-human-decision',
    );
    await expect(adjudicateReview(context, request)).rejects.toThrow('additional evidence');
    await adjudicateReview(context, {
      ...request,
      evidence: [...request.evidence, 'A compatibility test covers the same behavior.'],
      decision: 'confirmed',
    });
    expect(
      (await getReview(context, run.id)).threads.flatMap((entry) => entry.decisions),
    ).toHaveLength(2);
    store.close();
  });

  it('persists an agent failure as failed instead of interrupted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-interactive-failure-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const runtime = createWorkflowRuntime(store, artifacts, new FailingInteractiveDriver());
    const coordinator = new InteractivePlanBuildQaCoordinator(runtime, store, artifacts);
    const profiles = Object.fromEntries(
      ['analyst', 'planner', 'builder', 'qa'].map((name) => [name, profile(name)]),
    );

    const run = await coordinator.execute(planBuildQaInteractiveWorkflow, {
      objective: 'Fail during review workflow',
      input: { objective: 'Fail during review workflow' },
      profiles,
    });

    expect(run.status).toBe('failed');
    expect((await store.getRun(run.id))?.status).toBe('failed');
    expect(
      (await store.getArtifacts(run.id)).some(
        (artifact) => artifact.stepId === 'coordinator' && artifact.name === 'FINAL-REPORT.md',
      ),
    ).toBe(true);
    store.close();
  });

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

    const scopeDecision = {
      runId: first.id,
      threadId: scopeReview.threads[0]!.thread.id,
      target: { kind: 'scope' as const, id: 'scope' },
    };
    const rejected = await decideReview(context, { ...scopeDecision, decision: 'reject' });
    expect(rejected.status).toBe('waiting');
    expect((await getReview(context, first.id)).threads[0]!.decisions.at(-1)?.decision).toBe(
      'reject',
    );

    const explanationRequest = {
      ...scopeDecision,
      evidence: 'The scope artifact supports this decision.',
    };
    await explainReview(context, explanationRequest);
    await explainReview(context, explanationRequest);
    expect((await getReview(context, first.id)).threads[0]!.messages).toHaveLength(4);
    expect((await store.getRun(first.id))?.status).toBe('waiting');

    const afterScope = await decideReview(context, {
      ...scopeDecision,
      decision: 'approve',
    });
    expect(afterScope.status).toBe('waiting');
    expect(driver.steps).toHaveLength(5);
    expect(driver.steps[0]).toBe('scope');
    expect(driver.steps.slice(1, 3).every((step) => step.startsWith('review-explainer-'))).toBe(
      true,
    );
    expect(driver.steps.slice(-2)).toEqual(['plan', 'build']);

    const afterChangesReview = await getReview(context, first.id);
    const changes = afterChangesReview.threads.find((entry) => entry.thread.phase === 'changes')!;
    const afterChanges = await decideReview(context, {
      runId: first.id,
      threadId: changes.thread.id,
      target: changes.thread.target,
      decision: 'approve',
    });
    expect(afterChanges.status).toBe('waiting');
    expect(driver.steps.slice(-1)).toEqual(['qa']);

    const beforeQa = await getReview(context, first.id);
    const qa = beforeQa.threads.find((entry) => entry.thread.phase === 'qa')!;
    const completed = await decideReview(context, {
      runId: first.id,
      threadId: qa.thread.id,
      target: qa.thread.target,
      decision: 'accept-risk',
    });
    expect(completed.status).toBe('completed');
    expect(
      (await store.getArtifacts(first.id)).map((artifact) => `${artifact.stepId}.${artifact.name}`),
    ).toEqual(expect.arrayContaining(['coordinator.TODO.md', 'coordinator.FINAL-REPORT.md']));
    expect((await store.getRun(first.id))?.status).toBe('completed');
    expect((await getReview(context, first.id)).threads).toHaveLength(3);
    store.close();
  });
});

class FailingInteractiveDriver implements AgentDriver {
  async execute(): Promise<never> {
    throw new Error('agent failed');
  }
}

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
