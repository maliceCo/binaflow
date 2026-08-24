import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../src/core/events.js';
import {
  createRuntimeEventSink,
  MAX_BUFFERED_TEXT_BYTES,
  MAX_BUFFERED_TEXT_EVENTS,
  openApplicationStorage,
} from '../src/application/runtime.js';
import { createApplicationQueries, type ApplicationQueries } from '../src/application/service.js';
import type { RunStore } from '../src/storage/run-store.js';

describe('application runtime event buffering', () => {
  it('flushes text by count and flushes status and error events immediately', async () => {
    const saveEvents = vi.fn(async (events: NormalizedEvent[]) => {
      void events;
    });
    const saveEvent = vi.fn(async (event: NormalizedEvent) => {
      void event;
    });
    const sink = createRuntimeEventSink({ saveEvents, saveEvent } as unknown as RunStore);

    for (let index = 0; index < MAX_BUFFERED_TEXT_EVENTS; index += 1) {
      await sink(textEvent(`text-${index}`));
    }
    await sink(textEvent('pending'));
    await sink(statusEvent('status flush'));
    await sink(textEvent('error pending'));
    await sink({ ...statusEvent('error flush'), type: 'error' });

    expect(saveEvents.mock.calls.map(([events]) => events.length)).toEqual([
      MAX_BUFFERED_TEXT_EVENTS,
      1,
      1,
    ]);
    expect(saveEvent.mock.calls.map(([event]) => event.type)).toEqual(['status', 'error']);
  });

  it('flushes large text buffers by bytes and retries a failed batch transactionally', async () => {
    const saveEvents = vi
      .fn<RunStore['saveEvents']>()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValue(undefined);
    const saveEvent = vi.fn<RunStore['saveEvent']>().mockResolvedValue(undefined);
    const sink = createRuntimeEventSink({ saveEvents, saveEvent } as unknown as RunStore);
    const large = 'x'.repeat(Math.ceil(MAX_BUFFERED_TEXT_BYTES / 2));

    await sink(textEvent(large));
    await expect(sink(textEvent(large))).rejects.toThrow('temporary storage failure');
    await sink.flush?.();

    expect(saveEvents).toHaveBeenCalledTimes(2);
    expect(saveEvents.mock.calls[0]?.[0]).toHaveLength(2);
    expect(saveEvents.mock.calls[1]?.[0]).toHaveLength(2);
  });
});

describe('application capability composition', () => {
  it('builds query capabilities without execution commands', () => {
    const queries: ApplicationQueries = createApplicationQueries({
      config: { profiles: {} },
      store: {} as RunStore,
      artifacts: {} as never,
      modelDiscovery: { discoverModels: async () => [] },
    });

    expect(queries).not.toHaveProperty('runWorkflow');
    expect(queries).not.toHaveProperty('resumeWorkflow');
    expect(queries).toHaveProperty('inspectRun');
  });

  it('closes storage resources on the context rather than the query service', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-context-'));
    try {
      mkdirSync(join(directory, '.binaflow'));
      writeFileSync(
        join(directory, '.binaflow', 'config.json'),
        JSON.stringify({ dataDir: './data', profiles: {} }),
      );
      const context = await openApplicationStorage('.binaflow/config.json', directory);

      expect(await context.application.listRuns()).toEqual({ runs: [] });
      context.close();
      await expect(context.application.listRuns()).rejects.toThrow(
        /database connection is not open/i,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function textEvent(message: string): NormalizedEvent {
  return {
    runId: 'run-1',
    stepId: 'plan',
    type: 'text',
    message,
    occurredAt: new Date().toISOString(),
  };
}

function statusEvent(message: string): NormalizedEvent {
  return {
    runId: 'run-1',
    stepId: 'plan',
    type: 'status',
    message,
    occurredAt: new Date().toISOString(),
  };
}
