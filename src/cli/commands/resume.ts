import type { Command } from 'commander';
import {
  exitCodeFor,
  machineMode,
  runStartedRecord,
  writeJsonl,
  writeJsonlFailure,
} from '../protocol.js';

export function registerResumeCommand(cli: Command): void {
  cli
    .command('resume')
    .description('Resume a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const {
        installSignalHandlers,
        openContext,
        printRunSummary,
        printMachineRunResult,
        printHumanProgress,
        rootOptions,
      } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      const context = await openContext(optionsAtRoot);
      try {
        const controller = new AbortController();
        const removeSignalHandlers = installSignalHandlers(controller, runId);
        let started = false;
        try {
          const result = await context.application.resumeWorkflow({
            runId,
            signal: controller.signal,
            onRunStarted: (startedRun) => {
              started = true;
              if (!mode) {
                printHumanProgress(
                  `Resuming run ${startedRun.id}  workflow=${startedRun.workflowId}`,
                );
              }
              if (mode === 'jsonl') {
                writeJsonl(runStartedRecord('resume', startedRun.id, startedRun.workflowId));
              }
            },
          });
          const run = result.run;
          if (mode === 'jsonl' && result.alreadyCompleted) {
            started = true;
            writeJsonl(runStartedRecord('resume', run.id, run.workflowId));
          }
          if (mode) await printMachineRunResult('resume', run, context, mode);
          else {
            const inspection = await context.application.inspectRun(run.id, {
              includeStepResults: true,
            });
            const view = await context.application.getRunView(run.id);
            printRunSummary(view, inspection.steps);
          }
          if (run.status === 'failed' || run.status === 'cancelled') {
            process.exitCode = run.status === 'cancelled' ? 130 : 1;
          }
        } catch (error) {
          if (mode === 'jsonl' && started) {
            writeJsonlFailure('resume', runId, error);
            process.exitCode = exitCodeFor(error);
            return;
          }
          throw error;
        } finally {
          removeSignalHandlers();
        }
      } finally {
        context.close();
      }
    });
}
