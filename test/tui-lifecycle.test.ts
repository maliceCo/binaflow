import { describe, expect, it } from 'vitest';
import { createSnapshotInspectionController } from '../src/tui/execution.js';
import { createAttachedExecutionLifecycle } from '../src/tui/lifecycle.js';

describe('attached TUI lifecycle', () => {
  it('rejects a second operation and keeps the context open until the first finishes', async () => {
    const events: string[] = [];
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const lifecycle = createAttachedExecutionLifecycle<{
      close(): void;
    }>(undefined);
    await lifecycle.openContext(async () => ({
      close() {
        events.push('closed');
      },
    }));

    lifecycle.beginOperation();
    lifecycle.trackOperation(operation);
    expect(() => lifecycle.beginOperation()).toThrow('already active');

    const replacement = lifecycle.replaceOwnedContext(async () => ({
      close() {
        events.push('replacement closed');
      },
    }));
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseOperation();
    await replacement;
    expect(events).toEqual(['closed']);
    await lifecycle.shutdown();
  });

  it('drains tracked requests before closing an owned context', async () => {
    const events: string[] = [];
    let releaseRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const lifecycle = createAttachedExecutionLifecycle<{
      close(): void;
    }>(undefined);

    await lifecycle.openContext(async () => ({
      close() {
        events.push('closed');
      },
    }));
    lifecycle.trackRequest(
      request.then(() => {
        events.push('request settled');
      }),
    );

    const shutdown = lifecycle.shutdown();
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseRequest();
    await shutdown;
    expect(events).toEqual(['request settled', 'closed']);
  });

  it('rejects new operations synchronously once shutdown starts', async () => {
    const lifecycle = createAttachedExecutionLifecycle<{ close(): void }>(undefined);
    await lifecycle.openContext(async () => ({ close: () => undefined }));

    const shutdown = lifecycle.shutdown();

    expect(() => lifecycle.beginOperation()).toThrow('Application context is closing.');
    await shutdown;
  });

  it('waits for a live snapshot request before closing its context', async () => {
    const events: string[] = [];
    let releaseSnapshot!: () => void;
    const lifecycle = createAttachedExecutionLifecycle<{ close(): void }>(undefined);
    await lifecycle.openContext(async () => ({
      close() {
        events.push('closed');
      },
    }));
    const controller = createSnapshotInspectionController({
      inspect: () => {
        const request = new Promise<[]>((resolve) => {
          releaseSnapshot = () => {
            events.push('snapshot settled');
            resolve([]);
          };
        });
        lifecycle.trackRequest(request);
        return request;
      },
      getRunId: () => 'run-1',
      apply: () => undefined,
    });

    controller.request('status');
    await Promise.resolve();
    const shutdown = lifecycle.shutdown();
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseSnapshot();
    await shutdown;
    expect(events).toEqual(['snapshot settled', 'closed']);
    controller.dispose();
  });
});
