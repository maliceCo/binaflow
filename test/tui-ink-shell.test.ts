import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as configOperations from '../src/application/config-operations.js';
import { runInkShell } from '../src/tui-ink/shell.js';
import type { ConfigurationDiagnosis } from '../src/application/config-operations.js';
import type { ApplicationContext } from '../src/application/operations.js';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { NormalizedEvent } from '../src/core/events.js';
import type { WorkflowRun } from '../src/core/run.js';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import type { RunStore } from '../src/storage/run-store.js';

describe('Ink shell', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('navigates home, documentation, scrolling, and exit without legacy rendering', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await terminal.output.waitFor('Read documentation');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('Documentation');
    for (let index = 0; index < 10; index += 1) terminal.input.push('j');
    await terminal.output.waitFor('v more content');
    terminal.input.push('q');
    await terminal.output.waitFor('Read documentation');
    terminal.input.push('j');
    await terminal.output.waitFor('> Refresh diagnosis');
    terminal.input.push('j');
    await terminal.output.waitFor('> Run history');
    terminal.input.push('j');
    await terminal.output.waitFor('> Exit');
    terminal.input.push('\r');
    await running;

    expect(terminal.output.text()).not.toContain('\u001b[36m');
    expect(terminal.output.text()).toContain('\u001b[?1049l');
  });

  it('coalesces diagnosis refreshes and ignores a result after unmount', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    let calls = 0;
    let release: (value: ConfigurationDiagnosis) => void = () => undefined;
    const diagnosis = new Promise<ConfigurationDiagnosis>((resolve) => {
      release = resolve;
    });
    const result = createDiagnosis(directory);
    vi.spyOn(configOperations, 'diagnoseConfigurationFile').mockImplementation(async () => {
      calls += 1;
      return diagnosis;
    });

    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });
    await terminal.output.waitFor('Refresh diagnosis');
    await terminal.input.waitUntilReady();
    terminal.input.push('r');
    terminal.input.push('r');
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    terminal.input.push('q');
    await running;
    release(result);
    await new Promise((resolve) => setImmediate(resolve));
    expect(terminal.output.text()).toContain('Refresh diagnosis');
  });

  it('keeps an attached run live through activity, cancellation, and completion', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    let emitEvent: ((event: NormalizedEvent) => void) | undefined;
    let resolveExecution: ((run: WorkflowRun) => void) | undefined;
    const execute = vi.fn(
      async (
        _workflow: unknown,
        request: { signal?: AbortSignal; onRunStarted?: (run: WorkflowRun) => void },
      ) => {
        const running = createRun('running');
        request.onRunStarted?.(running);
        const result = new Promise<WorkflowRun>((resolve) => {
          resolveExecution = resolve;
        });
        request.signal?.addEventListener('abort', () => {
          setTimeout(() => resolveExecution?.(createRun('cancelled')), 100);
        });
        return result;
      },
    );
    const context = createApplicationContext(execute, (listener) => {
      emitEvent = listener;
    });
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build input');
    terminal.input.push('Run the workflow');
    await terminal.output.waitFor('Run the workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('Confirm workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('Workflow running');
    emitEvent?.({
      runId: 'run-1',
      stepId: 'plan',
      type: 'text',
      message: '\u001b[31magent output\u001b[0m',
      occurredAt: new Date().toISOString(),
    });
    await terminal.output.waitFor('agent output');
    terminal.input.push('q');
    await terminal.output.waitFor('Cancellation requested');
    await terminal.output.waitFor('Workflow complete');
    expect(execute).toHaveBeenCalledTimes(1);
    terminal.input.push('q');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('q');
    await running;
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)(
    'cancels safely when %s arrives while context startup is pending',
    async (signal, exitCode) => {
      const directory = await temporaryDirectory();
      await writeConfig(directory);
      const terminal = createTerminal();
      let releaseContext: ((context: ApplicationContext & { close(): void }) => void) | undefined;
      let contextRequested = false;
      let closed = false;
      const context = createApplicationContext(
        vi.fn(async () => createRun('completed')),
        () => undefined,
      );
      const ownedContext = { ...context, close: () => (closed = true) };
      const opening = new Promise<ApplicationContext & { close(): void }>((resolve) => {
        releaseContext = resolve;
      });
      const previousExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        const running = runInkShell({
          cwd: directory,
          input: terminal.input as unknown as NodeJS.ReadStream,
          output: terminal.output as unknown as NodeJS.WriteStream,
          errorOutput: terminal.output as unknown as NodeJS.WriteStream,
          env: { NO_COLOR: '' },
          openApplicationContext: async () => {
            contextRequested = true;
            return opening;
          },
        });
        await launchWorkflow(terminal, false);
        await waitForCondition(() => contextRequested);
        process.emit(signal);
        releaseContext?.(ownedContext);
        await running;

        expect(process.exitCode).toBe(exitCode);
        expect(closed).toBe(true);
      } finally {
        process.exitCode = previousExitCode;
      }
    },
  );

  it.each(['input', 'output'] as const)(
    'unsubscribes and settles active work before closing an owned context after an %s stream failure',
    async (stream) => {
      const directory = await temporaryDirectory();
      await writeConfig(directory);
      const terminal = createTerminal();
      const order: string[] = [];
      let resolveExecution: ((run: WorkflowRun) => void) | undefined;
      const execution = new Promise<WorkflowRun>((resolve) => {
        resolveExecution = resolve;
      });
      const context = createApplicationContext(
        async (_workflow, request) => {
          request.onRunStarted?.(createRun('running'));
          request.signal?.addEventListener('abort', () => order.push('aborted'));
          const run = await execution;
          order.push('settled');
          return run;
        },
        () => undefined,
      );
      const ownedContext = {
        ...context,
        close: () => order.push('closed'),
        subscribeEvents: () => () => order.push('unsubscribed'),
      };
      const running = runInkShell({
        cwd: directory,
        input: terminal.input as unknown as NodeJS.ReadStream,
        output: terminal.output as unknown as NodeJS.WriteStream,
        errorOutput: terminal.output as unknown as NodeJS.WriteStream,
        env: { NO_COLOR: '' },
        openApplicationContext: async () => ownedContext,
      });
      await launchWorkflow(terminal);
      if (stream === 'input') terminal.input.emit('error', new Error('input failed'));
      else terminal.output.emit('error', new Error('output failed'));
      await new Promise((resolve) => setImmediate(resolve));

      expect(order).toContain('aborted');
      expect(order).toContain('unsubscribed');
      expect(order).not.toContain('closed');
      resolveExecution?.(createRun('cancelled'));
      await expect(running).rejects.toThrow(`${stream} failed`);
      expect(order).toEqual(['unsubscribed', 'aborted', 'settled', 'closed']);
    },
  );

  it('restores the terminal before force signalling and leaves no active work after exit', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const terminal = createTerminal();
    let resolveExecution: ((run: WorkflowRun) => void) | undefined;
    let closed = false;
    const execution = new Promise<WorkflowRun>((resolve) => {
      resolveExecution = resolve;
    });
    const context = createApplicationContext(
      async (_workflow, request) => {
        request.onRunStarted?.(createRun('running'));
        request.signal?.addEventListener('abort', () => undefined);
        return execution;
      },
      () => undefined,
    );
    const forceExit = vi.fn(() => {
      expect(terminal.input.rawMode).toEqual([true, false]);
      expect(terminal.output.text()).toContain('\u001b[?1049l');
      resolveExecution?.(createRun('cancelled'));
    });
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      openApplicationContext: async () => ({ ...context, close: () => (closed = true) }),
      forceExit,
    });
    await launchWorkflow(terminal);
    terminal.input.push('q');
    await terminal.output.waitFor('Cancellation requested');
    terminal.input.push('q');
    await running;

    expect(forceExit).toHaveBeenCalledWith('SIGINT');
    expect(closed).toBe(true);
  });

  it('keeps the footer visible and redraws the shell after resize', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await terminal.output.waitFor('Enter select');
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    terminal.output.emit('resize');
    await terminal.output.waitFor('Terminal too small');
    terminal.output.columns = 80;
    terminal.output.rows = 24;
    terminal.output.emit('resize');
    await terminal.input.waitUntilReady();
    terminal.input.push('q');
    await running;
  });

  it('blocks hidden actions below minimum terminal size and only allows quit', async () => {
    const directory = await temporaryDirectory();
    const terminal = createTerminal();
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await terminal.output.waitFor('Terminal too small');
    await terminal.input.waitUntilReady();
    terminal.input.push('j');
    terminal.input.push('\r');
    terminal.input.push('r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.output.text()).toContain('Terminal too small');
    expect(terminal.output.text()).not.toContain('> Refresh diagnosis');
    terminal.input.push('q');
    await running;
  });

  it('opens bounded history and run detail through inspection operations', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const historical = createRun('completed');
    const getStepRuns = vi.fn(async (_runId: string, options?: { includeResult?: unknown }) => {
      expect(options?.includeResult === true).toBe(false);
      return [];
    });
    const context: ApplicationContext = {
      config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
      store: {
        listRunsPage: async () => ({ runs: [historical] }),
        getRun: async () => historical,
        getStepRuns,
        getArtifacts: async () => [],
        countEvents: async () => 0,
      } as unknown as RunStore,
      artifacts: {} as ArtifactStore,
      engine: {} as WorkflowEngine,
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('j');
    await terminal.output.waitFor('> Refresh diagnosis');
    terminal.input.push('j');
    await terminal.output.waitFor('> Run history');
    terminal.input.push('\r');
    await terminal.output.waitFor('Filters: status=all workflow=all');
    terminal.input.push('\r');
    await terminal.output.waitFor('Historical inspection');
    expect(terminal.output.text()).toContain('Persisted metadata only');
    expect(getStepRuns).toHaveBeenCalled();
    terminal.input.push('q');
    await terminal.output.waitFor('Filters: status=all workflow=all');
    terminal.input.push('q');
    await terminal.output.waitFor('Run history');
    terminal.input.push('q');
    await running;
  });

  it('shows approval message, bounded previews, and workspace warning while waiting', async () => {
    const directory = await temporaryDirectory();
    await writeConfig(directory);
    const waiting = {
      ...createRun('waiting'),
      id: 'run-wait-1',
      workflowId: 'research-plan-build',
      objective: 'Research objective',
    };
    const reportArtifact = {
      id: 'art-1',
      runId: waiting.id,
      stepId: 'research',
      name: 'report',
      kind: 'text' as const,
      path: 'report.txt',
      mediaType: 'text/plain',
      sizeBytes: 12,
    };
    const context: ApplicationContext = {
      config: {
        profiles: {
          planner: profile('planner'),
          builder: profile('builder'),
          researcher: profile('researcher'),
          'research-reviewer': profile('research-reviewer'),
        },
      },
      store: {
        listRunsPage: async () => ({ runs: [waiting] }),
        getRun: async () => waiting,
        getStepRuns: async () => [
          {
            runId: waiting.id,
            stepId: 'research',
            profile: 'researcher',
            status: 'completed',
            attempt: 1,
          },
          {
            runId: waiting.id,
            stepId: 'research-review',
            profile: 'research-reviewer',
            status: 'completed',
            attempt: 1,
          },
          {
            runId: waiting.id,
            stepId: 'research-approval',
            profile: 'research-reviewer',
            status: 'waiting',
            attempt: 1,
          },
        ],
        getArtifacts: async () => [reportArtifact],
        countEvents: async () => 0,
      } as unknown as RunStore,
      artifacts: {
        readBounded: async () => ({ content: 'bounded research preview', truncated: false }),
      } as unknown as ArtifactStore,
      engine: {} as WorkflowEngine,
    };
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('j');
    await terminal.output.waitFor('> Refresh diagnosis');
    terminal.input.push('j');
    await terminal.output.waitFor('> Run history');
    terminal.input.push('\r');
    await terminal.output.waitFor('Filters: status=all workflow=all');
    terminal.input.push('\r');
    await terminal.output.waitFor('Run detail');
    await terminal.output.waitFor('Approve research and continue');
    expect(terminal.output.text()).toContain('Review the research artifact');
    expect(terminal.output.text()).toContain('bounded research preview');
    expect(terminal.output.text()).toContain('can modify the workspace');
    terminal.input.push('q');
    await terminal.output.waitFor('Filters: status=all workflow=all');
    terminal.input.push('q');
    await terminal.output.waitFor('New workflow');
    terminal.input.push('q');
    await running;
  }, 15_000);
});

