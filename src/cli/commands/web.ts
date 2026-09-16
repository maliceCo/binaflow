import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import type { TaskContractBrief } from '../../application/task-contract.js';
import { createPersonalWebRuntime } from '../../application/web-runtime.js';
import { createExecutionHost } from '../../application/execution-host.js';
import { openApplicationContext } from '../../application/runtime.js';
import { loadWebConfig } from '../../web/config.js';
import { loadOrCreateDeviceIdentity } from '../../web/device-identity.js';
import { FileDeviceStore } from '../../web/device-store.js';
import {
  FileProjectCatalog,
  listProjectDirectory,
  discoverProjectRootCandidates,
  registerProjectFromDirectory,
  resolveDefaultProjectCatalogPath,
} from '../../web/project-catalog.js';
import { PeerAuth } from '../../web/peer-auth.js';
import {
  createWebSettingsController,
  launcherSettingsToWebConfig,
  loadOrBootstrapWebSettings,
  readWebSettingsSourceHash,
  resolveDefaultWebSettingsPath,
} from '../../web/settings-store.js';
import { createWebServer } from '../../web/server.js';
import { projectWebSource } from '../../web/contracts.js';
import { toWebTaskDto } from '../../web/dto.js';
import type { WebApiCapabilities } from '../../web/routes.js';
import { rootOptions } from './common.js';
import { createLauncherTransferResources } from './web-transfer.js';

