import type { Command } from 'commander';
import { resolveWorkflow } from '../../workflows/catalog.js';
import {
  installSignalHandlers,
  openContext,
  printRunSummary,
  rootOptions,
  validateWorkflowProfiles,
} from './common.js';

export function registerResumeCommand(cli: Command): void {
  cli
    .command('resume')
    .description('Resume a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const context = await openContext(rootOptions(command));
      try {
        const previous = await context.store.getRun(runId);
        if (!previous) throw new Error(`Unknown run: ${runId}`);
        const workflow = resolveWorkflow(previous.workflowId);
        validateWorkflowProfiles(workflow, context.config.profiles);
        const controller = new AbortController();
        const removeSignalHandlers = installSignalHandlers(controller, runId);
        console.log(`Resuming run ${runId}  workflow=${previous.workflowId}`);
        try {
          const run = await context.engine.execute(workflow, {
            runId,
            input: { objective: previous.objective },
            profiles: context.config.profiles,
            resume: true,
            signal: controller.signal,
          });
          printRunSummary(run, await context.store.getStepRuns(run.id), context.config);
          if (run.status === 'failed' || run.status === 'cancelled') {
            process.exitCode = 1;
          }
        } finally {
          removeSignalHandlers();
        }
      } finally {
        context.close();
      }
    });
}
