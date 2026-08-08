import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRequest } from '../../src/core/agent.js';
import type { NormalizedEvent } from '../../src/core/events.js';
import { PiDriver } from '../../src/drivers/pi-rpc.js';
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

  it('does not wait for a second termination grace period after signal exit', async () => {
    const client = new JsonlProcess({
      command: process.execPath,
      args: ['-e', "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10)"],
    });
    children.push(client);

    await expect(client.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL process exited',
    );
    const startedAt = Date.now();
    await client.terminate();

    expect(Date.now() - startedAt).toBeLessThan(500);
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

    await expect(client.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL record exceeded maximum size',
    );
  });

  it('turns message and stderr listener exceptions into transport failures', async () => {
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

    const stderrClient = new JsonlProcess({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("stderr event\\n"); setTimeout(() => {}, 500)'],
    });
    children.push(stderrClient);
    stderrClient.onStderr(() => {
      throw new Error('stderr listener failed');
    });
    await expect(stderrClient.request({ type: 'wait' }, { timeoutMs: 1000 })).rejects.toThrow(
      'JSONL stderr listener failed',
    );
  });
});

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

    const startedAt = Date.now();
    await expect(
      driver.execute(
        requestFor({ timeoutMs: 5_000 }),
        () => undefined,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PI_RPC_FAILED' });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
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
    const startedAt = Date.now();
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
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(80);
    expect(events.some((event) => event.message === 'Pi agent settled')).toBe(true);
  });
});
