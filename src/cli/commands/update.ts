import type { Command } from 'commander';
import { checkForUpdate, installUpdate, rollbackUpdate } from '../../update/installer.js';
import { managedInstallRoot } from '../../update/paths.js';
import type { ReleaseChannel } from '../../update/release-client.js';

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
    .action(async (options: UpdateOptions) => {
      if (options.check && options.rollback) throw new Error('Choose either --check or --rollback');
      if (options.channel !== 'preview' && options.channel !== 'stable') {
        throw new Error(`Unsupported release channel: ${options.channel}`);
      }
      managedInstallRoot();
      if (options.rollback) {
        console.log(`Rolled back to Binaflow ${await rollbackUpdate()}`);
        return;
      }
      const result = await checkForUpdate(options.channel);
      if (options.check) {
        console.log(
          result.available
            ? `Update available: ${result.release.version}`
            : `Binaflow ${result.current} is up to date`,
        );
        return;
      }
      const release = await installUpdate(options.channel);
      console.log(`Updated Binaflow to ${release.version}`);
    });
}
