import type { Command } from 'commander';
import type { WorkflowRun } from '../../core/run.js';
import { discoverWorkflows } from '../../application/operations.js';
import { readJsonInput as readJsonInputFile } from '../../application/config-operations.js';
import { cliUsageError, machineMode, runStartedRecord, writeJsonl } from '../protocol.js';

interface RunOptions {
  objective?: string;
  interactive?: boolean;
  inputJson?: string;
}

export function registerRunCommand(cli: Command): void {
  cli
    .command('run')
    .description('Start a workflow run')
    .argument('[workflow]', 'workflow name')
    .option('--objective <text>', 'objective for the workflow')
    .option('--input-json <path>', 'workflow input JSON file, or - for stdin')
    .option('--interactive', 'choose missing inputs interactively')
    .addHelpText(
      'after',
      `\nAvailable workflows:\n${formatWorkflowList()}\n\nExamples:\n  $ binaflow run plan-build --objective "Fix the failing tests"\n  $ binaflow run --interactive\n`,
    )
    .action(async (workflowId: string | undefined, options: RunOptions, command: Command) => {
      const outputMode = rootMachineMode(command);
      if (options.interactive && outputMode) {
        throw cliUsageError(
          'INTERACTIVE_WITH_MACHINE_OUTPUT',
          'The --interactive option cannot be combined with --json or --jsonl',
        );
      }
      const input = await readInputJson(options.inputJson);
      const inputObjective = typeof input.objective === 'string' ? input.objective : undefined;
      const inputs = options.interactive
        ? await promptForMissingInputs(workflowId, options.objective ?? inputObjective, input)
        : requireRunInputs(workflowId, options.objective ?? inputObjective, input);
      const { randomUUID } = await import('node:crypto');
      const {
        printRunSummary,
        printMachineRunResult,
        printHumanProgress,
        rootOptions,
        runAttachedCli,
      } = await import('./common.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      const runId = randomUUID();
      await runAttachedCli(optionsAtRoot, runId, 'run', async (context, lifecycle) => {
        const run = await context.application.runWorkflow({
          workflowId: inputs.workflowId,
          objective: inputs.objective,
          input: inputs.input,
          runId,
          signal: lifecycle.signal,
          onRunStarted: (startedRun: WorkflowRun) => {
            lifecycle.markStarted();
            if (mode === 'jsonl') {
              lifecycle.streamFailure.write(() =>
                writeJsonl(runStartedRecord('run', startedRun.id, startedRun.workflowId)),
              );
            } else if (!mode) {
              lifecycle.streamFailure.write(() =>
                printHumanProgress(
                  `Started run ${startedRun.id}  workflow=${startedRun.workflowId}`,
                ),
              );
            }
          },
        });
        if (lifecycle.streamFailure.failed) {
          process.exitCode = 1;
          return;
        }
        if (mode) {
          await printMachineRunResult('run', run, context, mode, lifecycle.streamFailure.write);
        } else {
          const inspection = await context.application.inspectRun(run.id, {
            includeStepResults: true,
          });
          const view = await context.application.getRunView(run.id);
          lifecycle.streamFailure.write(() => printRunSummary(view, inspection.steps));
        }
        if (run.status === 'failed' || run.status === 'cancelled') {
          process.exitCode = run.status === 'cancelled' ? 130 : 1;
        }
      });
    });
}

function formatWorkflowList(): string {
  return discoverWorkflows()
    .map(
      (item) =>
        `  ${item.id.padEnd(22)} ${item.experimental ? '[experimental] ' : ''}${item.description}`,
    )
    .join('\n');
}

function requireRunInputs(
  workflowId: string | undefined,
  objective: string | undefined,
  input: Record<string, unknown>,
): {
  workflowId: string;
  objective: string;
  input: Record<string, unknown>;
} {
  const missing = [
    workflowId ? undefined : 'workflow',
    objective?.trim() ? undefined : 'objective',
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) {
    const instruction =
      missing.length === 2
        ? 'Provide a workflow and an objective'
        : missing[0] === 'workflow'
          ? 'Provide a workflow'
          : 'Add --objective "<what should be done>"';
    throw cliUsageError(
      'INVALID_INPUT',
      `Missing ${missing.join(' and ')}. ${instruction}.\n\nAvailable workflows:\n${formatWorkflowList()}\n\nUsage:\n  binaflow run <workflow> --objective "<what should be done>"\n\nTry:\n  binaflow run plan-build --objective "Fix the failing tests"\n  binaflow run --interactive`,
    );
  }
  return {
    workflowId: workflowId!,
    objective: objective!.trim(),
    input: { ...input, objective: objective!.trim() },
  };
}

async function promptForMissingInputs(
  workflowId: string | undefined,
  objective: string | undefined,
  input: Record<string, unknown>,
): Promise<{ workflowId: string; objective: string; input: Record<string, unknown> }> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw cliUsageError(
      'INTERACTIVE_REQUIRES_TTY',
      'Interactive mode requires a terminal. Use --objective and a workflow, or run `binaflow run --help`.',
    );
  }

  if (workflowId && objective?.trim()) {
    return {
      workflowId,
      objective: objective.trim(),
      input: { ...input, objective: objective.trim() },
    };
  }

  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const selectedWorkflow =
      workflowId ??
      (
        await readline.question(
          `Workflow (${discoverWorkflows()
            .map((item) => item.id)
            .join(', ')}): `,
        )
      ).trim();
    const selectedObjective = objective?.trim() ?? (await readline.question('Objective: ')).trim();
    return requireRunInputs(selectedWorkflow, selectedObjective, input);
  } finally {
    readline.close();
  }
}

async function readInputJson(path: string | undefined): Promise<Record<string, unknown>> {
  if (!path) return {};
  try {
    return await readJsonInputFile(path, readStdin);
  } catch (error) {
    throw cliUsageError(
      'INVALID_INPUT_JSON',
      `Invalid input JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function rootMachineMode(command: Command): 'json' | 'jsonl' | undefined {
  let root = command;
  while (root.parent) root = root.parent;
  const options = root.opts<{ json?: boolean; jsonl?: boolean }>();
  if (options.jsonl) return 'jsonl';
  if (options.json) return 'json';
  return undefined;
}
