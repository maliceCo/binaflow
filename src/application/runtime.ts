import { mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileArtifactStore } from '../artifacts/file-artifact-store.js';
import { directoryPackageStore } from '../portability/directory-package.js';
import { gitTransfer } from '../portability/git-transfer.js';
import { createWorkspaceCommandRunner } from '../process/workspace-process.js';
import { FileWorkspaceExecutionLock } from '../workspace/execution-lock.js';
import { LocalGitWorkspace } from '../workspace/git-workspace.js';
import { loadConfig, loadDataDir, loadQaHistory } from '../config.js';
import { createWorkflowRuntime, WorkflowEngine } from '../core/engine.js';
import type { EventSink, NormalizedEvent } from '../core/events.js';
import { PiDriver } from '../drivers/pi-rpc.js';
import { PiModelDiscovery } from '../drivers/pi-discovery.js';
import {
  assertActivePortableDatabase,
  FileDataDirectoryLock,
  inspectPortableDatabaseState,
} from '../storage/data-directory-lock.js';
import {
  activateImportedBackup,
  inspectPortableBackup,
  normalizePortableBackup,
} from '../storage/sqlite-portability.js';
import { SqliteRunStore } from '../storage/sqlite-run-store.js';
import type { ApplicationPortabilityStore, ApplicationRunStore } from './ports.js';
import type { WorkflowRun } from '../core/run.js';
import { createExecutionHost, type ExecutionHost } from './execution-host.js';
import { interpretWorkflowDisposition } from '../workflows/dispositions.js';
import { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import { PlanBuildQaCoordinator } from './plan-build-qa-coordinator.js';
import { TodoBuildQaCoordinator } from './todo-build-qa-coordinator.js';
import { InteractivePlanBuildQaCoordinator } from './interactive-plan-build-qa-coordinator.js';
import { GuidedExecutionCoordinator } from './guided-execution-coordinator.js';
import { createPortabilityService } from './portability-operations.js';
import {
  createGuidedExecutionRunner,
  createGuidedExecutionService,
  type GuidedExecutionRunner,
} from './guided-execution-operations.js';
import { createGuidedPreparationService } from './guided-preparation-operations.js';
import { createPublicSourceReader } from '../research/public-sources.js';
import type { PublicSourceReader } from './ports.js';
import { discoverAgentModels } from './config-operations.js';
import {
  createApplicationService,
  createApplicationQueries,
  type ApplicationQueries,
  type ApplicationService,
} from './service.js';

export interface ApplicationContext {
  readonly application: ApplicationService;
  readonly guidedExecution?: import('./execution-host.js').HostedGuidedExecution;
  readonly findRun?: (runId: string) => Promise<WorkflowRun | undefined>;
  close(): void;
}

export interface ApplicationStorageContext {
  readonly application: ApplicationQueries;
  close(): void;
}

export type ApplicationRuntimeContext = ApplicationContext;

export interface PortabilityContext {
  readonly portability: import('./ports.js').PortabilityService;
  close(): void;
}

/** Opens only the resources needed by dataset transfer commands. */
export async function openPortabilityContext(
  configPath = '.binaflow/config.json',
  cwd = process.cwd(),
  options: { createDatabase?: boolean } = {},
): Promise<PortabilityContext> {
  const config = await loadConfig(configPath, cwd);
  await mkdir(config.dataDir, { recursive: true });
  const dataDir = realpathSync(config.dataDir);
  const lease = await new FileDataDirectoryLock().acquire(dataDir);
  let store: SqliteRunStore | undefined;
  try {
    const state = inspectPortableDatabaseState(`${dataDir}/runs.db`);
    if (state || options.createDatabase !== false) {
      store = new SqliteRunStore(`${dataDir}/runs.db`);
    }
    const portabilityStore = store ?? readOnlyPortabilityStore();
    const portability = createPortabilityService({
      store: portabilityStore,
      database: { normalizePortableBackup, inspectPortableBackup, activateImportedBackup },
      packageStore: directoryPackageStore,
      git: gitTransfer,
      dataDir,
      workspace: realpathSync(cwd),
      baselineWasAbsent: !state,
    });
    let closed = false;
    return {
      portability,
      close: () => {
        if (closed) return;
        closed = true;
        try {
          store?.close();
        } finally {
          void lease.release();
        }
      },
    };
  } catch (error) {
    store?.close();
    await lease.release();
    throw error;
  }
}

function readOnlyPortabilityStore(): ApplicationPortabilityStore {
  const unavailable = async (): Promise<never> => {
    throw new Error('The configured dataset is not writable during transfer');
  };
  return {
    getPortabilityState: unavailable,
    inspectPortabilityBlockers: unavailable,
    beginExportIntent: unavailable,
    finalizeExport: unavailable,
    cancelExportIntent: unavailable,
    backupDatabaseTo: unavailable,
  };
}

/** Discovers Pi-authenticated models before a Binaflow configuration exists. */
export async function discoverAvailableModels() {
  return discoverAgentModels(new PiModelDiscovery());
}

export interface OpenApplicationOptions {
  configPath?: string;
  cwd?: string;
  onEvent?: (event: NormalizedEvent) => void | Promise<void>;
  publicSourceReader?: PublicSourceReader;
}

export function isApplicationEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && fileURLToPath(moduleUrl) === realpathSync(argv1);
}

