import { mkdir } from 'node:fs/promises';
import { FileArtifactStore } from '../artifacts/file-artifact-store.js';
import { loadConfig, loadDataDir } from '../config.js';
import { WorkflowEngine } from '../core/engine.js';
import type { EventSink, NormalizedEvent } from '../core/events.js';
import { PiDriver } from '../drivers/pi-rpc.js';
import { PiModelDiscovery } from '../drivers/pi-discovery.js';
import { SqliteRunStore } from '../storage/sqlite-run-store.js';
import type { RunStore } from '../storage/run-store.js';
import { interpretWorkflowDisposition } from '../workflows/dispositions.js';
import { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import { createApplicationService, type ApplicationService } from './service.js';

export type ApplicationRuntimeContext = ApplicationService;

export interface OpenApplicationOptions {
  configPath?: string;
  cwd?: string;
  onEvent?: (event: NormalizedEvent) => void;
}

export async function openApplicationContext(
  configPathOrOptions: string | OpenApplicationOptions = '.binaflow/config.json',
  cwdArg = process.cwd(),
): Promise<ApplicationRuntimeContext> {
  const options: OpenApplicationOptions =
    typeof configPathOrOptions === 'string'
      ? { configPath: configPathOrOptions, cwd: cwdArg }
      : configPathOrOptions;
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? '.binaflow/config.json';
  const config = await loadConfig(configPath, cwd);
  await mkdir(config.dataDir, { recursive: true });
  const store = new SqliteRunStore(`${config.dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${config.dataDir}/artifacts`);
  const eventListeners = new Set<(event: NormalizedEvent) => void>();
  if (options.onEvent) eventListeners.add(options.onEvent);
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
    { interpretDisposition: interpretWorkflowDisposition },
  );
  const researchCoordinator = new ResearchPlanBuildCoordinator(engine.runtime);
  return createApplicationService({
    config,
    store,
    artifacts,
    engine,
    researchCoordinator,
    modelDiscovery: new PiModelDiscovery(),
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    close: () => store.close(),
  });
}

/** Storage-only open for read commands that do not execute workflows. */
export async function openApplicationStorage(
  configPath = '.binaflow/config.json',
  cwd = process.cwd(),
): Promise<ApplicationRuntimeContext> {
  const dataDir = await loadDataDir(configPath, cwd);
  await mkdir(dataDir, { recursive: true });
  const store = new SqliteRunStore(`${dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${dataDir}/artifacts`);
  const config = { profiles: {} };
  const engine = new WorkflowEngine(
    store,
    artifacts,
    {
      async execute() {
        throw new Error('Execution is unavailable in storage-only application context');
      },
    },
    () => undefined,
    { interpretDisposition: interpretWorkflowDisposition },
  );
  const researchCoordinator = new ResearchPlanBuildCoordinator(engine.runtime);
  return createApplicationService({
    config,
    store,
    artifacts,
    engine,
    researchCoordinator,
    modelDiscovery: { discoverModels: async () => [] },
    subscribeEvents: () => () => undefined,
    close: () => store.close(),
  });
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