export function registerWebCommand(cli: Command): void {
  cli
    .command('web')
    .description('Start the personal authenticated browser interface')
    .option('--web-config <path>', 'path to the legacy project web configuration')
    .option('--launcher', 'use the global launcher settings')
    .action(
      async (commandOptions: { webConfig?: string; launcher?: boolean }, command: Command) => {
        const options = rootOptions(command);
        if (options.json || options.jsonl)
          throw new Error('The web command cannot use machine output');
        if (commandOptions.webConfig && commandOptions.launcher) {
          throw new Error('The --launcher and --web-config options cannot be combined');
        }

        const launcherMode = !commandOptions.webConfig || commandOptions.launcher === true;
        const settingsPath = launcherMode ? resolveDefaultWebSettingsPath() : undefined;
        const launcherSettings = settingsPath
          ? await loadOrBootstrapWebSettings(settingsPath)
          : undefined;
        const webConfig = launcherSettings
          ? launcherSettingsToWebConfig(launcherSettings)
          : await loadWebConfig(commandOptions.webConfig!);
        const settingsController =
          settingsPath && launcherSettings
            ? createWebSettingsController(
                settingsPath,
                launcherSettings,
                await readWebSettingsSourceHash(settingsPath),
              )
            : undefined;
        const context =
          launcherMode && !options.cwd && !options.config
            ? undefined
            : await openApplicationContext({
                ...(options.config ? { configPath: options.config } : {}),
                ...(options.cwd ? { cwd: options.cwd } : {}),
              });
        let host: ReturnType<typeof createExecutionHost> | undefined;
        if (context) {
          if (!context.guidedExecution || !context.findRun) {
            await context.close();
            throw new Error('Application runtime does not provide an execution host');
          }
          host = createExecutionHost({
            application: context.application,
            guidedExecution: context.guidedExecution,
            ...(context.application.guidedPreparation
              ? { guidedPreparation: { service: context.application.guidedPreparation } }
              : {}),
            findRun: context.findRun,
            close: context.close,
          });
        }
        const launcherResources =
          launcherMode &&
          !options.cwd &&
          !options.config &&
          settingsPath &&
          launcherSettings &&
          settingsController
            ? await createLauncherResources(settingsPath, settingsController)
            : undefined;
        const activeApplication = () => {
          const application = launcherResources?.runtime.getActiveApplication();
          if (!application?.taskContracts) throw new Error('Select an active project first');
          return application;
        };
        const activePreparation = () => {
          const preparation = launcherResources?.runtime.getActiveHost()?.client.guidedPreparation;
          if (!preparation) throw new Error('The active project has no guided preparation');
          return preparation;
        };
        const activeExecution = () => {
          const execution = launcherResources?.runtime.getActiveHost()?.client.taskExecutions;
          if (!execution) throw new Error('The active project has no guided execution');
          return execution;
        };
        const api: WebApiCapabilities = {
          ...(settingsController ? { settings: settingsController } : {}),
          ...(launcherResources
            ? {
                devices: launcherResources.devices,
                projectCatalog: launcherResources.projectCatalog,
                projectRuntime: launcherResources.runtime,
                transfers: launcherResources.transfers,
                taskContracts: {
                  list: (query) => activeApplication().taskContracts!.list(query),
                  get: (taskId) => activeApplication().taskContracts!.get(taskId),
                  create: (request) => activeApplication().taskContracts!.create(request),
                  getDocument: (request) => activeApplication().taskContracts!.getDocument(request),
                },
                guidedPreparation: {
                  execute: (request, options) => activePreparation().execute(request, options),
                  create: (contractId) => activePreparation().create(contractId),
                  getState: (contractId) => activePreparation().getState(contractId),
                  listMessages: (contractId, afterSequence) =>
                    activePreparation().listMessages(contractId, afterSequence),
                  listSources: (contractId, afterSequence) =>
                    activePreparation().listSources(contractId, afterSequence),
                },
                getTaskDetail: async (taskId) => {
                  const task = await activeApplication().taskContracts!.get(taskId);
                  const preparation = activePreparation();
                  const state = await preparation.getState(taskId);
                  const [messages, sources] = await Promise.all([
                    preparation.listMessages(taskId),
                    preparation.listSources(taskId),
                  ]);
                  const brief = await activeApplication().taskContracts!.getDocument({
                    contractId: taskId,
                    kind: 'brief',
                    version: task.currentBrief.version,
                  });
                  return {
                    ...toWebTaskDto(task),
                    currentBrief: brief.body as TaskContractBrief,
                    messages: messages.items,
                    sources: sources.items.map(projectWebSource),
                    preparationRevision: state?.revision ?? 0,
                    lastSequence: state?.lastSequence ?? 0,
                    confirmedSourceIds: state?.confirmedSourceIds ?? [],
                    activeOperation: null,
                  };
                },
                listMessages: (contractId, afterSequence) =>
                  activePreparation().listMessages(contractId, afterSequence),
                listSources: (contractId, afterSequence) =>
                  activePreparation().listSources(contractId, afterSequence),
                execution: {
                  previewStart: (request) => activeExecution().previewStart(request),
                  previewResume: (runId) => activeExecution().previewResume(runId),
                  get: (runId) => activeExecution().get(runId),
                  list: (query) => activeExecution().list(query),
                  start: (request) => activeExecution().start(request),
                  resume: (request) => activeExecution().resume(request),
                  cancelWaiting: (runId, reason) => activeExecution().cancelWaiting(runId, reason),
                },
              }
            : {}),
          ...(context && host
            ? {
                ...(context.application.taskContracts
                  ? { taskContracts: context.application.taskContracts }
                  : {}),
                ...(host.client.guidedPreparation
                  ? {
                      guidedPreparation: {
                        execute: host.client.guidedPreparation.execute,
                        create: host.client.guidedPreparation.create,
                        getState: host.client.guidedPreparation.getState,
                        listMessages: host.client.guidedPreparation.listMessages,
                        listSources: host.client.guidedPreparation.listSources,
                      },
                    }
                  : {}),
                ...(host.client.taskExecutions
                  ? {
                      execution: {
                        previewStart: host.client.taskExecutions.previewStart,
                        previewResume: host.client.taskExecutions.previewResume,
                        get: host.client.taskExecutions.get,
                        list: host.client.taskExecutions.list,
                        start: host.client.taskExecutions.start,
                        resume: host.client.taskExecutions.resume,
                        cancelWaiting: host.client.taskExecutions.cancelWaiting,
                      },
                    }
                  : {}),
              }
            : {}),
        };
        const server = createWebServer({ config: webConfig, api });
        const stop = async (): Promise<void> => {
          await server.close();
          await launcherResources?.close();
          await launcherResources?.runtime.close();
          await host?.close();
        };
        const waitForSignal = new Promise<void>((resolve) => {
          const onSignal = (): void => {
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            resolve();
          };
          process.once('SIGINT', onSignal);
          process.once('SIGTERM', onSignal);
        });
        try {
          await launcherResources?.peerTransport?.start();
          await server.start();
          await waitForSignal;
        } finally {
          await stop();
        }
      },
    );
}

