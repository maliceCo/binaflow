import { mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileArtifactStore } from '../artifacts/file-artifact-store.js';
import { loadConfig, loadDataDir, loadQaHistory } from '../config.js';
import { createWorkflowRuntime, WorkflowEngine } from '../core/engine.js';
import type { EventSink, NormalizedEvent } from '../core/events.js';
import { PiDriver } from '../drivers/pi-rpc.js';
import { PiModelDiscovery } from '../drivers/pi-discovery.js';
import { SqliteRunStore } from '../storage/sqlite-run-store.js';
import type { ApplicationRunStore } from './ports.js';
import { interpretWorkflowDisposition } from '../workflows/dispositions.js';
import { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import { PlanBuildQaCoordinator } from './plan-build-qa-coordinator.js';
import {
  createApplicationService,
  createApplicationQueries,
  type ApplicationQueries,
  type ApplicationService,
} from './service.js';

export interface ApplicationContext {
  readonly application: ApplicationService;
  close(): void;
}

export interface ApplicationStorageContext {
  readonly application: ApplicationQueries;
  close(): void;
}

export type ApplicationRuntimeContext = ApplicationContext;

export interface OpenApplicationOptions {
  configPath?: string;
  cwd?: string;
  onEvent?: (event: NormalizedEvent) => void | Promise<void>;
}

export function isApplicationEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && fileURLToPath(moduleUrl) === realpathSync(argv1);
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
  const eventListeners = new Set<(event: NormalizedEvent) => void | Promise<void>>();
  if (options.onEvent) eventListeners.add(options.onEvent);
  const eventSink = createRuntimeEventSink(store, async (event) => {
    for (const listener of eventListeners) await listener(event);
  });
  const driver = new PiDriver({ command: config.piCommand, cwd });
  const runtime = createWorkflowRuntime(store, artifacts, driver, eventSink, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  const engine = new WorkflowEngine(store, artifacts, driver, eventSink, {
    interpretDisposition: interpretWorkflowDisposition,
  });
  const researchCoordinator = new ResearchPlanBuildCoordinator(runtime, store, artifacts);
  const planBuildQaCoordinator = new PlanBuildQaCoordinator(
    runtime,
    store,
    artifacts,
    config.qaHistory.enabled ? store : undefined,
  );
  const application = createApplicationService({
    config,
    store,
    artifacts,
    engine,
    researchCoordinator,
    planBuildQaCoordinator,
    ...(config.qaHistory.enabled ? { qaHistory: store } : {}),
    modelDiscovery: new PiModelDiscovery(),
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  });
  return { application, close: () => store.close() };
}

/** Storage-only open for read commands that do not execute workflows. */
export async function openApplicationStorage(
  configPath = '.binaflow/config.json',
  cwd = process.cwd(),
): Promise<ApplicationStorageContext> {
  const dataDir = await loadDataDir(configPath, cwd);
  const qaHistory = await loadQaHistory(configPath, cwd);
  await mkdir(dataDir, { recursive: true });
  const store = new SqliteRunStore(`${dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${dataDir}/artifacts`);
  const queries = createApplicationQueries({
    config: { profiles: {}, qaHistory },
    store,
    artifacts,
    ...(qaHistory.enabled ? { qaHistory: store } : {}),
    modelDiscovery: { discoverModels: async () => [] },
  });
  return { application: queries, close: () => store.close() };
}

export function createRuntimeEventSink(
  store: Pick<ApplicationRunStore, 'saveEvent' | 'saveEvents'>,
  observer?: (event: NormalizedEvent) => void | Promise<void>,
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
      await observer?.(event);
      return;
    }
    await flushTextEvents();
    await store.saveEvent(event);
    await observer?.(event);
  };
  eventSink.flush = flushTextEvents;
  return eventSink;
}

export const MAX_BUFFERED_TEXT_EVENTS = 256;
export const MAX_BUFFERED_TEXT_BYTES = 1024 * 1024;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
