export interface ClosableContext {
  close?(): void | Promise<void>;
}

export type CancellationRequest = 'inactive' | 'graceful' | 'forced';

export interface AttachedExecutionLifecycle<Context extends ClosableContext> {
  readonly context: Context | undefined;
  readonly ownsContext: boolean;
  readonly forceSignal: NodeJS.Signals | undefined;
  beginOperation(): AbortController;
  trackOperation(operation: Promise<void>): void;
  subscribe(unsubscribe: (() => void) | undefined): void;
  unsubscribe(): void;
  openContext(create: () => Promise<Context>): Promise<Context>;
  /** Close an owned context and open a fresh one so execution uses current config. */
  replaceOwnedContext(create: () => Promise<Context>): Promise<Context>;
  requestCancellation(signal: NodeJS.Signals): CancellationRequest;
  shutdown(): Promise<void>;
}

export function createAttachedExecutionLifecycle<Context extends ClosableContext>(
  initialContext: Context | undefined,
): AttachedExecutionLifecycle<Context> {
  let context = initialContext;
  let ownsContext = false;
  let controller: AbortController | undefined;
  let operation: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  let cancellationRequested = false;
  let forceSignal: NodeJS.Signals | undefined;
  let shutdown: Promise<void> | undefined;
  let openingContext: Promise<Context> | undefined;
  let stopping = false;

  const releaseSubscription = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const openFresh = async (create: () => Promise<Context>): Promise<Context> => {
    if (stopping) throw new Error('Application context is closing.');
    if (openingContext) return openingContext;
    const opening = create().then((nextContext) => {
      context = nextContext;
      ownsContext = true;
      return nextContext;
    });
    openingContext = opening;
    void opening.then(
      () => {
        if (openingContext === opening) openingContext = undefined;
      },
      () => {
        if (openingContext === opening) openingContext = undefined;
      },
    );
    return opening;
  };

  return {
    get context() {
      return context;
    },
    get ownsContext() {
      return ownsContext;
    },
    get forceSignal() {
      return forceSignal;
    },
    beginOperation() {
      controller = new AbortController();
      cancellationRequested = false;
      return controller;
    },
    trackOperation(nextOperation) {
      const tracked = nextOperation.finally(() => {
        if (operation === tracked) {
          operation = undefined;
          controller = undefined;
        }
      });
      operation = tracked;
    },
    subscribe(nextUnsubscribe) {
      releaseSubscription();
      unsubscribe = nextUnsubscribe;
    },
    unsubscribe: releaseSubscription,
    async openContext(create) {
      if (context) return context;
      return openFresh(create);
    },
    async replaceOwnedContext(create) {
      if (stopping) throw new Error('Application context is closing.');
      releaseSubscription();
      await openingContext?.catch(() => undefined);
      openingContext = undefined;
      if (ownsContext) {
        const previous = context;
        context = undefined;
        ownsContext = false;
        await previous?.close?.();
      } else if (!context) {
        // No injected context; open fresh below.
      } else {
        // Injected (test) context is not closed; reuse it.
        return context;
      }
      return openFresh(create);
    },
    requestCancellation(signal) {
      if (!controller) return 'inactive';
      if (cancellationRequested) {
        forceSignal ??= signal;
        return 'forced';
      }
      cancellationRequested = true;
      controller.abort();
      return 'graceful';
    },
    async shutdown() {
      shutdown ??= (async () => {
        stopping = true;
        releaseSubscription();
        controller?.abort();
        await operation?.catch(() => undefined);
        await openingContext?.catch(() => undefined);
        if (ownsContext) await context?.close?.();
      })();
      await shutdown;
    },
  };
}
