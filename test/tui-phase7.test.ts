import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile } from '../src/config.js';
import type { NormalizedEvent } from '../src/core/events.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
import type { ApplicationContext } from '../src/application/operations.js';
import type { ApplicationRuntimeContext } from '../src/application/runtime.js';
import type { RunStore } from '../src/storage/run-store.js';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import { runTui, type TuiInput, type TuiOutput } from '../src/tui/app.js';
import {
  renderCompletion,
  renderLive,
  sanitizeTerminalText,
  type CompletionViewModel,
  type LiveViewModel,
} from '../src/tui/render.js';

describe('attached TUI live execution and completion', () => {
  const directories: string[] = [];

  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('renders completion and failure details with usage and semantic artifacts', () => {
    const completed = step('plan', 'completed', {
      text: '{}',
      usage: { totalTokens: 12 },
      costUsd: 0.004,
    });
    const failed = step('build', 'failed', undefined, {
      message: 'builder failed',
      retryable: false,
    });
    const model: CompletionViewModel = {
      run: run('failed'),
      steps: [completed, failed, step('unused', 'skipped')],
      artifacts: [
        {
          id: 'artifact-1',
          runId: 'run-1',
          stepId: 'plan',
          name: 'plan',
          kind: 'json',
          path: 'plan.json',
          mediaType: 'application/json',
          sizeBytes: 2,
        },
      ],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:03.000Z',
      selected: 3,
      width: 120,
      height: 40,
      colors: false,
    };
    const screen = renderCompletion(model);
    expect(screen).toContain('Status:    Failed');
    expect(screen).toContain('Duration:  3s');
    expect(screen).toContain('12 tokens');
    expect(screen).toContain('cost=$0.0040');
    expect(screen).toContain('plan.plan');
    expect(screen).toContain('builder failed');
    expect(screen).toContain('Return home');
  });

  it('shows live status, steps, tool activity, and sanitized messages', () => {
    const model: LiveViewModel = {
      run: run('running'),
      workflow: {
        id: 'plan-build',
        version: 1,
        description: 'Plan and build',
        input: { required: ['objective'], properties: { objective: { type: 'string' } } },
        requiredProfiles: ['planner', 'builder'],
        steps: [
          { id: 'plan', profile: 'planner', dependsOn: [], outputs: [] },
          { id: 'build', profile: 'builder', dependsOn: ['plan'], outputs: [] },
        ],
      },
      steps: [
        { id: 'plan', status: 'running' },
        { id: 'build', status: 'pending' },
      ],
      activity: [
        {
          type: 'status',
          stepId: 'plan',
          message: 'Pi tool_execution_start tool=read',
          occurredAt: '2026-01-01T00:00:01.000Z',
        },
        {
          type: 'text',
          stepId: 'plan',
          message: '\u001b[31magent output\u001b[0m',
          occurredAt: '2026-01-01T00:00:02.000Z',
        },
      ],
      startedAt: '2026-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:04.000Z',
      detail: true,
      cancellationRequested: false,
      width: 120,
      height: 40,
      colors: false,
    };
    const screen = renderLive(model);
    expect(screen).toMatch(/plan\s+running/);
    expect(screen).toContain('tool started tool=read');
    expect(screen).toContain('agent output');
    expect(screen).not.toContain('\u001b[31m');
    expect(sanitizeTerminalText('\u001b]0;title\u0007safe\u0007')).toBe('saf e'.replace(' ', ''));
    expect(sanitizeTerminalText('before\u0085after')).toBe('beforeafter');
  });

  it('requests graceful cancellation without leaving the attached run', async () => {
    const directory = await temporaryDirectory('binaflow-tui-cancel-');
    await writeConfig(directory);
    const terminal = createTerminal();
    let emitEvent: ((event: NormalizedEvent) => void) | undefined;
    let resolveRun: ((run: WorkflowRun) => void) | undefined;
    let aborted = false;
    const result = new Promise<WorkflowRun>((resolve) => {
      resolveRun = resolve;
    });
    const context = executionContext(
      async (_workflow, request) => {
        await request.onRunStarted?.(run('running'));
        request.signal?.addEventListener('abort', () => {
          aborted = true;
          emitEvent?.(event('error', 'active agent error'));
        });
        return result;
      },
      (listener) => {
        emitEvent = listener;
      },
    );
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await startWorkflow(terminal);
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Cancellation requested');
    expect(aborted).toBe(true);
    expect(terminal.output.text()).toContain('Workflow is still running');
    resolveRun?.(run('cancelled'));
    await waitFor(terminal.output, 'Status:    Cancelled');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
    expect(terminal.output.text()).toContain('\x1b[?1049l');
  });

  it('force-cancels on the second request and restores the terminal', async () => {
    const directory = await temporaryDirectory('binaflow-tui-force-');
    await writeConfig(directory);
    const terminal = createTerminal();
    const forceExit = vi.fn();
    const context = executionContext(async (_workflow, request) => {
      await request.onRunStarted?.(run('running'));
      return new Promise<WorkflowRun>(() => {
        request.signal?.addEventListener('abort', () => undefined);
      });
    });
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
      forceExit,
    });
    await startWorkflow(terminal);
    send(terminal.input, 'qq');
    await running;
    expect(forceExit).toHaveBeenCalledWith('SIGINT');
    expect(terminal.input.rawMode).toEqual([true, false]);
    expect(terminal.output.text()).toContain('\x1b[?1049l');
  });

  it('escalates a second OS signal while workflow startup is still pending', async () => {
    const directory = await temporaryDirectory('binaflow-tui-startup-signal-');
    await writeConfig(directory);
    const terminal = createTerminal();
    const forceExit = vi.fn();
    const context = executionContext(async () => new Promise<WorkflowRun>(() => undefined));
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
        applicationContext: context,
        forceExit,
      });
      await waitFor(terminal.output, 'New workflow');
      send(terminal.input, '\r\rRun the workflow\r\r');
      await waitFor(terminal.output, 'Starting plan-build');
      process.emit('SIGINT');
      await waitFor(terminal.output, 'Workflow is still running');
      process.emit('SIGINT');
      await running;
      expect(forceExit).toHaveBeenCalledWith('SIGINT');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('cleans up owned context only after active work settles on input termination', async () => {
    const directory = await temporaryDirectory('binaflow-tui-input-shutdown-');
    await writeConfig(directory);
    for (const failure of ['end', 'input-error', 'output-error'] as const) {
      const terminal = createTerminal();
      let resolveExecution: ((run: WorkflowRun) => void) | undefined;
      let aborted = false;
      let closed = false;
      const execution = new Promise<WorkflowRun>((resolve) => {
        resolveExecution = resolve;
      });
      const context = executionContext(async (_workflow, request) => {
        await request.onRunStarted?.(run('running'));
        request.signal?.addEventListener('abort', () => {
          aborted = true;
        });
        return execution;
      });
      const ownedContext = {
        ...context,
        close: () => {
          closed = true;
        },
      } as unknown as ApplicationRuntimeContext;
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
        openApplicationContext: async () => ownedContext,
      });
      await startWorkflow(terminal);
      if (failure === 'end') terminal.input.emit('end');
      else if (failure === 'input-error') terminal.input.emit('error', new Error('input failed'));
      else terminal.output.emit('error', new Error('output failed'));
      await new Promise((resolve) => setImmediate(resolve));
      expect(aborted).toBe(true);
      expect(closed).toBe(false);
      resolveExecution?.(run('cancelled'));
      if (failure === 'end') await running;
      else
        await expect(running).rejects.toThrow(
          failure === 'input-error' ? 'input failed' : 'output failed',
        );
      expect(closed).toBe(true);
    }
  });

  it('cleans up before self-signalling for default force-cancel', async () => {
    const directory = await temporaryDirectory('binaflow-tui-self-force-');
    await writeConfig(directory);
    const terminal = createTerminal();
    const context = executionContext(async (_workflow, request) => {
      await request.onRunStarted?.(run('running'));
      return new Promise<WorkflowRun>(() => {
        request.signal?.addEventListener('abort', () => undefined);
      });
    });
    const previousExitCode = process.exitCode;
    const listenerCount = process.listenerCount('SIGINT');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      expect(terminal.input.rawMode).toEqual([true, false]);
      expect(terminal.output.text()).toContain('\x1b[?1049l');
      expect(process.listenerCount('SIGINT')).toBe(listenerCount);
      return true;
    });
    try {
      process.exitCode = undefined;
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
        applicationContext: context,
      });
      await startWorkflow(terminal);
      send(terminal.input, 'qq');
      await running;
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
      expect(process.exitCode).toBe(130);
    } finally {
      kill.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it('keeps large displayed activity bounded and redraws after live resize', async () => {
    const directory = await temporaryDirectory('binaflow-tui-stream-');
    await writeConfig(directory);
    const terminal = createTerminal();
    let emitEvent: ((event: NormalizedEvent) => void) | undefined;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = executionContext(
      async (_workflow, request) => {
        await request.onRunStarted?.(run('running'));
        for (let index = 0; index < 1_000; index += 1) {
          emitEvent?.(event('status', `event-${index}`));
        }
        await gate;
        return run('completed');
      },
      (listener) => {
        emitEvent = listener;
      },
    );
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: { NO_COLOR: '' },
      applicationContext: context,
    });
    await startWorkflow(terminal);
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    terminal.output.emit('resize');
    expect(terminal.output.text()).toContain('Terminal too small');
    terminal.output.columns = 120;
    terminal.output.rows = 40;
    terminal.output.emit('resize');
    send(terminal.input, 'd');
    expect(terminal.output.last()).toContain('event-800');
    expect(terminal.output.last()).not.toContain('event-0');
    release?.();
    await waitFor(terminal.output, 'Status:    Completed');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });
});

