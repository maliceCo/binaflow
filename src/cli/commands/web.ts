import type { Command } from 'commander';
import { createExecutionHost } from '../../application/execution-host.js';
import { openApplicationContext } from '../../application/runtime.js';
import { loadWebConfig } from '../../web/config.js';
import {
  createWebSettingsController,
  launcherSettingsToWebConfig,
  loadOrBootstrapWebSettings,
  readWebSettingsSourceHash,
  resolveDefaultWebSettingsPath,
} from '../../web/settings-store.js';
import { createWebServer } from '../../web/server.js';
import { rootOptions } from './common.js';

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
        const server = createWebServer({
          config: webConfig,
          ...(context && host
            ? {
                api: {
                  ...(settingsController ? { settings: settingsController } : {}),
                  ...(context.application.taskContracts
                    ? { taskContracts: context.application.taskContracts }
                    : {}),
                  ...(host.client.guidedPreparation
                    ? { guidedPreparation: { execute: host.client.guidedPreparation.execute } }
                    : {}),
                },
              }
            : settingsController
              ? { api: { settings: settingsController } }
              : {}),
        });
        const stop = async (): Promise<void> => {
          await server.close();
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
          await server.start();
          await waitForSignal;
        } finally {
          await stop();
        }
      },
    );
}
