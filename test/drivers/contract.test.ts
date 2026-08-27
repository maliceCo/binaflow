import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRequest } from '../../src/core/agent.js';
import type { NormalizedEvent } from '../../src/core/events.js';
import { MAX_AGENT_RESULT_BYTES, PiDriver } from '../../src/drivers/pi-rpc.js';
import { JsonlProcess, MAX_JSONL_RECORD_BYTES } from '../../src/process/jsonl-process.js';

const children: JsonlProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await child.terminate();
});

const fakeJsonl = String.raw`
let buffer = "";
function write(value) { process.stdout.write(JSON.stringify(value) + "\n"); }
process.stderr.write("fake stderr\n");
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    const command = JSON.parse(line);
    write({ id: command.id, type: "response", command: command.type, success: true });
    write({ type: "event", value: command.value });
    index = buffer.indexOf("\n");
  }
});`;

function requestFor(overrides: Partial<AgentRequest['profile']> = {}): AgentRequest {
  return {
    runId: 'run-1',
    stepId: 'plan',
    prompt: 'Return a plan',
    profile: {
      driver: 'pi',
      model: 'test-model',
      tools: ['read'],
      workspaceMode: 'read-only',
      timeoutMs: 1000,
      retryLimit: 0,
      ...overrides,
    },
  };
}

