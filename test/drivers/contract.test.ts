import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRequest } from '../../src/core/agent.js';
import type { NormalizedEvent } from '../../src/core/events.js';
import { PiDriver } from '../../src/drivers/pi-rpc.js';
import { JsonlProcess } from '../../src/process/jsonl-process.js';

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
    expect(events.some((event) => event.type === 'status')).toBe(true);
  });

  it('reports an unavailable Pi executable as an actionable driver error', async () => {
    const driver = new PiDriver({ command: 'binaflow-pi-does-not-exist' });

    await expect(
      driver.execute(requestFor(), () => undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PI_RPC_FAILED' });
  });
});
