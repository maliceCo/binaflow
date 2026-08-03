import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { resolveWorkflow } from '../../workflows/catalog.js';
import {
  installSignalHandlers,
  openContext,
  printRunSummary,
  rootOptions,
  validateWorkflowProfiles,
} from './common.js';

export function registerRunCommand(cli: Command): void {
  cli
    .command('run')
    .description('Start a workflow run')
    .argument('<workflow>', 'workflow name')
    .requiredOption('--objective <text>', 'objective for the workflow')
    .action(async (workflowId: string, options: { objective: string }, command: Command) => {
      const workflow = resolveWorkflow(workflowId);
      const context = await openContext(rootOptions(command));
      const runId = randomUUID();
      const controller = new AbortController();
      const removeSignalHandlers = installSignalHandlers(controller, runId);
      try {
        validateWorkflowProfiles(workflow, context.config.profiles);
        console.log(`Started run ${runId}  workflow=${workflow.id}`);
        const run = await context.engine.execute(workflow, {
          objective: options.objective,
          profiles: context.config.profiles,
          runId,
          signal: controller.signal,
        });
        printRunSummary(run, await context.store.getStepRuns(run.id), context.config);
        if (run.status === 'failed' || run.status === 'cancelled') {
          process.exitCode = 1;
        }
      } finally {
        removeSignalHandlers();
        context.close();
      }
    });
}
