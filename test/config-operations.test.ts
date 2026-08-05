import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configurationExists,
  canLaunchCommand,
  diagnoseConfigurationFile,
  generateConfiguration,
  writeConfigurationAtomically,
} from '../src/application/config-operations.js';
import { loadConfig } from '../src/config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('configuration operations', () => {
  it('diagnoses invalid profiles and missing workflow profiles without creating data', async () => {
    const directory = await temporaryDirectory('binaflow-doctor-');
    const configPath = join(directory, '.binaflow', 'config.json');
    await mkdir(join(directory, '.binaflow'));
    await writeFile(
      configPath,
      JSON.stringify({
        dataDir: './data',
        piCommand: process.execPath,
        profiles: {
          planner: {
            driver: 'pi',
            model: '',
            tools: ['read'],
            workspaceMode: 'read-only',
            timeoutMs: 0,
            retryLimit: 0,
          },
        },
      }),
    );

    const diagnosis = await diagnoseConfigurationFile('.binaflow/config.json', directory);

    expect(diagnosis.configValid).toBe(false);
    expect(diagnosis.profiles[0]).toMatchObject({
      name: 'planner',
      valid: false,
      errors: expect.arrayContaining(['model must be a non-empty string']),
    });
    expect(diagnosis.workflows.find((workflow) => workflow.id === 'plan-build')).toMatchObject({
      missingProfiles: ['planner', 'builder'],
      available: false,
    });
    expect(diagnosis.dataDirPath).toBe(join(directory, '.binaflow', 'data'));
    expect(diagnosis.ready).toBe(false);
    await expect(access(join(directory, '.binaflow', 'data'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reports a missing config without creating a run or data directory', async () => {
    const directory = await temporaryDirectory('binaflow-doctor-missing-');

    const diagnosis = await diagnoseConfigurationFile('.binaflow/config.json', directory);

    expect(diagnosis).toMatchObject({
      configExists: false,
      configValid: false,
      ready: false,
      profiles: [],
    });
    await expect(access(join(directory, 'data'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks stable plan-build ready while diagnosing experimental research as unavailable', async () => {
    const directory = await temporaryDirectory('binaflow-doctor-ready-');
    const configPath = join(directory, '.binaflow', 'config.json');
    await mkdir(join(directory, '.binaflow'));
    const profile = {
      driver: 'pi',
      model: 'test-model',
      tools: ['read'],
      workspaceMode: 'read-only',
      timeoutMs: 1000,
      retryLimit: 0,
    };
    await writeFile(
      configPath,
      JSON.stringify({
        piCommand: process.execPath,
        profiles: { planner: profile, builder: profile },
      }),
    );

    const diagnosis = await diagnoseConfigurationFile('.binaflow/config.json', directory);

    expect(diagnosis.ready).toBe(true);
    expect(diagnosis.workflows.find((workflow) => workflow.id === 'plan-build')).toMatchObject({
      available: true,
    });
    expect(
      diagnosis.workflows.find((workflow) => workflow.id === 'research-plan-build'),
    ).toMatchObject({
      experimental: true,
      available: false,
      missingProfiles: ['researcher', 'research-reviewer'],
    });
  });

  it.each([
    { name: 'empty', piCommand: '', error: 'piCommand must be a non-empty string' },
    { name: 'NUL-containing', piCommand: '\0', error: 'piCommand must not contain NUL bytes' },
    { name: 'non-string', piCommand: 42, error: 'piCommand must be a string' },
  ])(
    'diagnoses a $name piCommand without attempting to launch it',
    async ({ piCommand, error }) => {
      const directory = await temporaryDirectory(`binaflow-doctor-${error}-`);
      const configPath = join(directory, '.binaflow', 'config.json');
      await mkdir(join(directory, '.binaflow'));
      await writeFile(
        configPath,
        JSON.stringify({
          piCommand,
          profiles: {},
        }),
      );

      const diagnosis = await diagnoseConfigurationFile('.binaflow/config.json', directory);

      expect(diagnosis.configValid).toBe(false);
      expect(diagnosis.ready).toBe(false);
      expect(diagnosis.errors).toContain(`Binaflow config ${error}`);
      expect(diagnosis.piCommandLaunchable).toBeUndefined();
    },
  );

  it('reports synchronous spawn failures instead of rejecting diagnosis', async () => {
    const directory = await temporaryDirectory('binaflow-probe-invalid-');

    await expect(canLaunchCommand('\0', directory)).resolves.toMatchObject({
      launchable: false,
    });
  });

  it('does not treat a nonzero probe exit as launchable', async () => {
    const directory = await temporaryDirectory('binaflow-probe-failure-');

    await expect(
      canLaunchCommand(process.execPath, directory, ['-e', 'process.exit(7)']),
    ).resolves.toEqual({
      launchable: false,
      message: 'command exited with code 7',
    });
  });

  it('waits for a timed-out probe child to be reaped', async () => {
    const directory = await temporaryDirectory('binaflow-probe-timeout-');
    const pidPath = join(directory, 'pid');
    const script = [
      "require('node:fs').writeFileSync(",
      JSON.stringify(pidPath),
      ", String(process.pid)); process.on('SIGTERM', () => {}); setTimeout(() => {}, 10000);",
    ].join('');

    await expect(
      canLaunchCommand(process.execPath, directory, ['-e', script]),
    ).resolves.toMatchObject({
      launchable: false,
      message: 'command timed out',
    });
    const pid = Number(await readFile(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('generates and atomically writes a safe configuration', async () => {
    const directory = await temporaryDirectory('binaflow-init-');
    const generated = generateConfiguration({
      configPath: '.binaflow/config.json',
      cwd: directory,
      plannerProvider: 'provider-a',
      plannerModel: 'planner-model',
      builderProvider: 'provider-b',
      builderModel: 'builder-model',
      builderWriteAccess: false,
    });

    await writeConfigurationAtomically(generated);

    const loaded = await loadConfig(generated.configPath);
    expect(loaded.profiles.planner).toMatchObject({
      provider: 'provider-a',
      model: 'planner-model',
      workspaceMode: 'read-only',
      projectTrust: 'never',
    });
    expect(loaded.profiles.builder).toMatchObject({
      provider: 'provider-b',
      model: 'builder-model',
      tools: ['ls', 'find', 'read'],
      workspaceMode: 'read-only',
      projectTrust: 'never',
    });
    expect(await configurationExists('.binaflow/config.json', directory)).toBe(true);
    expect(await readFile(generated.configPath, 'utf8')).not.toContain('credential');
  });

  it('refuses existing files and invalid generated values before writing', async () => {
    const directory = await temporaryDirectory('binaflow-init-refusal-');
    const generated = generateConfiguration({
      configPath: '.binaflow/config.json',
      cwd: directory,
      plannerProvider: 'provider',
      plannerModel: 'planner',
      builderProvider: 'provider',
      builderModel: 'builder',
      builderWriteAccess: true,
    });
    await writeConfigurationAtomically(generated);

    await expect(writeConfigurationAtomically(generated)).rejects.toThrow('already exists');
    expect(() =>
      generateConfiguration({
        configPath: '.binaflow/invalid.json',
        cwd: directory,
        plannerProvider: '',
        plannerModel: 'planner',
        builderProvider: 'provider',
        builderModel: 'builder',
        builderWriteAccess: false,
      }),
    ).toThrow('provider must be a non-empty string');
  });

  it('does not overwrite when concurrent initialization publishes the same target', async () => {
    const directory = await temporaryDirectory('binaflow-init-concurrent-');
    const generated = generateConfiguration({
      configPath: '.binaflow/config.json',
      cwd: directory,
      plannerProvider: 'provider',
      plannerModel: 'planner',
      builderProvider: 'provider',
      builderModel: 'builder',
      builderWriteAccess: false,
    });

    const results = await Promise.allSettled([
      writeConfigurationAtomically(generated),
      writeConfigurationAtomically(generated),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining('already exists') }),
    });
    expect(JSON.parse(await readFile(generated.configPath, 'utf8'))).toMatchObject({
      profiles: { planner: { model: 'planner' } },
    });
  });

  it('does not leave a partial configuration when the destination cannot be created', async () => {
    const directory = await temporaryDirectory('binaflow-init-atomic-failure-');
    const blockedParent = join(directory, 'blocked');
    await writeFile(blockedParent, 'not a directory');
    const generated = generateConfiguration({
      configPath: 'blocked/config.json',
      cwd: directory,
      plannerProvider: 'provider',
      plannerModel: 'planner',
      builderProvider: 'provider',
      builderModel: 'builder',
      builderWriteAccess: false,
    });

    await expect(writeConfigurationAtomically(generated)).rejects.toBeDefined();
    await expect(access(generated.configPath)).rejects.toBeDefined();
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
