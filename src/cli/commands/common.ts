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
import type { NormalizedEvent } from '../../core/events.js';
import {
  machineMode,
  runEventRecord,
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
        writeJsonl(runEventRecord(++eventSequence, event));
      }
    },
  });
  return {
    application: application.application,
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
        `    error=${phase.error.code ?? 'UNKNOWN'}  retryable=${phase.error.retryable}  ${phase.error.message}`,
      );
    }
    if (phase.skipReason) {
      console.log(`    skipped=${phase.skipReason.code}  ${phase.skipReason.message}`);
    }
    if (phase.approval?.decision) {
      console.log(
        `    approval=${phase.approval.decision}${phase.approval.feedback ? `  ${phase.approval.feedback}` : ''}`,
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
): Promise<void> {
  const inspection = await context.application.inspectRun(run.id, { includeStepResults: true });
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
  const summary = workflowSummaries.find((item) => item.id === workflowId);
  return summary?.experimental ? `${workflowId} [Experimental]` : workflowId;
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
