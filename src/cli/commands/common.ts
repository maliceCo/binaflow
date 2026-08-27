import type { Command } from 'commander';
import type { RunView } from '../../application/run-view.js';
import {
  openApplicationContext,
  openApplicationStorage,
  type ApplicationContext,
  type ApplicationStorageContext,
  type ApplicationRuntimeContext,
} from '../../application/runtime.js';
import type { StepRun, WorkflowRun } from '../../core/run.js';
import {
  formatDurationMs,
  formatTimestamp,
  humanRunStatus,
  humanStepStatus,
} from '../../presentation/format.js';
import { sanitizeTerminalText } from '../../presentation/text.js';
import type { NormalizedEvent } from '../../core/events.js';
import { discoverWorkflows } from '../../application/operations.js';
import {
  exitCodeFor,
  machineMode,
  runEventRecord,
  runFinishedRecord,
  toArtifactDto,
  toRunDto,
  toStepRunDto,
  writeJsonResult,
  writeJsonl,
  writeJsonlFailure,
  type MachineMode,
} from '../protocol.js';

export interface RootOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  jsonl?: boolean;
}

export type CliContext = ApplicationContext;
export type StorageContext = ApplicationStorageContext;

export class CliEventPresenter {
  private textStep: string | undefined;

  constructor(
    private readonly verbose = false,
    private readonly write: (text: string) => void = (text) => {
      process.stderr.write(text);
    },
  ) {}

  present(event: NormalizedEvent): void {
    const message = sanitizeTerminalText(event.message);
    if (this.verbose) {
      if (event.type === 'text') {
        this.write(message);
      } else {
        this.endText();
        this.write(`\n[${event.stepId}] ${event.type}: ${message}\n`);
      }
      return;
    }

    if (event.type === 'text') {
      if (this.textStep !== event.stepId) {
        this.endText();
        this.write(`[${event.stepId}] agent: `);
        this.textStep = event.stepId;
      }
      this.write(message);
      return;
    }

    this.endText();
    const prefix = event.type === 'error' ? 'error: ' : '';
    this.write(`[${event.stepId}] ${prefix}${friendlyEventMessage(message)}\n`);
  }

  flush(): void {
    this.endText();
  }

  private endText(): void {
    if (this.textStep !== undefined) {
      this.write('\n');
      this.textStep = undefined;
    }
  }
}

export async function openContext(
  rootOptions: RootOptions,
  streamFailure?: Pick<CliStreamFailure, 'failed' | 'write'>,
): Promise<CliContext> {
  const mode = machineMode(rootOptions);
  const presenter = mode
    ? new CliEventPresenter(false, () => undefined)
    : new CliEventPresenter(
        rootOptions.verbose,
        streamFailure
          ? (text) => {
              streamFailure.write(() => process.stderr.write(text));
            }
          : undefined,
      );
  let eventSequence = 0;
  const application = await openApplicationContext({
    configPath: rootOptions.config ?? '.binaflow/config.json',
    cwd: rootOptions.cwd ?? process.cwd(),
    onEvent: (event) => {
      if (streamFailure?.failed) return;
      presenter.present(event);
      if (mode === 'jsonl') {
        const record = runEventRecord(++eventSequence, event);
        if (streamFailure) streamFailure.write(() => writeJsonl(record));
        else writeJsonl(record);
      }
    },
  });
  return {
    application: application.application,
    close: () => {
      try {
        presenter.flush();
      } finally {
        application.close();
      }
    },
  };
}

export async function openStorageContext(rootOptions: RootOptions): Promise<StorageContext> {
  return openApplicationStorage(
    rootOptions.config ?? '.binaflow/config.json',
    rootOptions.cwd ?? process.cwd(),
  );
}

export function rootOptions(command: Command): RootOptions {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts<RootOptions>();
}

