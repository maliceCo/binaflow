import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { WorkflowRun } from '../src/core/run.js';
import type { RunStore } from '../src/storage/run-store.js';
import type { ApplicationContext } from '../src/application/operations.js';
import { runInkShell } from '../src/tui-ink/shell.js';

const testDirectories: string[] = [];

describe('Ink setup and launch safety', () => {
  afterEach(async () => {
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

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('Setup required');
    expect(terminal.output.text()).toContain('No configuration was found at the displayed path.');
    terminal.input.push('\r');
    await terminal.output.waitFor('Planner provider');
    const answers = ['provider-a', 'planner-model', 'provider-b', 'builder-model', 'no'];
    const nextFields = [
      'Planner model',
      'Builder provider',
      'Builder model',
      'Builder permissions',
      'Review configuration',
    ];
    for (let index = 0; index < answers.length; index += 1) {
      const answer = answers[index]!;
      terminal.input.push(answer);
      await terminal.output.waitFor(answer);
      terminal.input.push('\r');
      await terminal.output.waitFor(nextFields[index]!);
    }
    await terminal.output.waitFor('Review configuration');
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

  it('groups workflows, explains missing profiles, and cancels before execution', async () => {
    const directory = await temporaryDirectory('binaflow-ink-workflows-');
    await writeConfig(directory, { planner: profile('planner') });
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

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build');
    expect(terminal.output.text()).toContain('research-plan-build [Experimental]');
    expect(terminal.output.text()).toContain('missing: builder');
    terminal.input.push('\r');
    await terminal.output.waitFor('Missing profiles: builder');
    expect(execute).not.toHaveBeenCalled();
    terminal.input.push('q');
    await terminal.output.waitFor('Read documentation');
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

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('Setup required');
    terminal.input.push('\r');
    await terminal.output.waitFor('Planner provider');
    const answers = ['provider-a', 'planner-model', 'provider-b', 'builder-model', 'no'];
    const nextFields = [
      'Planner model',
      'Builder provider',
      'Builder model',
      'Builder permissions',
      'Review configuration',
    ];
    for (let index = 0; index < answers.length; index += 1) {
      terminal.input.push(answers[index]!);
      await terminal.output.waitFor(answers[index]!);
      terminal.input.push('\r');
      await terminal.output.waitFor(nextFields[index]!);
    }
    const configPath = join(directory, '.binaflow', 'config.json');
    const original = '{"profiles":{},"piCommand":"pi"}';
    await mkdir(join(directory, '.binaflow'), { recursive: true });
    await writeFile(configPath, original);
    terminal.input.push('\r');
    await terminal.output.waitFor('Configuration already exists at');
    expect(await readFile(configPath, 'utf8')).toBe(original);
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

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build input');
    terminal.input.push('\r');
    await terminal.output.waitFor('objective is required');
    terminal.input.push('Implement the change');
    await terminal.output.waitFor('Implement the change');
    terminal.input.push('\r');
    await terminal.output.waitFor('WARNING: this workflow can modify');
    expect(execute).not.toHaveBeenCalled();
    terminal.input.push('j');
    await terminal.output.waitFor('Edit objective');
    terminal.input.push('j');
    await terminal.output.waitFor('> Cancel');
    terminal.input.push('\r');
    await terminal.output.waitFor('Workflow launch cancelled.');
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

    await terminal.output.waitFor('New workflow');
    await terminal.input.waitUntilReady();
    terminal.input.push('k');
    await terminal.output.waitFor('> New workflow');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build');
    terminal.input.push('\r');
    await terminal.output.waitFor('plan-build input');
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
    await terminal.output.waitFor('> New workflow');
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

function applicationContext(execute: ReturnType<typeof vi.fn>): ApplicationContext {
  return {
    config: { profiles: { planner: profile('planner'), builder: profile('builder', true) } },
    store: {} as RunStore,
    artifacts: {} as ArtifactStore,
    engine: { execute } as unknown as WorkflowEngine,
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
