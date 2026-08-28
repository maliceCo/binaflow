import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  parseConfigValue,
  resolveProfile,
  validateAgentProfile,
} from '../src/config.js';

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
    expect(config.qaHistory).toEqual({ enabled: false });
    expect(config.profiles.planner?.provider).toBe('anthropic');
    expect(config.profiles.planner?.projectTrust).toBe('always');
  });

  it('accepts and validates the workspace QA history setting', () => {
    expect(
      parseConfigValue({ profiles: {}, qaHistory: { enabled: true } }, 'config.json'),
    ).toMatchObject({
      qaHistory: { enabled: true },
    });
    expect(() =>
      parseConfigValue({ profiles: {}, qaHistory: { enabled: 'yes' } }, 'config.json'),
    ).toThrow('qaHistory.enabled must be a boolean');
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

  it('resolves an explicit skill policy relative to the config file', () => {
    const validation = validateAgentProfile(
      'qa',
      {
        driver: 'pi',
        model: 'claude-test',
        tools: ['read'],
        workspaceMode: 'read-only',
        timeoutMs: 1000,
        retryLimit: 0,
        skills: { mode: 'only', paths: ['./skills/review'], required: ['review'] },
      },
      '/workspace/.binaflow/config.json',
    );

    expect(validation.errors).toEqual([]);
    expect(validation.profile?.skills).toEqual({
      mode: 'only',
      paths: ['/workspace/.binaflow/skills/review'],
      required: ['review'],
    });
  });

  it.each([
    { skills: { mode: 'none', paths: ['./skills/review'] }, error: 'cannot define paths' },
    { skills: { mode: 'only', paths: [] }, error: 'requires non-empty paths' },
    {
      skills: { mode: 'only', paths: ['./skills/review'], required: [' '] },
      error: 'non-empty names',
    },
  ])('rejects invalid skill policy: $error', ({ skills, error }) => {
    const validation = validateAgentProfile('qa', {
      driver: 'pi',
      model: 'claude-test',
      tools: ['read'],
      workspaceMode: 'read-only',
      timeoutMs: 1000,
      retryLimit: 0,
      skills,
    });

    expect(validation.errors.join('; ')).toContain(error);
  });

  it.each(['write', 'edit', 'bash'])('rejects %s in a read-only profile', (tool) => {
    const validation = validateAgentProfile('planner', {
      driver: 'pi',
      model: 'claude-test',
      tools: [tool],
      workspaceMode: 'read-only',
      timeoutMs: 1000,
      retryLimit: 0,
    });

    expect(validation.errors).toContain(
      'read-only profiles cannot enable write, edit, or bash tools',
    );
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects unsafe profile name %s', (name) => {
    const parsed = JSON.parse(
      JSON.stringify({
        profiles: {
          [name]: {
            driver: 'pi',
            model: 'test-model',
            tools: ['read'],
            workspaceMode: 'read-only',
            timeoutMs: 1000,
            retryLimit: 0,
          },
        },
      }),
    ) as unknown;

    expect(() => parseConfigValue(parsed, 'config.json')).toThrow('profile name is reserved');
  });

  it('does not resolve inherited agent profiles', () => {
    const profiles = Object.create({ planner: { model: 'inherited' } }) as Record<string, never>;

    expect(() => resolveProfile({ profiles }, 'planner')).toThrow('Unknown agent profile: planner');
  });
});