async function createLauncherResources(
  settingsPath: string,
  settingsController: ReturnType<
    typeof import('../../web/settings-store.js').createWebSettingsController
  >,
) {
  const identity = await loadOrCreateDeviceIdentity({
    directory: join(dirname(settingsPath), 'device'),
  });
  const deviceStore = new FileDeviceStore(join(dirname(settingsPath), 'devices.json'));
  const peerAuth = new PeerAuth(identity, {
    peers: deviceStore.load(),
    persistPeers: (peers) => deviceStore.save(peers),
    allowExperimentalHttpOrigin:
      settingsController.get().peerTransport?.mode === 'lan-experimental',
  });
  const catalog = new FileProjectCatalog(resolveDefaultProjectCatalogPath());
  const rootCandidates = await discoverProjectRootCandidates();
  const runtime = createPersonalWebRuntime({ catalog, ownerDeviceId: identity.deviceId });
  const projectCatalog = {
    listSetupRoots: async () => {
      const authorized = new Set(settingsController.get().projectRoots.map((root) => root.path));
      return rootCandidates
        .filter((candidate) => !authorized.has(candidate.path))
        .map(({ id, label }) => ({ id, label }));
    },
    authorizeSetupRoot: async (candidateId: string) => {
      const candidate = rootCandidates.find((item) => item.id === candidateId);
      if (!candidate) throw new Error('Setup root candidate was not found');
      const current = settingsController.get();
      if (current.projectRoots.some((root) => root.path === candidate.path)) {
        return { settings: current, restartRequired: false };
      }
      return settingsController.update({
        ...current,
        projectRoots: [
          ...current.projectRoots,
          { rootId: candidate.id, label: candidate.label, path: candidate.path },
        ],
      });
    },
    getRoots: () =>
      settingsController.get().projectRoots.map(({ rootId, label }) => ({ id: rootId, label })),
    listProjects: async () => catalog.list().then((value) => value.projects),
    listDirectory: (rootId: string, segments: string[], offset: number, limit: number) =>
      listProjectDirectory(settingsController.get().projectRoots, rootId, segments, offset, limit),
    register: (rootId: string, segments: string[], projectId?: string) =>
      registerProjectFromDirectory(
        catalog,
        settingsController.get().projectRoots,
        rootId,
        segments,
        identity.deviceId,
        projectId,
      ),
  };
  const transferResources = await createLauncherTransferResources({
    settingsPath,
    settings: settingsController,
    identity,
    peerAuth,
    catalog,
    getActiveProject: () => runtime.getActiveProject(),
  });
  return {
    runtime,
    projectCatalog,
    transfers: transferResources.transfers,
    peerTransport: transferResources.peerTransport,
    close: transferResources.close,
    devices: {
      list: () => peerAuth.listPeers(),
      beginPairing: () => peerAuth.beginPairing(),
      confirmPeer: (
        record: import('../../web/launcher-contracts.js').DeviceRecord,
        expectedFingerprint?: string,
      ) => peerAuth.confirmPeerFingerprint(record, expectedFingerprint),
      revokePeer: (deviceId: string) => peerAuth.revokePeer(deviceId),
    },
  };
}
