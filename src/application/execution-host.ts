import type { WorkflowRun } from '../core/run.js';
import type {
  ApplicationRunEventPage,
  ApplicationRunEventPageQuery,
  ApplicationRunListPage,
  ApplicationRunListQuery,
} from './ports.js';
import type { RunWorkflowRequest } from './execution-operations.js';
import type { ApplicationService } from './service.js';
import type { RunView } from './run-view.js';

export interface ExecutionStartRequest {
  requestId: string;
  workflowId: string;
  objective: string;
}

export interface ExecutionStartResult {
  runId: string;
}

export interface ExecutionHostClient {
  start(request: ExecutionStartRequest): Promise<ExecutionStartResult>;
  cancel(runId: string): Promise<void>;
  listRuns(query?: ApplicationRunListQuery): Promise<ApplicationRunListPage>;
  getRunView(runId: string): Promise<RunView>;
  listRunEvents(
    runId: string,
    query?: ApplicationRunEventPageQuery,
  ): Promise<ApplicationRunEventPage>;
}

export interface ExecutionHost {
  readonly client: ExecutionHostClient;
  close(): Promise<void>;
}

export interface CreateExecutionHostOptions {
  application: Pick<
    ApplicationService,
    'runWorkflow' | 'listRuns' | 'getRunView' | 'listRunEvents'
  >;
  findRun(runId: string): Promise<WorkflowRun | undefined>;
  close(): void | Promise<void>;
}

interface ActiveExecution {
  readonly runId: string;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  cancelPromise?: Promise<void>;
}

export function createExecutionHost(options: CreateExecutionHostOptions): ExecutionHost {
  let activeExecution: ActiveExecution | undefined;
  let closePromise: Promise<void> | undefined;
  let closing = false;
  let internalFailure: unknown;

  const start = (request: ExecutionStartRequest): Promise<ExecutionStartResult> => {
    try {
      assertCanStart();
      const captured = captureStartRequest(request);
      if (activeExecution) {
        throw new Error(`Execution host is already running ${activeExecution.runId}`);
      }

      const controller = new AbortController();
      const receipt = deferred<ExecutionStartResult>();
      const completion = deferred<void>();
      const active: ActiveExecution = {
        runId: `host-${captured.requestId}`,
        controller,
        completion: completion.promise,
        resolveCompletion: completion.resolve,
      };
      activeExecution = active;
      void execute(active, captured, receipt);
      return receipt.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const cancel = (runId: string): Promise<void> => {
    try {
      assertOpen();
      const active = activeExecution;
      if (active) {
        if (active.runId !== runId) {
          throw new Error(`Run ${runId} is not owned by this execution host`);
        }
        if (!active.cancelPromise) {
          active.controller.abort();
          active.cancelPromise = active.completion.then(() => undefined);
        }
        return active.cancelPromise;
      }
      return cancelPersistedRun(runId);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = finishClose();
    return closePromise;
  };

  const client: ExecutionHostClient = {
    start,
    cancel,
    listRuns: (query) => {
      try {
        assertOpen();
        return options.application.listRuns(query);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getRunView: (runId) => {
      try {
        assertOpen();
        return options.application.getRunView(runId);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    listRunEvents: (runId, query) => {
      try {
        assertOpen();
        return options.application.listRunEvents(runId, query);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };

  return { client, close };

  async function execute(
    active: ActiveExecution,
    request: CapturedStartRequest,
    receipt: Deferred<ExecutionStartResult>,
  ): Promise<void> {
    let started = false;
    try {
      const existing = await options.findRun(active.runId);
      if (existing) {
        throw new Error(`Run ${active.runId} already exists`);
      }
      if (closing || active.controller.signal.aborted) {
        throw new Error('Execution host is closed or the start was cancelled');
      }

      const operationRequest: RunWorkflowRequest = {
        workflowId: request.workflowId,
        objective: request.objective,
        input: { objective: request.objective },
        runId: active.runId,
        signal: active.controller.signal,
        onRunStarted: () => {
          if (started) return;
          started = true;
          receipt.resolve({ runId: active.runId });
        },
      };
      const operation = options.application.runWorkflow(operationRequest);
      await operation.then(
        () => {
          if (!started) {
            receipt.reject(new Error(`Run ${active.runId} completed before it started`));
          }
        },
        (error: unknown) => {
          if (!started) {
            receipt.reject(error);
          } else {
            internalFailure = error;
          }
        },
      );
    } catch (error) {
      if (!started) {
        receipt.reject(error);
      } else {
        internalFailure = error;
      }
    } finally {
      active.resolveCompletion();
      if (activeExecution === active) activeExecution = undefined;
    }
  }

  async function cancelPersistedRun(runId: string): Promise<void> {
    const run = await options.findRun(runId);
    if (!run) throw new Error(`Run ${runId} does not exist`);
    if (run.status !== 'pending' && run.status !== 'running') return;
    throw new Error(`Run ${runId} is not owned by this execution host`);
  }

  async function finishClose(): Promise<void> {
    const active = activeExecution;
    if (active) {
      active.controller.abort();
      await active.completion;
    }
    await options.close();
  }

  function assertOpen(): void {
    if (closing) throw new Error('Execution host is closed');
  }

  function assertCanStart(): void {
    assertOpen();
    if (internalFailure)
      throw new Error('Execution host is unavailable after an execution failure');
  }
}

interface CapturedStartRequest {
  readonly requestId: string;
  readonly workflowId: string;
  readonly objective: string;
}

function captureStartRequest(request: ExecutionStartRequest): CapturedStartRequest {
  if (!request || typeof request !== 'object') {
    throw new Error('Execution start request must be an object');
  }
  if (!isUuidV4(request.requestId)) {
    throw new Error('requestId must be a canonical lowercase UUID v4');
  }
  if (request.workflowId !== 'plan-build') {
    throw new Error('Hosted execution only supports the plan-build workflow');
  }
  if (typeof request.objective !== 'string' || request.objective.length === 0) {
    throw new Error('Execution objective must be non-empty');
  }
  return {
    requestId: request.requestId,
    workflowId: request.workflowId,
    objective: request.objective,
  };
}

function isUuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
