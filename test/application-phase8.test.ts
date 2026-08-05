import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import {
  clarificationQuestions,
  explainRunRecovery,
  loadResearchApprovalPreviews,
  readArtifact,
  type RunInspection,
} from '../src/application/operations.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import type { RunStore } from '../src/storage/run-store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Phase 8 application inspection operations', () => {
  it('explains retryable recovery, reuse, cancellation, interruption, and version mismatch', async () => {
    const completed = step('plan', 'completed');
    const retryable = step('build', 'failed', { message: 'temporary', retryable: true });
    const store = fakeStore(run('failed'), [completed, retryable]);

    await expect(explainRunRecovery({ store }, 'run-1')).resolves.toMatchObject({
      eligible: true,
      completedStepIds: ['plan'],
      retryableStepIds: ['build'],
      reason: expect.stringContaining('never silently rerun'),
    });

    for (const [status, text] of [
      ['cancelled', 'cannot be resumed'],
      ['interrupted', 'Recovery will reuse'],
    ] as const) {
      const current = run(status);
      const currentStore = fakeStore(current, status === 'interrupted' ? [completed] : []);
      const explanation = await explainRunRecovery({ store: currentStore }, current.id);
      expect(explanation.eligible).toBe(status === 'interrupted');
      expect(explanation.reason).toContain(text);
    }

    const mismatch = await explainRunRecovery(
      { store: fakeStore({ ...run('failed'), workflowVersion: 99 }, []) },
      'run-1',
    );
    expect(mismatch.eligible).toBe(false);
    expect(mismatch.reason).toContain('version incompatibility');

    const running = await explainRunRecovery(
      { store: fakeStore(run('running'), [completed]) },
      'run-1',
    );
    expect(running.actions).toEqual([
      {
        kind: 'mark-interrupted',
        label: 'Mark interrupted and review recovery',
        requiresConfirmation: true,
      },
    ]);
  });

  it('extracts clarification questions from the persisted plan disposition', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-phase8-'));
    directories.push(directory);
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const artifact = await artifacts.write(
      'run-1',
      'plan',
      'plan',
      'json',
      JSON.stringify({
        decision: 'needs_clarification',
        clarificationQuestions: ['Which files?', 'What behavior?'],
      }),
      'application/json',
    );
    const inspection: RunInspection = {
      run: run('completed'),
      steps: [
        {
          ...step('plan', 'completed'),
          disposition: { kind: 'stop', code: 'PLAN_NEEDS_CLARIFICATION', message: 'fallback' },
        },
      ],
      artifacts: [artifact],
      eventCount: 0,
    };

    await expect(
      clarificationQuestions({ store: fakeStore(run('completed'), []), artifacts }, inspection),
    ).resolves.toEqual(['Which files?', 'What behavior?']);
  });

  it('falls back without loading an unbounded plan artifact', async () => {
    const readBounded = vi.fn(async () => ({
      content: '{"clarificationQuestions":',
      truncated: true,
    }));
    const inspection: RunInspection = {
      run: run('completed'),
      steps: [
        {
          ...step('plan', 'completed'),
          disposition: { kind: 'stop', code: 'PLAN_NEEDS_CLARIFICATION', message: 'fallback' },
        },
      ],
      artifacts: [
        {
          id: 'plan',
          runId: 'run-1',
          stepId: 'plan',
          name: 'plan',
          kind: 'json',
          path: '/tmp/plan.json',
          mediaType: 'application/json',
          sizeBytes: 1_000_000,
        },
      ],
      eventCount: 0,
    };
    const artifacts = { readBounded, read: vi.fn() } as unknown as FileArtifactStore;

    await expect(
      clarificationQuestions({ store: fakeStore(run('completed'), []), artifacts }, inspection),
    ).resolves.toEqual(['fallback']);
    expect(readBounded).toHaveBeenCalledWith(inspection.artifacts[0], 64_000);
    expect(artifacts.read).not.toHaveBeenCalled();
  });

  it('bounds previews, formats JSON, and reports missing or corrupt artifacts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-phase8-artifacts-'));
    directories.push(directory);
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const json = await artifacts.write(
      'run-1',
      'plan',
      'plan',
      'json',
      '{"ok":true}',
      'application/json',
    );
    const text = await artifacts.write(
      'run-1',
      'build',
      'result',
      'text',
      'x'.repeat(10_000),
      'text/plain',
    );
    const corrupt = await artifacts.write(
      'run-1',
      'plan',
      'broken',
      'json',
      '{bad',
      'application/json',
    );
    const store = fakeStore(run('completed'), [], [json, text, corrupt]);

    await expect(readArtifact({ store, artifacts }, 'run-1', 'plan.plan')).resolves.toMatchObject({
      content: '{\n  "ok": true\n}',
      formatted: true,
      truncated: false,
    });
    await expect(
      readArtifact({ store, artifacts }, 'run-1', 'build.result'),
    ).resolves.toMatchObject({
      truncated: true,
      content: 'x'.repeat(4_000),
    });
    const completeContent = 'complete-'.repeat(8_000);
    const complete = await artifacts.write(
      'run-1',
      'build',
      'complete',
      'text',
      completeContent,
      'text/plain',
    );
    const completeStore = fakeStore(run('completed'), [], [complete]);
    await expect(
      readArtifact({ store: completeStore, artifacts }, 'run-1', 'build.complete', {
        mode: 'full',
      }),
    ).resolves.toMatchObject({ content: completeContent, truncated: false });
    await expect(readArtifact({ store, artifacts }, 'run-1', 'plan.broken')).resolves.toMatchObject(
      {
        error: expect.stringContaining('corrupt'),
      },
    );
    const missing = { ...json, path: join(directory, 'missing.json') };
    const missingStore = fakeStore(run('completed'), [], [missing]);
    await expect(
      readArtifact({ store: missingStore, artifacts }, 'run-1', 'plan.plan'),
    ).resolves.toMatchObject({
      error: expect.stringContaining('cannot be read'),
    });
  });

  it('loads bounded research approval previews while keeping corrupt files actionable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-phase8-approval-'));
    directories.push(directory);
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const report = await artifacts.write(
      'run-1',
      'research',
      'report',
      'json',
      '{"summary":"evidence"}',
      'application/json',
    );
    const review = {
      ...report,
      id: 'missing-review',
      stepId: 'research-review',
      name: 'review',
      path: join(directory, 'missing-review.json'),
    };
    const inspection: RunInspection = {
      run: run('waiting'),
      steps: [],
      artifacts: [report, review],
      eventCount: 0,
    };

    const previews = await loadResearchApprovalPreviews(
      { store: fakeStore(run('waiting'), [], [report, review]), artifacts },
      inspection,
    );
    expect(previews[0]).toMatchObject({
      formatted: true,
      content: '{\n  "summary": "evidence"\n}',
    });
    expect(previews[1]).toMatchObject({ error: expect.stringContaining('cannot be read') });
  });
});

function fakeStore(
  runValue: WorkflowRun,
  steps: StepRun[],
  artifacts: ArtifactReference[] = [],
): RunStore {
  return {
    getRun: vi.fn(async () => runValue),
    getStepRuns: vi.fn(async () => steps),
    getArtifacts: vi.fn(async () => artifacts),
  } as unknown as RunStore;
}

function run(status: WorkflowRun['status']): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Clarify the objective',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
  };
}

function step(stepId: string, status: StepRun['status'], error?: StepRun['error']): StepRun {
  return {
    runId: 'run-1',
    stepId,
    profile: stepId === 'plan' ? 'planner' : 'builder',
    status,
    attempt: 1,
    ...(error ? { error } : {}),
  };
}
