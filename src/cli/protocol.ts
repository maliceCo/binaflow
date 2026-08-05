import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';
import type { RootOptions } from './commands/common.js';

export const CLI_PROTOCOL = 'binaflow-cli';
export const CLI_PROTOCOL_VERSION = 1;

export type MachineMode = 'json' | 'jsonl';

export interface CliErrorPayload {
  code: string;
  message: string;
}

export interface CliResult<T> {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'result';
  command: string;
  data: T;
}

export interface CliErrorResult {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'error';
  command?: string;
  error: CliErrorPayload;
}

export interface RunStartedRecord {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'run.started';
  command: string;
  runId: string;
  workflowId: string;
}

export interface RunEventRecord {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'event';
  sequence: number;
  event: NormalizedEvent;
}

export interface RunFinishedRecord {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'run.finished';
  command: string;
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: ArtifactReference[];
}

export interface RunFailedRecord {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'run.failed';
  command: string;
  runId: string;
  error: CliErrorPayload;
}

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function cliUsageError(code: string, message: string): CliError {
  return new CliError(code, message, 2);
}

export function machineMode(options: RootOptions): MachineMode | undefined {
  if (options.jsonl) return 'jsonl';
  if (options.json) return 'json';
  return undefined;
}

export function validateMachineMode(options: RootOptions): void {
  if (options.json && options.jsonl) {
    throw cliUsageError('CONFLICTING_OUTPUT_MODES', 'Choose either --json or --jsonl');
  }
}

export function writeJsonResult<T>(command: string, data: T): void {
  const result: CliResult<T> = {
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'result',
    command,
    data,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export function writeJsonl(
  record: RunStartedRecord | RunEventRecord | RunFinishedRecord | RunFailedRecord,
): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function writeJsonlFailure(command: string, runId: string, error: unknown): void {
  writeJsonl({
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'run.failed',
    command,
    runId,
    error: errorPayload(error),
  });
}

export function writeJsonError(error: unknown, command?: string): void {
  const result: CliErrorResult = {
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'error',
    ...(command ? { command } : {}),
    error: {
      ...errorPayload(error),
    },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof CliError) return error.exitCode;
  if (isCodedError(error)) {
    if (error.code === 'commander.help' || error.code === 'commander.helpDisplayed') return 0;
    if (error.code === 'commander.version') return 0;
    if (error.code.startsWith('commander.')) return 2;
  }
  return 1;
}

export function runFinishedRecord(
  command: string,
  run: WorkflowRun,
  steps: StepRun[],
  artifacts: ArtifactReference[],
): RunFinishedRecord {
  return {
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'run.finished',
    command,
    run,
    steps,
    artifacts,
  };
}

function isCodedError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
  );
}

function errorPayload(error: unknown): CliErrorPayload {
  return {
    code: error instanceof CliError ? error.code : isCodedError(error) ? error.code : 'CLI_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
