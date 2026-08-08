import type { Command } from 'commander';
import type { ReleaseChannel } from '../../update/release-client.js';
import {
  cliUsageError,
  machineMode,
  rejectUnsupportedJsonl,
  writeJsonResult,
} from '../protocol.js';

interface UpdateOptions {
  check?: boolean;
  rollback?: boolean;
  channel: ReleaseChannel;
}

export function registerUpdateCommand(cli: Command): void {
  cli
    .command('update')
    .description('check for or install a Binaflow release')
    .option('--check', 'only check for an available update')
    .option('--rollback', 'switch to the previously installed version')
    .option('--channel <channel>', 'release channel: preview or stable', 'preview')
    .action(async (options: UpdateOptions, command: Command) => {
      const { rootOptions } = await import('./common.js');
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'update');
      if (options.check && options.rollback) {
        throw cliUsageError('CONFLICTING_UPDATE_OPTIONS', 'Choose either --check or --rollback');
      }
      if (options.channel !== 'preview' && options.channel !== 'stable') {
        throw cliUsageError(
          'INVALID_UPDATE_CHANNEL',
          `Unsupported release channel: ${options.channel}`,
        );
      }
      const { checkForUpdate, installUpdate, rollbackUpdate } =
        await import('../../update/installer.js');
      const { managedInstallRoot } = await import('../../update/paths.js');
      managedInstallRoot();
      if (options.rollback) {
        const version = await rollbackUpdate();
        if (mode) {
          writeJsonResult('update', { action: 'rollback', version });
        } else {
          console.log(`Rolled back to Binaflow ${version}`);
        }
        return;
      }
      const result = await checkForUpdate(options.channel);
      if (options.check) {
        if (mode) {
          writeJsonResult('update', {
            action: 'check',
            current: result.current,
            available: result.available,
            ...(result.available ? { release: result.release } : {}),
          });
        } else {
          console.log(
            result.available
              ? `Update available: ${result.release.version}`
              : `Binaflow ${result.current} is up to date`,
          );
        }
        return;
      }
      const release = await installUpdate(options.channel);
      if (mode) {
        writeJsonResult('update', { action: 'install', version: release.version });
      } else {
        console.log(`Updated Binaflow to ${release.version}`);
      }
    });
}
