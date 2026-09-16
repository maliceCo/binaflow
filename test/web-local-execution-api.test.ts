import { describe, expect, it, vi } from 'vitest';
import { handleWebApi, type WebExecutionCapabilities } from '../src/web/routes.js';

const contractId = '123e4567-e89b-42d3-a456-426614174000';
const runId = 'guided-123';
const progress = {
  runId,
  contractId,
  revision: 2,
  stage: 'changes-review' as const,
  status: 'waiting' as const,
  phases: [],
  activeBlock: null,
  nextAction: 'review-changes' as const,
};

const execution = {
  previewStart: vi.fn(async () => ({
    authorization: {
      workspace: '/secret/workspace',
      commands: [],
      files: ['/secret/workspace/file.ts'],
    },
    todoMarkdown: { fileName: 'TODO.md' as const, content: 'todo' },
    git: { clean: true, changes: [], workspace: '/secret/workspace' },
    digest: 'a'.repeat(64),
  })),
  previewResume: vi.fn(),
  get: vi.fn(async () => progress),
  list: vi.fn(async () => ({ items: [progress] })),
  start: vi.fn(async () => progress),
  resume: vi.fn(),
  cancelWaiting: vi.fn(async () => ({
    ...progress,
    status: 'cancelled' as const,
    nextAction: 'none' as const,
  })),
} as unknown as WebExecutionCapabilities;

describe('local execution API', () => {
  it('previews and starts without exposing workspace paths', async () => {
    const api = { execution };
    const preview = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/execution/preview`,
        body: { expectedRevision: 2, todoVersion: 1 },
      },
      api,
    );
    expect(preview).toMatchObject({
      status: 200,
      body: { data: { digest: 'a'.repeat(64), todoFileName: 'TODO.md', gitClean: true } },
    });
    expect(JSON.stringify(preview)).not.toContain('/secret');

    const started = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/execution`,
        body: {
          requestId: '123e4567-e89b-42d3-a456-426614174001',
          contractId,
          expectedRevision: 2,
          todoVersion: 1,
          previewDigest: 'a'.repeat(64),
        },
      },
      api,
    );
    expect(started).toMatchObject({ status: 202, body: { data: { runId } } });

    const cancelled = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/executions/${runId}/cancel`,
        body: { reason: 'Stop now' },
      },
      api,
    );
    expect(cancelled).toMatchObject({ status: 200, body: { data: { status: 'cancelled' } } });
    expect(execution.cancelWaiting).toHaveBeenCalledWith(runId, 'Stop now');
  });
});
