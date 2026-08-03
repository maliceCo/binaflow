import type { Command } from 'commander';
import { exitCodeFor, machineMode, writeJsonl, writeJsonlFailure } from '../protocol.js';

export function registerResumeCommand(cli: Command): void {
  cli
    .command('resume')
    .description('Resume a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const { resolveWorkflow } = await import('../../workflows/catalog.js');
      const {
        installSignalHandlers,
        openContext,
        printRunSummary,
        printMachineRunResult,
        rootOptions,
        validateWorkflowProfiles,
      } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      const context = await openContext(optionsAtRoot);
      try {
        const previous = await context.store.getRun(runId);
        if (!previous) throw new Error(`Unknown run: ${runId}`);
        let started = false;
        if (mode === 'jsonl' && previous.status === 'completed') {
          started = true;
          writeJsonl({
            protocol: 'binaflow-cli',
            version: 1,
            type: 'run.started',
            command: 'resume',
            runId,
            workflowId: previous.workflowId,
          });
        }
        if (previous.status === 'completed') {
          if (mode) await printMachineRunResult('resume', previous, context, mode);
          else printRunSummary(previous, await context.store.getStepRuns(runId), context.config);
          return;
        }
        const workflow = resolveWorkflow(previous.workflowId);
        validateWorkflowProfiles(workflow, context.config.profiles);
        const controller = new AbortController();
        const removeSignalHandlers = installSignalHandlers(controller, runId);
        if (!mode) {
          console.log(`Resuming run ${runId}  workflow=${previous.workflowId}`);
        }
        try {
          const run = await context.engine.execute(workflow, {
            runId,
            profiles: context.config.profiles,
            resume: true,
            signal: controller.signal,
            ...(mode === 'jsonl'
              ? {
                  onRunStarted: (startedRun: typeof previous) => {
                    started = true;
                    writeJsonl({
                      protocol: 'binaflow-cli',
                      version: 1,
                      type: 'run.started',
                      command: 'resume',
                      runId: startedRun.id,
                      workflowId: startedRun.workflowId,
                    });
                  },
                }
              : {}),
          });
          if (mode) await printMachineRunResult('resume', run, context, mode);
          else printRunSummary(run, await context.store.getStepRuns(run.id), context.config);
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
