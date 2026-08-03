import type { Command } from 'commander';

export function registerRunsCommand(cli: Command): void {
  cli
    .command('runs')
    .description('List persisted workflow runs')
    .action(async (_options, command: Command) => {
      const { openStorageContext, printMachineResult, rootOptions } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const context = await openStorageContext(optionsAtRoot);
      try {
        const runs = await context.store.listRuns();
        if (optionsAtRoot.json || optionsAtRoot.jsonl) {
          if (optionsAtRoot.jsonl) {
            throw new Error('The runs command supports --json, not --jsonl');
          }
          printMachineResult('runs', { runs });
          return;
        }
        if (runs.length === 0) {
          console.log(
            'No workflow runs found. Start one with: binaflow run plan-build --objective "..."',
          );
          return;
        }
        console.log('RUN ID  STATUS  WORKFLOW  CREATED  OBJECTIVE');
        for (const run of runs) {
          console.log(
            `${run.id}  ${run.status}  ${run.workflowId}  ${run.createdAt}  ${singleLine(run.objective, 120)}`,
          );
        }
      } finally {
        context.close();
      }
    });
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
