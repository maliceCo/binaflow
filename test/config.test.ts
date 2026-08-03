import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('Binaflow config', () => {
  it('loads external profiles and resolves relative data storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-config-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: './data',
        piCommand: 'pi',
        profiles: {
          planner: {
            driver: 'pi',
            provider: 'anthropic',
            model: 'claude-test',
            tools: ['read'],
            workspaceMode: 'read-only',
            projectTrust: 'always',
            timeoutMs: 1000,
            retryLimit: 0,
          },
        },
      }),
    );

    const config = await loadConfig(configPath);

    expect(config.dataDir).toBe(join(directory, 'data'));
    expect(config.profiles.planner?.provider).toBe('anthropic');
    expect(config.profiles.planner?.projectTrust).toBe('always');
  });

  it('rejects invalid runtime limits instead of silently accepting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-config-invalid-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          planner: {
            driver: 'pi',
            model: 'claude-test',
            tools: ['read'],
            workspaceMode: 'read-only',
            timeoutMs: 0,
            retryLimit: -1,
          },
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow('Profile planner has invalid');
  });

  it('rejects unsupported drivers and malformed tool names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-config-driver-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          planner: {
            driver: 'other',
            model: 'claude-test',
            tools: [' read'],
            workspaceMode: 'read-only',
            timeoutMs: 1000,
            retryLimit: 0,
          },
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow('driver must be pi');
  });

  it('rejects empty or padded tool names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-config-tools-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        profiles: {
          planner: {
            driver: 'pi',
            model: 'claude-test',
            tools: [' '],
            workspaceMode: 'read-only',
            timeoutMs: 1000,
            retryLimit: 0,
          },
        },
      }),
    );

    await expect(loadConfig(configPath)).rejects.toThrow('Profile planner has invalid');
  });
});