export async function openExecutionHost(
  configPath = '.binaflow/config.json',
  cwd = process.cwd(),
): Promise<ExecutionHost> {
  const resources = await openApplicationResources(configPath, cwd);
  try {
    return createExecutionHost({
      application: resources.application,
      guidedExecution: resources.guidedExecution,
      ...(resources.application.guidedPreparation
        ? { guidedPreparation: { service: resources.application.guidedPreparation } }
        : {}),
      findRun: resources.findRun,
      close: resources.close,
    });
  } catch (error) {
    await resources.close();
    throw error;
  }
}

export async function openApplicationContext(
  configPathOrOptions: string | OpenApplicationOptions = '.binaflow/config.json',
  cwdArg = process.cwd(),
): Promise<ApplicationRuntimeContext> {
  const options: OpenApplicationOptions =
    typeof configPathOrOptions === 'string'
      ? { configPath: configPathOrOptions, cwd: cwdArg }
      : configPathOrOptions;
  const resources = await openApplicationResources(
    options.configPath ?? '.binaflow/config.json',
    options.cwd ?? process.cwd(),
    options.onEvent,
    options.publicSourceReader,
  );
  return {
    application: resources.application,
    guidedExecution: resources.guidedExecution,
    findRun: resources.findRun,
    close: resources.close,
  };
}

interface ApplicationResources {
  readonly application: ApplicationService;
  readonly guidedExecution: import('./execution-host.js').HostedGuidedExecution;
  readonly findRun: (runId: string) => Promise<WorkflowRun | undefined>;
  close(): void;
}

