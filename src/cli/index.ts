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
import { VERSION } from '../version.js';

export function createCli(): Command {
  const cli = new Command();

  cli
    .name('binaflow')
    .description('Local workflow orchestrator for coding agents')
    .version(VERSION)
    .option('--config <path>', 'path to the external Binaflow config')
    .option('--cwd <path>', 'workspace directory for the agent')
    .option('--verbose', 'show live agent progress and text output');

  registerRunCommand(cli);
  registerRunsCommand(cli);
  registerShowCommand(cli);
  registerResumeCommand(cli);
  registerApprovalCommands(cli);
  registerUpdateCommand(cli);

  return cli;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createCli()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