export function printHumanProgress(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function printRunSummary(view: RunView, stepResults: StepRun[] = []): void {
  console.log(
    `Run ${view.id}  workflow=${workflowDisplayLabel(view.workflow.id)}  status=${view.status}`,
  );
  console.log(`  objective=${singleLine(view.objective, 240)}`);
  console.log(`  state=${humanRunStatus(view.status)}`);
  console.log(
    `  created=${formatTimestamp(view.createdAt)}  updated=${formatTimestamp(view.updatedAt)}`,
  );
  const resultsByStep = new Map(stepResults.map((step) => [step.stepId, step]));
  for (const phase of view.phases) {
    const stepResult = resultsByStep.get(phase.id);
    const profile = stepResult?.profileSnapshot;
    const duration = phase.durationMs === undefined ? '-' : formatDurationMs(phase.durationMs);
    const usage =
      phase.usage?.totalTokens === undefined ? '-' : `${phase.usage.totalTokens} tokens`;
    const cost = phase.costUsd === undefined ? '-' : `$${phase.costUsd.toFixed(4)}`;
    console.log(
      `  ${phase.id}  profile=${phase.profile ?? '-'}  driver=${profile?.driver ?? '-'}  model=${profile?.model ?? '-'}  status=${phase.status} (${humanStepStatus(phase.status)})  attempt=${phase.attempt ?? '-'}  duration=${duration}  usage=${usage}  cost=${cost}`,
    );
    if (stepResult && !profile && phase.status !== 'skipped') {
      console.log('    execution metadata=unavailable (legacy run)');
    }
    if (phase.error) {
      console.log(
        `    error=${phase.error.code ?? 'UNKNOWN'}  retryable=${phase.error.retryable}  ${sanitizeTerminalText(phase.error.message)}`,
      );
    }
    if (phase.skipReason) {
      console.log(
        `    skipped=${phase.skipReason.code}  ${sanitizeTerminalText(phase.skipReason.message)}`,
      );
    }
    if (phase.approval?.decision) {
      console.log(
        `    approval=${phase.approval.decision}${phase.approval.feedback ? `  ${sanitizeTerminalText(phase.approval.feedback)}` : ''}`,
      );
    }
    const result = stepResult?.result;
    if (result?.text?.trim()) printAgentResponse(result.text);
  }
  const totalUsage = view.metrics.usage?.totalTokens;
  const totalCost = view.metrics.costUsd;
  console.log(
    `  total  usage=${totalUsage === undefined ? '-' : `${totalUsage} tokens`}  cost=${totalCost === undefined ? '-' : `$${totalCost.toFixed(4)}`}`,
  );
  printNextAction(view);
}

export async function printMachineRunResult(
  command: string,
  run: WorkflowRun,
  context: ApplicationRuntimeContext,
  mode: MachineMode,
  write?: (action: () => void) => boolean,
): Promise<void> {
  const inspection = await context.application.inspectRun(run.id, { includeStepResults: true });
  if (mode === 'json') {
    const result = () =>
      writeJsonResult(command, {
        run: toRunDto(inspection.run),
        steps: inspection.steps.map(toStepRunDto),
        artifacts: inspection.artifacts.map(toArtifactDto),
      });
    if (write) write(result);
    else result();
  } else {
    const result = () =>
      writeJsonl(
        runFinishedRecord(command, inspection.run, inspection.steps, inspection.artifacts),
      );
    if (write) write(result);
    else result();
  }
}

export function printMachineResult<T>(command: string, data: T): void {
  writeJsonResult(command, data);
}

export interface InstalledSignalHandlers {
  remove(): void;
  completeCleanup(): void;
}

export interface CliStreamFailure {
  readonly error: Error | undefined;
  readonly failed: boolean;
  capture(error: unknown): void;
  write(action: () => void): boolean;
  remove(): void;
}

export function installCliStreamFailure(controller: AbortController): CliStreamFailure {
  let error: Error | undefined;
  const capture = (reason: unknown): void => {
    const failure = reason instanceof Error ? reason : new Error(String(reason));
    error ??= failure;
    controller.abort(failure);
  };
  const onError = (reason: Error): void => {
    capture(reason);
  };
  process.stdout.on('error', onError);
  process.stderr.on('error', onError);
  let removed = false;
  return {
    get error() {
      return error;
    },
    get failed() {
      return error !== undefined;
    },
    capture,
    write: (action) => {
      if (error) return false;
      try {
        action();
        return true;
      } catch (reason) {
        capture(reason);
        return false;
      }
    },
    remove: () => {
      if (removed) return;
      removed = true;
      process.stdout.removeListener('error', onError);
      process.stderr.removeListener('error', onError);
    },
  };
}

export interface AttachedCliLifecycle {
  readonly signal: AbortSignal;
  readonly streamFailure: CliStreamFailure;
  markStarted(): void;
}

export async function runAttachedCli(
  rootOptions: RootOptions,
  runId: string,
  command: string,
  operation: (context: CliContext, lifecycle: AttachedCliLifecycle) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const streamFailure = installCliStreamFailure(controller);
  const signalHandlers = installSignalHandlers(controller, runId, streamFailure);
  let context: CliContext | undefined;
  let operationPromise: Promise<void> | undefined;
  let failure: unknown;
  let failed = false;
  let cleanupFailure: unknown;
  let started = false;
  let failureHandled = false;

  try {
    context = await openContext(rootOptions, streamFailure);
    const lifecycle: AttachedCliLifecycle = {
      signal: controller.signal,
      streamFailure,
      markStarted: () => {
        started = true;
      },
    };
    operationPromise = operation(context, lifecycle);
    await operationPromise;
  } catch (error) {
    failure = error;
    failed = true;
    if (streamFailure.failed) {
      process.exitCode = 1;
      failureHandled = true;
    } else if (machineMode(rootOptions) === 'jsonl' && started) {
      streamFailure.write(() => writeJsonlFailure(command, runId, error));
      process.exitCode = exitCodeFor(error);
      failureHandled = true;
    }
  } finally {
    if (operationPromise) {
      try {
        await operationPromise;
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
    }

    if (context) {
      try {
        await context.close();
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    try {
      signalHandlers.completeCleanup();
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  streamFailure.remove();
  signalHandlers.remove();

  if (streamFailure.failed) {
    process.exitCode = 1;
    return;
  }
  if (failureHandled) return;
  if (failed) throw failure;
  if (cleanupFailure) throw cleanupFailure;
}

export function installSignalHandlers(
  controller: AbortController,
  runId: string,
  output?: Pick<CliStreamFailure, 'write'>,
): InstalledSignalHandlers {
  let cancellationRequested = false;
  let forceRequested = false;
  let forceSignal: NodeJS.Signals | undefined;
  let cleanupComplete = false;
  let removed = false;
  const forceAfterCleanup = (signal: NodeJS.Signals): void => {
    if (!cleanupComplete) return;
    process.exitCode = 130;
    process.kill(process.pid, signal);
  };
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (!cancellationRequested) {
      cancellationRequested = true;
      controller.abort();
      writeSignalMessage(
        output,
        `\nCancellation requested for run ${runId}; waiting for the agent to stop. Press Ctrl-C again to force exit.\n`,
      );
      return;
    }

    forceRequested = true;
    forceSignal = signal;
    writeSignalMessage(output, `\nForce-exiting run ${runId} after cleanup.\n`);
    forceAfterCleanup(signal);
  };
  const onSigint = (): void => handleSignal('SIGINT');
  const onSigterm = (): void => handleSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  return {
    remove: () => {
      if (removed) return;
      removed = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    },
    completeCleanup: () => {
      cleanupComplete = true;
      if (forceRequested) forceAfterCleanup(forceSignal ?? 'SIGINT');
    },
  };
}

function writeSignalMessage(
  output: Pick<CliStreamFailure, 'write'> | undefined,
  message: string,
): void {
  if (output) output.write(() => process.stderr.write(message));
  else process.stderr.write(message);
}

function friendlyEventMessage(message: string): string {
  const stepMessage = message.match(/^Step \S+ (.+)$/);
  if (stepMessage) return stepMessage[1]!;
  return message
    .replace(/^Pi tool_execution_start/, 'tool started')
    .replace(/^Pi tool_execution_end/, 'tool completed');
}

function printAgentResponse(response: string): void {
  const safeResponse = sanitizeTerminalText(response);
  const lines = safeResponse.trim().slice(0, 4_000).split(/\r?\n/);
  console.log('    response:');
  for (const line of lines) console.log(`      ${line}`);
  if (safeResponse.trim().length > 4_000) console.log('      [response truncated]');
}

function printNextAction(view: RunView): void {
  if (view.availableActions.some((action) => action.kind === 'resume')) {
    console.log(`  next=binaflow resume ${view.id}`);
    return;
  }
  if (
    view.availableActions.some((action) => action.kind === 'approve-research') &&
    view.availableActions.some((action) => action.kind === 'reject-research')
  ) {
    console.log(
      `  next=binaflow approve ${view.id}  or  binaflow reject ${view.id} --feedback "..."`,
    );
    return;
  }
  const markInterrupted = view.availableActions.find(
    (action) => action.kind === 'mark-interrupted',
  );
  if (markInterrupted) {
    console.log(`  action=${markInterrupted.label}`);
    return;
  }
  if (view.status === 'failed' || view.status === 'interrupted' || view.status === 'cancelled') {
    console.log(`  next=binaflow show ${view.id}`);
    return;
  }
  if (view.followUp?.kind === 'clarification') {
    console.log('  next=run again with an objective that answers the clarification questions');
  }
}

export function workflowDisplayLabel(workflowId: string): string {
  const summary = discoverWorkflows().find((item) => item.id === workflowId);
  return summary?.experimental ? `${workflowId} [Experimental]` : workflowId;
}

function singleLine(value: string, maxLength: number): string {
  const normalized = sanitizeTerminalText(value).replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
