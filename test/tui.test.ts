import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import * as configOperations from '../src/application/config-operations.js';
import { runTui, parseKeys, type TuiInput, type TuiOutput } from '../src/tui/app.js';
import {
  moveSelection,
  renderHome,
  renderMinimumSize,
  renderSetupPrompt,
} from '../src/tui/render.js';

describe('attached TUI foundation', () => {
  it('renders a color-free home screen and wraps navigation', () => {
    const screen = renderHome({
      workspacePath: 'C:/workspace',
      configPath: 'C:/workspace/.binaflow/config.json',
      configExists: false,
      configValid: false,
      ready: false,
      selectedAction: 0,
      width: 80,
      height: 24,
      colors: false,
    });

    expect(screen).toContain('Binaflow');
    expect(screen).toContain('New workflow');
    expect(screen).toContain('[!] setup required');
    expect(screen).not.toContain('\x1b[');
    expect(moveSelection(0, -1)).toBe(4);
    expect(moveSelection(4, 1)).toBe(0);
  });

  it('parses keyboard navigation and provides a minimum-size fallback', () => {
    expect(parseKeys(Buffer.from('\x1b[A\x1b[B\x1bOA\x1bOB\rjrq'))).toEqual([
      'up',
      'down',
      'up',
      'down',
      'select',
      'down',
      'refresh',
      'quit',
    ]);
    const parser = { pending: '' };
    expect(parseKeys(Buffer.from('\x1b['), parser)).toEqual([]);
    expect(parseKeys(Buffer.from('A'), parser)).toEqual(['up']);
    const ss3Parser = { pending: '' };
    expect(parseKeys(Buffer.from('\x1bO'), ss3Parser)).toEqual([]);
    expect(parseKeys(Buffer.from('B'), ss3Parser)).toEqual(['down']);
    expect(renderMinimumSize()).toContain('Terminal too small');
  });

  it('ignores split escape sequences and preserves split UTF-8 in text prompts', async () => {
    const directory = await temporaryDirectory('binaflow-tui-text-input-');
    try {
      const terminal = createTerminal();
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      terminal.input.emit('data', Buffer.from('\r\r'));
      for (
        let attempt = 0;
        attempt < 100 && !terminal.output.text().includes('Planner provider');
        attempt += 1
      )
        await new Promise((resolve) => setImmediate(resolve));
      terminal.input.emit('data', Buffer.from('\u001b'));
      terminal.input.emit('data', Buffer.from('['));
      terminal.input.emit('data', Buffer.from('A'));
      terminal.input.emit('data', Buffer.from('caf'));
      terminal.input.emit('data', Buffer.from([0xc3]));
      terminal.input.emit('data', Buffer.from([0xa9]));
      expect(terminal.output.text()).toContain('café');
      expect(terminal.output.text()).not.toContain('café[A');
      terminal.input.emit('data', Buffer.from('\r'));
      for (
        let attempt = 0;
        attempt < 100 && !terminal.output.text().includes('Planner model');
        attempt += 1
      )
        await new Promise((resolve) => setImmediate(resolve));
      expect(terminal.output.text()).toContain('Planner model');
      terminal.input.emit('data', Buffer.from('\u001b'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      terminal.input.emit('data', Buffer.from('q'));
      await running;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps raw Ctrl-C distinct from q', () => {
    expect(parseKeys(Buffer.from('q\u0003'))).toEqual(['quit', 'interrupt']);
  });

  it('exits idle with code 130 for raw Ctrl-C', async () => {
    const directory = await temporaryDirectory('binaflow-tui-ctrl-c-');
    const previousExitCode = process.exitCode;
    try {
      const terminal = createTerminal();
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      process.exitCode = undefined;
      terminal.input.emit('data', Buffer.from('\u0003'));
      await running;
      expect(process.exitCode).toBe(130);
    } finally {
      process.exitCode = previousExitCode;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores actions below the minimum terminal size until resize recovery', async () => {
    const directory = await temporaryDirectory('binaflow-tui-minimum-size-input-');
    try {
      const terminal = createTerminal();
      terminal.output.columns = 40;
      terminal.output.rows = 8;
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      const before = terminal.output.text();
      terminal.input.emit('data', Buffer.from('j\rr'));
      expect(terminal.output.text()).toBe(before);
      terminal.output.columns = 80;
      terminal.output.rows = 24;
      terminal.output.emit('resize');
      expect(terminal.output.text()).toContain('New workflow');
      terminal.input.emit('data', Buffer.from('q'));
      await running;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('sanitizes dynamic paths and errors without color output', () => {
    const path = 'C:/workspace\u001b]0;injected\u0007\nnext';
    const home = renderHome({
      workspacePath: path,
      configPath: path,
      configExists: true,
      configValid: false,
      ready: false,
      selectedAction: 0,
      statusMessage: 'bad\u001b[31m status',
      width: 100,
      height: 24,
      colors: false,
    });
    const prompt = renderSetupPrompt({
      title: 'Input',
      explanation: 'Explain',
      prompt: 'Value: ',
      value: 'value',
      error: 'failed\u001b[2J\nnext',
      width: 100,
      height: 24,
      colors: false,
    });
    expect(home).not.toContain('\u001b');
    expect(home).not.toContain('injected');
    expect(home).not.toContain('\nnext');
    expect(prompt).not.toContain('\u001b');
    expect(prompt).not.toContain('\nnext');
  });

  it('honors NO_COLOR without disabling terminal control sequences', async () => {
    const directory = await temporaryDirectory('binaflow-tui-no-color-');
    try {
      const terminal = createTerminal();
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '1' },
      });
      await waitForInitialRender(terminal.output);
      expect(terminal.output.text()).not.toMatch(/\x1b\[[0-9;]*m/);
      expect(terminal.output.text()).toContain('\x1b[?1049h');
      terminal.input.emit('data', Buffer.from('q'));
      await running;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores the terminal on normal exit and SIGINT', async () => {
    const directory = await temporaryDirectory('binaflow-tui-exit-');
    const previousExitCode = process.exitCode;
    try {
      const first = createTerminal();
      const running = runTui({
        cwd: directory,
        input: first.input,
        output: first.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(first.output);
      first.input.emit('data', Buffer.from('q'));
      await running;
      expect(first.input.rawMode).toEqual([true, false]);
      expect(first.input.pauseCount).toBe(1);
      expect(first.output.text()).toContain('\x1b[?1049h');
      expect(first.output.text()).toContain('\x1b[?1049l');

      const second = createTerminal();
      const signalRun = runTui({
        cwd: directory,
        input: second.input,
        output: second.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(second.output);
      process.exitCode = undefined;
      process.emit('SIGINT');
      await signalRun;
      expect(second.input.rawMode).toEqual([true, false]);
      expect(second.input.pauseCount).toBe(1);
      expect(process.exitCode).toBe(130);

      const third = createTerminal();
      const termRun = runTui({
        cwd: directory,
        input: third.input,
        output: third.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(third.output);
      process.exitCode = undefined;
      process.emit('SIGTERM');
      await termRun;
      expect(third.input.pauseCount).toBe(1);
      expect(process.exitCode).toBe(143);
    } finally {
      process.exitCode = previousExitCode;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores the terminal when input or output reports an error', async () => {
    const directory = await temporaryDirectory('binaflow-tui-stream-error-');
    try {
      const inputError = createTerminal();
      const inputRun = runTui({
        cwd: directory,
        input: inputError.input,
        output: inputError.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(inputError.output);
      inputError.input.emit('error', new Error('input failed'));
      await expect(inputRun).rejects.toThrow('input failed');
      expect(inputError.input.pauseCount).toBe(1);
      expect(inputError.input.rawMode).toEqual([true, false]);
      expect(inputError.output.text()).toContain('\x1b[?1049l');

      const outputError = createTerminal();
      const outputRun = runTui({
        cwd: directory,
        input: outputError.input,
        output: outputError.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(outputError.output);
      const outputFailure = expect(outputRun).rejects.toThrow('output failed');
      outputError.output.emit('error', new Error('output failed'));
      await outputFailure;
      expect(outputError.input.pauseCount).toBe(1);
      expect(outputError.input.rawMode).toEqual([true, false]);
      expect(outputError.output.text()).toContain('\x1b[?1049l');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not render a refresh result after the TUI has finished', async () => {
    const directory = await temporaryDirectory('binaflow-tui-refresh-');
    try {
      const terminal = createTerminal();
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      terminal.input.emit('data', Buffer.from('rq'));
      await running;
      const finishedText = terminal.output.text();
      await new Promise((resolve) => setImmediate(resolve));
      expect(terminal.output.text()).toBe(finishedText);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('coalesces refresh requests while one diagnosis is running', async () => {
    const directory = await temporaryDirectory('binaflow-tui-refresh-queue-');
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const originalDiagnose = configOperations.diagnoseConfigurationFile;
    let diagnosisCalls = 0;
    const diagnose = vi
      .spyOn(configOperations, 'diagnoseConfigurationFile')
      .mockImplementation(async (configPath, cwd) => {
        diagnosisCalls += 1;
        const result = await originalDiagnose(configPath, cwd);
        if (diagnosisCalls > 1) await refreshGate;
        return result;
      });
    let running: Promise<void> | undefined;
    try {
      const terminal = createTerminal();
      running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      terminal.input.emit('data', Buffer.from('rrr'));
      await new Promise((resolve) => setImmediate(resolve));
      expect(diagnosisCalls).toBe(2);
      releaseRefresh();
      await new Promise((resolve) => setImmediate(resolve));
      expect(diagnosisCalls).toBe(2);
      terminal.input.emit('data', Buffer.from('q'));
      await running;
    } finally {
      releaseRefresh();
      if (running) await running.catch(() => undefined);
      diagnose.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores the terminal when setup fails and rejects non-TTY use', async () => {
    const directory = await temporaryDirectory('binaflow-tui-error-');
    try {
      const failing = createTerminal(true);
      await expect(
        runTui({ cwd: directory, input: failing.input, output: failing.output }),
      ).rejects.toThrow('input setup failed');
      expect(failing.input.rawMode).toEqual([true, false]);
      expect(failing.output.text()).toContain('\x1b[?1049l');

      const nonTty = createTerminal();
      nonTty.input.isTTY = false;
      await expect(runTui({ input: nonTty.input, output: nonTty.output })).rejects.toThrow(
        'requires an interactive terminal',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('redraws after a terminal resize', async () => {
    const directory = await temporaryDirectory('binaflow-tui-resize-');
    try {
      const terminal = createTerminal();
      const running = runTui({
        cwd: directory,
        input: terminal.input,
        output: terminal.output,
        env: { NO_COLOR: '' },
      });
      await waitForInitialRender(terminal.output);
      terminal.output.columns = 40;
      terminal.output.rows = 8;
      terminal.output.emit('resize');
      expect(terminal.output.text()).toContain('Terminal too small');
      terminal.input.emit('data', Buffer.from('q'));
      await running;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class FakeInput extends EventEmitter implements TuiInput {
  isTTY = true;
  rawMode: boolean[] = [];
  pauseCount = 0;
  constructor(private readonly failOnData = false) {
    super();
  }

  override on(event: string, listener: Parameters<EventEmitter['on']>[1]): this {
    if (event === 'data' && this.failOnData) throw new Error('input setup failed');
    return super.on(event, listener);
  }

  resume(): this {
    return this;
  }

  pause(): this {
    this.pauseCount += 1;
    return this;
  }

  setRawMode(enabled: boolean): this {
    this.rawMode.push(enabled);
    return this;
  }
}

class FakeOutput extends EventEmitter implements TuiOutput {
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
}

function createTerminal(failOnData = false): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(failOnData), output: new FakeOutput() };
}

async function waitForInitialRender(output: FakeOutput): Promise<void> {
  for (let attempt = 0; attempt < 1000 && !output.text().includes('Binaflow'); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(output.text()).toContain('Binaflow');
}

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
