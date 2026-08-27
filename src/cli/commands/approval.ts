import type { Command } from 'commander';
import { machineMode, runStartedRecord, writeJsonl } from '../protocol.js';

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
  const { printMachineRunResult, printRunSummary, rootOptions, runAttachedCli } =
    await import('./common.js');
  const optionsAtRoot = rootOptions(command);
  const mode = machineMode(optionsAtRoot);
  const commandName = decision === 'approved' ? 'approve' : 'reject';
  await runAttachedCli(optionsAtRoot, runId, commandName, async (context, lifecycle) => {
    const run = await context.application.decideApproval({
      runId,
      decision,
      ...(feedback ? { feedback } : {}),
      signal: lifecycle.signal,
      ...(mode === 'jsonl'
        ? {
            onRunStarted: (startedRun) => {
              lifecycle.markStarted();
              lifecycle.streamFailure.write(() =>
                writeJsonl(runStartedRecord(commandName, startedRun.id, startedRun.workflowId)),
              );
            },
          }
        : {}),
    });
    if (lifecycle.streamFailure.failed) {
      process.exitCode = 1;
      return;
    }
    if (mode) {
      await printMachineRunResult(commandName, run, context, mode, lifecycle.streamFailure.write);
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
}
