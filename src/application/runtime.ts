import { mkdir } from 'node:fs/promises';
import { FileArtifactStore } from '../artifacts/file-artifact-store.js';
import { loadConfig } from '../config.js';
import { WorkflowEngine } from '../core/engine.js';
import type { EventSink, NormalizedEvent } from '../core/events.js';
import { PiDriver } from '../drivers/pi-rpc.js';
import { SqliteRunStore } from '../storage/sqlite-run-store.js';
import type { RunStore } from '../storage/run-store.js';
import type { ApplicationContext } from './operations.js';

export interface ApplicationRuntimeContext extends ApplicationContext {
  close(): void;
  subscribeEvents(listener: (event: NormalizedEvent) => void): () => void;
}

export async function openApplicationContext(
  configPath: string,
  cwd = process.cwd(),
): Promise<ApplicationRuntimeContext> {
  const config = await loadConfig(configPath, cwd);
  await mkdir(config.dataDir, { recursive: true });
  const store = new SqliteRunStore(`${config.dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${config.dataDir}/artifacts`);
  const eventListeners = new Set<(event: NormalizedEvent) => void>();
  const eventSink = createRuntimeEventSink(store, (event) => {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch {
        // Presentation listeners must not change event persistence semantics.
      }
    }
  });
  const engine = new WorkflowEngine(
    store,
    artifacts,
    new PiDriver({ command: config.piCommand, cwd }),
    eventSink,
  );
  return {
    config,
    store,
    artifacts,
    engine,
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    close: () => store.close(),
  };
}

export function createRuntimeEventSink(
  store: Pick<RunStore, 'saveEvent' | 'saveEvents'>,
  observer?: (event: NormalizedEvent) => void,
): EventSink {
  const pendingTextEvents: NormalizedEvent[] = [];
  let pendingTextBytes = 0;

  const flushTextEvents = async (): Promise<void> => {
    if (pendingTextEvents.length === 0) return;
    const events = pendingTextEvents.splice(0, pendingTextEvents.length);
    const bytes = events.reduce((total, event) => total + byteLength(event.message), 0);
    pendingTextBytes -= bytes;
    try {
      await store.saveEvents(events);
    } catch (error) {
      pendingTextEvents.unshift(...events);
      pendingTextBytes += bytes;
      throw error;
    }
  };

  const eventSink: EventSink = async (event) => {
    if (event.type === 'text') {
      pendingTextEvents.push(event);
      pendingTextBytes += byteLength(event.message);
      if (
        pendingTextEvents.length >= MAX_BUFFERED_TEXT_EVENTS ||
        pendingTextBytes >= MAX_BUFFERED_TEXT_BYTES
      ) {
        await flushTextEvents();
      }
      observer?.(event);
      return;
    }
    await flushTextEvents();
    await store.saveEvent(event);
    observer?.(event);
  };
  eventSink.flush = flushTextEvents;
  return eventSink;
}

export const MAX_BUFFERED_TEXT_EVENTS = 256;
export const MAX_BUFFERED_TEXT_BYTES = 1024 * 1024;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
