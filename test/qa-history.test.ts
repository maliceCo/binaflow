import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QaDefect, QaDefectEvent, QaOccurrence } from '../src/core/qa-history.js';
import type { WorkflowRun } from '../src/core/run.js';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('QA history persistence', () => {
  it('stores defects, unique occurrences, and append-only lifecycle events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-qa-history-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'run.db'));
    const artifacts = new FileArtifactStore(join(directory, 'artifacts'));
    const run: WorkflowRun = {
      id: 'history-run',
      workflowId: 'plan-build-qa',
      workflowVersion: 1,
      objective: 'Track a finding',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const report = await artifacts.write(
      run.id,
      'qa',
      'report',
      'json',
      '{"findings":[]}',
      'application/json',
    );
    await store.createRun(run, [report]);

    const defect: QaDefect = {
      id: 'defect-1',
      fingerprint: 'fingerprint-1',
      title: 'Invalid input accepted',
      summary: 'Validation is missing',
      category: 'correctness',
      severity: 'high',
      status: 'detected',
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      locations: ['src/example.ts'],
      symbols: ['validateInput'],
      resolution: 'Add a validation guard',
    };
    const occurrence: QaOccurrence = {
      id: 'occurrence-1',
      runId: run.id,
      defectId: defect.id,
      qaIteration: 1,
      findingId: 'finding-1',
      reportArtifactId: report.id,
      createdAt: '2026-01-01T00:00:02.000Z',
    };
    await store.saveQaDefect(defect);
    await store.saveQaOccurrence(occurrence);
    await expect(
      store.saveQaOccurrence({ ...occurrence, id: 'occurrence-duplicate' }),
    ).rejects.toThrow();

    const detected: QaDefectEvent = {
      defectId: defect.id,
      occurrenceId: occurrence.id,
      status: 'detected',
      details: 'First observed',
      createdAt: '2026-01-01T00:00:02.000Z',
    };
    const fixed: QaDefectEvent = {
      ...detected,
      status: 'fixed',
      details: 'Builder applied the correction',
      createdAt: '2026-01-01T00:00:03.000Z',
    };
    await store.saveQaDefectEvent(detected);
    await store.saveQaDefectEvent(fixed);

    const persistedDefect = { ...defect, status: 'fixed' as const, updatedAt: fixed.createdAt };
    expect(await store.getQaDefects()).toEqual([persistedDefect]);
    expect(await store.searchQaDefects('fingerprint-1', 'unrelated')).toEqual([
      { defect: persistedDefect, exact: true },
    ]);
    expect(await store.searchQaDefects('other-fingerprint', 'invalid input')).toEqual([
      { defect: persistedDefect, exact: false },
    ]);
    await store.saveQaDefect({
      ...defect,
      id: 'defect-2',
      fingerprint: 'fingerprint-2',
      title: 'Invalid input is accepted',
    });
    const candidates = await store.searchQaDefects('other-fingerprint', 'invalid input');
    expect(candidates).toHaveLength(2);
    expect(candidates).toEqual(
      expect.arrayContaining([
        {
          defect: {
            ...defect,
            id: 'defect-2',
            fingerprint: 'fingerprint-2',
            title: 'Invalid input is accepted',
          },
          exact: false,
        },
        { defect: persistedDefect, exact: false },
      ]),
    );
    await store.reindexQaSearch();
    expect(await store.searchQaDefects('other-fingerprint', 'validateInput')).toHaveLength(2);
    expect(await store.getQaOccurrences(defect.id)).toEqual([occurrence]);
    expect(await store.getQaDefectEvents(defect.id)).toEqual([
      { ...detected, id: 1 },
      { ...fixed, id: 2 },
    ]);
    store.close();
  });
});
