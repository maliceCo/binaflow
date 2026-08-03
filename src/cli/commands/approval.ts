import type { Command } from 'commander';
import { resolveWorkflow } from '../../workflows/catalog.js';
import {
  installSignalHandlers,
  openContext,
  printRunSummary,
  rootOptions,
  validateWorkflowProfiles,
} from './common.js';

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
  const context = await openContext(rootOptions(command));
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
}
