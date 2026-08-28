import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ReviewDecision,
  ReviewMessage,
  ReviewThread,
} from '../src/core/interactive-review.js';
import type { WorkflowRun } from '../src/core/run.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('interactive review persistence', () => {
  it('recovers messages and atomically records decisions with the thread state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-review-persistence-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const run: WorkflowRun = {
      id: 'review-run',
      workflowId: 'plan-build-qa-interactive',
      workflowVersion: 1,
      objective: 'Review a change',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    const thread: ReviewThread = {
      id: 'thread-1',
      runId: run.id,
      phase: 'scope',
      target: { kind: 'scope', id: 'scope' },
      artifactRevision: 1,
      state: 'waiting',
      revision: 1,
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    };
    await store.createReviewThread(thread);

    const question: ReviewMessage = {
      id: 'message-question',
      threadId: thread.id,
      sequence: 1,
      role: 'user',
      content: 'Should this task include the migration?',
      generationStatus: 'pending',
      createdAt: '2026-01-01T00:00:02.000Z',
      updatedAt: '2026-01-01T00:00:02.000Z',
    };
    await store.saveReviewMessage(question);
    const answer: ReviewMessage = {
      id: 'message-answer',
      threadId: thread.id,
      sequence: 2,
      role: 'assistant',
      content: 'The migration is in scope.',
      generationStatus: 'interrupted',
      profileSnapshot: {
        driver: 'pi',
        model: 'reviewer',
        tools: ['read'],
        workspaceMode: 'read-only',
        timeoutMs: 1000,
        retryLimit: 0,
      },
      createdAt: '2026-01-01T00:00:03.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
    };
    await store.saveReviewMessage(answer);
    await store.saveReviewMessage({
      ...answer,
      generationStatus: 'failed',
      updatedAt: '2026-01-01T00:00:04.000Z',
    });

    const large = await artifacts.write(
      run.id,
      'review',
      'context',
      'text',
      'large context',
      'text/plain',
    );
    await store.saveCoordinatorArtifacts(run.id, [large]);
    await store.saveReviewMessage({
      id: 'message-context',
      threadId: thread.id,
      sequence: 3,
      role: 'system',
      contentArtifactId: large.id,
      generationStatus: 'sent',
      createdAt: '2026-01-01T00:00:05.000Z',
      updatedAt: '2026-01-01T00:00:05.000Z',
    });

    const decision: ReviewDecision = {
      threadId: thread.id,
      target: thread.target,
      decision: 'approve',
      revision: 1,
      details: 'The proposed scope is accepted.',
      createdAt: '2026-01-01T00:00:06.000Z',
    };
    await store.saveReviewDecision(decision, 'decided');

    expect(await store.getReviewThread(thread.id)).toMatchObject({ state: 'decided', revision: 2 });
    expect(await store.getReviewMessages(thread.id)).toEqual([
      question,
      { ...answer, generationStatus: 'failed', updatedAt: '2026-01-01T00:00:04.000Z' },
      {
        id: 'message-context',
        threadId: thread.id,
        sequence: 3,
        role: 'system',
        contentArtifactId: large.id,
        generationStatus: 'sent',
        createdAt: '2026-01-01T00:00:05.000Z',
        updatedAt: '2026-01-01T00:00:05.000Z',
      },
    ]);
    expect(await store.getReviewDecisions(thread.id)).toMatchObject([
      { target: thread.target, decision: 'approve', revision: 2 },
    ]);
    await expect(
      store.saveReviewDecision({ ...decision, decision: 'reject' }, 'decided'),
    ).rejects.toThrow('changed before the decision was saved');
    expect(await store.getReviewDecisions(thread.id)).toHaveLength(1);
    store.close();
  });
});
