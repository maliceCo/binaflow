import type { Command } from 'commander';
import { machineMode, writeJsonl } from '../protocol.js';

export function registerApprovalCommands(cli: Command): void {
  cli
    .command('approve')
    .description('Approve a waiting workflow gate')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      await decide(command, runId, 'approved');
    });

  cli
    .command('reject')
    .description('Reject a waiting workflow gate and provide research feedback')
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
  const { resolveWorkflow } = await import('../../workflows/catalog.js');
  const {
    installSignalHandlers,
    openContext,
    printMachineRunResult,
    printRunSummary,
    rootOptions,
    validateWorkflowProfiles,
  } = await import('./common.js');
  const optionsAtRoot = rootOptions(command);
  const mode = machineMode(optionsAtRoot);
  const context = await openContext(optionsAtRoot);
  try {
    const previous = await context.store.getRun(runId);
    if (!previous) throw new Error(`Unknown run: ${runId}`);
    const workflow = resolveWorkflow(previous.workflowId);
    validateWorkflowProfiles(workflow, context.config.profiles);
    if (!workflow.approval) throw new Error(`Workflow ${workflow.id} has no approval gate`);
    const steps = await context.store.getStepRuns(runId);
    const approval = steps.find((step) => step.stepId === workflow.approval?.id);
    if (!approval || approval.status !== 'waiting') {
      throw new Error(`Run ${runId} is not waiting for approval`);
    }

    await context.store.saveStepRun({
      ...approval,
      status: 'pending',
      approval: {
        decision,
        ...(feedback ? { feedback } : {}),
        decidedAt: new Date().toISOString(),
      },
    });
    const controller = new AbortController();
    const removeSignalHandlers = installSignalHandlers(controller, runId);
    try {
      if (mode === 'jsonl') {
        writeJsonl({
          protocol: 'binaflow-cli',
          version: 1,
          type: 'run.started',
          command: decision === 'approved' ? 'approve' : 'reject',
          runId,
          workflowId: previous.workflowId,
        });
      }
      const run = await context.engine.execute(workflow, {
        runId,
        input: { objective: previous.objective },
        profiles: context.config.profiles,
        resume: true,
        signal: controller.signal,
      });
      if (mode) {
        await printMachineRunResult(
          decision === 'approved' ? 'approve' : 'reject',
          run,
          context,
          mode,
        );
      } else {
        printRunSummary(run, await context.store.getStepRuns(run.id), context.config);
      }
      if (run.status === 'failed' || run.status === 'cancelled') {
        process.exitCode = run.status === 'cancelled' ? 130 : 1;
      }
    } finally {
      removeSignalHandlers();
    }
  } finally {
    context.close();
  }
}
