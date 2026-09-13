import { describe, expect, it, vi } from 'vitest';
import type { RunWorkflowRequest } from '../src/application/execution-operations.js';
import type { WorkflowRun } from '../src/core/run.js';
import type { ApplicationService } from '../src/application/service.js';
import { createExecutionHost } from '../src/application/execution-host.js';

const request = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  workflowId: 'plan-build',
  objective: 'Implement the hosted workflow',
};

const run = { id: `host-${request.requestId}`, status: 'running' } as WorkflowRun;

describe('execution host lifecycle', () => {
  it('returns the start receipt before the workflow completes', async () => {
    const operation = deferred<WorkflowRun>();
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input) => {
      void input.onRunStarted?.(run);
      return operation.promise;
    });
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: async () => undefined,
      close: closeContext,
    });

    await expect(host.client.start(request)).resolves.toEqual({ runId: run.id });
    expect(runWorkflow).toHaveBeenCalledOnce();
    expect(closeContext).not.toHaveBeenCalled();

    operation.resolve(run);
    await host.close();
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('rejects a start when the workflow fails before its receipt', async () => {
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>(async () => {
      throw new Error('could not start workflow');
    });
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: async () => undefined,
      close: closeContext,
    });

    await expect(host.client.start(request)).rejects.toThrow('could not start workflow');
    await host.close();
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('aborts once and makes repeated cancellation wait for cleanup', async () => {
    const operation = deferred<WorkflowRun>();
    let executionRequest: RunWorkflowRequest | undefined;
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input) => {
      executionRequest = input;
      void input.onRunStarted?.(run);
      return operation.promise;
    });
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    await host.client.start(request);
    const firstCancel = host.client.cancel(run.id);
    const secondCancel = host.client.cancel(run.id);

    expect(executionRequest?.signal?.aborted).toBe(true);
    expect(runWorkflow).toHaveBeenCalledOnce();
    let cleaned = false;
    void firstCancel.then(() => {
      cleaned = true;
    });
    await Promise.resolve();
    expect(cleaned).toBe(false);

    operation.resolve({ ...run, status: 'cancelled' });
    await expect(firstCancel).resolves.toBeUndefined();
    await expect(secondCancel).resolves.toBeUndefined();
  });

  it('waits for an in-flight start before closing the context', async () => {
    const persistedRun = deferred<WorkflowRun | undefined>();
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>(() => {
      throw new Error('runWorkflow must not be called while closing');
    });
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: () => persistedRun.promise,
      close: closeContext,
    });

    const start = host.client.start(request);
    const closing = host.close();
    expect(closeContext).not.toHaveBeenCalled();

    persistedRun.resolve(undefined);
    await expect(start).rejects.toThrow(/closed|cancelled/i);
    await closing;
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalledOnce();
  });
});

function applicationWith(
  runWorkflow: ApplicationService['runWorkflow'],
): Pick<ApplicationService, 'runWorkflow' | 'listRuns' | 'getRunView' | 'listRunEvents'> {
  return {
    runWorkflow,
    listRuns: async () => ({ runs: [] }),
    getRunView: async () => {
      throw new Error('not used in this test');
    },
    listRunEvents: async () => {
      throw new Error('not used in this test');
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
