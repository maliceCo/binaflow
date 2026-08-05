import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactStore } from '../src/artifacts/artifact-store.js';
import type { AgentProfile } from '../src/config.js';
import type { WorkflowEngine } from '../src/core/engine.js';
import type { WorkflowRun } from '../src/core/run.js';
import type { RunStore } from '../src/storage/run-store.js';
import type { ApplicationContext } from '../src/application/operations.js';
import { runTui, type TuiInput, type TuiOutput } from '../src/tui/app.js';

describe('attached TUI setup and launch', () => {
  const directories: string[] = [];

  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('offers first-run setup and writes only after confirmation', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-setup-');
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
    });
    await waitFor(terminal.output, 'setup required');

    send(terminal.input, '\r\r');
    await waitFor(terminal.output, 'Planner provider');
    for (const answer of ['provider-a', 'planner-model', 'provider-b', 'builder-model', 'n']) {
      send(terminal.input, `${answer}\r`);
    }
    await waitFor(terminal.output, 'Review configuration');
    expect(terminal.output.text()).toContain('"workspaceMode": "read-only"');
    expect(terminal.output.text()).toContain('Builder permissions');
    expect(terminal.output.text()).toContain('Nothing has been written yet.');
    expect(await fileExists(join(directory, '.binaflow', 'config.json'))).toBe(false);

    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Configuration written; readiness requires attention.');
    expect(
      JSON.parse(await readFile(join(directory, '.binaflow', 'config.json'), 'utf8')),
    ).toMatchObject({
      profiles: {
        planner: { provider: 'provider-a', model: 'planner-model', workspaceMode: 'read-only' },
        builder: { provider: 'provider-b', model: 'builder-model', workspaceMode: 'read-only' },
      },
    });
    send(terminal.input, 'q');
    await running;
  });

  it('does not overwrite an existing configuration', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-existing-');
    const configPath = join(directory, '.binaflow', 'config.json');
    const original = JSON.stringify({ profiles: {}, piCommand: process.execPath });
    await mkdir(join(directory, '.binaflow'), { recursive: true });
    await writeFile(configPath, original);
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
    });
    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, 'jjj\r');
    await waitFor(terminal.output, 'will not overwrite');
    expect(await readFile(configPath, 'utf8')).toBe(original);
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('labels experimental workflows and explains missing profiles', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-catalog-');
    await writeConfig(directory, {
      piCommand: process.execPath,
      profiles: { planner: profile('planner') },
    });
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Stable');
    expect(terminal.output.text()).toContain('Stable');
    expect(terminal.output.text()).toContain('Experimental');
    expect(terminal.output.text()).toContain('research-plan-build [Experimental]');
    expect(terminal.output.text()).toContain('missing: builder');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Missing profiles: builder');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('corrects invalid input and can cancel before creating a run', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-input-');
    await writeConfig(directory, {
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder') },
    });
    const execute = vi.fn(async () => completedRun());
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
      applicationContext: applicationContext(execute),
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, '\r\r');
    await waitFor(terminal.output, 'plan-build input');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'objective is required');
    send(terminal.input, 'Improve the workflow\r');
    await waitFor(terminal.output, 'Confirm workflow');
    expect(execute).not.toHaveBeenCalled();
    send(terminal.input, 'jj\r');
    await waitFor(terminal.output, 'Workflow launch cancelled.');
    expect(execute).not.toHaveBeenCalled();
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('shows write permissions and requires confirmation before launching', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-write-');
    await writeConfig(directory, {
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder', true) },
    });
    const execute = vi.fn(async () => completedRun());
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
      applicationContext: applicationContext(execute),
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, '\r\r');
    await waitFor(terminal.output, 'plan-build input');
    send(terminal.input, 'Implement the change\r');
    await waitFor(terminal.output, 'WARNING: this workflow can modify');
    expect(terminal.output.text()).toContain('[WRITE/SHELL]');
    expect(execute).not.toHaveBeenCalled();
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Run run-1 finished with status Completed.');
    expect(execute).toHaveBeenCalledTimes(1);
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('requires renewed confirmation when a reviewed profile becomes write-capable', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-profile-review-');
    await writeConfig(directory, {
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder') },
    });
    const execute = vi.fn(async () => completedRun());
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
      applicationContext: applicationContext(execute),
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, '\r\rImplement the change\r');
    await waitFor(terminal.output, 'Confirm workflow');
    const configPath = join(directory, '.binaflow', 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      profiles: Record<string, AgentProfile>;
    };
    config.profiles.builder = profile('builder', true);
    await writeFile(configPath, JSON.stringify(config));

    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Profile permissions or settings changed');
    expect(execute).not.toHaveBeenCalled();
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Run run-1 finished with status Completed.');
    expect(execute).toHaveBeenCalledTimes(1);
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });

  it('does not leave a workflow running after quitting the attached TUI', async () => {
    const directory = await temporaryDirectory(directories, 'binaflow-tui-attached-run-');
    await writeConfig(directory, {
      piCommand: process.execPath,
      profiles: { planner: profile('planner'), builder: profile('builder', true) },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<WorkflowRun>((resolve) => {
      release = () => resolve(completedRun());
    });
    const execute = vi.fn(async () => gate);
    const terminal = createTerminal();
    const running = runTui({
      cwd: directory,
      input: terminal.input,
      output: terminal.output,
      env: {},
      applicationContext: applicationContext(execute),
    });

    await waitFor(terminal.output, 'New workflow');
    send(terminal.input, '\r\r');
    await waitFor(terminal.output, 'plan-build input');
    send(terminal.input, 'Implement the change\r');
    await waitFor(terminal.output, 'WARNING: this workflow can modify');
    send(terminal.input, '\r');
    await waitFor(terminal.output, 'Starting plan-build');
    send(terminal.input, 'q');
    await waitFor(terminal.output, 'Workflow is still running');
    expect(execute).toHaveBeenCalledTimes(1);

    release();
    await waitFor(terminal.output, 'Run run-1 finished with status Completed.');
    send(terminal.input, 'q');
    send(terminal.input, 'q');
    await running;
  });
});

class FakeInput extends EventEmitter implements TuiInput {
  isTTY = true;
  resume(): this {
    return this;
  }
  setRawMode(): this {
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
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

function send(input: FakeInput, value: string): void {
  for (const character of value) input.emit('data', Buffer.from(character));
}

async function waitFor(output: FakeOutput, text: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !output.text().includes(text); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(output.text()).toContain(text);
}

async function temporaryDirectory(directories: string[], prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function writeConfig(
  directory: string,
  config: { piCommand: string; profiles: Record<string, AgentProfile> },
): Promise<void> {
  await mkdir(join(directory, '.binaflow'), { recursive: true });
  await writeFile(join(directory, '.binaflow', 'config.json'), JSON.stringify(config));
}

function profile(model: string, writeAccess = false): AgentProfile {
  return {
    driver: 'pi',
    model,
    provider: 'provider',
    tools: writeAccess ? ['ls', 'find', 'read', 'write', 'edit', 'bash'] : ['ls', 'find', 'read'],
    workspaceMode: writeAccess ? 'read-write' : 'read-only',
    projectTrust: writeAccess ? 'always' : 'never',
    timeoutMs: 1_000,
    retryLimit: 0,
  };
}

function applicationContext(execute: WorkflowEngine['execute']): ApplicationContext {
  return {
    config: { profiles: { planner: profile('planner'), builder: profile('builder', true) } },
    store: {} as RunStore,
    artifacts: {} as ArtifactStore,
    engine: { execute } as WorkflowEngine,
  };
}

function completedRun(): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Implement the change',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
