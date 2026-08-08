import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { runInkFoundation } from '../src/tui/bootstrap.js';

describe('Ink foundation', () => {
  it('refuses non-TTY streams before rendering', async () => {
    const terminal = createTerminal();
    terminal.input.isTTY = false;

    await expect(
      runInkFoundation({
        input: terminal.input as unknown as NodeJS.ReadStream,
        output: terminal.output as unknown as NodeJS.WriteStream,
      }),
    ).rejects.toThrow('interactive terminal');
    expect(terminal.output.text()).toBe('');
  });

  it('handles input, normal unmount, alternate screen, and raw mode cleanup', async () => {
    const terminal = createTerminal();
    const running = start(terminal);
    await terminal.output.waitFor('Binaflow Ink foundation');
    await terminal.input.waitUntilReady();

    terminal.input.push('q');
    await running;

    expect(terminal.input.rawMode).toEqual([true, false]);
    expect(terminal.output.text()).toContain('\u001b[?1049h');
    expect(terminal.output.text()).toContain('\u001b[?1049l');
  });

  it('reacts to resize and shows a minimum-size fallback', async () => {
    const terminal = createTerminal();
    terminal.output.columns = 40;
    terminal.output.rows = 8;
    const running = start(terminal);
    await terminal.output.waitFor('Terminal too small');
    await terminal.input.waitUntilReady();
    await terminal.output.waitUntilReady();

    terminal.output.columns = 80;
    terminal.output.rows = 24;
    const previousChunkCount = terminal.output.chunkCount();
    terminal.output.emit('resize');
    await terminal.output.waitForMoreThan(previousChunkCount);
    expect(stripAnsi(terminal.output.text())).toContain('Terminal too small');
    terminal.input.push('q');
    await running;
  });

  it('does not render color when NO_COLOR is present', async () => {
    const terminal = createTerminal();
    const running = start(terminal, { NO_COLOR: '' });
    await terminal.output.waitFor('Binaflow Ink foundation');
    await terminal.input.waitUntilReady();

    expect(terminal.output.text()).not.toContain('\u001b[36m');
    terminal.input.push('q');
    await running;
  });

  it('restores the terminal and rejects after a stream error', async () => {
    const terminal = createTerminal();
    const running = start(terminal);
    await terminal.output.waitFor('Binaflow Ink foundation');
    await terminal.input.waitUntilReady();

    terminal.output.emit('error', new Error('output failed'));
    await expect(running).rejects.toThrow('output failed');
    expect(terminal.input.rawMode).toEqual([true, false]);
    expect(terminal.output.text()).toContain('\u001b[?1049l');
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('handles %s after unmounting safely', async (signal, exitCode) => {
    const terminal = createTerminal();
    const previousExitCode = process.exitCode;
    const running = start(terminal);
    try {
      await terminal.output.waitFor('Binaflow Ink foundation');
      await terminal.input.waitUntilReady();
      process.exitCode = undefined;
      process.emit(signal);
      await running;

      expect(process.exitCode).toBe(exitCode);
      expect(terminal.input.rawMode).toEqual([true, false]);
      expect(terminal.output.text()).toContain('\u001b[?1049l');
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

class FakeInput extends EventEmitter {
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

  setEncoding(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
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

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.emit('readable');
  }

  private readonly chunks: string[] = [];

  read(): string | null {
    return this.chunks.shift() ?? null;
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

  chunkCount(): number {
    return this.chunks.length;
  }

  async waitFor(value: string): Promise<void> {
    for (let attempt = 0; attempt < 1000 && !stripAnsi(this.text()).includes(value); attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(stripAnsi(this.text())).toContain(value);
  }

  async waitForMoreThan(count: number): Promise<void> {
    for (let attempt = 0; attempt < 1000 && this.chunkCount() <= count; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(this.chunkCount()).toBeGreaterThan(count);
  }

  async waitUntilReady(): Promise<void> {
    for (let attempt = 0; attempt < 1000 && this.listenerCount('resize') < 2; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(this.listenerCount('resize')).toBeGreaterThanOrEqual(2);
  }
}

function createTerminal(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

function start(
  terminal: ReturnType<typeof createTerminal>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return runInkFoundation({
    input: terminal.input as unknown as NodeJS.ReadStream,
    output: terminal.output as unknown as NodeJS.WriteStream,
    errorOutput: terminal.output as unknown as NodeJS.WriteStream,
    ...(env ? { env } : {}),
  });
}

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  return value
    .replace(new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'g'), '')
    .replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}
