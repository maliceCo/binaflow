import { describe, expect, it } from 'vitest';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import { getRunView } from '../src/application/run-view.js';
import type { RunStore } from '../src/storage/run-store.js';

describe('application run view', () => {
  it('orders installed phases, exposes waiting approval, and aggregates persisted data', async () => {
    const run = workflowRun({
      workflowId: 'research-plan-build',
      status: 'waiting',
    });
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'research',
        profile: 'researcher',
        status: 'completed',
        attempt: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:02.000Z',
        result: { text: 'omitted from the view', usage: { totalTokens: 12 }, costUsd: 0.25 },
      },
      {
        runId: run.id,
        stepId: 'research-review',
        profile: 'research-reviewer',
        status: 'completed',
        attempt: 1,
        startedAt: '2026-01-01T00:00:02.000Z',
        finishedAt: '2026-01-01T00:00:03.000Z',
        result: { text: 'omitted from the view', usage: { inputTokens: 8 }, costUsd: 0.5 },
      },
      {
        runId: run.id,
        stepId: 'research-approval',
        profile: 'human',
        status: 'waiting',
        attempt: 1,
      },
    ];
    const artifact: ArtifactReference = {
      id: 'report',
      runId: run.id,
      stepId: 'research',
      name: 'report',
      kind: 'json',
      path: 'C:/private/report.json',
      mediaType: 'application/json',
      sizeBytes: 42,
    };

    const view = await getRunView({ store: store(run, steps, [artifact]) as RunStore }, run.id);

    expect(view.workflow).toEqual({
      id: 'research-plan-build',
      version: 1,
      installedVersion: 1,
      compatible: true,
    });
    expect(view.phases.map((phase) => phase.id)).toEqual([
      'research',
      'research-review',
      'research-approval',
      'plan',
      'build',
    ]);
    expect(view.phases.find((phase) => phase.id === 'plan')).toMatchObject({
      status: 'pending',
      profile: 'planner',
    });
    expect(view.currentPhaseId).toBe('research-approval');
    expect(view.pendingAction).toEqual({
      kind: 'research-approval',
      stepId: 'research-approval',
      message: 'Review the research artifact before planning and execution.',
    });
    expect(view.availableActions.map((action) => action.kind)).toEqual([
      'approve-research',
      'reject-research',
    ]);
    expect(view.metrics).toEqual({
      usage: { inputTokens: 8, totalTokens: 12 },
      costUsd: 0.75,
      durationMs: 3_000,
    });
    expect(view.artifacts).toEqual([
      {
        id: 'report',
        stepId: 'research',
        name: 'report',
        kind: 'json',
        mediaType: 'application/json',
        sizeBytes: 42,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain('C:/private/report.json');
    expect(JSON.stringify(view)).not.toContain('omitted from the view');
  });

  it('represents workflow-version incompatibility without offering recovery actions', async () => {
    const run = workflowRun({ workflowId: 'plan-build', workflowVersion: 99, status: 'failed' });
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'failed',
        attempt: 1,
        error: { message: 'temporary failure', retryable: true },
      },
    ];

    const view = await getRunView({ store: store(run, steps) as RunStore }, run.id);

    expect(view.workflow).toEqual({
      id: 'plan-build',
      version: 99,
      installedVersion: 1,
      compatible: false,
    });
    expect(view.availableActions).toEqual([]);
    expect(view.currentPhaseId).toBe('plan');
    expect(view.phases.map((phase) => phase.id)).toEqual(['plan', 'build']);
  });

  it('does not expose a pending approval action for an incompatible workflow', async () => {
    const run = workflowRun({
      workflowId: 'research-plan-build',
      workflowVersion: 99,
      status: 'waiting',
    });
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'research-approval',
        profile: 'human',
        status: 'waiting',
        attempt: 1,
      },
    ];

    const view = await getRunView({ store: store(run, steps) as RunStore }, run.id);

    expect(view.workflow.compatible).toBe(false);
    expect(view.pendingAction).toBeUndefined();
    expect(view.availableActions).toEqual([]);
  });

  it('projects resume for compatible failed work and no actions for a completed run', async () => {
    const failed = workflowRun({ status: 'failed' });
    const failedSteps: StepRun[] = [
      {
        runId: failed.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'failed',
        attempt: 1,
        error: { message: 'temporary failure', retryable: true },
      },
    ];
    const failedView = await getRunView(
      { store: store(failed, failedSteps) as RunStore },
      failed.id,
    );

    expect(failedView.currentPhaseId).toBe('plan');
    expect(failedView.availableActions).toEqual([
      { kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false },
    ]);

    const completed = workflowRun({ status: 'completed' });
    const completedView = await getRunView(
      { store: store(completed, []) as RunStore },
      completed.id,
    );

    expect(completedView.currentPhaseId).toBeUndefined();
    expect(completedView.pendingAction).toBeUndefined();
    expect(completedView.availableActions).toEqual([]);
  });

  it('projects the existing mark-interrupted recovery action for a running run', async () => {
    const run = workflowRun({ status: 'running' });
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'running',
        attempt: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    const view = await getRunView({ store: store(run, steps) as RunStore }, run.id);

    expect(view.currentPhaseId).toBe('plan');
    expect(view.availableActions).toEqual([
      {
        kind: 'mark-interrupted',
        label: 'Mark interrupted and review recovery',
        requiresConfirmation: true,
      },
    ]);
  });
});

function store(
  run: WorkflowRun,
  steps: StepRun[],
  artifacts: ArtifactReference[] = [],
): Pick<RunStore, 'getRun' | 'getStepRuns' | 'getArtifacts'> {
  return {
    getRun: async () => run,
    getStepRuns: async () => steps,
    getArtifacts: async () => artifacts,
  };
}

function workflowRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Inspect the workflow',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:03.000Z',
    ...overrides,
  };
}
