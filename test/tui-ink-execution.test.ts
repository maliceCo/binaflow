import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../src/core/events.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
import type { WorkflowContract } from '../src/workflows/catalog.js';
import {
  appendLiveActivity,
  applyStepSnapshot,
  createLiveState,
  MAX_ACTIVITY_BYTES,
  MAX_DISPLAYED_ACTIVITY,
} from '../src/tui-ink/execution.js';

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

  it('applies persisted step state and aggregates usage and cost', () => {
    const state = createLiveState(run('running'), workflow());
    const steps: StepRun[] = [
      {
        runId: 'run-1',
        stepId: 'plan',
        profile: 'planner',
        status: 'completed',
        attempt: 1,
        result: { text: '{}', usage: { totalTokens: 12 }, costUsd: 0.004 },
      },
      {
        runId: 'run-1',
        stepId: 'build',
        profile: 'builder',
        status: 'running',
        attempt: 1,
        result: { text: '', usage: { totalTokens: 8 }, costUsd: 0.002 },
      },
    ];
    const next = applyStepSnapshot(state, steps);
    expect(next.steps.map((step) => step.status)).toEqual(['completed', 'running']);
    expect(next.tokens).toBe(20);
    expect(next.costUsd).toBe(0.006);
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
