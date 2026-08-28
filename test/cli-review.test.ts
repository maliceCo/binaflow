import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCli } from '../src/cli/index.js';
import type { ReviewThread } from '../src/core/interactive-review.js';
import type { WorkflowRun } from '../src/core/run.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('interactive review CLI', () => {
  it('gets a review and publishes a visible message through versioned JSON', async () => {
    const directory = await setupWorkspace();
    const store = new SqliteRunStore(join(directory, '.binaflow', 'data', 'runs.db'));
    const run: WorkflowRun = {
      id: 'review-run',
      workflowId: 'plan-build-qa-interactive',
      workflowVersion: 1,
      objective: 'Review a change',
      status: 'waiting',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const thread: ReviewThread = {
      id: 'thread-1',
      runId: run.id,
      phase: 'scope',
      target: { kind: 'scope', id: 'scope' },
      artifactRevision: 1,
      state: 'waiting',
      revision: 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    await store.createRun(run);
    await store.createReviewThread(thread);
    store.close();
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await createCli().parseAsync([
      'node',
      'binaflow',
      '--cwd',
      directory,
      '--json',
      'review',
      run.id,
    ]);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      command: 'review',
      data: { runId: run.id, threads: [{ thread: { id: thread.id } }] },
    });

    await createCli().parseAsync([
      'node',
      'binaflow',
      '--cwd',
      directory,
      '--json',
      'review',
      'message',
      run.id,
      '--thread',
      thread.id,
      '--message',
      'Please explain the scope.',
    ]);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      command: 'review message',
      data: { threads: [{ messages: [{ content: 'Please explain the scope.' }] }] },
    });
  });

  it('rejects ambiguous targets and unsupported JSONL without mutating the thread', async () => {
    const directory = await setupWorkspace();
    const store = new SqliteRunStore(join(directory, '.binaflow', 'data', 'runs.db'));
    const run: WorkflowRun = {
      id: 'review-run',
      workflowId: 'plan-build-qa-interactive',
      workflowVersion: 1,
      objective: 'Review a change',
      status: 'waiting',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    await store.createReviewThread({
      id: 'thread-1',
      runId: run.id,
      phase: 'scope',
      target: { kind: 'scope', id: 'scope' },
      artifactRevision: 1,
      state: 'waiting',
      revision: 1,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    });
    store.close();

    await expect(
      createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--jsonl', 'review', run.id]),
    ).rejects.toThrow('supports --json, not --jsonl');
  });
});

async function setupWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-review-'));
  directories.push(directory);
  await mkdir(join(directory, '.binaflow', 'data'), { recursive: true });
  await writeFile(join(directory, '.binaflow', 'config.json'), JSON.stringify({ profiles: {} }));
  return directory;
}
