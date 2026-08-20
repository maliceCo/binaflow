import { describe, expect, it } from 'vitest';
import { createAttachedExecutionLifecycle } from '../src/tui/lifecycle.js';

describe('attached TUI lifecycle', () => {
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
