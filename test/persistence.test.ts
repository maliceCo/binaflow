import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
import type { NormalizedEvent } from '../src/core/events.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('local persistence', () => {
  it('reuses a completed step and its artifact after reopening the stores', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-'));
    temporaryDirectories.push(directory);

    const databasePath = join(directory, 'run.db');
    const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
    const store = new SqliteRunStore(databasePath);
    const run: WorkflowRun = {
      id: 'run-1',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Add a useful change',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await store.createRun(run);
    await store.saveRun({ ...run, status: 'running', updatedAt: '2026-01-01T00:00:01.000Z' });

    const pendingStep: StepRun = {
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(pendingStep);
    await store.saveStepRun({
      ...pendingStep,
      status: 'running',
      startedAt: '2026-01-01T00:00:02.000Z',
    });

    const planContent = JSON.stringify({ summary: 'A persisted plan' });
    const artifact = await artifactStore.write(
      run.id,
      'plan',
      'plan',
      'json',
      planContent,
      'application/json',
    );
    const completedStep: StepRun = {
      ...pendingStep,
      status: 'completed',
      startedAt: '2026-01-01T00:00:02.000Z',
      finishedAt: '2026-01-01T00:00:03.000Z',
      result: { text: planContent, sessionId: 'session-1' },
      disposition: { kind: 'continue' },
    };
    await store.completeStep(completedStep, [artifact]);
    const event: NormalizedEvent = {
      runId: run.id,
      stepId: 'plan',
      type: 'status',
      message: 'Plan completed',
      occurredAt: '2026-01-01T00:00:03.000Z',
    };
    await store.saveEvent(event);
    store.close();

    const reopenedStore = new SqliteRunStore(databasePath);
    const savedRun = await reopenedStore.getRun(run.id);
    const savedSteps = await reopenedStore.getStepRuns(run.id);
    const savedArtifacts = await reopenedStore.getArtifacts(run.id);

    expect(savedRun?.status).toBe('running');
    expect(savedSteps).toEqual([completedStep]);
    expect(savedArtifacts).toEqual([artifact]);
    expect(await artifactStore.read(savedArtifacts[0]!)).toBe(planContent);
    expect(await reopenedStore.getEvents(run.id)).toEqual([event]);
    await expect(
      reopenedStore.saveRun({
        ...savedRun!,
        status: 'pending',
        updatedAt: '2026-01-01T00:00:04.000Z',
      }),
    ).rejects.toThrow('Invalid run status transition');
    reopenedStore.close();
  });

  it('lists runs with stable cursor pagination and filters', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-history-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const createdAt = '2026-01-01T00:00:00.000Z';

    for (const [id, workflowId, status] of [
      ['run-a', 'plan-build', 'completed'],
      ['run-b', 'plan-build', 'failed'],
      ['run-c', 'research-plan-build', 'completed'],
    ] as const) {
      await store.createRun({
        id,
        workflowId,
        workflowVersion: 1,
        objective: id,
        status,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const first = await store.listRunsPage({ limit: 2 });
    const second = await store.listRunsPage({
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const filtered = await store.listRunsPage({ status: 'completed', workflowId: 'plan-build' });

    expect(first.runs.map((run) => run.id)).toEqual(['run-c', 'run-b']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.runs.map((run) => run.id)).toEqual(['run-a']);
    expect(second.nextCursor).toBeUndefined();
    expect(filtered.runs.map((run) => run.id)).toEqual(['run-a']);
    await expect(store.listRunsPage({ limit: 0 })).rejects.toThrow('between 1 and 100');
    await expect(store.listRunsPage({ cursor: 'invalid' })).rejects.toThrow('Invalid run cursor');
    store.close();
  });

  it('persists event batches in input order', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-events-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const run: WorkflowRun = {
      id: 'event-batch-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Persist events',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    const events: NormalizedEvent[] = Array.from({ length: 1_000 }, (_, index) => ({
      runId: run.id,
      stepId: 'plan',
      type: index === 999 ? ('status' as const) : ('text' as const),
      message: `event-${index}`,
      occurredAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    }));

    await store.saveEvents(events);

    const savedEvents = await store.getEvents(run.id);
    expect(savedEvents).toHaveLength(1_000);
    expect(savedEvents[0]).toEqual(events[0]);
    expect(savedEvents[999]).toEqual(events[999]);
    expect(await store.countEvents(run.id)).toBe(1_000);
    store.close();
  });

  it('claims an eligible run with a transactional compare-and-set', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-claim-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    await store.createRun({
      id: 'claim-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Claim once',
      status: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const claims = await Promise.all([
      store.claimRun('claim-run', ['failed']),
      store.claimRun('claim-run', ['failed']),
    ]);

    expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
    expect(claims.find((claim) => claim !== undefined)?.status).toBe('running');
    expect((await store.getRun('claim-run'))?.status).toBe('running');
    await expect(store.claimRun('claim-run', ['running'])).rejects.toThrow(
      'A running run cannot be claimed',
    );
    store.close();
  });

  it('claims an approval and its pending decision in one transaction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-approval-claim-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const run: WorkflowRun = {
      id: 'approval-run',
      workflowId: 'research-plan-build',
      workflowVersion: 1,
      objective: 'Approve once',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    await store.saveRun({ ...run, status: 'running', updatedAt: '2026-01-01T00:00:01.000Z' });
    await store.saveRun({ ...run, status: 'waiting', updatedAt: '2026-01-01T00:00:02.000Z' });
    const waitingStep: StepRun = {
      runId: run.id,
      stepId: 'research-approval',
      profile: 'human',
      status: 'waiting',
      attempt: 1,
    };
    await store.saveStepRun({ ...waitingStep, status: 'pending' });
    await store.saveStepRun(waitingStep);

    const decisions = await Promise.all([
      store.claimApproval(run.id, {
        ...waitingStep,
        status: 'pending',
        approval: { decision: 'approved', decidedAt: '2026-01-01T00:00:03.000Z' },
      }),
      store.claimApproval(run.id, {
        ...waitingStep,
        status: 'pending',
        approval: {
          decision: 'rejected',
          feedback: 'Needs more evidence',
          decidedAt: '2026-01-01T00:00:03.000Z',
        },
      }),
    ]);

    expect(decisions.filter((decision) => decision !== undefined)).toHaveLength(1);
    expect((await store.getRun(run.id))?.status).toBe('running');
    expect((await store.getStepRuns(run.id))[0]?.status).toBe('pending');
    store.close();
  });

  it('marks only running work interrupted in one transaction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-interrupt-'));
    temporaryDirectories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifactStore = new FileArtifactStore(join(directory, 'artifacts'));
    const run: WorkflowRun = {
      id: 'interrupt-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Recover explicitly',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);

    const completed: StepRun = {
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(completed);
    const planArtifact = await artifactStore.write(
      run.id,
      'plan',
      'plan',
      'json',
      '{"summary":"keep"}',
      'application/json',
    );
    await store.completeStep(
      {
        ...completed,
        status: 'completed',
        finishedAt: '2026-01-01T00:00:01.000Z',
      },
      [planArtifact],
    );

    const running: StepRun = {
      runId: run.id,
      stepId: 'build',
      profile: 'builder',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(running);
    await store.saveStepRun({
      ...running,
      status: 'running',
      startedAt: '2026-01-01T00:00:02.000Z',
    });

    const pending: StepRun = {
      runId: run.id,
      stepId: 'future',
      profile: 'builder',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(pending);

    const interrupted = await store.markRunInterrupted(run.id);

    expect(interrupted?.status).toBe('interrupted');
    expect((await store.getStepRuns(run.id)).map((step) => [step.stepId, step.status])).toEqual([
      ['plan', 'completed'],
      ['build', 'interrupted'],
      ['future', 'pending'],
    ]);
    expect(await store.getArtifacts(run.id)).toEqual([planArtifact]);
    expect(await store.markRunInterrupted(run.id)).toBeUndefined();
    store.close();
  });
});
