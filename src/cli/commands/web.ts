import type { Command } from 'commander';
import { createExecutionHost } from '../../application/execution-host.js';
import { openApplicationContext } from '../../application/runtime.js';
import { loadWebConfig } from '../../web/config.js';
import { createWebServer } from '../../web/server.js';
import { rootOptions } from './common.js';

export function registerWebCommand(cli: Command): void {
  cli
    .command('web')
    .description('Start the personal authenticated browser interface')
    .option('--web-config <path>', 'path to the web configuration', '.binaflow/web.json')
    .action(async (commandOptions: { webConfig: string }, command: Command) => {
      const options = rootOptions(command);
      if (options.json || options.jsonl)
        throw new Error('The web command cannot use machine output');
      const webConfig = await loadWebConfig(commandOptions.webConfig);
      const context = await openApplicationContext({
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
      });
      if (!context.guidedExecution || !context.findRun) {
        throw new Error('Application runtime does not provide an execution host');
      }
      const host = createExecutionHost({
        application: context.application,
        guidedExecution: context.guidedExecution,
        ...(context.application.guidedPreparation
          ? { guidedPreparation: { service: context.application.guidedPreparation } }
          : {}),
        findRun: context.findRun,
        close: context.close,
      });
      const server = createWebServer({
        config: webConfig,
        api: {
          ...(context.application.taskContracts
            ? { taskContracts: context.application.taskContracts }
            : {}),
          ...(host.client.guidedPreparation
            ? { guidedPreparation: { execute: host.client.guidedPreparation.execute } }
            : {}),
        },
      });
      const stop = async (): Promise<void> => {
        await server.close();
        await host.close();
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
    });
}
