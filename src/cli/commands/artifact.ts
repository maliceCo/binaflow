import type { Command } from 'commander';
import { cliUsageError, machineMode } from '../protocol.js';

export function registerArtifactCommands(cli: Command): void {
  cli
    .command('artifacts')
    .description('List artifacts for a persisted workflow run')
    .argument('<run-id>', 'run ID')
    .action(async (runId: string, _options: unknown, command: Command) => {
      const { openStorageContext, printMachineResult, rootOptions } = await import('./common.js');
      const options = rootOptions(command);
      const context = await openStorageContext(options);
      try {
        const inspection = await context.inspectRun(runId);
        const artifacts = inspection.artifacts;
        if (options.json || options.jsonl) {
          if (options.jsonl)
            throw cliUsageError(
              'UNSUPPORTED_OUTPUT_MODE',
              'The artifacts command supports --json, not --jsonl',
            );
          printMachineResult('artifacts', { runId, artifacts });
          return;
        }
        if (artifacts.length === 0) {
          console.log(`No artifacts found for run ${runId}`);
          return;
        }
        for (const artifact of artifacts) {
          console.log(
            `${artifact.id}  ${artifact.stepId}.${artifact.name}  ${artifact.mediaType}  ${artifact.sizeBytes} bytes`,
          );
        }
      } finally {
        context.close();
      }
    });

  cli
    .command('artifact')
    .description('Read one persisted artifact by ID or step.name')
    .argument('<run-id>', 'run ID')
    .argument('<artifact>', 'artifact ID or step.name')
    .option('--raw', 'write only the artifact content to stdout')
    .action(
      async (runId: string, artifactKey: string, options: { raw?: boolean }, command: Command) => {
        const { openStorageContext, printMachineResult, rootOptions } = await import('./common.js');
        const root = rootOptions(command);
        if (options.raw && machineMode(root)) {
          throw cliUsageError(
            'CONFLICTING_OUTPUT_MODES',
            '--raw cannot be combined with --json or --jsonl',
          );
        }
        const context = await openStorageContext(root);
        try {
          const view = await context.readArtifact(runId, artifactKey, { mode: 'full' });
          if (view.error && !view.content) throw new Error(view.error);
          const artifact = view.artifact;
          const content = view.content ?? '';
          if (options.raw) {
            process.stdout.write(content);
            return;
          }
          if (root.json || root.jsonl) {
            if (root.jsonl)
              throw cliUsageError(
                'UNSUPPORTED_OUTPUT_MODE',
                'The artifact command supports --json, not --jsonl',
              );
            printMachineResult('artifact', { artifact, content });
            return;
          }
          console.log(`Artifact ${artifact.stepId}.${artifact.name} (${artifact.mediaType})`);
          console.log(
            `  id=${artifact.id}  size=${artifact.sizeBytes} bytes  path=${artifact.path}`,
          );
          console.log(content);
        } finally {
          context.close();
        }
      },
    );
}