async function openApplicationResources(
  configPath: string,
  cwd: string,
  onEvent?: (event: NormalizedEvent) => void | Promise<void>,
  publicSourceReader?: PublicSourceReader,
): Promise<ApplicationResources> {
  const config = await loadConfig(configPath, cwd);
  await mkdir(config.dataDir, { recursive: true });
  const dataDir = realpathSync(config.dataDir);
  const dataDirectoryLease = await new FileDataDirectoryLock().acquire(dataDir);
  let store: SqliteRunStore | undefined;
  try {
    assertActivePortableDatabase(`${dataDir}/runs.db`);
    store = new SqliteRunStore(`${dataDir}/runs.db`);
  } catch (error) {
    await dataDirectoryLease.release();
    throw error;
  }
  const artifacts = new FileArtifactStore(`${dataDir}/artifacts`);
  const eventListeners = new Set<(event: NormalizedEvent) => void | Promise<void>>();
  if (onEvent) eventListeners.add(onEvent);
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
  const todoBuildQaCoordinator = new TodoBuildQaCoordinator(runtime, store, artifacts);
  const interactivePlanBuildQaCoordinator = new InteractivePlanBuildQaCoordinator(
    runtime,
    store,
    artifacts,
    config.qaHistory.enabled ? store : undefined,
  );
  const workspace = realpathSync(cwd);
  const guidedGit = new LocalGitWorkspace();
  const guidedLock = new FileWorkspaceExecutionLock();
  const guidedCoordinator = new GuidedExecutionCoordinator(
    runtime,
    store,
    store,
    artifacts,
    guidedGit,
    createWorkspaceCommandRunner(),
  );
  const guidedPreparation = config.profiles.planner
    ? createGuidedPreparationService({
        store,
        taskContracts: store,
        sourceReader: publicSourceReader ?? createPublicSourceReader(),
        driver,
        plannerProfile: config.profiles.planner,
        workspace,
      })
    : undefined;
  const guidedExecution = createGuidedExecutionService({
    taskContracts: store,
    executions: store,
    artifacts,
    git: guidedGit,
    lock: guidedLock,
    workspace,
    profiles: config.profiles,
    preparation: store,
  });
  const guidedExecutionRunner: GuidedExecutionRunner = createGuidedExecutionRunner(
    {
      taskContracts: store,
      executions: store,
      artifacts,
      git: guidedGit,
      lock: guidedLock,
      workspace,
      profiles: config.profiles,
      runStore: store,
      preparation: store,
    },
    guidedCoordinator,
  );
  const application = createApplicationService({
    config,
    store,
    artifacts,
    engine,
    researchCoordinator,
    planBuildQaCoordinator,
    todoBuildQaCoordinator,
    interactivePlanBuildQaCoordinator,
    reviewStore: store,
    preparationStore: store,
    preparationArtifacts: artifacts,
    preparationDriver: driver,
    readPreparationReviewMode: async () =>
      (await loadConfig(configPath, cwd)).preparation.reviewMode,
    ...(config.qaHistory.enabled ? { qaHistory: store } : {}),
    taskContractStore: store,
    taskContractWorkspace: workspace,
    guidedExecution,
    ...(guidedPreparation ? { guidedPreparation } : {}),
    portability: createPortabilityService({
      store,
      database: { normalizePortableBackup, inspectPortableBackup, activateImportedBackup },
      packageStore: directoryPackageStore,
      git: gitTransfer,
      dataDir,
      workspace,
    }),
    executionLock: guidedLock,
    workspace,
    modelDiscovery: new PiModelDiscovery(),
    subscribeEvents: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  });
  let closed = false;
  return {
    application,
    guidedExecution: { service: guidedExecution, runner: guidedExecutionRunner },
    findRun: (runId) => store!.getRun(runId),
    close: () => {
      if (closed) return;
      closed = true;
      try {
        store!.close();
      } finally {
        void dataDirectoryLease.release();
      }
    },
  };
}

/** Storage-only open for read commands that do not execute workflows. */
export async function openApplicationStorage(
  configPath = '.binaflow/config.json',
  cwd = process.cwd(),
): Promise<ApplicationStorageContext> {
  const dataDir = await loadDataDir(configPath, cwd);
  const qaHistory = await loadQaHistory(configPath, cwd);
  await mkdir(dataDir, { recursive: true });
  const canonicalDataDir = realpathSync(dataDir);
  const dataDirectoryLease = await new FileDataDirectoryLock().acquire(canonicalDataDir);
  let store: SqliteRunStore | undefined;
  try {
    assertActivePortableDatabase(`${canonicalDataDir}/runs.db`);
    store = new SqliteRunStore(`${canonicalDataDir}/runs.db`);
  } catch (error) {
    await dataDirectoryLease.release();
    throw error;
  }
  const artifacts = new FileArtifactStore(`${canonicalDataDir}/artifacts`);
  const queries = createApplicationQueries({
    config: { profiles: {}, qaHistory },
    store,
    artifacts,
    taskContractStore: store,
    taskContractWorkspace: realpathSync(cwd),
    ...(qaHistory.enabled ? { qaHistory: store } : {}),
    reviewStore: store,
    preparationStore: store,
    modelDiscovery: { discoverModels: async () => [] },
  });
  let closed = false;
  return {
    application: queries,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        store!.close();
      } finally {
        void dataDirectoryLease.release();
      }
    },
  };
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
