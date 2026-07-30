#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

export function createCli(): Command {
  const cli = new Command();

  cli
    .name('binaflow')
    .description('Local workflow orchestrator for coding agents')
    .version('0.1.0');

  cli
    .command('run')
    .description('Start a workflow run')
    .argument('<workflow>', 'workflow name')
    .option('--objective <text>', 'objective for the workflow');

  cli.command('runs').description('List persisted workflow runs');
  cli.command('show').description('Show a persisted workflow run').argument('<run-id>', 'run ID');
  cli
    .command('resume')
    .description('Resume a persisted workflow run')
    .argument('<run-id>', 'run ID');

  return cli;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createCli().parseAsync(process.argv);
}
