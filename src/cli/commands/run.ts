import type { Command } from 'commander';
import { resolveWorkflow } from '../../workflows/catalog.js';
import { openContext, printRunSummary, rootOptions } from './common.js';

export function registerRunCommand(cli: Command): void {
  cli
    .command('run')
    .description('Start a workflow run')
    .argument('<workflow>', 'workflow name')
    .requiredOption('--objective <text>', 'objective for the workflow')
    .action(async (workflowId: string, options: { objective: string }, command: Command) => {
      const workflow = resolveWorkflow(workflowId);
      const context = await openContext(rootOptions(command));
      try {
        const run = await context.engine.execute(workflow, {
          objective: options.objective,
          profiles: context.config.profiles,
        });
        printRunSummary(run, await context.store.getStepRuns(run.id), context.config);
        if (run.status === 'failed' || run.status === 'cancelled') {
          throw new Error(`Run ${run.id} ended with status ${run.status}`);
        }
      } finally {
        context.close();
      }
    });
}
