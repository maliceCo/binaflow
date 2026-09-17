import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GuidedExecutionSnapshot } from '../src/application/guided-execution.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

const brief = {
  objective: 'Persist guided execution',
  conclusions: ['The contract is approved'],
  constraints: ['Keep changes scoped'],
  outOfScope: ['Remote execution'],
};
const plan = {
  briefVersion: 1,
  summary: 'Execute one task',
  items: [
    {
      id: 'item-1',
      title: 'Implement task',
      description: 'Implement the approved task',
      files: [{ path: 'src/example.ts', reason: 'The task needs this file' }],
      acceptanceCriteria: ['The task is persisted'],
    },
  ],
  verification: ['Run focused tests'],
};
const todo = {
  planVersion: 1,
  phases: [
    {
      id: 'phase-1',
      title: 'Build',
      tasks: [
        {
          id: 'task-1',
          planItemId: 'item-1',
          instructions: ['Implement the task'],
          files: ['src/example.ts'],
          acceptanceCriteria: ['The task is complete'],
          verification: ['Run tests'],
          stopConditions: ['Stop on scope changes'],
        },
      ],
    },
  ],
  scopeChanges: [],
};

function setup(): { directory: string; path: string; workspace: string; contractId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'binaflow-guided-persistence-'));
  directories.push(directory);
  return {
    directory,
    path: join(directory, 'runs.db'),
    workspace: '/workspace/guided',
    contractId: '11111111-1111-4111-8111-111111111111',
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('guided execution persistence', () => {
  it('creates a durable handoff, exposes the contract link, and replays the same request', async () => {
    const { path, workspace, contractId } = setup();
    const store = new SqliteRunStore(path);
    await store.createTaskContract({ contractId, workspace, brief });
    await store.publishTaskContractPlan({ contractId, workspace, expectedRevision: 1, plan });
    const approved = await store.approveTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: 2,
      planVersion: 1,
    });
    await store.publishTaskContractTodo({ contractId, workspace, expectedRevision: 3, todo });
    const state = await store.getTaskContract(workspace, contractId);
    const snapshot: GuidedExecutionSnapshot = {
      contractId,
      contractRevision: state!.contract.revision,
      coordinatorVersion: 1,
      workflowVersion: 1,
      workspace,
      objective: brief.objective,
      brief: state!.currentBrief,
      plan: state!.approvedPlan!,
      todo: state!.currentTodo!,
      approval: approved.approval!,
      profile: {
        name: 'builder',
        driver: 'pi',
        model: 'test-model',
        tools: ['read', 'edit'],
        workspaceMode: 'read-write',
        timeoutMs: 1_000,
        retryLimit: 0,
      },
      git: { workspace, branch: 'main', head: 'head-1', clean: true, changes: [] },
      commands: [{ command: 'pnpm', args: ['test'], shell: true }],
      files: ['src/example.ts'],
    };
    const requestId = '22222222-2222-4222-8222-222222222222';
    const artifact = (name: string, kind: 'json' | 'text') => ({
      id: `${name}-artifact`,
      runId: `guided-${requestId}`,
      stepId: 'handoff',
      name,
      kind,
      path: `/tmp/${name}`,
      mediaType: kind === 'json' ? 'application/json' : 'text/markdown',
      sizeBytes: 10,
    });
    const first = await store.createGuidedExecution({
      requestId,
      snapshot,
      snapshotArtifact: artifact('snapshot', 'json'),
      todoArtifact: artifact('todo', 'text'),
      inputArtifact: artifact('input', 'json'),
    });
    expect(first.phases[0]?.tasks[0]?.status).toBe('pending');
    expect((await store.getTaskContract(workspace, contractId))?.execution).toEqual({
      runId: `guided-${requestId}`,
    });
    const replay = await store.createGuidedExecution({
      requestId,
      snapshot,
      snapshotArtifact: artifact('snapshot', 'json'),
      todoArtifact: artifact('todo', 'text'),
      inputArtifact: artifact('input', 'json'),
    });
    expect(replay.runId).toBe(first.runId);

    const claim = await store.claimGuidedExecution(first.runId, ['pending']);
    expect(claim?.runId).toBe(first.runId);
    await store.saveGuidedCheckpoint(
      {
        runId: first.runId,
        phaseId: 'phase-1',
        taskId: 'task-1',
        fingerprint: snapshot.git,
        artifactIds: [],
        revision: 1,
      },
      claim!,
    );
    expect((await store.getGuidedExecution(first.runId))?.revision).toBe(2);
    await store.releaseGuidedExecution(first.runId, claim!);
    store.close();

    const database = new Database(path);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM guided_execution_tasks').get()).toEqual({
      count: 1,
    });
    expect(
      database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get(),
    ).toEqual({ version: 17 });
    database.close();
  });
});
