#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerResumeCommand } from './commands/resume.js';
import { registerRunCommand } from './commands/run.js';
import { registerRunsCommand } from './commands/runs.js';
import { registerShowCommand } from './commands/show.js';
import { registerApprovalCommands } from './commands/approval.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerArtifactCommands } from './commands/artifact.js';
import { registerConfigurationCommands } from './commands/configuration.js';
import { VERSION } from '../version.js';
import { workflowSummaries } from '../workflows/catalog.js';
import {
  exitCodeFor,
  cliUsageError,
  machineMode,
  validateMachineMode,
  writeJsonError,
  writeJsonResult,
} from './protocol.js';

let parsedCommand: string | undefined;

export function createCli(): Command {
  const cli = new Command();

  cli
    .name('binaflow')
    .description('Local workflow orchestrator for coding agents')
    .version(VERSION)
    .option('--config <path>', 'path to the external Binaflow config')
    .option('--cwd <path>', 'workspace directory for the agent')
    .option('--verbose', 'show live agent progress and text output')
    .option('--json', 'emit one versioned JSON result')
    .option('--jsonl', 'emit a versioned JSONL execution stream')
    .exitOverride()
    .configureOutput({ writeOut: writeCommandOutput })
    .showSuggestionAfterError()
    .showHelpAfterError();

  cli.addHelpText(
    'after',
    `\nWorkflows:\n${workflowSummaries.map((item) => `  ${item.id.padEnd(22)} ${item.experimental ? '[experimental] ' : ''}${item.description}`).join('\n')}\n\nExamples:\n  $ binaflow run plan-build --objective "Fix the failing tests"\n  $ binaflow --cwd /path/to/project runs\n  $ binaflow run --interactive\n`,
  );
  cli.hook('preAction', (command) => {
    let root = command;
    while (root.parent) root = root.parent;
    validateMachineMode(root.opts());
  });

  registerRunCommand(cli);
  registerRunsCommand(cli);
  registerShowCommand(cli);
  registerResumeCommand(cli);
  registerApprovalCommands(cli);
  registerUpdateCommand(cli);
  registerArtifactCommands(cli);
  registerConfigurationCommands(cli);
  registerTuiCommand(cli);
  registerWorkflowCommand(cli);

  return cli;
}

function registerTuiCommand(cli: Command): void {
  cli
    .command('tui')
    .description('Open the attached terminal interface')
    .action(async (_options: unknown, command: Command) => {
      const { rootOptions } = await import('./commands/common.js');
      const options = rootOptions(command);
      if (options.json || options.jsonl) {
        throw cliUsageError(
          'INTERACTIVE_REQUIRES_HUMAN_MODE',
          'The tui command cannot be combined with --json or --jsonl',
        );
      }
      if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        throw cliUsageError('TUI_REQUIRES_TTY', 'The tui command requires an interactive terminal');
      }
      const { runInkShell: runTui } = await import('../tui-ink/shell.js');
      await runTui({
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.config ? { configPath: options.config } : {}),
      });
    });
}

function registerWorkflowCommand(cli: Command): void {
  cli
    .command('workflows')
    .description('List available workflows and their machine-readable contracts')
    .action(async (_options: unknown, command: Command) => {
      const { discoverWorkflows } = await import('../application/operations.js');
      const workflows = discoverWorkflows();
      let root = command;
      while (root.parent) root = root.parent;
      const mode = machineMode(root.opts());
      if (mode) {
        if (mode === 'jsonl')
          throw cliUsageError(
            'UNSUPPORTED_OUTPUT_MODE',
            'The workflows command supports --json, not --jsonl',
          );
        writeJsonResult('workflows', { workflows });
        return;
      }
      for (const workflow of workflows) {
        console.log(
          `${workflow.id}${workflow.experimental ? '  [Experimental]' : ''}  ${workflow.description}`,
        );
      }
    });
}

export async function runCli(argv = process.argv): Promise<void> {
  parsedCommand = undefined;
  if (argv.length === 2) {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      createCli().outputHelp();
      return;
    }
    const { runInkShell: runTui } = await import('../tui-ink/shell.js');
    await runTui();
    return;
  }
  const cli = createCli();
  cli.hook('preSubcommand', (_parent, command) => {
    parsedCommand = command.name();
  });
  cli.hook('preAction', (_root, command) => {
    parsedCommand = command.name();
  });
  await cli.parseAsync(argv);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  runCli().catch((error: unknown) => {
    const mode = process.argv.includes('--jsonl')
      ? 'jsonl'
      : process.argv.includes('--json')
        ? 'json'
        : undefined;
    const exitCode = exitCodeFor(error);
    if (mode && exitCode !== 0) writeJsonError(error, parsedCommand);
    else if (!isCommanderError(error)) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = exitCode;
  });
}

function writeCommandOutput(text: string): void {
  if (process.argv.includes('--json') || process.argv.includes('--jsonl')) {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
}

function isCommanderError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('commander.')
  );
}
