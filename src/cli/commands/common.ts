import { mkdir } from 'node:fs/promises';
import type { Command } from 'commander';
import { FileArtifactStore } from '../../artifacts/file-artifact-store.js';
import { loadConfig, type BinaflowConfig } from '../../config.js';
import { WorkflowEngine } from '../../core/engine.js';
import type { EventSink } from '../../core/events.js';
import type { StepRun, WorkflowRun } from '../../core/run.js';
import { PiDriver } from '../../drivers/pi-rpc.js';
import { SqliteRunStore } from '../../storage/sqlite-run-store.js';

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

export async function openContext(rootOptions: RootOptions): Promise<CliContext> {
  const cwd = rootOptions.cwd ?? process.cwd();
  const config = await loadConfig(rootOptions.config ?? '.binaflow/config.json', cwd);
  await mkdir(config.dataDir, { recursive: true });
  const store = new SqliteRunStore(`${config.dataDir}/runs.db`);
  const artifacts = new FileArtifactStore(`${config.dataDir}/artifacts`);
  const eventSink: EventSink | undefined = rootOptions.verbose
    ? (event) => {
        if (event.type === 'text') {
          process.stderr.write(event.message);
        } else {
          process.stderr.write(`\n[${event.stepId}] ${event.type}: ${event.message}\n`);
        }
      }
    : undefined;
  const engine = new WorkflowEngine(
    store,
    artifacts,
    new PiDriver({ command: config.piCommand, cwd }),
    eventSink,
  );
  return { config, store, artifacts, engine, close: () => store.close() };
}

export function rootOptions(command: Command): RootOptions {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts<RootOptions>();
}

export function printRunSummary(run: WorkflowRun, steps: StepRun[], config: BinaflowConfig): void {
  console.log(`Run ${run.id}  workflow=${run.workflowId}  status=${run.status}`);
  for (const step of steps) {
    const profile = config.profiles[step.profile];
    const duration = step.startedAt
      ? `${durationMs(step.startedAt, step.finishedAt ?? new Date().toISOString())}ms`
      : '-';
    const usage =
      step.result?.usage?.totalTokens === undefined
        ? '-'
        : `${step.result.usage.totalTokens} tokens`;
    console.log(
      `  ${step.stepId}  profile=${step.profile}  driver=${profile?.driver ?? '-'}  model=${profile?.model ?? '-'}  status=${step.status}  duration=${duration}  usage=${usage}`,
    );
    if (step.error) {
      console.log(
        `    error=${step.error.code ?? 'UNKNOWN'}  retryable=${step.error.retryable}  ${step.error.message}`,
      );
    }
    if (step.skipReason) {
      console.log(`    skipped=${step.skipReason.code}  ${step.skipReason.message}`);
    }
  }
}

export function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

export function requirePlanBuild(workflowId: string): 'plan-build' {
  if (workflowId !== 'plan-build') throw new Error(`Unknown workflow: ${workflowId}`);
  return 'plan-build';
}
