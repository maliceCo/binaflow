import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { WorkflowRun } from '../../core/run.js';
import { workflowSummaries } from '../../workflows/catalog-info.js';
import {
  cliUsageError,
  exitCodeFor,
  machineMode,
  writeJsonl,
  writeJsonlFailure,
} from '../protocol.js';

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
        installSignalHandlers,
        openContext,
        printRunSummary,
        printMachineRunResult,
        printHumanProgress,
        rootOptions,
      } = await import('./common.js');
      const { runWorkflow } = await import('../../application/operations.js');
      const optionsAtRoot = rootOptions(command);
      const mode = machineMode(optionsAtRoot);
      const context = await openContext(optionsAtRoot);
      const runId = randomUUID();
      const controller = new AbortController();
      const removeSignalHandlers = installSignalHandlers(controller, runId);
      let started = false;
      try {
        const run = await runWorkflow(context, {
          workflowId: inputs.workflowId,
          objective: inputs.objective,
          input: inputs.input,
          runId,
          signal: controller.signal,
          onRunStarted: (startedRun: WorkflowRun) => {
            started = true;
            if (mode === 'jsonl') {
              writeJsonl({
                protocol: 'binaflow-cli',
                version: 1,
                type: 'run.started',
                command: 'run',
                runId: startedRun.id,
                workflowId: startedRun.workflowId,
              });
            } else if (!mode) {
              printHumanProgress(`Started run ${startedRun.id}  workflow=${startedRun.workflowId}`);
            }
          },
        });
        if (mode) {
          await printMachineRunResult('run', run, context, mode);
        } else {
          printRunSummary(run, await context.store.getStepRuns(run.id));
        }
        if (run.status === 'failed' || run.status === 'cancelled') {
          process.exitCode = run.status === 'cancelled' ? 130 : 1;
        }
      } catch (error) {
        if (mode === 'jsonl' && started) {
          writeJsonlFailure('run', runId, error);
          process.exitCode = exitCodeFor(error);
          return;
        }
        throw error;
      } finally {
        removeSignalHandlers();
        context.close();
      }
    });
}

function formatWorkflowList(): string {
  return workflowSummaries
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
          `Workflow (${workflowSummaries.map((item) => item.id).join(', ')}): `,
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
  let content: string;
  try {
    content = await (path === '-' ? readStdin() : readFile(path, 'utf8'));
  } catch (error) {
    throw cliUsageError(
      'INVALID_INPUT_JSON',
      `Cannot read input JSON ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) throw new Error('input JSON must be an object');
    return parsed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rootMachineMode(command: Command): 'json' | 'jsonl' | undefined {
  let root = command;
  while (root.parent) root = root.parent;
  const options = root.opts<{ json?: boolean; jsonl?: boolean }>();
  if (options.jsonl) return 'jsonl';
  if (options.json) return 'json';
  return undefined;
}
