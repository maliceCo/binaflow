import type { Command } from 'commander';
import { machineMode, runStartedRecord, writeJsonl } from '../protocol.js';

export function registerResumeCommand(cli: Command): void {
  cli
    .command('resume')
    .description('Resume a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const {
        printRunSummary,
        printMachineRunResult,
        printHumanProgress,
        rootOptions,
        runAttachedCli,
      } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      await runAttachedCli(optionsAtRoot, runId, 'resume', async (context, lifecycle) => {
        const result = await context.application.resumeWorkflow({
          runId,
          signal: lifecycle.signal,
          onRunStarted: (startedRun) => {
            lifecycle.markStarted();
            if (!mode) {
              lifecycle.streamFailure.write(() =>
                printHumanProgress(
                  `Resuming run ${startedRun.id}  workflow=${startedRun.workflowId}`,
                ),
              );
            }
            if (mode === 'jsonl') {
              lifecycle.streamFailure.write(() =>
                writeJsonl(runStartedRecord('resume', startedRun.id, startedRun.workflowId)),
              );
            }
          },
        });
        const run = result.run;
        if (mode === 'jsonl' && result.alreadyCompleted) {
          lifecycle.markStarted();
          lifecycle.streamFailure.write(() =>
            writeJsonl(runStartedRecord('resume', run.id, run.workflowId)),
          );
        }
        if (lifecycle.streamFailure.failed) {
          process.exitCode = 1;
          return;
        }
        if (mode) {
          await printMachineRunResult('resume', run, context, mode, lifecycle.streamFailure.write);
        } else {
          const inspection = await context.application.inspectRun(run.id, {
            includeStepResults: true,
          });
          const view = await context.application.getRunView(run.id);
          lifecycle.streamFailure.write(() => printRunSummary(view, inspection.steps));
        }
        if (run.status === 'failed' || run.status === 'cancelled') {
          process.exitCode = run.status === 'cancelled' ? 130 : 1;
        }
      });
    });
}
