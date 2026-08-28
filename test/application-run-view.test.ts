import { describe, expect, it, vi } from 'vitest';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import { getRunView } from '../src/application/run-view.js';
import { explainRunRecovery } from '../src/application/run-operations.js';
import type { RunStore } from '../src/storage/run-store.js';
import type { ApplicationArtifactStore } from '../src/application/ports.js';

describe('application run view', () => {
  it('orders installed phases, exposes waiting approval, and aggregates persisted data', async () => {
    const run = workflowRun({
      workflowId: 'research-plan-build',
      workflowVersion: 2,
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
      version: 2,
      installedVersion: 2,
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
    expect(view.eventCount).toBe(0);
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
    expect(view.phases.map((phase) => phase.id)).toEqual(['plan']);
    expect(view.phases[0]?.kind).toBe('unknown');
  });

  it('projects clarification follow-up guidance from persisted disposition', async () => {
    const run = workflowRun({ status: 'completed' });
    const steps: StepRun[] = [
      {
        runId: run.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'completed',
        attempt: 1,
        disposition: {
          kind: 'stop',
          code: 'PLAN_NEEDS_CLARIFICATION',
          message: 'The objective needs clarification',
        },
      },
    ];

    const view = await getRunView({ store: store(run, steps) as RunStore }, run.id);

    expect(view.followUp).toEqual({ kind: 'clarification' });
  });

  it('projects QA iteration, blocking findings, and a valid recovery action', async () => {
    const run = workflowRun({ workflowId: 'plan-build-qa', status: 'failed' });
    const input: ArtifactReference = {
      id: 'input',
      runId: run.id,
      stepId: 'run',
      name: 'input',
      kind: 'json',
      path: 'C:/private/input.json',
      mediaType: 'application/json',
      sizeBytes: 1,
    };
    const report: ArtifactReference = {
      id: 'report',
      runId: run.id,
      stepId: 'qa-2',
      name: 'report',
      kind: 'json',
      path: 'C:/private/report.json',
      mediaType: 'application/json',
      sizeBytes: 1,
    };
    const steps: StepRun[] = [
      { runId: run.id, stepId: 'fix-1', profile: 'builder', status: 'completed', attempt: 1 },
      { runId: run.id, stepId: 'qa-2', profile: 'qa', status: 'failed', attempt: 1 },
    ];
    const view = await getRunView(
      {
        store: store(run, steps, [input, report]) as RunStore,
        artifacts: {
          read: async (artifact) =>
            artifact.name === 'input'
              ? JSON.stringify({ objective: run.objective, qaIteration: 1 })
              : JSON.stringify({
                  decision: 'block',
                  summary: 'A blocker remains',
                  findings: [
                    {
                      id: 'finding-1',
                      severity: 'high',
                      category: 'correctness',
                      title: 'Broken behavior',
                      explanation: 'The behavior is incorrect.',
                      impact: 'The objective is not met.',
                      evidence: ['src/example.ts'],
                      suggestedCorrection: 'Fix the behavior.',
                      verifications: ['Run tests'],
                    },
                  ],
                }),
          readBounded: async () => ({ content: '', truncated: false }),
        } as ApplicationArtifactStore,
      },
      run.id,
    );

    expect(view.phases.map((phase) => phase.id)).toEqual([
      'scope',
      'plan',
      'build',
      'qa',
      'fix-1',
      'qa-2',
    ]);
    expect(view.phases.find((phase) => phase.id === 'fix-1')).toMatchObject({
      kind: 'agent',
      profile: 'builder',
      status: 'completed',
    });
    expect(view.currentPhaseId).toBe('qa-2');
    expect(view.qa).toEqual({
      phaseId: 'qa-2',
      iteration: 2,
      limit: 3,
      blockingFindings: 1,
      findings: [{ id: 'finding-1', severity: 'high', title: 'Broken behavior' }],
      recoveryAction: 'resume',
    });
    expect(view.availableActions).toEqual([
      { kind: 'resume', label: 'Resume retryable work', requiresConfirmation: false },
    ]);
  });

  it('calculates elapsed duration for an active phase at view time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    try {
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

      expect(view.phases.find((phase) => phase.id === 'plan')?.durationMs).toBe(5_000);
      expect(view.metrics.durationMs).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('freezes interrupted duration and omits invented timing for stale active steps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    try {
      const interrupted = workflowRun({ status: 'interrupted' });
      const finishedStep: StepRun = {
        runId: interrupted.id,
        stepId: 'plan',
        profile: 'planner',
        status: 'interrupted',
        attempt: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:03.000Z',
      };
      const interruptedView = await getRunView(
        { store: store(interrupted, [finishedStep]) as RunStore },
        interrupted.id,
      );
      expect(interruptedView.phases.find((phase) => phase.id === 'plan')?.durationMs).toBe(3_000);

      const staleStep: StepRun = { ...finishedStep, status: 'running' };
      delete staleStep.finishedAt;
      const staleView = await getRunView(
        { store: store(interrupted, [staleStep]) as RunStore },
        interrupted.id,
      );
      expect(staleView.phases.find((phase) => phase.id === 'plan')?.durationMs).toBeUndefined();
      expect(staleView.metrics.durationMs).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

  it('does not offer recovery for missing or corrupt research input', async () => {
    const run = workflowRun({
      workflowId: 'research-plan-build',
      workflowVersion: 2,
      status: 'failed',
    });
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
    const input: ArtifactReference = {
      id: 'run-input',
      runId: run.id,
      stepId: 'run',
      name: 'input',
      kind: 'json',
      path: 'C:/private/input.json',
      mediaType: 'application/json',
      sizeBytes: 1,
    };

    for (const artifacts of [[], [input]]) {
      const artifactStore = {
        read: async () => {
          if (artifacts.length === 0) throw new Error('not called');
          throw new Error('corrupt input');
        },
        readBounded: async () => ({ content: '', truncated: false }),
      } as ApplicationArtifactStore;
      const context = { store: store(run, steps, artifacts) as RunStore, artifacts: artifactStore };
      const view = await getRunView(context, run.id);
      const recovery = await explainRunRecovery(context, run.id);

      expect(view.availableActions).toEqual([]);
      expect(recovery.eligible).toBe(false);
      expect(recovery.reason).toContain('missing or invalid');
    }
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

  it('does not offer recovery after the research iteration limit is persisted', async () => {
    const run = workflowRun({
      workflowId: 'research-plan-build',
      workflowVersion: 2,
      status: 'failed',
    });
    const input: ArtifactReference = {
      id: 'run-input',
      runId: run.id,
      stepId: 'run',
      name: 'input',
      kind: 'json',
      path: 'C:/private/input.json',
      mediaType: 'application/json',
      sizeBytes: 24,
    };
    const steps: StepRun[] = [
      { runId: run.id, stepId: 'research', profile: 'researcher', status: 'completed', attempt: 1 },
      {
        runId: run.id,
        stepId: 'research-review',
        profile: 'research-reviewer',
        status: 'completed',
        attempt: 1,
      },
      { runId: run.id, stepId: 'plan', profile: 'planner', status: 'pending', attempt: 1 },
      { runId: run.id, stepId: 'build', profile: 'builder', status: 'pending', attempt: 1 },
    ];

    const view = await getRunView(
      {
        store: store(run, steps, [input]) as RunStore,
        artifacts: {
          read: async () => JSON.stringify({ objective: run.objective, researchIteration: 3 }),
          readBounded: async () => ({
            content: JSON.stringify({ objective: run.objective, researchIteration: 3 }),
            truncated: false,
          }),
        } as ApplicationArtifactStore,
      },
      run.id,
    );

    expect(view.availableActions).toEqual([]);
  });
});

function store(
  run: WorkflowRun,
  steps: StepRun[],
  artifacts: ArtifactReference[] = [],
): Pick<RunStore, 'getRun' | 'getStepRuns' | 'getArtifacts' | 'countEvents'> {
  return {
    getRun: async () => run,
    getStepRuns: async () => steps,
    getArtifacts: async () => artifacts,
    countEvents: async () => 0,
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