describe('JSONL transport', () => {
  it('correlates responses, forwards events, and captures stderr', async () => {
    const client = new JsonlProcess({ command: process.execPath, args: ['-e', fakeJsonl] });
    children.push(client);
    const event = new Promise<Record<string, unknown>>((resolve) => {
      client.onMessage((message) => {
        if (message.type === 'event') resolve(message);
      });
    });

    const response = await client.request({ type: 'echo', value: 'hello' }, { timeoutMs: 1000 });

    expect(response).toMatchObject({ type: 'response', command: 'echo', success: true });
    expect(await event).toEqual({ type: 'event', value: 'hello' });
    expect(client.stderr).toContain('fake stderr');
  });

  it('drains a final response before reporting process exit', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: [
        '-e',
        String.raw`process.stdin.once('data', (chunk) => {
          const command = JSON.parse(chunk.toString());
          process.stdout.write(JSON.stringify({ id: command.id, type: 'response', success: true }) + '\n');
          process.exit(0);
        });`,
      ],
    });
    children.push(client);

    await expect(
      client.request({ type: 'final-response' }, { timeoutMs: 1000 }),
    ).resolves.toMatchObject({
      type: 'response',
      success: true,
    });
  });

  it('does not wait for a second termination grace period after signal exit', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: ['-e', "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10)"],
    });
    children.push(client);

    await expect(client.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL process exited',
    );
    const exit = await client.waitForExit();
    expect(exit.code !== null || exit.signal !== null).toBe(true);
    await client.terminate();
  });

  it('turns a child that closes stdin into a request failure', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: ['-e', 'process.stdin.destroy(); setTimeout(() => {}, 500)'],
    });
    children.push(client);

    await expect(
      client.request({ type: 'write-after-close' }, { timeoutMs: 200 }),
    ).rejects.toThrow();
  });

  it('fails when an unterminated JSONL record exceeds the UTF-8 byte bound', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write("{" + "a".repeat(${MAX_JSONL_RECORD_BYTES + 8})); setTimeout(() => {}, 500)`,
      ],
    });
    children.push(client);

    await expect(client.request({ type: 'wait' }, { timeoutMs: 3000 })).rejects.toThrow(
      'JSONL record exceeded maximum size',
    );
  });

  it('splits complete records before applying the per-record byte bound', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: [
        '-e',
        String.raw`process.stdin.once('data', (chunk) => {
          const command = JSON.parse(chunk.toString());
          const event = JSON.stringify({ type: 'event', value: 'x'.repeat(${MAX_JSONL_RECORD_BYTES - 100}) });
          const response = JSON.stringify({ id: command.id, type: 'response', success: true });
          process.stdout.write(event + '\n' + response + '\n');
        });`,
      ],
    });
    children.push(client);

    await expect(
      client.request({ type: 'near-limit' }, { timeoutMs: 1000 }),
    ).resolves.toMatchObject({
      type: 'response',
      success: true,
    });
  });

  it('rejects an oversized complete JSONL record', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: [
        '-e',
        String.raw`process.stdout.write("{" + "a".repeat(${MAX_JSONL_RECORD_BYTES + 8}) + "}\n"); setTimeout(() => {}, 500)`,
      ],
    });
    children.push(client);

    await expect(client.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL record exceeded maximum size',
    );
  });

  it('terminates a Pi grandchild before it can modify the workspace', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-process-tree-'));
    const sentinel = join(directory, 'sentinel.txt');
    const ready = join(directory, 'ready.txt');
    const controller = new AbortController();
    const client = new JsonlProcess({
      command: process.execPath,
      args: [join(process.cwd(), 'test', 'drivers', 'grandchild-pi.mjs')],
      env: { ...process.env, BINAFLOW_SENTINEL: sentinel, BINAFLOW_PARENT_READY: ready },
    });
    children.push(client);
    try {
      const request = client.request({ type: 'wait' }, { signal: controller.signal });
      const deadline = Date.now() + 2_000;
      while (!existsSync(ready) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(existsSync(ready)).toBe(true);
      const { childPid } = JSON.parse(readFileSync(ready, 'utf8')) as { childPid: number };
      controller.abort();
      await expect(request).rejects.toThrow('JSONL request cancelled');
      await client.terminate();
      await waitForProcessExit(childPid);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('turns message listener exceptions into transport failures', async () => {
    const messageClient = new JsonlProcess({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify({type:"event"}) + "\\n"); setTimeout(() => {}, 500)',
      ],
    });
    children.push(messageClient);
    messageClient.onMessage(() => {
      throw new Error('message listener failed');
    });
    await expect(messageClient.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL message listener failed',
    );
  });
});

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (processIsAlive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(processIsAlive(pid)).toBe(false);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

describe('PiDriver', () => {
  it('normalizes Pi text, session, usage, cost, and events', async () => {
    const events: NormalizedEvent[] = [];
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: ['test/drivers/fake-pi.mjs'],
    });

    const result = await driver.execute(
      requestFor(),
      (event) => {
        events.push(event);
      },
      new AbortController().signal,
    );

    expect(result).toEqual({
      text: 'hello',
      sessionId: 'session-1',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      costUsd: 0.25,
    });
    expect(events.some((event) => event.type === 'text' && event.message === 'hello')).toBe(true);
    expect(events.some((event) => event.message.includes('tool=read id=call-1'))).toBe(true);
  });

  it('reports an unavailable Pi executable as an actionable driver error', async () => {
    const driver = new PiDriver({ command: 'binaflow-pi-does-not-exist' });

    await expect(
      driver.execute(requestFor(), () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PI_RPC_FAILED' });
  });

  it('serializes normalized events and propagates an event sink failure', async () => {
    const events: string[] = [];
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: ['test/drivers/ordered-events-pi.mjs'],
    });

    const execution = driver.execute(
      requestFor(),
      async (event) => {
        if (event.type !== 'text') return;
        if (event.message === 'first') await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(event.message);
        if (event.message === 'second') throw new Error('event sink failed');
      },
      new AbortController().signal,
    );
    await expect(execution).rejects.toMatchObject({
      code: 'PI_RPC_FAILED',
      message: 'Pi RPC failed: event sink failed',
    });

    expect(events).toEqual(['first', 'second']);
  });

  it('fails immediately when Pi exits after prompt without agent_settled', async () => {
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: [
        '-e',
        String.raw`
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    const command = JSON.parse(line);
    if (command.type === 'prompt') {
      process.stdout.write(JSON.stringify({ id: command.id, type: 'response', success: true }) + '\n');
      process.exit(0);
    }
    index = buffer.indexOf('\n');
  }
});`,
      ],
    });

    await expect(
      driver.execute(
        requestFor({ timeoutMs: 5_000 }),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PI_RPC_FAILED' });
  });

  it('drains accepted events after Pi exits before agent_settled', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstEvent = new Promise<void>((resolve) => {
      started = resolve;
    });
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: ['test/drivers/exiting-events-pi.mjs'],
    });
    const events: string[] = [];
    const execution = driver.execute(
      requestFor(),
      async (event) => {
        if (event.type !== 'text') return;
        events.push(event.message);
        if (event.message === 'first') {
          started();
          await gate;
        }
      },
      new AbortController().signal,
    );

    await firstEvent;
    release();
    await expect(execution).rejects.toMatchObject({ code: 'PI_RPC_FAILED' });
    expect(events).toEqual(['first', 'second']);
  });

  it.each(['delta', 'final'] as const)('rejects an oversized Pi %s result', async (kind) => {
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: ['test/drivers/oversized-pi.mjs'],
      env: {
        ...process.env,
        BINAFLOW_RESULT_KIND: kind,
        BINAFLOW_RESULT_SIZE: String(MAX_AGENT_RESULT_BYTES + 1),
      },
    });

    await expect(
      driver.execute(
        requestFor({ timeoutMs: 1000 }),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PI_OUTPUT_TOO_LARGE' });
  });

  it('does not spawn Pi when execution is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const driver = new PiDriver({ command: 'binaflow-pi-does-not-exist' });

    await expect(
      driver.execute(requestFor(), () => undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'PI_CANCELLED' });
  });

  it('waits briefly for Pi to settle after cancellation before terminating it', async () => {
    const events: NormalizedEvent[] = [];
    const controller = new AbortController();
    const driver = new PiDriver({
      command: process.execPath,
      commandArgs: ['test/drivers/canceling-pi.mjs'],
    });
    const execution = driver.execute(
      requestFor(),
      (event) => {
        events.push(event);
      },
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 20);

    await expect(execution).rejects.toMatchObject({ code: 'PI_CANCELLED' });
    expect(events.some((event) => event.message === 'Pi agent settled')).toBe(true);
  });
});
