import type { Command } from 'commander';
import { planBuildWorkflow } from '../../workflows/plan-build.js';
import { openContext, printRunSummary, requirePlanBuild, rootOptions } from './common.js';

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
        requirePlanBuild(previous.workflowId);
        const run = await context.engine.execute(planBuildWorkflow, {
          runId,
          input: { objective: previous.objective },
          profiles: context.config.profiles,
          resume: true,
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
