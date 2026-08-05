import type { RunStatus, StepStatus } from './run.js';

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  pending: ['pending', 'running', 'cancelled'],
  running: ['running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting: ['waiting', 'running', 'failed', 'cancelled'],
  completed: ['completed'],
  failed: ['failed', 'pending', 'running'],
  cancelled: ['cancelled'],
  interrupted: ['interrupted', 'pending', 'running'],
};

const stepTransitions: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['pending', 'running', 'waiting', 'completed', 'cancelled', 'skipped'],
  running: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting: ['waiting', 'pending', 'running', 'failed', 'cancelled'],
  // Bounded workflow loops may explicitly restart a completed step.
  completed: ['completed', 'pending'],
  failed: ['failed', 'pending'],
  cancelled: ['cancelled'],
  interrupted: ['interrupted', 'pending'],
  skipped: ['skipped', 'pending'],
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
