import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuidedExecutionService } from '../src/application/guided-execution-operations.js';
import { createChangeSet } from '../src/application/change-set.js';
import type { ArtifactReference } from '../src/core/run.js';
import type { GitWorkspace, WorkspaceExecutionLock } from '../src/application/ports.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];
const brief = {
  objective: 'Run approved task',
  conclusions: ['Ready'],
  constraints: ['Stay scoped'],
  outOfScope: ['Remote'],
};
const plan = {
  briefVersion: 1,
  summary: 'A plan',
  items: [
    {
      id: 'item-1',
      title: 'Task',
      description: 'Task',
      files: [{ path: 'file.ts', reason: 'code' }],
      acceptanceCriteria: ['done'],
    },
  ],
  verification: ['pnpm test'],
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
          instructions: ['do'],
          files: ['file.ts'],
          acceptanceCriteria: ['done'],
          verification: ['pnpm test'],
          stopConditions: ['stop'],
        },
      ],
    },
  ],
  scopeChanges: [],
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function git(): GitWorkspace {
  const state = { workspace: '/workspace', branch: 'main', head: 'head', clean: true, changes: [] };
  return {
    inspect: async () => state,
    preflight: async () => state,
    validatePaths: async () => {},
    stagePaths: async () => {},
    inspectStagedTree: async () => ({ tree: 'tree', fingerprint: state }),
    commitPhase: async () => 'commit',
    inspectCommit: async (_workspace, sha) => ({
      sha,
      parent: 'head',
      tree: 'tree',
      branch: 'main',
      fingerprint: state,
    }),
    reconcileCommitIntent: async () => ({ commitSha: null, noChanges: true }),
    inspectChangeSet: async () => [],
  };
}

function artifacts() {
  const contents = new Map<string, string>();
  return {
    contents,
    async write(
      runId: string,
      stepId: string,
      name: string,
      kind: 'json' | 'text',
      content: string,
      mediaType: string,
    ): Promise<ArtifactReference> {
      const artifact = {
        id: `${runId}-${stepId}-${name}`,
        runId,
        stepId,
        name,
        kind,
        path: `/tmp/${name}`,
        mediaType,
        sizeBytes: Buffer.byteLength(content),
      };
      contents.set(artifact.id, content);
      return artifact;
    },
    async remove(artifact: ArtifactReference): Promise<void> {
      contents.delete(artifact.id);
    },
    async read(artifact: ArtifactReference): Promise<string> {
      return contents.get(artifact.id)!;
    },
  };
}

function lock(): WorkspaceExecutionLock & { acquisitions: number } {
  const value = {
    acquisitions: 0,
    async acquire(): Promise<{ workspace: string; token: string; release(): Promise<void> }> {
      value.acquisitions += 1;
      return { workspace: '/workspace', token: 'token', release: async () => {} };
    },
  };
  return value;
}

describe('guided execution operations', () => {
  it('previews without mutation and starts/replays an exact authorization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-guided-operations-'));
    directories.push(directory);
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const workspace = '/workspace';
    const contractId = '11111111-1111-4111-8111-111111111111';
    await store.createTaskContract({ contractId, workspace, brief });
    await store.publishTaskContractPlan({ contractId, workspace, expectedRevision: 1, plan });
    await store.approveTaskContractPlan({
      contractId,
      workspace,
      expectedRevision: 2,
      planVersion: 1,
    });
    await store.publishTaskContractTodo({ contractId, workspace, expectedRevision: 3, todo });
    const lockAdapter = lock();
    const service = createGuidedExecutionService({
      taskContracts: store,
      executions: store,
      artifacts: artifacts(),
      git: git(),
      lock: lockAdapter,
      workspace,
      profiles: {
        builder: {
          driver: 'pi',
          model: 'builder',
          tools: ['edit'],
          workspaceMode: 'read-write',
          timeoutMs: 1000,
          retryLimit: 0,
        },
      },
    });

    const preview = await service.previewStart({ contractId, expectedRevision: 4, todoVersion: 1 });
    expect(preview.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await store.getGuidedExecutionByRequest('22222222-2222-4222-8222-222222222222'),
    ).toBeUndefined();
    const request = {
      requestId: '22222222-2222-4222-8222-222222222222',
      contractId,
      expectedRevision: 4,
      todoVersion: 1,
      previewDigest: preview.digest,
    };
    const started = await service.start(request);
    expect(started).toMatchObject({ runId: `guided-${request.requestId}`, status: 'pending' });
    const replay = await service.start(request);
    expect(replay.runId).toBe(started.runId);

    const claim = await store.claimGuidedExecution(started.runId, ['pending']);
    expect(claim).toBeTruthy();
    const waiting = await store.getGuidedExecution(started.runId);
    const changeSet = createChangeSet({
      id: 'changes-1',
      runId: started.runId,
      contractId,
      revision: 1,
      base: { branch: 'main', commit: 'head-1' },
      result: { branch: 'main', commit: 'head-2' },
      files: [{ path: 'file.ts', status: 'modified', hunks: [] }],
    });
    await store.saveGuidedProgress(
      {
        ...waiting!,
        revision: waiting!.revision + 1,
        status: 'waiting',
        stage: 'changes-review',
        nextAction: 'review-changes',
        changeSet,
      },
      waiting!.revision,
      claim!,
    );
    await store.releaseGuidedExecution(started.runId, claim!);

    const resumePreview = await service.previewResume(started.runId);
    expect(resumePreview.allowedDecisions).toContain('approve-changes');
    const approved = await service.resume({
      runId: started.runId,
      expectedRevision: resumePreview.revision,
      previewDigest: resumePreview.digest,
      decision: 'approve-changes',
      reason: 'Reviewed changes',
    });
    expect(approved).toMatchObject({
      status: 'completed',
      nextAction: 'none',
      changeSet: { status: 'approved' },
    });
    const completedPreview = await service.previewResume(started.runId);
    await expect(
      service.resume({
        runId: started.runId,
        expectedRevision: completedPreview.revision,
        previewDigest: completedPreview.digest,
        decision: 'approve-changes',
        reason: 'Duplicate approval',
      }),
    ).rejects.toThrow('not allowed');
    expect(lockAdapter.acquisitions).toBe(2);
    store.close();
  });
});
