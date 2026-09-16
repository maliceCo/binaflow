import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import { createPersonalWebRuntime } from '../../application/web-runtime.js';
import { createExecutionHost } from '../../application/execution-host.js';
import { openApplicationContext } from '../../application/runtime.js';
import { loadWebConfig } from '../../web/config.js';
import { loadOrCreateDeviceIdentity } from '../../web/device-identity.js';
import {
  FileProjectCatalog,
  listProjectDirectory,
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
        const api: WebApiCapabilities = {
          ...(settingsController ? { settings: settingsController } : {}),
          ...(launcherResources
            ? {
                devices: launcherResources.devices,
                projectCatalog: launcherResources.projectCatalog,
                projectRuntime: launcherResources.runtime,
                transfers: launcherResources.transfers,
              }
            : {}),
          ...(context && host
            ? {
                ...(context.application.taskContracts
                  ? { taskContracts: context.application.taskContracts }
                  : {}),
                ...(host.client.guidedPreparation
                  ? { guidedPreparation: { execute: host.client.guidedPreparation.execute } }
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
  const peerAuth = new PeerAuth(identity, {
    allowExperimentalHttpOrigin:
      settingsController.get().peerTransport?.mode === 'lan-experimental',
  });
  const catalog = new FileProjectCatalog(resolveDefaultProjectCatalogPath());
  const runtime = createPersonalWebRuntime({ catalog, ownerDeviceId: identity.deviceId });
  const projectCatalog = {
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
