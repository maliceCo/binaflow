import { render } from 'ink';
import type { ReactNode } from 'react';

export interface InkApplicationOptions {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  errorOutput?: NodeJS.WriteStream;
  env?: NodeJS.ProcessEnv;
  onSignal?: (signal: NodeJS.Signals) => boolean | void;
}

export interface InkApplicationContext {
  colors: boolean;
  size: { columns: number; rows: number };
}

export async function runInkApplication(
  options: InkApplicationOptions,
  createRoot: (context: InkApplicationContext) => ReactNode,
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;

  if (input.isTTY !== true || output.isTTY !== true) {
    throw new Error('The Ink foundation requires an interactive terminal');
  }

  const colors = (options.env ?? process.env).NO_COLOR === undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let instance: ReturnType<typeof render> | undefined;
  let streamFailure: unknown;
  const onResize = () => {
    if (instance) instance.rerender(createRoot({ colors, size: terminalSize(output) }));
  };

  const onStreamError = (error: unknown) => {
    streamFailure = error;
    instance?.unmount();
  };
  input.on('error', onStreamError);
  output.on('error', onStreamError);
  if (errorOutput !== output) errorOutput.on('error', onStreamError);

  try {
    instance = render(createRoot({ colors, size: terminalSize(output) }), {
      stdin: input,
      stdout: output,
      stderr: errorOutput,
      interactive: true,
      alternateScreen: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    output.on('resize', onResize);

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => {
        process.exitCode = signal === 'SIGINT' ? 130 : 143;
        if (options.onSignal?.(signal)) return;
        instance?.unmount();
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    await instance.waitUntilExit();
    if (streamFailure !== undefined) throw streamFailure;
  } finally {
    input.off('error', onStreamError);
    output.off('error', onStreamError);
    if (errorOutput !== output) errorOutput.off('error', onStreamError);
    output.off('resize', onResize);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}

function terminalSize(output: NodeJS.WriteStream): { columns: number; rows: number } {
  return { columns: output.columns || 80, rows: output.rows || 24 };
}
