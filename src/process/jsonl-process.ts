import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

export const MAX_JSONL_RECORD_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const PROCESS_TERMINATION_GRACE_MS = 1_000;

export type JsonObject = Record<string, unknown>;

export interface JsonlProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface JsonlRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

type MessageListener = (message: JsonObject) => void | Promise<void>;
type StderrListener = (chunk: string) => void | Promise<void>;

interface PendingRequest {
  resolve: (message: JsonObject) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  cleanup?: () => void;
}

export class JsonlProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly messageListeners = new Set<MessageListener>();
  private readonly stderrListeners = new Set<StderrListener>();
  private readonly decoder = new StringDecoder('utf8');
  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;
  private stdoutBuffer = '';
  private stdoutBufferBytes = 0;
  private stderrText = '';
  private closed = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  constructor(options: JsonlProcessOptions) {
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.readStdout(this.decoder.write(chunk)));
    this.child.stdout.on('end', () => this.readStdout(this.decoder.end(), true));
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrText = `${this.stderrText}${text}`.slice(-MAX_STDERR_BYTES);
      for (const listener of this.stderrListeners) {
        try {
          this.handleListenerResult(listener(text), 'stderr');
        } catch (error) {
          this.fail(listenerError('stderr', error));
          return;
        }
      }
    });
    this.child.on('error', (error) => {
      this.fail(error);
      this.resolveExit();
    });
    this.child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.resolveExit();
      if (!this.closed) {
        this.fail(
          new Error(`JSONL process exited (${code ?? 'unknown'}, ${signal ?? 'no signal'})`),
        );
      }
    });
  }

  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.exitPromise.then(() => ({
      code: this.exitCode ?? this.child.exitCode,
      signal: this.exitSignal ?? this.child.signalCode,
    }));
  }

  get stderr(): string {
    return this.stderrText;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStderr(listener: StderrListener): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  send(message: JsonObject): void {
    if (this.closed) throw new Error('Cannot write to a closed JSONL process');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(message: JsonObject, options: JsonlRequestOptions = {}): Promise<JsonObject> {
    if (this.closed) return Promise.reject(new Error('Cannot request from a closed JSONL process'));
    const id = typeof message.id === 'string' ? message.id : randomUUID();
    const request = { ...message, id };

    return new Promise<JsonObject>((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      if (options.timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          pending.cleanup?.();
          reject(new Error(`JSONL request timed out: ${String(message.type ?? 'unknown')}`));
        }, options.timeoutMs);
      }
      if (options.signal) {
        const abort = () => {
          this.pending.delete(id);
          if (pending.timer) clearTimeout(pending.timer);
          reject(new Error('JSONL request cancelled'));
        };
        pending.cleanup = () => options.signal?.removeEventListener('abort', abort);
        if (options.signal.aborted) return abort();
        options.signal.addEventListener('abort', abort, { once: true });
      }
      this.pending.set(id, pending);
      try {
        this.send(request);
      } catch (error) {
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.cleanup?.();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async terminate(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.rejectPending(new Error('JSONL process terminated'));
      this.child.stdin.destroy();
    }
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill();
    await waitForExit(this.exitPromise, PROCESS_TERMINATION_GRACE_MS);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGKILL');
      await waitForExit(this.exitPromise, PROCESS_TERMINATION_GRACE_MS);
    }
  }

  private readStdout(chunk: string, final = false): void {
    if (chunk.length > 0) {
      this.stdoutBuffer += chunk;
      this.stdoutBufferBytes += Buffer.byteLength(chunk, 'utf8');
      if (this.stdoutBufferBytes > MAX_JSONL_RECORD_BYTES) {
        this.stdoutBuffer = '';
        this.stdoutBufferBytes = 0;
        this.fail(
          new Error(`JSONL record exceeded maximum size of ${MAX_JSONL_RECORD_BYTES} UTF-8 bytes`),
        );
        return;
      }
    }
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      let line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.stdoutBufferBytes = Buffer.byteLength(this.stdoutBuffer, 'utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.readLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
    if (final && this.stdoutBuffer.length > 0) {
      const line = this.stdoutBuffer.endsWith('\r')
        ? this.stdoutBuffer.slice(0, -1)
        : this.stdoutBuffer;
      this.stdoutBuffer = '';
      this.stdoutBufferBytes = 0;
      this.readLine(line);
    }
  }

  private readLine(line: string): void {
    if (!line) return;
    let message: JsonObject;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('JSONL record must be an object');
      }
      message = parsed as JsonObject;
    } catch (error) {
      this.fail(
        new Error(
          `Invalid JSONL output: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    const id = typeof message.id === 'string' ? message.id : undefined;
    const pending = id ? this.pending.get(id) : undefined;
    if (id && pending && message.type === 'response') {
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.cleanup?.();
      if (message.success === false) {
        pending.reject(new Error(String(message.error ?? 'JSONL request failed')));
      } else {
        pending.resolve(message);
      }
    }
    for (const listener of this.messageListeners) {
      try {
        this.handleListenerResult(listener(message), 'message');
      } catch (error) {
        this.fail(listenerError('message', error));
        return;
      }
    }
  }

  private handleListenerResult(result: void | Promise<void>, kind: 'message' | 'stderr'): void {
    if (result instanceof Promise) {
      void result.catch((error: unknown) => this.fail(listenerError(kind, error)));
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    const details = this.stderrText
      ? `${error.message}; stderr: ${this.stderrText.trim()}`
      : error.message;
    this.rejectPending(new Error(details));
    if (this.child.exitCode === null) this.child.kill();
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
  }
}

function listenerError(kind: 'message' | 'stderr', error: unknown): Error {
  return new Error(
    `JSONL ${kind} listener failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

async function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exit,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
