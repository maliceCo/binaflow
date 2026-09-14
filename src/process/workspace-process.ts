import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { signalProcessTree, waitForExit } from './process-tree.js';
import type {
  WorkspaceCommandOptions,
  WorkspaceCommandResult,
} from '../application/guided-execution.js';

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 1_000;

export class WorkspaceProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private exitPromise: Promise<void> | undefined;
  private resolveExit: (() => void) | undefined;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private closed = false;

  async run(
    command: string,
    args: readonly string[],
    options: WorkspaceCommandOptions,
  ): Promise<WorkspaceCommandResult> {
    if (this.child) throw new Error('WorkspaceProcess can only run once');
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('workspace command timeoutMs must be a positive integer');
    }

    const outputLimit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isInteger(outputLimit) || outputLimit <= 0) {
      throw new Error('workspace command maxOutputBytes must be a positive integer');
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let failure: Error | undefined;
    let timer: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;

    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });

    try {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      child.stdin.destroy();
      this.child = child;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (truncated) return;
      const remaining = outputLimit - outputBytes;
      if (chunk.byteLength > remaining) {
        const accepted = chunk.subarray(0, Math.max(0, remaining));
        if (target === 'stdout') stdout += accepted.toString('utf8');
        else stderr += accepted.toString('utf8');
        outputBytes = outputLimit;
        truncated = true;
        void this.terminate(true).catch((error) => {
          failure ??= error instanceof Error ? error : new Error(String(error));
        });
        return;
      }
      outputBytes += chunk.byteLength;
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    const child = this.child;
    if (!child) throw new Error('workspace process failed to start');
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
    });
    child.on('close', () => {
      this.closed = true;
      this.resolveExit?.();
    });

    const terminate = (): void => {
      void this.terminate(false).catch((error) => {
        failure ??= error instanceof Error ? error : new Error(String(error));
      });
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    if (options.signal) {
      abortHandler = () => {
        aborted = true;
        terminate();
      };
      if (options.signal.aborted) abortHandler();
      else options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    await this.exitPromise;
    if (timer) clearTimeout(timer);
    if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);

    return {
      command,
      args: [...args],
      exitCode: this.exitCode,
      signal: this.exitSignal,
      stdout,
      stderr,
      truncated,
      timedOut,
      aborted,
      ok: !failure && !truncated && !timedOut && !aborted && this.exitCode === 0,
      ...(failure ? { error: failure.message } : {}),
    };
  }

  private async terminate(force: boolean): Promise<void> {
    const child = this.child;
    const exit = this.exitPromise;
    if (!child || !exit || this.closed) return;
    await signalProcessTree(child, force);
    if (await waitForExit(exit, TERMINATION_GRACE_MS)) return;
    if (!force) {
      await signalProcessTree(child, true);
      if (await waitForExit(exit, TERMINATION_GRACE_MS)) return;
    }
    if (!this.closed) throw new Error('workspace process did not terminate');
  }
}

export async function runWorkspaceCommand(
  command: string,
  args: readonly string[],
  options: WorkspaceCommandOptions,
): Promise<WorkspaceCommandResult> {
  return new WorkspaceProcess().run(command, args, options);
}

export function createWorkspaceCommandRunner(): {
  run(
    command: string,
    args: readonly string[],
    options: WorkspaceCommandOptions,
  ): Promise<WorkspaceCommandResult>;
} {
  return { run: runWorkspaceCommand };
}
