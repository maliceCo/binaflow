import { mkdir } from 'node:fs/promises';
import type { Command } from 'commander';
import { FileArtifactStore } from '../../artifacts/file-artifact-store.js';
import { loadConfig, type BinaflowConfig } from '../../config.js';
import { WorkflowEngine } from '../../core/engine.js';
import type { EventSink } from '../../core/events.js';
import type { StepRun, WorkflowRun } from '../../core/run.js';
import { PiDriver } from '../../drivers/pi-rpc.js';
import { SqliteRunStore } from '../../storage/sqlite-run-store.js';
import type { NormalizedEvent } from '../../core/events.js';
import type { WorkflowDefinition } from '../../core/workflow.js';

export interface RootOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
}

export interface CliContext {
  config: BinaflowConfig;
  store: SqliteRunStore;
  artifacts: FileArtifactStore;
  engine: WorkflowEngine;
  close(): void;
}

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
  const cwd = rootOptions.cwd ?? process.cwd();
  const config = await loadConfig(rootOptions.config ?? '.binaflow/config.json', cwd);
  await mkdir(config.dataDir, { recursive: true });
  const store = new SqliteRunStore(`${config.dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${config.dataDir}/artifacts`);
  const presenter = new CliEventPresenter(rootOptions.verbose);
  const eventSink: EventSink = async (event) => {
    await store.saveEvent(event);
    presenter.present(event);
  };
  const engine = new WorkflowEngine(
    store,
    artifacts,
    new PiDriver({ command: config.piCommand, cwd }),
    eventSink,
  );
  return {
    config,
    store,
    artifacts,
    engine,
    close: () => {
      presenter.flush();
      store.close();
    },
  };
}

export function rootOptions(command: Command): RootOptions {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts<RootOptions>();
}

export function validateWorkflowProfiles(
  workflow: WorkflowDefinition,
  profiles: BinaflowConfig['profiles'],
): void {
  const required = [...new Set(workflow.steps.map((step) => step.profile))];
  const missing = required.filter((profile) => !profiles[profile]);
  if (missing.length > 0) {
    throw new Error(
      `Missing agent profile(s): ${missing.join(', ')}. Add them to .binaflow/config.json`,
    );
  }
}

export function printRunSummary(run: WorkflowRun, steps: StepRun[], config: BinaflowConfig): void {
  console.log(`Run ${run.id}  workflow=${run.workflowId}  status=${run.status}`);
  console.log(`  objective=${singleLine(run.objective, 240)}`);
  console.log(`  created=${run.createdAt}  updated=${run.updatedAt}`);
  let totalTokens = 0;
  let totalCost = 0;
  let hasTokens = false;
  let hasCost = false;
  for (const step of steps) {
    const profile = config.profiles[step.profile];
    const duration = step.startedAt
      ? `${durationMs(step.startedAt, step.finishedAt ?? new Date().toISOString())}ms`
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
      `  ${step.stepId}  profile=${step.profile}  driver=${profile?.driver ?? '-'}  model=${profile?.model ?? '-'}  status=${step.status}  attempt=${step.attempt}  duration=${duration}  usage=${usage}  cost=${cost}`,
    );
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
    run.status === 'completed' &&
    steps.some(
      (step) =>
        step.disposition?.kind === 'stop' && step.disposition.code === 'PLAN_NEEDS_CLARIFICATION',
    )
  ) {
    console.log('  next=run again with an objective that answers the clarification questions');
  }
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
