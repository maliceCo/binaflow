import type { Command } from 'commander';

export function registerShowCommand(cli: Command): void {
  cli
    .command('show')
    .description('Show a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .option('--events', 'show the complete normalized event history')
    .action(async (runId: string, options: { events?: boolean }, command: Command) => {
      const { openStorageContext, printMachineResult, printRunSummary, rootOptions } =
        await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const context = await openStorageContext(optionsAtRoot);
      try {
        const run = await context.store.getRun(runId);
        if (!run) throw new Error(`Unknown run: ${runId}`);
        const steps = await context.store.getStepRuns(runId);
        const events = await context.store.getEvents(runId);
        const artifacts = await context.store.getArtifacts(runId);
        if (optionsAtRoot.json || optionsAtRoot.jsonl) {
          if (optionsAtRoot.jsonl) throw new Error('The show command supports --json, not --jsonl');
          printMachineResult('show', {
            run,
            steps,
            artifacts,
            ...(options.events ? { events } : {}),
          });
          return;
        }
        const config = await import('../../config.js').then(({ loadConfig }) =>
          loadConfig(optionsAtRoot.config ?? '.binaflow/config.json', optionsAtRoot.cwd),
        );
        printRunSummary(run, steps, config);
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
        for (const artifact of artifacts) {
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
