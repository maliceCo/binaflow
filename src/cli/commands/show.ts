import type { Command } from 'commander';
import { openContext, printRunSummary, rootOptions } from './common.js';

export function registerShowCommand(cli: Command): void {
  cli
    .command('show')
    .description('Show a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .option('--events', 'show the complete normalized event history')
    .action(async (runId: string, options: { events?: boolean }, command: Command) => {
      const context = await openContext(rootOptions(command));
      try {
        const run = await context.store.getRun(runId);
        if (!run) throw new Error(`Unknown run: ${runId}`);
        printRunSummary(run, await context.store.getStepRuns(runId), context.config);
        const events = await context.store.getEvents(runId);
        if (options.events && events.length > 0) {
          console.log(`\nEvents (${events.length})`);
          for (const event of events) {
            console.log(`  ${event.occurredAt}  [${event.stepId}] ${event.type}: ${event.message}`);
          }
        } else if (events.length > 0) {
          console.log(
            `\nActivity: ${events.length} events (use show ${runId} --events for full history)`,
          );
        }
        for (const artifact of await context.store.getArtifacts(runId)) {
          const content = await context.artifacts.read(artifact);
          console.log(`\nArtifact ${artifact.stepId}.${artifact.name} (${artifact.mediaType})`);
          console.log(`  size=${artifact.sizeBytes} bytes  path=${artifact.path}`);
          console.log(indent(safeArtifactContent(content, artifact.kind, artifact.path)));
        }
      } finally {
        context.close();
      }
    });
}

function safeArtifactContent(content: string, kind: 'json' | 'text', path: string): string {
  const displayed = kind === 'json' ? prettyJson(content) : content;
  return displayed.length > 20_000
    ? `${displayed.slice(0, 20_000)}\n[artifact truncated; read the full file at ${path}]`
    : displayed;
}

function indent(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n');
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
