import type { Command } from 'commander';
import { cliUsageError, machineMode, rejectUnsupportedJsonl } from '../protocol.js';
import type { RunStatus } from '../../core/run.js';
import { formatTimestamp, humanRunStatus } from '../../presentation/format.js';

interface RunsOptions {
  limit?: string;
  status?: string;
  workflow?: string;
  cursor?: string;
}

export function registerRunsCommand(cli: Command): void {
  cli
    .command('runs')
    .description('List persisted workflow runs')
    .option('--limit <number>', 'maximum number of runs to return (1-100)')
    .option('--status <status>', 'filter by run status')
    .option('--workflow <id>', 'filter by workflow ID')
    .option('--cursor <cursor>', 'continue after a previous page')
    .action(async (options: RunsOptions, command: Command) => {
      const { openStorageContext, printMachineResult, rootOptions, workflowDisplayLabel } =
        await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      rejectUnsupportedJsonl(mode, 'runs');
      const context = await openStorageContext(optionsAtRoot);
      try {
        const status = parseStatus(options.status);
        const page = await context.listRuns({
          ...(options.limit !== undefined ? { limit: parseLimit(options.limit) } : {}),
          ...(status ? { status } : {}),
          ...(options.workflow !== undefined ? { workflowId: options.workflow } : {}),
          ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
        });
        if (mode === 'json') {
          printMachineResult('runs', page);
          return;
        }
        if (page.runs.length === 0) {
          console.log(
            'No workflow runs found. Start one with: binaflow run plan-build --objective "..."',
          );
          return;
        }
        console.log('RUN ID       STATUS                 WORKFLOW  UPDATED  OBJECTIVE');
        for (const run of page.runs) {
          console.log(
            `${shortId(run.id).padEnd(10)}  ${humanRunStatus(run.status).padEnd(20)}  ${workflowDisplayLabel(run.workflowId)}  ${formatTimestamp(run.updatedAt)}  ${singleLine(run.objective, 120)}`,
          );
        }
        if (page.nextCursor) console.log(`NEXT CURSOR  ${page.nextCursor}`);
      } finally {
        context.close();
      }
    });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw cliUsageError('INVALID_LIMIT', 'The runs limit must be an integer between 1 and 100');
  }
  return limit;
}

function parseStatus(value: string | undefined): RunStatus | undefined {
  if (value === undefined) return undefined;
  const statuses: RunStatus[] = [
    'pending',
    'running',
    'waiting',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ];
  if (!statuses.includes(value as RunStatus)) {
    throw cliUsageError('INVALID_STATUS', `Unknown run status: ${value}`);
  }
  return value as RunStatus;
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
