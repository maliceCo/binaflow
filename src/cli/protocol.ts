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

export interface RunDto {
  id: string;
  workflowId: string;
  workflowVersion: number;
  objective: string;
  status: WorkflowRun['status'];
  createdAt: string;
  updatedAt: string;
}

export interface StepRunDto {
  runId: string;
  stepId: string;
  profile: string;
  status: StepRun['status'];
  attempt: number;
  profileSnapshot?: ProfileSnapshotDto;
  startedAt?: string;
  finishedAt?: string;
  result?: AgentStepResultDto;
  disposition?: StepDispositionDto;
  skipReason?: StepSkipReasonDto;
  error?: StepErrorDto;
  approval?: ApprovalDto;
}

export interface ProfileSnapshotDto {
  driver: string;
  provider?: string;
  model: string;
  thinking?: string;
  tools: string[];
  workspaceMode: 'read-only' | 'read-write';
  projectTrust?: 'never' | 'always';
  timeoutMs: number;
  retryLimit: number;
}

export interface AgentStepResultDto {
  text: string;
  sessionId?: string;
  usage?: AgentUsageDto;
  costUsd?: number;
}

export interface AgentUsageDto {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type StepDispositionDto =
  { kind: 'continue' } | { kind: 'stop'; code: string; message: string };

export interface StepSkipReasonDto {
  code: string;
  message: string;
}

export interface StepErrorDto {
  message: string;
  code?: string;
  retryable: boolean;
}

export interface ApprovalDto {
  decision?: 'approved' | 'rejected';
  feedback?: string;
  decidedAt?: string;
}

export interface ArtifactDto {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: ArtifactReference['kind'];
  path: string;
  mediaType: string;
  sizeBytes: number;
}

export interface EventDto {
  runId: string;
  stepId: string;
  type: NormalizedEvent['type'];
  message: string;
  occurredAt: string;
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
  event: EventDto;
}

export interface RunFinishedRecord {
  protocol: typeof CLI_PROTOCOL;
  version: typeof CLI_PROTOCOL_VERSION;
  type: 'run.finished';
  command: string;
  run: RunDto;
  steps: StepRunDto[];
  artifacts: ArtifactDto[];
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

/** Read machine-output flags from argv, stopping at the first bare `--` delimiter. */
export function machineModeFromArgv(argv: readonly string[]): MachineMode | undefined {
  const flags = machineModeFlagsFromArgv(argv);
  if (flags.jsonl) return 'jsonl';
  if (flags.json) return 'json';
  return undefined;
}

export function machineOutputRequestedFromArgv(argv: readonly string[]): boolean {
  const flags = machineModeFlagsFromArgv(argv);
  return flags.json || flags.jsonl;
}

export function validateMachineMode(options: RootOptions): void {
  if (options.json && options.jsonl) {
    throw cliUsageError('CONFLICTING_OUTPUT_MODES', 'Choose either --json or --jsonl');
  }
}

export function rejectUnsupportedJsonl(mode: MachineMode | undefined, command: string): void {
  if (mode === 'jsonl') {
    throw cliUsageError(
      'UNSUPPORTED_OUTPUT_MODE',
      `The ${command} command supports --json, not --jsonl`,
    );
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

export function toRunDto(run: WorkflowRun): RunDto {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    objective: run.objective,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function toStepRunDto(step: StepRun): StepRunDto {
  return {
    runId: step.runId,
    stepId: step.stepId,
    profile: step.profile,
    status: step.status,
    attempt: step.attempt,
    ...(step.profileSnapshot
      ? { profileSnapshot: toProfileSnapshotDto(step.profileSnapshot) }
      : {}),
    ...(step.startedAt ? { startedAt: step.startedAt } : {}),
    ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
    ...(step.result ? { result: toResultDto(step.result) } : {}),
    ...(step.disposition ? { disposition: toDispositionDto(step.disposition) } : {}),
    ...(step.skipReason ? { skipReason: toSkipReasonDto(step.skipReason) } : {}),
    ...(step.error ? { error: toErrorDto(step.error) } : {}),
    ...(step.approval ? { approval: toApprovalDto(step.approval) } : {}),
  };
}

export function toArtifactDto(artifact: ArtifactReference): ArtifactDto {
  return {
    id: artifact.id,
    runId: artifact.runId,
    stepId: artifact.stepId,
    name: artifact.name,
    kind: artifact.kind,
    path: artifact.path,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
  };
}

export function toEventDto(event: NormalizedEvent): EventDto {
  return {
    runId: event.runId,
    stepId: event.stepId,
    type: event.type,
    message: event.message,
    occurredAt: event.occurredAt,
  };
}

export function runStartedRecord(
  command: string,
  runId: string,
  workflowId: string,
): RunStartedRecord {
  return {
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'run.started',
    command,
    runId,
    workflowId,
  };
}

export function runEventRecord(sequence: number, event: NormalizedEvent): RunEventRecord {
  return {
    protocol: CLI_PROTOCOL,
    version: CLI_PROTOCOL_VERSION,
    type: 'event',
    sequence,
    event: toEventDto(event),
  };
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

function machineModeFlagsFromArgv(argv: readonly string[]): { json: boolean; jsonl: boolean } {
  const start = argv.length >= 2 && looksLikeNodeArgv(argv) ? 2 : 0;
  let json = false;
  let jsonl = false;
  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || arg === '--') break;
    if (arg === '--json') json = true;
    else if (arg === '--jsonl') jsonl = true;
  }
  return { json, jsonl };
}

function looksLikeNodeArgv(argv: readonly string[]): boolean {
  const first = argv[0];
  if (first === undefined) return false;
  return (
    first === 'node' ||
    first.endsWith('/node') ||
    first.endsWith('\\node') ||
    first.endsWith('/node.exe') ||
    first.endsWith('\\node.exe')
  );
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
    run: toRunDto(run),
    steps: steps.map(toStepRunDto),
    artifacts: artifacts.map(toArtifactDto),
  };
}

function toResultDto(result: NonNullable<StepRun['result']>): NonNullable<StepRunDto['result']> {
  return {
    text: result.text,
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    ...(result.usage
      ? {
          usage: {
            ...(result.usage.inputTokens !== undefined
              ? { inputTokens: result.usage.inputTokens }
              : {}),
            ...(result.usage.outputTokens !== undefined
              ? { outputTokens: result.usage.outputTokens }
              : {}),
            ...(result.usage.totalTokens !== undefined
              ? { totalTokens: result.usage.totalTokens }
              : {}),
          },
        }
      : {}),
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
  };
}

function toProfileSnapshotDto(
  snapshot: NonNullable<StepRun['profileSnapshot']>,
): ProfileSnapshotDto {
  return {
    driver: snapshot.driver,
    ...(snapshot.provider ? { provider: snapshot.provider } : {}),
    model: snapshot.model,
    ...(snapshot.thinking ? { thinking: snapshot.thinking } : {}),
    tools: [...snapshot.tools],
    workspaceMode: snapshot.workspaceMode,
    ...(snapshot.projectTrust ? { projectTrust: snapshot.projectTrust } : {}),
    timeoutMs: snapshot.timeoutMs,
    retryLimit: snapshot.retryLimit,
  };
}

function toDispositionDto(disposition: NonNullable<StepRun['disposition']>): StepDispositionDto {
  return disposition.kind === 'continue'
    ? { kind: 'continue' }
    : { kind: 'stop', code: disposition.code, message: disposition.message };
}

function toSkipReasonDto(reason: NonNullable<StepRun['skipReason']>): StepSkipReasonDto {
  return { code: reason.code, message: reason.message };
}

function toErrorDto(error: NonNullable<StepRun['error']>): StepErrorDto {
  return {
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    retryable: error.retryable,
  };
}

function toApprovalDto(approval: NonNullable<StepRun['approval']>): ApprovalDto {
  return {
    ...(approval.decision ? { decision: approval.decision } : {}),
    ...(approval.feedback ? { feedback: approval.feedback } : {}),
    ...(approval.decidedAt ? { decidedAt: approval.decidedAt } : {}),
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
