import type { Command } from 'commander';
import { openContext, rootOptions } from './common.js';

export function registerRunsCommand(cli: Command): void {
  cli
    .command('runs')
    .description('List persisted workflow runs')
    .action(async (_options, command: Command) => {
      const context = await openContext(rootOptions(command));
      try {
        for (const run of await context.store.listRuns()) {
          console.log(`${run.id}  ${run.status}  ${run.workflowId}  ${run.objective}`);
        }
      } finally {
        context.close();
      }
    });
}
