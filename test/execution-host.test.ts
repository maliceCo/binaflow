import { describe, expect, it, vi } from 'vitest';
import type { RunWorkflowRequest } from '../src/application/execution-operations.js';
import type {
  GuidedExecutionProgress,
  GuidedExecutionService,
} from '../src/application/guided-execution.js';
import type { WorkflowRun } from '../src/core/run.js';
import type { ApplicationService } from '../src/application/service.js';
import { createExecutionHost } from '../src/application/execution-host.js';

const request = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  workflowId: 'plan-build',
  objective: 'Implement the hosted workflow',
};

const run = {
  id: `host-${request.requestId}`,
  workflowId: 'plan-build',
  workflowVersion: 1,
  objective: request.objective,
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies WorkflowRun;

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

  it('reuses the in-flight receipt for the same request and rejects a different request as busy', async () => {
    const operation = deferred<WorkflowRun>();
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input) => {
      void input.onRunStarted?.(run);
      return operation.promise;
    });
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    const first = host.client.start(request);
    const repeated = host.client.start({ ...request });
    const different = expect(
      host.client.start({
        ...request,
        requestId: '123e4567-e89b-42d3-a456-426614174001',
      }),
    ).rejects.toThrow(/already.*running|busy/i);
    const conflict = expect(
      host.client.start({ ...request, objective: 'A different objective' }),
    ).rejects.toThrow(/already.*running|conflict/i);

    expect(repeated).toBe(first);
    await different;
    await conflict;
    await expect(first).resolves.toEqual({ runId: run.id });
    expect(runWorkflow).toHaveBeenCalledOnce();

    operation.resolve(run);
    await host.close();
  });

  it('replays an existing run after validating its persisted input', async () => {
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>();
    const readArtifact = vi.fn<ApplicationService['readArtifact']>(async () => ({
      artifact: {} as never,
      content: JSON.stringify({ objective: request.objective }),
      truncated: false,
      formatted: false,
    }));
    const existingRun = { ...run, status: 'completed' } as WorkflowRun;
    const host = createExecutionHost({
      application: applicationWith(runWorkflow, readArtifact),
      findRun: async () => existingRun,
      close: vi.fn(),
    });

    await expect(host.client.start(request)).resolves.toEqual({ runId: run.id });
    expect(runWorkflow).not.toHaveBeenCalled();
    expect(readArtifact).toHaveBeenCalledWith(run.id, 'run.input', {
      mode: 'preview',
      maxBytes: 64_000,
    });
    await host.close();
  });

  it.each([
    [
      'corrupt',
      async () => ({
        artifact: {} as never,
        content: '{not-json',
        truncated: false,
        formatted: false,
      }),
    ],
    [
      'missing',
      async () => {
        throw new Error('missing input artifact');
      },
    ],
  ])('rejects a replay with %s input without executing it', async (_kind, readArtifactImpl) => {
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>();
    const readArtifact = vi.fn<ApplicationService['readArtifact']>(readArtifactImpl);
    const host = createExecutionHost({
      application: applicationWith(runWorkflow, readArtifact),
      findRun: async () => run,
      close: vi.fn(),
    });

    await expect(host.client.start(request)).rejects.toThrow(/input.*invalid|corrupt/i);
    expect(runWorkflow).not.toHaveBeenCalled();
    await host.close();
  });

  it('rejects an input larger than the hosted limit before executing it', async () => {
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>();
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    await expect(host.client.start({ ...request, objective: 'x'.repeat(64_000) })).rejects.toThrow(
      /64,?000|64.000|size|large/i,
    );
    expect(runWorkflow).not.toHaveBeenCalled();
    await host.close();
  });

  it('rejects an input with an unexpected field before consulting persistence', async () => {
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>();
    const findRun = vi.fn(async () => undefined);
    const host = createExecutionHost({
      application: applicationWith(runWorkflow),
      findRun,
      close: vi.fn(),
    });

    await expect(
      host.client.start({ ...request, unexpected: true } as typeof request & {
        unexpected: boolean;
      }),
    ).rejects.toThrow(/unexpected|field|request/i);
    expect(findRun).not.toHaveBeenCalled();
    expect(runWorkflow).not.toHaveBeenCalled();
    await host.close();
  });

  it('keeps client queries independent while the workflow is active', async () => {
    const operation = deferred<WorkflowRun>();
    const firstQuery = deferred<{ runs: WorkflowRun[] }>();
    const listRuns = vi
      .fn<ApplicationService['listRuns']>()
      .mockReturnValueOnce(firstQuery.promise)
      .mockResolvedValue({ runs: [] });
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input) => {
      void input.onRunStarted?.(run);
      return operation.promise;
    });
    const host = createExecutionHost({
      application: applicationWith(runWorkflow, undefined, { listRuns }),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    await host.client.start(request);
    const clientA = host.client.listRuns();
    operation.resolve(run);
    const clientB = host.client.listRuns();

    await expect(clientB).resolves.toEqual({ runs: [] });
    let firstFinished = false;
    void clientA.then(() => {
      firstFinished = true;
    });
    await Promise.resolve();
    expect(firstFinished).toBe(false);

    firstQuery.resolve({ runs: [] });
    await clientA;
    await host.close();
  });

  it('waits for admitted queries and rejects new queries after closing', async () => {
    const query = deferred<{ runs: WorkflowRun[] }>();
    const listRuns = vi.fn<ApplicationService['listRuns']>(() => query.promise);
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(vi.fn(), undefined, { listRuns }),
      findRun: async () => undefined,
      close: closeContext,
    });

    const pendingQuery = host.client.listRuns();
    const closing = host.close();
    expect(closeContext).not.toHaveBeenCalled();
    await expect(host.client.listRuns()).rejects.toThrow(/closed/i);

    query.resolve({ runs: [] });
    await pendingQuery;
    await closing;
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('does not cancel the workflow when a client query fails', async () => {
    const operation = deferred<WorkflowRun>();
    let operationSignal: AbortSignal | undefined;
    const listRuns = vi.fn<ApplicationService['listRuns']>(async () => {
      throw new Error('query failed');
    });
    const runWorkflow = vi.fn<ApplicationService['runWorkflow']>((input) => {
      operationSignal = input.signal;
      void input.onRunStarted?.(run);
      return operation.promise;
    });
    const host = createExecutionHost({
      application: applicationWith(runWorkflow, undefined, { listRuns }),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    await host.client.start(request);
    await expect(host.client.listRuns()).rejects.toThrow('query failed');
    expect(operationSignal?.aborted).toBe(false);

    operation.resolve(run);
    await host.close();
  });

  it('delegates independent client queries without exposing host resources', async () => {
    const listRuns = vi.fn<ApplicationService['listRuns']>(async () => ({ runs: [] }));
    const host = createExecutionHost({
      application: applicationWith(vi.fn(), undefined, { listRuns }),
      findRun: async () => undefined,
      close: vi.fn(),
    });

    await expect(host.client.listRuns({ limit: 5 })).resolves.toEqual({ runs: [] });
    await expect(host.client.listRuns({ limit: 10 })).resolves.toEqual({ runs: [] });
    expect(listRuns).toHaveBeenNthCalledWith(1, { limit: 5 });
    expect(listRuns).toHaveBeenNthCalledWith(2, { limit: 10 });
    expect(host.client).not.toHaveProperty('application');
    expect(host.client).not.toHaveProperty('close');
    await host.close();
  });

  it('cancels a replay that is still validating persisted input', async () => {
    const readStarted = deferred<void>();
    const readResult = deferred<Awaited<ReturnType<ApplicationService['readArtifact']>>>();
    const readArtifact = vi.fn<ApplicationService['readArtifact']>(async () => {
      readStarted.resolve();
      return readResult.promise;
    });
    const host = createExecutionHost({
      application: applicationWith(vi.fn(), readArtifact),
      findRun: async () => run,
      close: vi.fn(),
    });

    const start = host.client.start(request);
    await readStarted.promise;
    const cancellation = host.client.cancel(run.id);
    readResult.resolve({
      artifact: {} as never,
      content: JSON.stringify({ objective: request.objective }),
      truncated: false,
      formatted: false,
    });

    await expect(start).rejects.toThrow(/closed|cancelled/i);
    await expect(cancellation).resolves.toBeUndefined();
  });

  it('waits for a persisted-run cancellation check before closing the context', async () => {
    const persistedRun = deferred<WorkflowRun | undefined>();
    const findRun = vi.fn(() => persistedRun.promise);
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(vi.fn()),
      findRun,
      close: closeContext,
    });

    const cancellation = expect(host.client.cancel('host-other-run')).rejects.toThrow(/owned/i);
    const closing = host.close();
    expect(closeContext).not.toHaveBeenCalled();

    persistedRun.resolve({ ...run, id: 'host-other-run', status: 'running' });
    await cancellation;
    await closing;
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('surfaces an operation failure that occurs after the start receipt', async () => {
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
    operation.reject(new Error('sqlite write failed'));

    await expect(host.close()).rejects.toThrow('sqlite write failed');
    expect(closeContext).toHaveBeenCalledOnce();
  });

  it('admits guided execution and keeps its coordinator under host ownership', async () => {
    const coordinator = deferred<GuidedExecutionProgress>();
    const progress: GuidedExecutionProgress = {
      runId: 'guided-123e4567-e89b-42d3-a456-426614174000',
      contractId: 'contract-1',
      revision: 1,
      stage: 'execution',
      status: 'pending',
      phases: [],
      activeBlock: null,
      nextAction: 'execute',
    };
    const service = {
      start: vi.fn<GuidedExecutionService['start']>(async () => progress),
    } as unknown as GuidedExecutionService;
    const runner = {
      execute: vi.fn(async () => coordinator.promise),
    };
    const closeContext = vi.fn();
    const host = createExecutionHost({
      application: applicationWith(vi.fn()),
      guidedExecution: { service, runner },
      findRun: async () => undefined,
      close: closeContext,
    });
    const request = {
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      contractId: 'contract-1',
      expectedRevision: 1,
      todoVersion: 1,
      previewDigest: 'digest',
    };

    await expect(host.client.taskExecutions!.start(request)).resolves.toEqual(progress);
    expect(runner.execute).toHaveBeenCalledWith(progress.runId, expect.any(AbortSignal));
    const closing = host.close();
    expect(closeContext).not.toHaveBeenCalled();
    coordinator.resolve({ ...progress, status: 'waiting', nextAction: 'review-changes' });
    await closing;
    expect(closeContext).toHaveBeenCalledOnce();
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
  readArtifact?: ApplicationService['readArtifact'],
  queries: Partial<Pick<ApplicationService, 'listRuns' | 'getRunView' | 'listRunEvents'>> = {},
): Pick<
  ApplicationService,
  'runWorkflow' | 'listRuns' | 'getRunView' | 'listRunEvents' | 'readArtifact'
> {
  return {
    runWorkflow,
    readArtifact:
      readArtifact ??
      (async () => {
        throw new Error('not used in this test');
      }),
    listRuns: queries.listRuns ?? (async () => ({ runs: [] })),
    getRunView:
      queries.getRunView ??
      (async () => {
        throw new Error('not used in this test');
      }),
    listRunEvents:
      queries.listRunEvents ??
      (async () => {
        throw new Error('not used in this test');
      }),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
