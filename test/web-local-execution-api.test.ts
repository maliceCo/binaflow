import { describe, expect, it, vi } from 'vitest';
import { GuidedExecutionError } from '../src/application/guided-execution.js';
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
  previewResume: vi.fn(async () => ({
    runId,
    revision: 3,
    status: 'waiting' as const,
    activeBlock: null,
    allowedDecisions: ['retry-task' as const],
    digest: 'b'.repeat(64),
  })),
  get: vi.fn(async () => progress),
  list: vi.fn(async () => ({ items: [progress] })),
  start: vi.fn(async () => progress),
  resume: vi.fn(async () => ({
    ...progress,
    status: 'completed' as const,
    nextAction: 'none' as const,
  })),
  cancelWaiting: vi.fn(async () => ({
    ...progress,
    status: 'cancelled' as const,
    nextAction: 'none' as const,
  })),
} as unknown as WebExecutionCapabilities;

describe('local execution API', () => {
  it('previews a waiting execution resume without exposing internal paths', async () => {
    const response = await handleWebApi(
      {
        method: 'GET',
        path: `/api/v1/executions/${runId}/resume/preview`,
      },
      { execution },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        version: 1,
        data: {
          runId,
          revision: 3,
          status: 'waiting',
          allowedDecisions: ['retry-task'],
          digest: 'b'.repeat(64),
        },
      },
    });
  });

  it('maps a task that is not ready to a specific conflict', async () => {
    const response = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/execution/preview`,
        body: { expectedRevision: 2, todoVersion: 1 },
      },
      {
        execution: {
          ...execution,
          previewStart: vi.fn(async () => {
            throw new GuidedExecutionError('not-ready', 'internal readiness detail');
          }),
        } as unknown as WebExecutionCapabilities,
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        version: 1,
        error: { code: 'not-ready', message: 'The task is not ready for execution.' },
      },
    });
  });

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

    const approved = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/executions/${runId}/resume`,
        body: {
          runId,
          expectedRevision: 3,
          previewDigest: 'b'.repeat(64),
          decision: 'approve-changes',
          reason: 'Reviewed and approved from the web',
        },
      },
      api,
    );
    expect(approved).toMatchObject({ status: 202, body: { data: { status: 'completed' } } });
    expect(execution.resume).toHaveBeenCalledWith({
      runId,
      expectedRevision: 3,
      previewDigest: 'b'.repeat(64),
      decision: 'approve-changes',
      reason: 'Reviewed and approved from the web',
    });

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
