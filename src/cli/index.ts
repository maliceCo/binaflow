#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerResumeCommand } from './commands/resume.js';
import { registerRunCommand } from './commands/run.js';
import { registerRunsCommand } from './commands/runs.js';
import { registerShowCommand } from './commands/show.js';
import { registerApprovalCommands } from './commands/approval.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerArtifactCommands } from './commands/artifact.js';
import { VERSION } from '../version.js';
import { workflowSummaries } from '../workflows/catalog-info.js';
import { exitCodeFor, machineMode, writeJsonError, writeJsonResult } from './protocol.js';

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
    .showSuggestionAfterError()
    .showHelpAfterError();

  cli.addHelpText(
    'after',
    `\nWorkflows:\n${workflowSummaries.map((item) => `  ${item.id.padEnd(22)} ${item.description}`).join('\n')}\n\nExamples:\n  $ binaflow run plan-build --objective "Fix the failing tests"\n  $ binaflow --cwd /path/to/project runs\n  $ binaflow run --interactive\n`,
  );

  registerRunCommand(cli);
  registerRunsCommand(cli);
  registerShowCommand(cli);
  registerResumeCommand(cli);
  registerApprovalCommands(cli);
  registerUpdateCommand(cli);
  registerArtifactCommands(cli);
  registerWorkflowCommand(cli);

  return cli;
}

function registerWorkflowCommand(cli: Command): void {
  cli
    .command('workflows')
    .description('List available workflows and their machine-readable contracts')
    .action(async (_options: unknown, command: Command) => {
      const { listWorkflowContracts } = await import('../workflows/catalog.js');
      const workflows = listWorkflowContracts();
      let root = command;
      while (root.parent) root = root.parent;
      const mode = machineMode(root.opts());
      if (mode) {
        if (mode === 'jsonl') throw new Error('The workflows command supports --json, not --jsonl');
        writeJsonResult('workflows', { workflows });
        return;
      }
      for (const workflow of workflows) console.log(`${workflow.id}  ${workflow.description}`);
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createCli()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const mode = process.argv.includes('--jsonl')
        ? 'jsonl'
        : process.argv.includes('--json')
          ? 'json'
          : undefined;
      if (mode) writeJsonError(error);
      else console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = exitCodeFor(error);
    });
}
