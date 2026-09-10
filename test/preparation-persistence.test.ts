import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import {
  createPreparationProposal,
  type PreparationDraft,
  type PreparationMessage,
} from '../src/application/preparation.js';

const stores: SqliteRunStore[] = [];
const directories: string[] = [];
const profile = {
  driver: 'fake',
  model: 'test',
  tools: [],
  workspaceMode: 'read-only' as const,
  timeoutMs: 1000,
  retryLimit: 0,
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function draft(): PreparationDraft {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspace: 'E:/workspace',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: '',
    revision: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

describe('preparation persistence', () => {
  it('reopens ordered context and invalidates an older proposal after a new message', async () => {
    const store = new SqliteRunStore(':memory:');
    stores.push(store);
    const value = draft();
    await store.createPreparation(value);
    const claim = await store.claimPreparation(value.id, { draftId: value.id, revision: 1 });
    expect(claim).toBeDefined();
    const first: PreparationMessage = {
      id: randomUUID(),
      draftId: value.id,
      sequence: 1,
      role: 'user',
      content: 'Add a feature',
      generationStatus: 'sent',
      createdAt: value.updatedAt,
      updatedAt: value.updatedAt,
    };
    await store.savePreparationMessage(first, 1, claim!);
    const proposal = createPreparationProposal({
      id: randomUUID(),
      draftId: value.id,
      revision: 2,
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Add a feature',
      outputs: [
        {
          stepId: 'plan',
          name: 'plan',
          value: {
            decision: 'build',
            summary: 'Build it',
            tasks: [
              {
                id: 'task-1',
                title: 'Build',
                description: 'Build it',
                files: [],
                acceptanceCriteria: ['Works'],
              },
            ],
            verification: ['pnpm test'],
            risks: [],
            clarificationQuestions: [],
          },
        },
      ],
      provenance: { profile: 'planner', profileSnapshot: profile },
    });
    await store.publishPreparationProposal(proposal, 2, claim!);
    expect((await store.getPreparation(value.id))?.proposal?.id).toBe(proposal.id);
    const second: PreparationMessage = {
      ...first,
      id: randomUUID(),
      sequence: 2,
      content: 'Also update docs',
    };
    await store.savePreparationMessage(second, 2, claim!);
    const reopened = await store.getPreparation(value.id);
    expect(reopened?.messages.map((message) => message.content)).toEqual([
      'Add a feature',
      'Also update docs',
    ]);
    expect(reopened?.proposal).toBeUndefined();
  });

  it('allows only one live owner across store connections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-preparation-'));
    directories.push(directory);
    const databasePath = join(directory, 'runs.db');
    const first = new SqliteRunStore(databasePath);
    stores.push(first);
    const value = draft();
    await first.createPreparation(value);
    const second = new SqliteRunStore(databasePath);
    stores.push(second);
    const firstClaim = await first.claimPreparation(value.id, { draftId: value.id, revision: 1 });
    const secondClaim = await second.claimPreparation(value.id, { draftId: value.id, revision: 1 });
    expect(firstClaim).toBeDefined();
    expect(secondClaim).toBeUndefined();
  });

  it('transfers the approved proposal and completed planning step atomically', async () => {
    const store = new SqliteRunStore(':memory:');
    stores.push(store);
    const value = draft();
    await store.createPreparation(value);
    const claim = await store.claimPreparation(value.id, { draftId: value.id, revision: 1 });
    const now = new Date().toISOString();
    const proposal = createPreparationProposal({
      id: randomUUID(),
      draftId: value.id,
      revision: 1,
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Build the feature',
      outputs: [
        {
          stepId: 'plan',
          name: 'plan',
          value: {
            decision: 'build',
            summary: 'Build it',
            tasks: [
              {
                id: 'task-1',
                title: 'Build',
                description: 'Build it',
                files: [],
                acceptanceCriteria: ['Works'],
              },
            ],
            verification: ['pnpm test'],
            risks: [],
            clarificationQuestions: [],
          },
        },
      ],
      provenance: { profile: 'planner', profileSnapshot: profile },
    });
    await store.publishPreparationProposal(proposal, 1, claim!);
    const run = {
      id: randomUUID(),
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: proposal.objective,
      status: 'running' as const,
      createdAt: now,
      updatedAt: now,
    };
    const result = await store.createRunFromPreparation!({
      draftId: value.id,
      proposalRevision: 1,
      claimToken: claim!,
      run,
      artifacts: [
        {
          id: randomUUID(),
          runId: run.id,
          stepId: 'run',
          name: 'input',
          kind: 'json',
          path: 'input',
          mediaType: 'application/json',
          sizeBytes: 1,
        },
      ],
      steps: [
        {
          runId: run.id,
          stepId: 'plan',
          profile: 'planner',
          status: 'completed',
          attempt: 1,
          startedAt: now,
          finishedAt: now,
          result: { text: '{}' },
        },
      ],
      approval: {
        proposalId: proposal.id,
        draftId: value.id,
        revision: 1,
        approvedAt: now,
        decision: 'approve',
      },
    });
    expect(result.run.id).toBe(run.id);
    expect((await store.getPreparation(value.id))?.draft.status).toBe('consumed');
    expect((await store.getStepRuns(run.id))[0]?.status).toBe('completed');
    await expect(
      store.createRunFromPreparation!({
        draftId: value.id,
        proposalRevision: 1,
        claimToken: claim!,
        run: { ...run, id: randomUUID() },
        steps: [],
        artifacts: [],
        approval: {
          proposalId: proposal.id,
          draftId: value.id,
          revision: 1,
          approvedAt: now,
          decision: 'approve',
        },
      }),
    ).rejects.toThrow();
  });
});
