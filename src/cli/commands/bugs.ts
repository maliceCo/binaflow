import type { Command } from 'commander';
import {
  cliUsageError,
  machineMode,
  rejectUnsupportedJsonl,
  writeJsonResult,
} from '../protocol.js';
import {
  openApplicationStorage,
  type ApplicationStorageContext,
} from '../../application/runtime.js';
import type { QaHistoryStats } from '../../application/qa-history-operations.js';
import { rootOptions } from './common.js';

export function registerBugCommands(cli: Command): void {
  const bugs = cli
    .command('bugs')
    .description('Inspect and maintain local QA history')
    .option('--search <text>', 'search QA history candidates')
    .option('--fingerprint <fingerprint>', 'match an exact finding fingerprint')
    .option('--stats', 'show QA history statistics')
    .action(
      async (
        options: { search?: string; fingerprint?: string; stats?: boolean },
        command: Command,
      ) => {
        const mode = machineMode(rootOptions(command));
        rejectUnsupportedJsonl(mode, 'bugs');
        const context = await openStorage(command);
        try {
          if (options.stats) {
            const stats = await context.application.qaHistoryStats!();
            if (mode) writeJsonResult('bugs', { stats });
            else printStats(stats);
            return;
          }
          const defects = options.search
            ? (
                await context.application.searchQaHistory!(
                  options.fingerprint ?? '',
                  options.search,
                )
              ).map((result) => result.defect)
            : options.fingerprint
              ? (await context.application.searchQaHistory!(options.fingerprint, '')).map(
                  (result) => result.defect,
                )
              : await context.application.listQaDefects!();
          if (mode) writeJsonResult('bugs', { bugs: defects });
          else
            for (const defect of defects)
              console.log(`${defect.id}  [${defect.severity}] ${defect.status}  ${defect.title}`);
        } finally {
          context.close();
        }
      },
    );

  bugs
    .command('reindex')
    .description('Rebuild the local QA FTS index')
    .action(async (_options: unknown, command: Command) => {
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'bugs reindex');
      const context = await openStorage(command);
      try {
        await context.application.reindexQaHistory!();
        if (mode) writeJsonResult('bugs reindex', { reindexed: true });
        else console.log('QA history search index rebuilt.');
      } finally {
        context.close();
      }
    });

  bugs
    .command('archive')
    .option('--before <timestamp>', 'archive defects created before an ISO timestamp')
    .action(async (options: { before?: string }, command: Command) => {
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'bugs archive');
      const context = await openStorage(command);
      try {
        const archived = await context.application.archiveQaHistory!(options.before);
        if (mode) writeJsonResult('bugs archive', { archived });
        else console.log(`Archived ${archived} QA defect(s).`);
      } finally {
        context.close();
      }
    });

  bugs
    .command('purge')
    .option('--yes', 'confirm permanent deletion of QA history')
    .action(async (options: { yes?: boolean }, command: Command) => {
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'bugs purge');
      if (!options.yes && mode) {
        throw cliUsageError(
          'CONFIRMATION_REQUIRED',
          'Use --yes to confirm purge when --json is enabled',
        );
      }
      if (!options.yes && !(await confirmPurge())) {
        if (mode) writeJsonResult('bugs purge', { purged: false });
        else console.log('QA history purge cancelled.');
        return;
      }
      const context = await openStorage(command);
      try {
        await context.application.purgeQaHistory!();
        if (mode) writeJsonResult('bugs purge', { purged: true });
        else console.log('QA history purged. Runs and run artifacts were not deleted.');
      } finally {
        context.close();
      }
    });

  cli
    .command('bug')
    .description('Show one QA defect and its occurrences')
    .argument('<id>', 'defect ID')
    .action(async (id: string, _options: unknown, command: Command) => {
      const mode = machineMode(rootOptions(command));
      rejectUnsupportedJsonl(mode, 'bug');
      const context = await openStorage(command);
      try {
        const defect = await context.application.getQaDefect!(id);
        if (mode) writeJsonResult('bug', defect);
        else {
          console.log(`${defect.defect.id}  [${defect.defect.severity}] ${defect.defect.status}`);
          console.log(defect.defect.title);
          console.log(`Occurrences: ${defect.occurrences.length}`);
          for (const occurrence of defect.occurrences) {
            console.log(
              `  ${occurrence.runId}  iteration=${occurrence.qaIteration}  finding=${occurrence.findingId}`,
            );
          }
        }
      } finally {
        context.close();
      }
    });
}

async function openStorage(command: Command): Promise<ApplicationStorageContext> {
  const options = rootOptions(command);
  return openApplicationStorage(options.config, options.cwd);
}

async function confirmPurge(): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question('Permanently purge QA history? (y/N): '))
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    readline.close();
  }
}

function printStats(stats: QaHistoryStats): void {
  console.log(`QA defects: ${stats.total}`);
  console.log(`Occurrences: ${stats.totalOccurrences}`);
  console.log(`Recurring: ${stats.recurring}`);
  console.log(`Regressions: ${stats.regressions}`);
  console.log(`Severity: ${formatCounts(stats.bySeverity)}`);
  console.log(`Status: ${formatCounts(stats.byStatus)}`);
}

function formatCounts(values: Record<string, number>): string {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ') || 'none'
  );
}
