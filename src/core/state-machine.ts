import type { RunStatus, StepStatus } from './run.js';

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  pending: ['pending', 'running', 'cancelled'],
  running: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: ['completed'],
  failed: ['failed', 'pending'],
  cancelled: ['cancelled'],
  interrupted: ['interrupted', 'pending'],
};

const stepTransitions: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['pending', 'running', 'cancelled', 'skipped'],
  running: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: ['completed'],
  failed: ['failed', 'pending'],
  cancelled: ['cancelled'],
  interrupted: ['interrupted', 'pending'],
  skipped: ['skipped'],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!runTransitions[from].includes(to)) {
    throw new Error(`Invalid run status transition: ${from} -> ${to}`);
  }
}

export function assertStepTransition(from: StepStatus, to: StepStatus): void {
  if (!stepTransitions[from].includes(to)) {
    throw new Error(`Invalid step status transition: ${from} -> ${to}`);
  }
}
