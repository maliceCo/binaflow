import type { NormalizedEvent } from '../core/events.js';
import type { StepRun, WorkflowRun } from '../core/run.js';
import type { WorkflowContract } from '../workflows/catalog.js';
import { sanitizeInkText } from './text.js';

export const MAX_DISPLAYED_ACTIVITY = 200;
export const MAX_ACTIVITY_BYTES = 64_000;
export const MAX_ACTIVITY_MESSAGE_BYTES = 4_000;
export const LIVE_UI_FLUSH_MS = 50;

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
  durationMs?: number | undefined;
  costUsd?: number | undefined;
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

export interface LiveActivityBuffer {
  readonly activity: readonly LiveActivity[];
  readonly activityBytes: number;
  append(event: NormalizedEvent): void;
  snapshot(): LiveActivity[];
  clear(): void;
}

export interface SnapshotInspectionController {
  readonly inFlight: boolean;
  readonly generation: number;
  request(reason: 'status' | 'error' | 'timer' | 'flush'): void;
  flush(): Promise<void>;
  dispose(): void;
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

export function createLiveActivityBuffer(
  limits: { maxItems?: number; maxBytes?: number; maxMessageBytes?: number } = {},
): LiveActivityBuffer {
  const maxItems = limits.maxItems ?? MAX_DISPLAYED_ACTIVITY;
  const maxBytes = limits.maxBytes ?? MAX_ACTIVITY_BYTES;
  const maxMessageBytes = limits.maxMessageBytes ?? MAX_ACTIVITY_MESSAGE_BYTES;
  const activity: LiveActivity[] = [];
  let activityBytes = 0;

  const trimFront = (): void => {
    while (activity.length > maxItems || activityBytes > maxBytes) {
      const removed = activity.shift();
      if (!removed) break;
      activityBytes -= Buffer.byteLength(removed.message, 'utf8');
    }
    if (activityBytes < 0) activityBytes = 0;
  };

  return {
    get activity() {
      return activity;
    },
    get activityBytes() {
      return activityBytes;
    },
    append(event) {
      const message = truncateUtf8(sanitizeInkText(event.message), maxMessageBytes);
      const item: LiveActivity = {
        type: event.type,
        stepId: event.stepId,
        message,
        occurredAt: event.occurredAt,
      };
      activity.push(item);
      activityBytes += Buffer.byteLength(message, 'utf8');
      trimFront();
    },
    snapshot() {
      return activity.slice();
    },
    clear() {
      activity.length = 0;
      activityBytes = 0;
    },
  };
}

/** @deprecated Prefer createLiveActivityBuffer; kept for unit tests of pure append. */
export function appendLiveActivity(state: LiveState, event: NormalizedEvent): LiveState {
  const buffer = createLiveActivityBuffer();
  for (const item of state.activity) {
    buffer.append({
      runId: state.run.id,
      stepId: item.stepId,
      type: item.type,
      message: item.message,
      occurredAt: item.occurredAt,
    });
  }
  buffer.append(event);
  return { ...state, activity: buffer.snapshot() };
}

export function applyStepSnapshot(
  state: LiveState,
  steps: StepRun[],
  generation: number,
  appliedGeneration: number,
  nowMs: number = Date.now(),
): LiveState | undefined {
  if (generation < appliedGeneration) return undefined;
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  return {
    ...state,
    steps: state.steps.map((step) => {
      const snapshot = byId.get(step.id);
      if (!snapshot) return step;
      return {
        ...step,
        status: snapshot.status,
        durationMs: stepDurationMs(snapshot, nowMs),
        costUsd: snapshot.result?.costUsd,
      };
    }),
    tokens: sumStepTokens(steps),
    costUsd: sumStepCosts(steps),
  };
}

export function stepDurationMs(step: StepRun, nowMs: number = Date.now()): number | undefined {
  if (!step.startedAt) return undefined;
  const start = Date.parse(step.startedAt);
  if (Number.isNaN(start)) return undefined;
  const end = step.finishedAt ? Date.parse(step.finishedAt) : nowMs;
  if (Number.isNaN(end)) return undefined;
  return Math.max(0, end - start);
}

export function createSnapshotInspectionController(options: {
  inspect: (runId: string) => Promise<StepRun[]>;
  getRunId: () => string | undefined;
  apply: (steps: StepRun[], generation: number) => void;
  intervalMs?: number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}): SnapshotInspectionController {
  const intervalMs = options.intervalMs ?? LIVE_UI_FLUSH_MS;
  const schedule = options.schedule ?? setTimeout;
  const clearSchedule = options.clearSchedule ?? clearTimeout;
  let inFlight = false;
  let pending = false;
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearSchedule(timer);
      timer = undefined;
    }
  };

  const runInspection = async (): Promise<void> => {
    if (disposed || inFlight) return;
    const runId = options.getRunId();
    if (!runId) {
      pending = false;
      return;
    }
    inFlight = true;
    pending = false;
    const token = ++generation;
    try {
      const steps = await options.inspect(runId);
      if (!disposed) options.apply(steps, token);
    } catch {
      // Snapshot inspection is supplemental; live events remain authoritative.
    } finally {
      inFlight = false;
      if (!disposed && pending) void runInspection();
    }
  };

  return {
    get inFlight() {
      return inFlight;
    },
    get generation() {
      return generation;
    },
    request(reason) {
      if (disposed) return;
      if (reason === 'status' || reason === 'error' || reason === 'flush') {
        clearTimer();
        if (inFlight) {
          pending = true;
          return;
        }
        void runInspection();
        return;
      }
      if (timer !== undefined || inFlight) {
        if (inFlight) pending = true;
        return;
      }
      timer = schedule(() => {
        timer = undefined;
        void runInspection();
      }, intervalMs);
    },
    async flush() {
      clearTimer();
      if (disposed) return;
      if (inFlight) {
        pending = true;
        while (inFlight || pending) {
          await Promise.resolve();
          if (!inFlight && pending) await runInspection();
          else if (inFlight) await Promise.resolve();
          else break;
        }
        return;
      }
      pending = true;
      await runInspection();
    },
    dispose() {
      disposed = true;
      clearTimer();
      pending = false;
    },
  };
}

export function createLiveUiPublisher(options: {
  getState: () => LiveState | undefined;
  publish: (state: LiveState) => void;
  buffer: LiveActivityBuffer;
  intervalMs?: number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
}): {
  markDirty: () => void;
  flush: () => void;
  dispose: () => void;
} {
  const intervalMs = options.intervalMs ?? LIVE_UI_FLUSH_MS;
  const schedule = options.schedule ?? setTimeout;
  const clearSchedule = options.clearSchedule ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const publishNow = (): void => {
    const current = options.getState();
    if (!current) return;
    options.publish({ ...current, activity: options.buffer.snapshot() });
  };

  return {
    markDirty() {
      if (disposed || timer !== undefined) return;
      timer = schedule(() => {
        timer = undefined;
        publishNow();
      }, intervalMs);
    },
    flush() {
      if (timer !== undefined) {
        clearSchedule(timer);
        timer = undefined;
      }
      if (!disposed) publishNow();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearSchedule(timer);
        timer = undefined;
      }
    },
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

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  return bytes.length <= maxBytes ? value : bytes.subarray(0, maxBytes).toString('utf8');
}