class FakeInput extends EventEmitter {
  isTTY = true;
  rawMode: boolean[] = [];
  private readonly chunks: string[] = [];

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  setRawMode(enabled: boolean): this {
    this.rawMode.push(enabled);
    return this;
  }

  setEncoding(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.emit('readable');
  }

  read(): string | null {
    return this.chunks.shift() ?? null;
  }

  async waitUntilReady(): Promise<void> {
    for (
      let attempt = 0;
      attempt < 1000 && (!this.rawMode.includes(true) || this.listenerCount('readable') === 0);
      attempt += 1
    ) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(this.rawMode).toContain(true);
    expect(this.listenerCount('readable')).toBeGreaterThan(0);
  }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  private readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  text(): string {
    return this.chunks.join('');
  }

  async waitFor(value: string, attempts = 200): Promise<void> {
    for (let attempt = 0; attempt < attempts && !this.text().includes(value); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(this.text()).toContain(value);
  }
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

async function launchWorkflow(
  terminal: ReturnType<typeof createTerminal>,
  waitForLive = true,
): Promise<void> {
  await terminal.output.waitFor('New workflow');
  await terminal.input.waitUntilReady();
  terminal.input.push('k');
  await terminal.output.waitFor('> New workflow');
  terminal.input.push('\r');
  await terminal.output.waitFor('plan-build');
  terminal.input.push('\r');
  await terminal.output.waitFor('plan-build input');
  terminal.input.push('Run the workflow');
  await terminal.output.waitFor('Run the workflow');
  terminal.input.push('\r');
  await terminal.output.waitFor('Confirm workflow');
  terminal.input.push('\r');
  if (waitForLive) await terminal.output.waitFor('Workflow running');
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-ink-shell-'));
  return directory;
}

async function writeConfig(directory: string): Promise<void> {
  await mkdir(join(directory, '.binaflow'), { recursive: true });
  await writeFile(
    join(directory, '.binaflow/config.json'),
    JSON.stringify({
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder') },
    }),
  );
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    provider: 'provider',
    model,
    tools: ['ls', 'find', 'read'],
    workspaceMode: 'read-only',
    projectTrust: 'never',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function createApplicationContext(
  execute: WorkflowEngine['execute'],
  subscribe: (listener: (event: NormalizedEvent) => void) => void,
): ApplicationContext {
  return {
    config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
    store: {} as RunStore,
    artifacts: {} as ArtifactStore,
    engine: { execute } as unknown as WorkflowEngine,
    subscribeEvents: (listener) => {
      subscribe(listener);
      return () => undefined;
    },
  };
}

function createRun(status: WorkflowRun['status']): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Run the workflow',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function createDiagnosis(workspacePath: string): ConfigurationDiagnosis {
  return {
    workspacePath,
    configPath: join(workspacePath, '.binaflow/config.json'),
    configExists: false,
    configValid: false,
    errors: [],
    profiles: [],
    workflows: [],
    ready: false,
  };
}
