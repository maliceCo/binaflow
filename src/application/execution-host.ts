import type { WorkflowRun } from '../core/run.js';
import type {
  ApplicationRunEventPage,
  ApplicationRunEventPageQuery,
  ApplicationRunListPage,
  ApplicationRunListQuery,
} from './ports.js';
import type { RunWorkflowRequest } from './execution-operations.js';
import type {
  GuidedExecutionProgress,
  GuidedExecutionService,
  GuidedResumeRequest,
  GuidedStartRequest,
} from './guided-execution.js';
import type { GuidedExecutionRunner } from './guided-execution-operations.js';
import type {
  GuidedPreparationOperationRequest,
  GuidedPreparationRequestRecord,
} from './guided-preparation.js';
import type { GuidedPreparationService } from './guided-preparation-operations.js';
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

export interface HostedGuidedExecution {
  readonly service: GuidedExecutionService;
  readonly runner: GuidedExecutionRunner;
}

export interface HostedGuidedPreparation {
  readonly service: GuidedPreparationService;
}

export interface ExecutionHostClient {
  readonly guidedPreparation?: {
    execute(
      request: GuidedPreparationOperationRequest,
      options?: { signal?: AbortSignal },
    ): Promise<GuidedPreparationRequestRecord>;
  };
  start(request: ExecutionStartRequest): Promise<ExecutionStartResult>;
  readonly taskExecutions?: {
    previewStart: GuidedExecutionService['previewStart'];
    previewResume: GuidedExecutionService['previewResume'];
    get: GuidedExecutionService['get'];
    list: GuidedExecutionService['list'];
    start(request: GuidedStartRequest): Promise<GuidedExecutionProgress>;
    resume(request: GuidedResumeRequest): Promise<GuidedExecutionProgress>;
    cancelWaiting(runId: string, reason: string): Promise<GuidedExecutionProgress>;
  };
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
    'runWorkflow' | 'listRuns' | 'getRunView' | 'listRunEvents' | 'readArtifact'
  >;
  guidedExecution?: HostedGuidedExecution;
  guidedPreparation?: HostedGuidedPreparation;
  findRun(runId: string): Promise<WorkflowRun | undefined>;
  close(): void | Promise<void>;
}

interface ActiveExecution {
  readonly runId: string;
  readonly request: CapturedStartRequest;
  readonly receiptPromise: Promise<ExecutionStartResult>;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  cancelPromise?: Promise<void>;
}

interface ActiveGuidedExecution {
  readonly runId: string;
  readonly request: GuidedStartRequest | GuidedResumeRequest;
  readonly receipt: Deferred<GuidedExecutionProgress>;
  readonly receiptPromise: Promise<GuidedExecutionProgress>;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  cancelPromise?: Promise<void>;
}

interface ActivePreparation {
  readonly request: GuidedPreparationOperationRequest;
  readonly receipt: Deferred<GuidedPreparationRequestRecord>;
  readonly receiptPromise: Promise<GuidedPreparationRequestRecord>;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
}

type ActiveOperation =
  | { kind: 'legacy'; value: ActiveExecution }
  | { kind: 'guided'; value: ActiveGuidedExecution }
  | { kind: 'preparation'; value: ActivePreparation };

