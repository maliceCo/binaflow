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
});
