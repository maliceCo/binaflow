import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PiDriver } from '../../src/drivers/pi-rpc.js';

const hasPi = spawnSync('pi', ['--version'], { stdio: 'ignore' }).status === 0;
const hasCredentials = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'].some((name) =>
  Boolean(process.env[name]),
);

describe('optional Pi integration', () => {
  it.skipIf(!hasPi || !hasCredentials)(
    'executes one Pi RPC prompt',
    async () => {
      const driver = new PiDriver();
      const result = await driver.execute(
        {
          runId: 'live-test',
          stepId: 'probe',
          prompt: 'Reply with exactly: ready',
          profile: {
            driver: 'pi',
            model: process.env.BINAFLOW_PI_MODEL ?? 'anthropic/claude-sonnet-4-20250514',
            tools: [],
            workspaceMode: 'read-only',
            timeoutMs: 120_000,
            retryLimit: 0,
          },
        },
        () => undefined,
        new AbortController().signal,
      );

      expect(result.text.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
