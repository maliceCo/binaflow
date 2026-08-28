import { describe, expect, it } from 'vitest';
import type { ReviewView } from '../src/application/review-operations.js';
import { createInitialTuiState, type TuiState } from '../src/tui/model.js';
import { reduce } from '../src/tui/reduce.js';

const review: ReviewView = {
  runId: 'run-review',
  status: 'waiting',
  threads: [
    {
      thread: {
        id: 'thread-scope',
        runId: 'run-review',
        phase: 'scope',
        target: { kind: 'scope', id: 'scope' },
        artifactRevision: 1,
        state: 'waiting',
        revision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      messages: [],
      decisions: [],
    },
  ],
};

describe('TUI interactive review navigation', () => {
  it('opens threads, keeps messages non-transitional, and returns without deciding', () => {
    let state: TuiState = {
      ...createInitialTuiState(),
      detail: 'inspect' as const,
      activeRunId: review.runId,
      runView: {
        id: review.runId,
        workflow: { id: 'plan-build-qa-interactive', version: 1, compatible: true },
        objective: 'Review the change',
        status: 'waiting' as const,
        createdAt: review.threads[0]!.thread.createdAt,
        updatedAt: review.threads[0]!.thread.updatedAt,
        phases: [],
        artifacts: [],
        eventCount: 0,
        metrics: {},
        availableActions: [],
      },
    };
    state = reduce(state, { type: 'open-review' });
    state = reduce(state, { type: 'review-set', review });
    state = reduce(state, { type: 'open-review-thread', threadId: 'thread-scope' });
    expect(state.detail).toBe('review-thread');
    state = reduce(state, { type: 'review-message-submit', content: 'Ask for context' });
    expect(state.detail).toBe('review-thread');
    expect(state.status).toBe('Sending review message...');
    state = reduce(state, { type: 'review-back' });
    expect(state.detail).toBe('review');
  });
});
