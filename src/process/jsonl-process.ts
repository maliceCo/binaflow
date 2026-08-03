import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';

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

type MessageListener = (message: JsonObject) => void;
type StderrListener = (chunk: string) => void;

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
  private stdoutBuffer = '';
  private stderrText = '';
  private closed = false;

  constructor(options: JsonlProcessOptions) {
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.readStdout(this.decoder.write(chunk)));
    this.child.stdout.on('end', () => this.readStdout(this.decoder.end(), true));
    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrText = `${this.stderrText}${text}`.slice(-MAX_STDERR_BYTES);
      for (const listener of this.stderrListeners) listener(text);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.fail(
          new Error(`JSONL process exited (${code ?? 'unknown'}, ${signal ?? 'no signal'})`),
        );
      }
    });
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
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }

  private readStdout(chunk: string, final = false): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      let line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.readLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
    if (final && this.stdoutBuffer.length > 0) {
      const line = this.stdoutBuffer.endsWith('\r')
        ? this.stdoutBuffer.slice(0, -1)
        : this.stdoutBuffer;
      this.stdoutBuffer = '';
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
    for (const listener of this.messageListeners) listener(message);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    const details = this.stderrText
      ? `${error.message}; stderr: ${this.stderrText.trim()}`
      : error.message;
    this.rejectPending(new Error(details));
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
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

const MAX_STDERR_BYTES = 64 * 1024;
