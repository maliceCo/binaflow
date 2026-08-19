import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../src/core/events.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
import type { WorkflowContract } from '../src/workflows/catalog.js';
import {
  appendLiveActivity,
  applyStepSnapshot,
  createLiveActivityBuffer,
  createLiveState,
  createLiveUiPublisher,
  createSnapshotInspectionController,
  MAX_ACTIVITY_BYTES,
  MAX_DISPLAYED_ACTIVITY,
} from '../src/tui/execution.js';

describe('Ink execution state', () => {
  it('sanitizes and bounds live activity while retaining the newest events', () => {
    const state = createLiveState(run('running'), workflow());
    let current = state;
    for (let index = 0; index < MAX_DISPLAYED_ACTIVITY + 20; index += 1) {
      current = appendLiveActivity(current, event(`event-${index}`));
    }
    expect(current.activity).toHaveLength(MAX_DISPLAYED_ACTIVITY);
    expect(current.activity[0]?.message).toBe('event-20');
    expect(current.activity.at(-1)?.message).toBe(`event-${MAX_DISPLAYED_ACTIVITY + 19}`);
    expect(
      current.activity.reduce((total, item) => total + Buffer.byteLength(item.message), 0),
    ).toBeLessThanOrEqual(MAX_ACTIVITY_BYTES);
    expect(
      appendLiveActivity(current, event('\u001b[31munsafe\u001b[0m')).activity.at(-1)?.message,
    ).toBe('unsafe');
  });

  it('tracks retained activity bytes incrementally without full rescans on each append', () => {
    const buffer = createLiveActivityBuffer({ maxItems: 5, maxBytes: 40, maxMessageBytes: 20 });
    buffer.append(event('aaaa'));
    expect(buffer.activityBytes).toBe(4);
    buffer.append(event('bbbb'));
    expect(buffer.activityBytes).toBe(8);
    for (let index = 0; index < 10; index += 1) buffer.append(event(`m${index}`));
    expect(buffer.activity.length).toBeLessThanOrEqual(5);
    const recomputed = buffer.activity.reduce(
      (total, item) => total + Buffer.byteLength(item.message, 'utf8'),
      0,
    );
    expect(buffer.activityBytes).toBe(recomputed);
    expect(buffer.activityBytes).toBeLessThanOrEqual(40);
  });

  it('coalesces UI publishes and keeps at most one snapshot inspection in flight', async () => {
    const publishes: number[] = [];
    const buffer = createLiveActivityBuffer();
    const timers: Array<() => void> = [];
    const publisher = createLiveUiPublisher({
      getState: () => createLiveState(run('running'), workflow()),
      publish: () => {
        publishes.push(buffer.activity.length);
      },
      buffer,
      intervalMs: 1_000,
      schedule: (callback) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => {
        timers.length = 0;
      },
    });

    buffer.append(event('one'));
    publisher.markDirty();
    buffer.append(event('two'));
    publisher.markDirty();
    expect(publishes).toEqual([]);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(publishes).toEqual([2]);

    let releaseInspect: ((steps: StepRun[]) => void) | undefined;
    let inspectCalls = 0;
    const applied: Array<{ generation: number; statuses: string[] }> = [];
    const controller = createSnapshotInspectionController({
      inspect: async () => {
        inspectCalls += 1;
        return new Promise<StepRun[]>((resolve) => {
          releaseInspect = resolve;
        });
      },
      getRunId: () => 'run-1',
      apply: (steps, generation) => {
        applied.push({ generation, statuses: steps.map((step) => step.status) });
      },
      intervalMs: 1_000,
      schedule: (callback) => {
        timers.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearSchedule: () => undefined,
    });

    controller.request('status');
    controller.request('status');
    controller.request('timer');
    await Promise.resolve();
    expect(inspectCalls).toBe(1);
    expect(controller.inFlight).toBe(true);

    const firstSteps: StepRun[] = [
      {
        runId: 'run-1',
        stepId: 'plan',
        profile: 'planner',
        status: 'completed',
        attempt: 1,
        result: { text: 'full-body-should-not-matter', usage: { totalTokens: 3 }, costUsd: 0.1 },
      },
      {
        runId: 'run-1',
        stepId: 'build',
        profile: 'builder',
        status: 'running',
        attempt: 1,
      },
    ];
    releaseInspect?.(firstSteps);
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toEqual([{ generation: 1, statuses: ['completed', 'running'] }]);

    // Late older generation cannot regress displayed step state.
    const state = createLiveState(run('running'), workflow());
    const advanced = applyStepSnapshot(state, firstSteps, 2, 1);
    expect(advanced?.steps.map((step) => step.status)).toEqual(['completed', 'running']);
    expect(advanced?.tokens).toBe(3);
    expect(applyStepSnapshot(advanced!, firstSteps, 1, 2)).toBeUndefined();

    controller.dispose();
    publisher.dispose();
  });

  it('applies persisted step state and aggregates usage and cost', () => {
    const state = createLiveState(run('running'), workflow());
    const steps: StepRun[] = [
      {
        runId: 'run-1',
        stepId: 'plan',
        profile: 'planner',
        status: 'completed',
        attempt: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:05.000Z',
        result: { text: '{}', usage: { totalTokens: 12 }, costUsd: 0.004 },
      },
      {
        runId: 'run-1',
        stepId: 'build',
        profile: 'builder',
        status: 'running',
        attempt: 1,
        startedAt: '2026-01-01T00:00:05.000Z',
        result: { text: '', usage: { totalTokens: 8 }, costUsd: 0.002 },
      },
    ];
    const next = applyStepSnapshot(state, steps, 1, 0, Date.parse('2026-01-01T00:00:08.000Z'));
    expect(next).toBeDefined();
    expect(next!.steps.map((step) => step.status)).toEqual(['completed', 'running']);
    expect(next!.steps[0]?.durationMs).toBe(5_000);
    expect(next!.steps[0]?.costUsd).toBe(0.004);
    expect(next!.steps[1]?.durationMs).toBe(3_000);
    expect(next!.tokens).toBe(20);
    expect(next!.costUsd).toBe(0.006);
  });
});

function event(message: string): NormalizedEvent {
  return {
    runId: 'run-1',
    stepId: 'plan',
    type: 'text',
    message,
    occurredAt: new Date().toISOString(),
  };
}

function run(status: WorkflowRun['status']): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Run',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function workflow(): WorkflowContract {
  return {
    id: 'plan-build',
    version: 1,
    description: 'Plan and build',
    input: { required: ['objective'], properties: { objective: { type: 'string' } } },
    requiredProfiles: ['planner', 'builder'],
    steps: [
      { id: 'plan', profile: 'planner', dependsOn: [], outputs: [] },
      { id: 'build', profile: 'builder', dependsOn: ['plan'], outputs: [] },
    ],
  };
}
