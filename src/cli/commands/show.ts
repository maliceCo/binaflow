import type { Command } from 'commander';
import { machineMode, rejectUnsupportedJsonl } from '../protocol.js';

export function registerShowCommand(cli: Command): void {
  cli
    .command('show')
    .description('Show a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .option('--events', 'show the complete normalized event history')
    .option('--full-output', 'include complete agent step results')
    .action(
      async (
        runId: string,
        options: { events?: boolean; fullOutput?: boolean },
        command: Command,
      ) => {
        const { openStorageContext, printMachineResult, printRunSummary, rootOptions } =
          await import('./common.js');
        const optionsAtRoot = rootOptions(command);
        const mode = machineMode(optionsAtRoot);
        rejectUnsupportedJsonl(mode, 'show');
        const context = await openStorageContext(optionsAtRoot);
        try {
          if (mode === 'json') {
            const inspection = await context.application.inspectRun(runId, {
              includeEvents: options.events === true,
              includeStepResults: options.fullOutput === true,
            });
            const { run, steps, artifacts, eventCount, events } = inspection;
            printMachineResult('show', {
              run,
              steps,
              artifacts,
              eventCount,
              ...(options.events ? { events: events ?? [] } : {}),
            });
            return;
          }
          const view = await context.application.getRunView(runId);
          const inspection = await context.application.inspectRun(runId, {
            includeEvents: options.events === true,
            includeStepResults: options.fullOutput === true,
          });
          printRunSummary(view, inspection.steps);
          if (options.events && inspection.events && inspection.events.length > 0) {
            console.log(`\nEvents (${inspection.events.length})`);
            for (const event of inspection.events) {
              console.log(
                `  ${event.occurredAt}  [${event.stepId}] ${event.type}: ${event.message}`,
              );
            }
          } else if (view.eventCount > 0) {
            console.log(
              `\nActivity: ${view.eventCount} events (use show ${runId} --events for full history)`,
            );
          }
          for (const artifact of view.artifacts) {
            console.log(`\nArtifact ${artifact.stepId}.${artifact.name} (${artifact.mediaType})`);
            console.log(`  size=${artifact.sizeBytes} bytes`);
            console.log(`  use=binaflow artifact ${runId} ${artifact.stepId}.${artifact.name}`);
          }
        } finally {
          context.close();
        }
      },
    );
}
