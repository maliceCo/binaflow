import { describe, expect, it } from 'vitest';
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
});