class FakeInput extends EventEmitter implements TuiInput {
  isTTY = true;
  rawMode: boolean[] = [];
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
}

class FakeOutput extends EventEmitter implements TuiOutput {
  isTTY = true;
  columns = 120;
  rows = 40;
  private chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
  last(): string {
    return this.chunks[this.chunks.length - 1] ?? '';
  }
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

function send(input: FakeInput, value: string): void {
  for (const character of value) input.emit('data', Buffer.from(character));
}

async function startWorkflow(terminal: { input: FakeInput; output: FakeOutput }): Promise<void> {
  await waitFor(terminal.output, 'New workflow');
  send(terminal.input, '\r\rRun the workflow\r\r');
  await waitFor(terminal.output, 'Live workflow');
}

async function waitFor(output: FakeOutput, text: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !output.text().includes(text); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(output.text()).toContain(text);
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return directory;
}

async function writeConfig(directory: string): Promise<void> {
  await mkdir(join(directory, '.binaflow'), { recursive: true });
  await writeFile(
    join(directory, '.binaflow', 'config.json'),
    JSON.stringify({
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder') },
    }),
  );
}

function executionContext(
  execute: WorkflowEngine['execute'],
  setListener?: (listener: (event: NormalizedEvent) => void) => void,
): ApplicationContext {
  return {
    config: { profiles: { planner: profile('planner'), builder: profile('builder') } },
    store: {
      getStepRuns: async () => [],
      getArtifacts: async () => [],
      countEvents: async () => 0,
    } as unknown as RunStore,
    artifacts: {} as ArtifactStore,
    engine: { execute } as WorkflowEngine,
    subscribeEvents: (listener) => {
      setListener?.(listener);
      return () => undefined;
    },
  };
}

function profile(model: string): AgentProfile {
  return {
    driver: 'pi',
    model,
    provider: 'provider',
    tools: ['ls', 'read'],
    workspaceMode: 'read-only',
    projectTrust: 'never',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function run(status: WorkflowRun['status']): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Run the workflow',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:03.000Z',
  };
}

function event(type: NormalizedEvent['type'], message: string): NormalizedEvent {
  return { runId: 'run-1', stepId: 'plan', type, message, occurredAt: new Date().toISOString() };
}

function step(
  stepId: string,
  status: StepRun['status'],
  result?: StepRun['result'],
  error?: StepRun['error'],
): StepRun {
  return {
    runId: 'run-1',
    stepId,
    profile: 'planner',
    status,
    attempt: 1,
    ...(result ? { result } : {}),
    ...(error ? { error: { ...error, retryable: false } } : {}),
  };
}
