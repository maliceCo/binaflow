import type { ApplicationService } from '../src/application/service.js';
import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowRun } from '../src/core/run.js';
import { runInkShell } from '../src/tui/shell.js';
import * as configOperations from '../src/application/config-operations.js';

const testDirectories: string[] = [];

describe('Ink setup and launch safety', () => {
  beforeEach(() => {
    vi.spyOn(configOperations, 'discoverSetupModels').mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of testDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes first-run setup only after review and confirmation', async () => {
    const directory = await temporaryDirectory('binaflow-ink-setup-');
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await acceptWelcome(terminal);
    await terminal.output.waitFor('Step 1 of 4');
    expect(configOperations.discoverSetupModels).toHaveBeenCalled();
    terminal.input.push('\r');
    await terminal.output.waitFor('Step 2 of 4: planner');
    const answers = ['provider-a', 'planner-model', 'provider-b', 'builder-model', 'no'];
    const nextFields = [
      'Planner model',
      'Builder provider',
      'Builder model',
      'Builder permissions',
      'Step 4 of 4',
    ];
    for (let index = 0; index < answers.length; index += 1) {
      const answer = answers[index]!;
      await terminal.input.waitUntilReady();
      terminal.input.push('\x7f'.repeat(100));
      terminal.input.push(answer);
      await terminal.output.waitFor(answer);
      terminal.input.push('\r');
      await settleInput();
      await terminal.input.waitUntilReady();
      await terminal.output.waitFor(nextFields[index]!);
    }
    await terminal.output.waitFor('Step 4 of 4');
    expect(terminal.output.text()).toContain('Nothing has been written yet.');
    await expect(fileExists(join(directory, '.binaflow', 'config.json'))).resolves.toBe(false);
    terminal.input.push('\r');
    await terminal.output.waitFor('Configuration written. Review diagnosis before launching.');
    expect(
      JSON.parse(await readFile(join(directory, '.binaflow', 'config.json'), 'utf8')),
    ).toMatchObject({
      profiles: {
        planner: { provider: 'provider-a', model: 'planner-model', workspaceMode: 'read-only' },
        builder: { provider: 'provider-b', model: 'builder-model', workspaceMode: 'read-only' },
      },
    });
    terminal.input.push('q');
    await running;
  });

  it('does not overwrite a configuration created before setup confirmation', async () => {
    const directory = await temporaryDirectory('binaflow-ink-existing-');
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await acceptWelcome(terminal);
    await terminal.output.waitFor('Step 1 of 4');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('Step 2 of 4: planner');
    const answers = ['provider-a', 'planner-model', 'provider-b', 'builder-model', 'no'];
    const nextFields = [
      'Planner model',
      'Builder provider',
      'Builder model',
      'Builder permissions',
      'Step 4 of 4',
    ];
    for (let index = 0; index < answers.length; index += 1) {
      await terminal.input.waitUntilReady();
      terminal.input.push('\x7f'.repeat(100));
      terminal.input.push(answers[index]!);
      await terminal.output.waitFor(answers[index]!);
      terminal.input.push('\r');
      await settleInput();
      await terminal.input.waitUntilReady();
      await terminal.output.waitFor(nextFields[index]!);
    }
    const configPath = join(directory, '.binaflow', 'config.json');
    const original = '{"profiles":{},"piCommand":"pi"}';
    await mkdir(join(directory, '.binaflow'), { recursive: true });
    await writeFile(configPath, original);
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('Configuration already exists at');
    expect(await readFile(configPath, 'utf8')).toBe(original);
    terminal.input.push('q');
    await terminal.output.waitFor('BINAFLOW');
    terminal.input.push('q');
    await running;
  }, 10_000);

  it('uses manual text input when Pi discovery has no models', async () => {
    const directory = await temporaryDirectory('binaflow-ink-setup-fallback-');
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
    });

    await acceptWelcome(terminal);
    await terminal.output.waitFor('Step 1 of 4');
    terminal.input.push('\r');
    await terminal.output.waitFor('Step 2 of 4: planner');
    terminal.input.push('manual-provider');
    await terminal.output.waitFor('manual-provider');
    terminal.input.push('\r');
    await terminal.output.waitFor('Planner model');
    terminal.input.push('manual-model');
    await terminal.output.waitFor('manual-model');
    terminal.input.push('\r');
    await terminal.output.waitFor('Step 3 of 4: builder');
    terminal.input.push('manual-provider');
    await terminal.output.waitFor('manual-provider');
    terminal.input.push('\r');
    await terminal.output.waitFor('Builder model');
    terminal.input.push('manual-builder');
    await terminal.output.waitFor('manual-builder');
    terminal.input.push('\r');
    await terminal.output.waitFor('Builder permissions');
    terminal.input.push('no');
    await terminal.output.waitFor('no');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('Step 4 of 4');
    expect(terminal.output.text()).toContain('Nothing has been written yet.');
    terminal.input.push('q');
    await terminal.output.waitFor('BINAFLOW');
    terminal.input.push('q');
    await running;
  });

  it('corrects required input and requires review before write-capable launch', async () => {
    const directory = await temporaryDirectory('binaflow-ink-launch-');
    await writeConfig(directory, {
      planner: profile('planner'),
      builder: profile('builder', true),
    });
    const execute = vi.fn(async () => completedRun());
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: applicationContext(execute),
    });

    await waitForStudio(terminal);
    terminal.input.push('n');
    await terminal.output.waitFor('plan-build');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build input');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('objective is required');
    terminal.input.push('qImplement the change');
    await terminal.output.waitFor('qImplement the change');
    terminal.input.push('\r');
    await terminal.output.waitFor('WARNING: this workflow can modify');
    expect(execute).not.toHaveBeenCalled();
    terminal.input.push('q');
    await terminal.output.waitFor('Configuration readiness');
    expect(execute).not.toHaveBeenCalled();
    terminal.input.push('q');
    await running;
  });

  it('invalidates confirmation when reviewed profile settings change', async () => {
    const directory = await temporaryDirectory('binaflow-ink-review-');
    await writeConfig(directory, { planner: profile('planner'), builder: profile('builder') });
    const execute = vi.fn(async () => completedRun());
    const terminal = createTerminal();
    const running = runInkShell({
      cwd: directory,
      input: terminal.input as unknown as NodeJS.ReadStream,
      output: terminal.output as unknown as NodeJS.WriteStream,
      errorOutput: terminal.output as unknown as NodeJS.WriteStream,
      env: { NO_COLOR: '' },
      applicationContext: applicationContext(execute),
    });

    await waitForStudio(terminal);
    terminal.input.push('n');
    await terminal.output.waitFor('plan-build');
    await terminal.input.waitUntilReady();
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build input');
    await terminal.input.waitUntilReady();
    terminal.input.push('Implement the change');
    await terminal.output.waitFor('Implement the change');
    terminal.input.push('\r');
    await terminal.output.waitFor('Confirm workflow');
    const configPath = join(directory, '.binaflow', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      profiles: Record<string, AgentProfile>;
    };
    config.profiles.builder = profile('builder', true);
    await writeFile(configPath, JSON.stringify(config));
    terminal.input.push('\r');
    await terminal.output.waitFor('Profile permissions or settings changed');
    expect(execute).not.toHaveBeenCalled();
    terminal.input.push('q');
    await terminal.output.waitFor('Workspace status');
    terminal.input.push('q');
    await running;
  });
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

