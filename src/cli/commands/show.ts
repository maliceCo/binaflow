import type { Command } from 'commander';
import { cliUsageError } from '../protocol.js';

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
        const { inspectRun } = await import('../../application/operations.js');
        const optionsAtRoot = rootOptions(command);
        const context = await openStorageContext(optionsAtRoot);
        try {
          const inspection = await inspectRun(context, runId, {
            includeEvents: options.events === true,
            includeStepResults: options.fullOutput === true,
          });
          const { run, steps, artifacts, eventCount, events } = inspection;
          if (optionsAtRoot.json || optionsAtRoot.jsonl) {
            if (optionsAtRoot.jsonl)
              throw cliUsageError(
                'UNSUPPORTED_OUTPUT_MODE',
                'The show command supports --json, not --jsonl',
              );
            printMachineResult('show', {
              run,
              steps,
              artifacts,
              eventCount,
              ...(options.events ? { events: events ?? [] } : {}),
            });
            return;
          }
          printRunSummary(run, steps);
          if (options.events && events && events.length > 0) {
            console.log(`\nEvents (${events.length})`);
            for (const event of events) {
              console.log(
                `  ${event.occurredAt}  [${event.stepId}] ${event.type}: ${event.message}`,
              );
            }
          } else if (eventCount > 0) {
            console.log(
              `\nActivity: ${eventCount} events (use show ${runId} --events for full history)`,
            );
          }
          for (const artifact of artifacts) {
            console.log(`\nArtifact ${artifact.stepId}.${artifact.name} (${artifact.mediaType})`);
            console.log(`  size=${artifact.sizeBytes} bytes  path=${artifact.path}`);
            console.log(`  use=binaflow artifact ${runId} ${artifact.stepId}.${artifact.name}`);
          }
        } finally {
          context.close();
        }
      },
    );
}
