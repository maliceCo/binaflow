export interface TerminalInput {
  on(event: 'data' | 'end', listener: (chunk?: Buffer) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'data' | 'end', listener: (chunk?: Buffer) => void): this;
  off(event: 'error', listener: (error: unknown) => void): this;
  pause?(): this;
  resume(): this;
  setRawMode?(enabled: boolean): this;
}

export interface TerminalOutput {
  on(event: 'resize', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'resize', listener: () => void): this;
  off(event: 'error', listener: (error: unknown) => void): this;
  write(chunk: string): boolean;
}

export interface TerminalSessionHandlers {
  onData: (chunk?: Buffer) => void;
  onEnd: () => void;
  onInputError: (error: unknown) => void;
  onOutputError: (error: unknown) => void;
  onResize: () => void;
  onSigint: () => void;
  onSigterm: () => void;
}

const ENTER_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l';
const LEAVE_SCREEN = '\x1b[?25h\x1b[?1049l';

export function createTerminalSession(
  input: TerminalInput,
  output: TerminalOutput,
  handlers: TerminalSessionHandlers,
): { start(): void; cleanup(): unknown } {
  let cleaned = false;

  const safely = (action: () => void, error: { value?: unknown }): void => {
    try {
      action();
    } catch (caught) {
      error.value ??= caught;
    }
  };

  return {
    start(): void {
      input.on('error', handlers.onInputError);
      output.on('error', handlers.onOutputError);
      output.write(ENTER_SCREEN);
      input.setRawMode?.(true);
      input.resume();
      input.on('data', handlers.onData);
      input.on('end', handlers.onEnd);
      output.on('resize', handlers.onResize);
      process.on('SIGINT', handlers.onSigint);
      process.on('SIGTERM', handlers.onSigterm);
    },
    cleanup(): unknown {
      if (cleaned) return;
      cleaned = true;
      const error: { value?: unknown } = {};
      safely(() => input.pause?.(), error);
      safely(() => input.off('data', handlers.onData), error);
      safely(() => input.off('end', handlers.onEnd), error);
      safely(() => output.off('resize', handlers.onResize), error);
      safely(() => process.off('SIGINT', handlers.onSigint), error);
      safely(() => process.off('SIGTERM', handlers.onSigterm), error);
      safely(() => input.setRawMode?.(false), error);
      safely(() => output.write(LEAVE_SCREEN), error);
      safely(() => input.off('error', handlers.onInputError), error);
      safely(() => output.off('error', handlers.onOutputError), error);
      return error.value;
    },
  };
}