async function acceptWelcome(terminal: ReturnType<typeof createTerminal>): Promise<void> {
  await terminal.output.waitFor('BINAFLOW');
  await terminal.input.waitUntilReady();
  terminal.input.push('\r');
  await terminal.input.waitUntilReady();
}

async function waitForStudio(terminal: ReturnType<typeof createTerminal>): Promise<void> {
  await acceptWelcome(terminal);
  await terminal.output.waitFor('Configuration readiness');
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

  async waitFor(value: string): Promise<void> {
    for (let attempt = 0; attempt < 200 && !this.text().includes(value); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(this.text()).toContain(value);
  }
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

async function settleInput(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  testDirectories.push(directory);
  return directory;
}

async function writeConfig(
  directory: string,
  profiles: Record<string, AgentProfile>,
): Promise<void> {
  await mkdir(join(directory, '.binaflow'), { recursive: true });
  await writeFile(
    join(directory, '.binaflow', 'config.json'),
    JSON.stringify({ dataDir: './data', piCommand: process.execPath, profiles }),
  );
}

function profile(name: string, write = false): AgentProfile {
  return {
    driver: 'pi',
    provider: 'provider',
    model: name,
    tools: write ? ['ls', 'find', 'read', 'write', 'edit', 'bash'] : ['ls', 'find', 'read'],
    workspaceMode: write ? 'read-write' : 'read-only',
    projectTrust: write ? 'always' : 'never',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function applicationContext(execute: ReturnType<typeof vi.fn>): ApplicationService {
  const profiles = { planner: profile('planner'), builder: profile('builder', true) };
  return {
    profiles,
    close: () => undefined,
    subscribeEvents: () => () => undefined,
    runWorkflow: async (request: {
      workflowId: string;
      objective: string;
      input: Record<string, unknown>;
      runId?: string;
      signal?: AbortSignal;
      onRunStarted?: (run: WorkflowRun) => void;
    }) =>
      execute(
        { version: 1, id: request.workflowId, input: { required: [], properties: {} }, steps: [] },
        {
          objective: request.objective,
          input: request.input,
          profiles,
          ...(request.runId ? { runId: request.runId } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
        },
      ),
    resumeWorkflow: async () => ({ run: completedRun(), alreadyCompleted: false }),
    decideApproval: async () => completedRun(),
    inspectRun: async () => ({
      run: completedRun(),
      steps: [],
      artifacts: [],
      eventCount: 0,
    }),
    listRuns: async () => ({ runs: [] }),
    readArtifact: async () => {
      throw new Error('not implemented');
    },
    explainRunRecovery: async () => ({
      eligible: false,
      reason: 'not implemented',
      completedStepIds: [],
      retryableStepIds: [],
      workflowVersionCompatible: true,
      actions: [],
    }),
    markRunInterrupted: async () => completedRun(),
    clarificationQuestions: async () => [],
    loadResearchApprovalPreviews: async () => [],
    discoverWorkflows: () => [],
    discoverModels: async () => [],
    diagnoseConfiguration: () => ({ configuredProfiles: [], workflows: [] }),
  };
}

function completedRun(): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Implement the change',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
