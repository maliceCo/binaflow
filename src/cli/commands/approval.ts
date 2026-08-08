import type { Command } from 'commander';
import {
  exitCodeFor,
  machineMode,
  runStartedRecord,
  writeJsonl,
  writeJsonlFailure,
} from '../protocol.js';

export function registerApprovalCommands(cli: Command): void {
  cli
    .command('approve')
    .description('Approve the experimental research-plan-build approval gate')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      await decide(command, runId, 'approved');
    });

  cli
    .command('reject')
    .description('Reject the experimental research-plan-build gate with research feedback')
    .argument('<run-id>', 'run ID')
    .requiredOption('--feedback <text>', 'feedback for the next research iteration')
    .action(async (runId: string, options: { feedback: string }, command: Command) => {
      await decide(command, runId, 'rejected', options.feedback);
    });
}

async function decide(
  command: Command,
  runId: string,
  decision: 'approved' | 'rejected',
  feedback?: string,
): Promise<void> {
  const {
    installSignalHandlers,
    openContext,
    printMachineRunResult,
    printRunSummary,
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
      const run = await context.decideApproval({
        runId,
        decision,
        ...(feedback ? { feedback } : {}),
        signal: controller.signal,
        ...(mode === 'jsonl'
          ? {
              onRunStarted: (startedRun) => {
                started = true;
                writeJsonl(
                  runStartedRecord(
                    decision === 'approved' ? 'approve' : 'reject',
                    startedRun.id,
                    startedRun.workflowId,
                  ),
                );
              },
            }
          : {}),
      });
      if (mode) {
        await printMachineRunResult(
          decision === 'approved' ? 'approve' : 'reject',
          run,
          context,
          mode,
        );
      } else {
        const inspection = await context.inspectRun(run.id, { includeStepResults: true });
        printRunSummary(run, inspection.steps);
      }
      if (run.status === 'failed' || run.status === 'cancelled') {
        process.exitCode = run.status === 'cancelled' ? 130 : 1;
      }
    } catch (error) {
      if (mode === 'jsonl' && started) {
        writeJsonlFailure(decision === 'approved' ? 'approve' : 'reject', runId, error);
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
}