export function createExecutionHost(options: CreateExecutionHostOptions): ExecutionHost {
  let activeOperation: ActiveOperation | undefined;
  let closePromise: Promise<void> | undefined;
  let closing = false;
  let internalFailure: unknown;
  const admittedQueries = new Set<Promise<void>>();

  const start = (request: ExecutionStartRequest): Promise<ExecutionStartResult> => {
    try {
      assertCanStart();
      const captured = captureStartRequest(request);
      const current = activeOperation?.kind === 'legacy' ? activeOperation.value : undefined;
      if (activeOperation && activeOperation.kind !== 'legacy') {
        throw new Error('Execution host is already running another operation');
      }
      if (current) {
        if (sameStartRequest(current.request, captured)) return current.receiptPromise;
        if (current.request.requestId === captured.requestId) {
          throw new Error(`Hosted start ${current.runId} conflicts with the active request`);
        }
        throw new Error(`Execution host is already running ${current.runId}`);
      }

      const controller = new AbortController();
      const receipt = deferred<ExecutionStartResult>();
      const completion = deferred<void>();
      const active: ActiveExecution = {
        runId: `host-${captured.requestId}`,
        request: captured,
        receiptPromise: receipt.promise,
        controller,
        completion: completion.promise,
        resolveCompletion: completion.resolve,
      };
      activeOperation = { kind: 'legacy', value: active };
      void execute(active, captured, receipt);
      return receipt.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const startGuided = (request: GuidedStartRequest): Promise<GuidedExecutionProgress> => {
    try {
      assertCanStart();
      const guided = requireGuidedExecution();
      if (activeOperation && activeOperation.kind !== 'guided') {
        throw new Error('Execution host is already running another operation');
      }
      const current = activeOperation?.kind === 'guided' ? activeOperation.value : undefined;
      if (current) {
        if (sameGuidedRequest(current.request, request)) return current.receiptPromise;
        throw new Error(`Execution host is already running ${current.runId}`);
      }
      const active = createActiveGuided(request, `guided-${request.requestId}`);
      activeOperation = { kind: 'guided', value: active };
      void executeGuided(active, guided, guided.service.start(request));
      return active.receiptPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const resumeGuided = (request: GuidedResumeRequest): Promise<GuidedExecutionProgress> => {
    try {
      assertCanStart();
      const guided = requireGuidedExecution();
      if (activeOperation && activeOperation.kind !== 'guided') {
        throw new Error('Execution host is already running another operation');
      }
      const current = activeOperation?.kind === 'guided' ? activeOperation.value : undefined;
      if (current) {
        if (sameGuidedRequest(current.request, request)) return current.receiptPromise;
        throw new Error(`Execution host is already running ${current.runId}`);
      }
      const active = createActiveGuided(request, request.runId);
      activeOperation = { kind: 'guided', value: active };
      void executeGuided(active, guided, guided.service.resume(request));
      return active.receiptPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const startPreparation = (
    request: GuidedPreparationOperationRequest,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<GuidedPreparationRequestRecord> => {
    try {
      assertCanStart();
      if (!options.guidedPreparation) throw new Error('Guided preparation is not configured');
      if (activeOperation) {
        if (
          activeOperation.kind === 'preparation' &&
          JSON.stringify(activeOperation.value.request) === JSON.stringify(request)
        ) {
          return activeOperation.value.receiptPromise;
        }
        throw new Error('Execution host is already running another operation');
      }
      const receipt = deferred<GuidedPreparationRequestRecord>();
      const completion = deferred<void>();
      const active: ActivePreparation = {
        request,
        receipt,
        receiptPromise: receipt.promise,
        controller: new AbortController(),
        completion: completion.promise,
        resolveCompletion: completion.resolve,
      };
      activeOperation = { kind: 'preparation', value: active };
      void executePreparation(active, options.guidedPreparation, requestOptions?.signal);
      return active.receiptPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const cancelGuidedWaiting = (runId: string, reason: string): Promise<GuidedExecutionProgress> => {
    try {
      assertOpen();
      const active = activeOperation?.kind === 'guided' ? activeOperation.value : undefined;
      if (active && active.runId === runId) {
        active.controller.abort();
        return active.completion.then(() => active.receiptPromise);
      }
      if (active) throw new Error(`Guided execution host owns ${active.runId}`);
      return admitQuery(() => requireGuidedExecution().service.cancelWaiting(runId, reason));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const cancel = (runId: string): Promise<void> => {
    try {
      assertOpen();
      const active = activeOperation?.kind === 'legacy' ? activeOperation.value : undefined;
      const activeGuided = activeOperation?.kind === 'guided' ? activeOperation.value : undefined;
      if (activeGuided && activeGuided.runId === runId) {
        if (!activeGuided.cancelPromise) {
          activeGuided.controller.abort();
          activeGuided.cancelPromise = activeGuided.completion.then(() => undefined);
        }
        return activeGuided.cancelPromise;
      }
      if (activeGuided) {
        throw new Error(`Run ${runId} is not owned by this execution host`);
      }
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
      return admitQuery(() => cancelPersistedRun(runId));
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
    ...(options.guidedPreparation ? { guidedPreparation: { execute: startPreparation } } : {}),
    ...(options.guidedExecution
      ? {
          taskExecutions: {
            previewStart: (request) =>
              admitQuery(() => options.guidedExecution!.service.previewStart(request)),
            previewResume: (runId) =>
              admitQuery(() => options.guidedExecution!.service.previewResume(runId)),
            get: (runId) => admitQuery(() => options.guidedExecution!.service.get(runId)),
            list: (query) => admitQuery(() => options.guidedExecution!.service.list(query)),
            start: startGuided,
            resume: resumeGuided,
            cancelWaiting: cancelGuidedWaiting,
          },
        }
      : {}),
    listRuns: (query) => admitQuery(() => options.application.listRuns(query)),
    getRunView: (runId) => admitQuery(() => options.application.getRunView(runId)),
    listRunEvents: (runId, query) =>
      admitQuery(() => options.application.listRunEvents(runId, query)),
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
        assertExecutionActive(active);
        await validateReplay(existing, request);
        assertExecutionActive(active);
        receipt.resolve({ runId: active.runId });
        return;
      }
      assertExecutionActive(active);

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
      if (activeOperation?.kind === 'legacy' && activeOperation.value === active) {
        activeOperation = undefined;
      }
    }
  }

  function requireGuidedExecution(): HostedGuidedExecution {
    if (!options.guidedExecution) throw new Error('Guided execution is not configured');
    return options.guidedExecution;
  }

  function createActiveGuided(
    request: GuidedStartRequest | GuidedResumeRequest,
    runId: string,
  ): ActiveGuidedExecution {
    const receipt = deferred<GuidedExecutionProgress>();
    const completion = deferred<void>();
    return {
      runId,
      request,
      receipt,
      receiptPromise: receipt.promise,
      controller: new AbortController(),
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    };
  }

  async function executePreparation(
    active: ActivePreparation,
    preparation: HostedGuidedPreparation,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    if (externalSignal) {
      if (externalSignal.aborted) active.controller.abort();
      else
        externalSignal.addEventListener('abort', () => active.controller.abort(), { once: true });
    }
    try {
      const result = await preparation.service.execute(active.request, {
        signal: active.controller.signal,
      });
      active.receipt.resolve(result);
    } catch (error) {
      active.receipt.reject(error);
    } finally {
      active.resolveCompletion();
      if (activeOperation?.kind === 'preparation' && activeOperation.value === active) {
        activeOperation = undefined;
      }
    }
  }

  async function executeGuided(
    active: ActiveGuidedExecution,
    guided: HostedGuidedExecution,
    operation: Promise<GuidedExecutionProgress>,
  ): Promise<void> {
    let admitted = false;
    try {
      const progress = await operation;
      if (closing || active.controller.signal.aborted) {
        throw new Error('Execution host is closed or the guided request was cancelled');
      }
      active.receipt.resolve(progress);
      admitted = true;
      await guided.runner.execute(progress.runId, active.controller.signal);
    } catch (error) {
      if (!admitted) active.receipt.reject(error);
      else internalFailure = error;
    } finally {
      active.resolveCompletion();
      if (activeOperation?.kind === 'guided' && activeOperation.value === active) {
        activeOperation = undefined;
      }
    }
  }

  async function cancelPersistedRun(runId: string): Promise<void> {
    const run = await options.findRun(runId);
    if (!run) throw new Error(`Run ${runId} does not exist`);
    if (run.status !== 'pending' && run.status !== 'running') return;
    throw new Error(`Run ${runId} is not owned by this execution host`);
  }

  async function validateReplay(run: WorkflowRun, request: CapturedStartRequest): Promise<void> {
    if (run.workflowId !== request.workflowId) {
      throw new Error(`Persisted run ${run.id} conflicts with workflow ${request.workflowId}`);
    }
    if (run.objective !== request.objective) {
      throw new Error(`Persisted run ${run.id} conflicts with the requested objective`);
    }

    let inputView;
    try {
      inputView = await options.application.readArtifact(run.id, 'run.input', {
        mode: 'preview',
        maxBytes: MAX_HOSTED_INPUT_BYTES,
      });
    } catch (error) {
      throw new Error(`Persisted run ${run.id} input is invalid`, { cause: error });
    }
    if (inputView.error || inputView.truncated || inputView.content === undefined) {
      throw new Error(
        `Persisted run ${run.id} input is invalid: ${inputView.error ?? 'unreadable'}`,
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(inputView.content);
    } catch (error) {
      throw new Error(`Persisted run ${run.id} input is invalid`, { cause: error });
    }
    if (!isHostedInput(input, request.objective)) {
      throw new Error(`Persisted run ${run.id} input conflicts with the requested objective`);
    }
  }

  async function finishClose(): Promise<void> {
    const active = activeOperation?.kind === 'legacy' ? activeOperation.value : undefined;
    if (active) {
      active.controller.abort();
      await active.completion;
    }
    const activeGuided = activeOperation?.kind === 'guided' ? activeOperation.value : undefined;
    if (activeGuided) {
      activeGuided.controller.abort();
      await activeGuided.completion;
    }
    const activePreparation =
      activeOperation?.kind === 'preparation' ? activeOperation.value : undefined;
    if (activePreparation) {
      activePreparation.controller.abort();
      await activePreparation.completion;
    }
    await Promise.all([...admittedQueries]);
    await options.close();
    if (internalFailure) throw internalFailure;
  }

  function admitQuery<T>(operation: () => Promise<T>): Promise<T> {
    try {
      assertOpen();
      const promise = operation();
      const tracked = promise.then(
        () => {
          admittedQueries.delete(tracked);
        },
        () => {
          admittedQueries.delete(tracked);
        },
      );
      admittedQueries.add(tracked);
      return promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function assertOpen(): void {
    if (closing) throw new Error('Execution host is closed');
  }

  function assertExecutionActive(active: ActiveExecution): void {
    if (closing || active.controller.signal.aborted) {
      throw new Error('Execution host is closed or the start was cancelled');
    }
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

const MAX_HOSTED_INPUT_BYTES = 64_000;

function captureStartRequest(request: ExecutionStartRequest): CapturedStartRequest {
  if (!request || typeof request !== 'object') {
    throw new Error('Execution start request must be an object');
  }
  const allowedFields = new Set(['requestId', 'workflowId', 'objective']);
  const unexpectedField = Object.keys(request).find((field) => !allowedFields.has(field));
  if (unexpectedField) throw new Error(`Unexpected execution start field: ${unexpectedField}`);
  if (!isUuidV4(request.requestId)) {
    throw new Error('requestId must be a canonical lowercase UUID v4');
  }
  if (request.workflowId !== 'plan-build') {
    throw new Error('Hosted execution only supports the plan-build workflow');
  }
  if (typeof request.objective !== 'string' || request.objective.length === 0) {
    throw new Error('Execution objective must be non-empty');
  }
  const objective = request.objective;
  if (Buffer.byteLength(JSON.stringify({ objective }), 'utf8') > MAX_HOSTED_INPUT_BYTES) {
    throw new Error(`Hosted execution input exceeds ${MAX_HOSTED_INPUT_BYTES} bytes`);
  }
  return {
    requestId: request.requestId,
    workflowId: request.workflowId,
    objective,
  };
}

function sameStartRequest(first: CapturedStartRequest, second: CapturedStartRequest): boolean {
  return (
    first.requestId === second.requestId &&
    first.workflowId === second.workflowId &&
    first.objective === second.objective
  );
}

function sameGuidedRequest(
  first: GuidedStartRequest | GuidedResumeRequest,
  second: GuidedStartRequest | GuidedResumeRequest,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function isHostedInput(value: unknown, objective: string): value is { objective: string } {
  return isRecord(value) && Object.keys(value).length === 1 && value.objective === objective;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
