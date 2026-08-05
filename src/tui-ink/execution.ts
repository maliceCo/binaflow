import type { NormalizedEvent } from '../core/events.js';
import type { StepRun, WorkflowRun } from '../core/run.js';
import type { WorkflowContract } from '../workflows/catalog.js';
import { sanitizeInkText } from './text.js';

export const MAX_DISPLAYED_ACTIVITY = 200;
export const MAX_ACTIVITY_BYTES = 64_000;
export const MAX_ACTIVITY_MESSAGE_BYTES = 4_000;

export interface LiveActivity {
  type: NormalizedEvent['type'];
  stepId: string;
  message: string;
  occurredAt: string;
}

export interface LiveStep {
  id: string;
  profile: string;
  status: StepRun['status'];
}

export interface LiveState {
  run: WorkflowRun;
  workflow: WorkflowContract;
  steps: LiveStep[];
  activity: LiveActivity[];
  startedAt: string;
  cancellationRequested: boolean;
  tokens?: number | undefined;
  costUsd?: number | undefined;
}

export interface CompletionState {
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: string[];
  startedAt: string;
  finishedAt: string;
}

export function createLiveState(
  run: WorkflowRun,
  workflow: WorkflowContract,
  previousSteps: StepRun[] = [],
): LiveState {
  return {
    run,
    workflow,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      profile: step.profile,
      status: previousSteps.find((previous) => previous.stepId === step.id)?.status ?? 'pending',
    })),
    activity: [],
    startedAt: run.createdAt,
    cancellationRequested: false,
  };
}

export function appendLiveActivity(state: LiveState, event: NormalizedEvent): LiveState {
  const message = truncateUtf8(sanitizeInkText(event.message), MAX_ACTIVITY_MESSAGE_BYTES);
  const activity = [
    ...state.activity,
    { type: event.type, stepId: event.stepId, message, occurredAt: event.occurredAt },
  ];
  while (activity.length > MAX_DISPLAYED_ACTIVITY || activityBytes(activity) > MAX_ACTIVITY_BYTES) {
    activity.shift();
  }
  return { ...state, activity };
}

export function applyStepSnapshot(state: LiveState, steps: StepRun[]): LiveState {
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  return {
    ...state,
    steps: state.steps.map((step) => ({
      ...step,
      status: byId.get(step.id)?.status ?? step.status,
    })),
    tokens: sumStepTokens(steps),
    costUsd: sumStepCosts(steps),
  };
}

export function sumStepTokens(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.usage?.totalTokens)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

export function sumStepCosts(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.costUsd)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

function activityBytes(activity: LiveActivity[]): number {
  return activity.reduce((total, item) => total + Buffer.byteLength(item.message, 'utf8'), 0);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  return bytes.length <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8');
}
