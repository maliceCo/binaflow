import type { Command } from 'commander';
import {
  openApplicationContext,
  openApplicationStorage,
  type ApplicationRuntimeContext,
} from '../../application/runtime.js';
import type { ApplicationService } from '../../application/service.js';
import type { StepRun, WorkflowRun } from '../../core/run.js';
import {
  formatDurationMs,
  formatTimestamp,
  humanRunStatus,
  humanStepStatus,
} from '../../presentation/format.js';
import type { NormalizedEvent } from '../../core/events.js';
import {
  machineMode,
  runFinishedRecord,
  writeJsonResult,
  writeJsonl,
  type MachineMode,
} from '../protocol.js';
import { workflowSummaries } from '../../workflows/catalog.js';

export interface RootOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  jsonl?: boolean;
}

export type CliContext = ApplicationService;
export type StorageContext = ApplicationService;

export class CliEventPresenter {
  private textStep: string | undefined;

  constructor(
    private readonly verbose = false,
    private readonly write: (text: string) => void = (text) => {
      process.stderr.write(text);
    },
  ) {}

  present(event: NormalizedEvent): void {
    if (this.verbose) {
      if (event.type === 'text') {
        this.write(event.message);
      } else {
        this.endText();
        this.write(`\n[${event.stepId}] ${event.type}: ${event.message}\n`);
      }
      return;
    }

    if (event.type === 'text') {
      if (this.textStep !== event.stepId) {
        this.endText();
        this.write(`[${event.stepId}] agent: `);
        this.textStep = event.stepId;
      }
      this.write(event.message);
      return;
    }

    this.endText();
    const prefix = event.type === 'error' ? 'error: ' : '';
    this.write(`[${event.stepId}] ${prefix}${friendlyEventMessage(event.message)}\n`);
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

export async function openContext(rootOptions: RootOptions): Promise<CliContext> {
  const mode = machineMode(rootOptions);
  const presenter = mode
    ? new CliEventPresenter(false, () => undefined)
    : new CliEventPresenter(rootOptions.verbose);
  let eventSequence = 0;
  const application = await openApplicationContext({
    configPath: rootOptions.config ?? '.binaflow/config.json',
    cwd: rootOptions.cwd ?? process.cwd(),
    onEvent: (event) => {
      presenter.present(event);
      if (mode === 'jsonl') {
        writeJsonl({
          protocol: 'binaflow-cli',
          version: 1,
          type: 'event',
          sequence: ++eventSequence,
          event,
        });
      }
    },
  });
  return {
    ...application,
    close: () => {
      presenter.flush();
      application.close();
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

export function printRunSummary(run: WorkflowRun, steps: StepRun[]): void {
  console.log(
    `Run ${run.id}  workflow=${workflowDisplayLabel(run.workflowId)}  status=${run.status}`,
  );
  console.log(`  objective=${singleLine(run.objective, 240)}`);
  console.log(`  state=${humanRunStatus(run.status)}`);
  console.log(
    `  created=${formatTimestamp(run.createdAt)}  updated=${formatTimestamp(run.updatedAt)}`,
  );
  let totalTokens = 0;
  let totalCost = 0;
  let hasTokens = false;
  let hasCost = false;
  for (const step of steps) {
    const profile = step.profileSnapshot;
    const duration = step.startedAt
      ? formatDurationMs(durationMs(step.startedAt, step.finishedAt ?? new Date().toISOString()))
      : '-';
    const usage =
      step.result?.usage?.totalTokens === undefined
        ? '-'
        : `${step.result.usage.totalTokens} tokens`;
    const cost = step.result?.costUsd === undefined ? '-' : `$${step.result.costUsd.toFixed(4)}`;
    if (step.result?.usage?.totalTokens !== undefined) {
      totalTokens += step.result.usage.totalTokens;
      hasTokens = true;
    }
    if (step.result?.costUsd !== undefined) {
      totalCost += step.result.costUsd;
      hasCost = true;
    }
    console.log(
      `  ${step.stepId}  profile=${step.profile}  driver=${profile?.driver ?? '-'}  model=${profile?.model ?? '-'}  status=${step.status} (${humanStepStatus(step.status)})  attempt=${step.attempt}  duration=${duration}  usage=${usage}  cost=${cost}`,
    );
    if (!profile && step.status !== 'skipped') {
      console.log('    execution metadata=unavailable (legacy run)');
    }
    if (step.error) {
      console.log(
        `    error=${step.error.code ?? 'UNKNOWN'}  retryable=${step.error.retryable}  ${step.error.message}`,
      );
    }
    if (step.skipReason) {
      console.log(`    skipped=${step.skipReason.code}  ${step.skipReason.message}`);
    }
    if (step.approval?.decision) {
      console.log(
        `    approval=${step.approval.decision}${step.approval.feedback ? `  ${step.approval.feedback}` : ''}`,
      );
    }
    if (step.result?.text?.trim()) printAgentResponse(step.result.text);
  }
  console.log(
    `  total  usage=${hasTokens ? `${totalTokens} tokens` : '-'}  cost=${hasCost ? `$${totalCost.toFixed(4)}` : '-'}`,
  );
  printNextAction(run, steps);
}

export async function printMachineRunResult(
  command: string,
  run: WorkflowRun,
  context: ApplicationRuntimeContext,
  mode: MachineMode,
): Promise<void> {
  const inspection = await context.inspectRun(run.id, { includeStepResults: true });
  if (mode === 'json') {
    writeJsonResult(command, {
      run: inspection.run,
      steps: inspection.steps,
      artifacts: inspection.artifacts,
    });
  } else {
    writeJsonl(runFinishedRecord(command, inspection.run, inspection.steps, inspection.artifacts));
  }
}

export function printMachineResult<T>(command: string, data: T): void {
  writeJsonResult(command, data);
}

export function installSignalHandlers(controller: AbortController, runId: string): () => void {
  let cancellationRequested = false;
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (!cancellationRequested) {
      cancellationRequested = true;
      process.stderr.write(
        `\nCancellation requested for run ${runId}; waiting for the agent to stop. Press Ctrl-C again to force exit.\n`,
      );
      controller.abort();
      return;
    }

    process.stderr.write(`\nForce-exiting run ${runId}.\n`);
    process.exitCode = 130;
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    process.kill(process.pid, signal);
  };
  const onSigint = (): void => handleSignal('SIGINT');
  const onSigterm = (): void => handleSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  return () => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  };
}

export function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function friendlyEventMessage(message: string): string {
  const stepMessage = message.match(/^Step \S+ (.+)$/);
  if (stepMessage) return stepMessage[1]!;
  return message
    .replace(/^Pi tool_execution_start/, 'tool started')
    .replace(/^Pi tool_execution_end/, 'tool completed');
}

function printAgentResponse(response: string): void {
  const lines = response.trim().slice(0, 4_000).split(/\r?\n/);
  console.log('    response:');
  for (const line of lines) console.log(`      ${line}`);
  if (response.trim().length > 4_000) console.log('      [response truncated]');
}

function printNextAction(run: WorkflowRun, steps: StepRun[]): void {
  if (run.status === 'failed' && steps.some((step) => step.error?.retryable)) {
    console.log(`  next=binaflow resume ${run.id}`);
    return;
  }
  if (run.status === 'waiting') {
    console.log(
      `  next=binaflow approve ${run.id}  or  binaflow reject ${run.id} --feedback "..."`,
    );
    return;
  }
  if (
    run.status === 'interrupted' &&
    steps.some(
      (step) =>
        step.status === 'pending' ||
        step.status === 'interrupted' ||
        (step.status === 'failed' && step.error?.retryable === true),
    )
  ) {
    console.log(`  next=binaflow resume ${run.id}`);
    return;
  }
  if (run.status === 'failed' || run.status === 'interrupted' || run.status === 'cancelled') {
    console.log(`  next=binaflow show ${run.id}`);
    return;
  }
  if (
    run.status === 'completed' &&
    steps.some(
      (step) =>
        step.disposition?.kind === 'stop' && step.disposition.code === 'PLAN_NEEDS_CLARIFICATION',
    )
  ) {
    console.log('  next=run again with an objective that answers the clarification questions');
  }
}

export function workflowDisplayLabel(workflowId: string): string {
  const summary = workflowSummaries.find((item) => item.id === workflowId);
  return summary?.experimental ? `${workflowId} [Experimental]` : workflowId;
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
