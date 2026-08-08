import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../src/artifacts/file-artifact-store.js';
import { loadConfig } from '../src/config.js';
import { createCli } from '../src/cli/index.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
import { researchPlanBuildWorkflow } from '../src/workflows/research-plan-build.js';

const cliEntry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const tsxEntry = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));

describe('CLI subprocess protocol boundary', { timeout: 15_000 }, () => {
  it('shows help for a no-argument non-TTY invocation', async () => {
    const result = await runCli([]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: binaflow');
    expect(result.stdout).toContain('tui');
    expect(result.stderr).toBe('');
  });

  it('runs when the CLI entry is reached through a symlinked directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-symlink-'));
    try {
      const linkedDirectory = join(directory, 'current');
      await symlink(dirname(cliEntry), linkedDirectory, 'dir');
      const result = await runCliFrom(join(linkedDirectory, 'index.ts'), ['--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Usage: binaflow');
      expect(result.stderr).toBe('');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects the explicit TUI command without a TTY', async () => {
    const result = await runCli(['tui']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('interactive terminal');
  });

  it.each([
    { name: 'unknown command in human mode', args: ['not-a-command'], machine: false },
    { name: 'unknown option in JSON mode', args: ['--json', '--not-an-option'], machine: true },
    { name: 'missing argument in JSONL mode', args: ['--jsonl', 'show'], machine: true },
    {
      name: 'conflicting output modes',
      args: ['--json', '--jsonl', 'workflows'],
      machine: true,
    },
    {
      name: 'interactive execution in machine mode',
      args: ['--json', 'run', '--interactive'],
      machine: true,
    },
  ])('$name exits with a protocol-safe usage failure', async ({ args, machine }) => {
    const result = await runCli(args);

    expect(result.code).toBe(2);
    if (machine) {
      const records = result.stdout.trim().split(/\r?\n/).filter(Boolean);
      expect(records).toHaveLength(1);
      expect(JSON.parse(records[0]!)).toMatchObject({
        protocol: 'binaflow-cli',
        version: 1,
        type: 'error',
        error: { code: expect.any(String), message: expect.any(String) },
      });
    } else {
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/error:/);
    }
  });

  it('keeps help output off stdout when a machine mode is selected', async () => {
    const result = await runCli(['--json', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: binaflow');
  });

  it('keeps human lifecycle progress on stderr', async () => {
    const directory = await createFailureConfig();
    try {
      const result = await runCli([
        '--cwd',
        directory,
        'run',
        'plan-build',
        '--objective',
        'Check output streams',
      ]);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Run ');
      expect(result.stdout).not.toContain('Started run');
      expect(result.stderr).toContain('Started run');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not report resume progress for a completed run', async () => {
    const directory = await createFailureConfig();
    const config = await loadConfig(join(directory, '.binaflow', 'config.json'), directory);
    await mkdir(config.dataDir, { recursive: true });
    const store = new SqliteRunStore(join(config.dataDir, 'runs.db'));
    const run = completedRun();
    try {
      await store.createRun(run);
    } finally {
      store.close();
    }

    try {
      const result = await runCli(['--cwd', directory, 'resume', run.id]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Run ${run.id}`);
      expect(result.stderr).not.toContain('Resuming run');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not report resume progress when required profiles are missing', async () => {
    const directory = await createFailureConfig(false);
    const config = await loadConfig(join(directory, '.binaflow', 'config.json'), directory);
    await mkdir(config.dataDir, { recursive: true });
    const store = new SqliteRunStore(join(config.dataDir, 'runs.db'));
    const run = { ...completedRun(), status: 'failed' as const };
    try {
      await store.createRun(run);
    } finally {
      store.close();
    }

    try {
      const result = await runCli(['--cwd', directory, 'resume', run.id]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Missing agent profile');
      expect(result.stderr).not.toContain('Resuming run');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects empty approval feedback before changing the persisted gate', async () => {
    const directory = await createFailureConfig(true, true);
    const config = await loadConfig(join(directory, '.binaflow', 'config.json'), directory);
    await mkdir(config.dataDir, { recursive: true });
    const store = new SqliteRunStore(join(config.dataDir, 'runs.db'));
    const run = {
      ...completedRun(),
      workflowId: researchPlanBuildWorkflow.id,
      status: 'waiting' as const,
    };
    const approval: StepRun = {
      runId: run.id,
      stepId: 'research-approval',
      profile: 'human',
      status: 'waiting',
      attempt: 1,
    };
    try {
      await store.createRun(run);
      await store.saveStepRun(approval);
    } finally {
      store.close();
    }

    try {
      const result = await runCli(['--cwd', directory, 'reject', run.id, '--feedback', '   ']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Rejection feedback must be non-empty');

      const reopened = new SqliteRunStore(join(config.dataDir, 'runs.db'));
      try {
        await expect(reopened.getStepRuns(run.id)).resolves.toEqual([approval]);
      } finally {
        reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns structured diagnosis without creating a run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-doctor-cli-'));
    try {
      const result = await runCli(['--cwd', directory, '--json', 'doctor']);
      const document = JSON.parse(result.stdout) as {
        type: string;
        command: string;
        data: { configExists: boolean; ready: boolean };
      };

      expect(result.code).toBe(1);
      expect(document).toMatchObject({ type: 'result', command: 'doctor' });
      expect(document.data.configExists).toBe(false);
      expect(document.data.ready).toBe(false);
      expect(result.stderr).not.toContain('Planner provider');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports an unrun Pi probe as not checked in human doctor output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-doctor-human-'));
    try {
      const result = await runCli(['--cwd', directory, 'doctor']);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Pi probe: not checked.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects machine-mode init without prompting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-init-machine-'));
    try {
      const result = await runCli(['--cwd', directory, '--json', 'init']);

      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        type: 'error',
        error: { code: 'INTERACTIVE_REQUIRES_HUMAN_MODE' },
      });
      expect(result.stderr).not.toContain('Planner provider');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('attributes machine errors to the parsed command, not option values', async () => {
    const result = await runCli(['--json', '--config', 'doctor', 'workflows']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ type: 'result', command: 'workflows' });
  });

  it('creates init configuration after confirmation and corrects blank input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-init-cli-'));
    try {
      const result = await runCliWithInput(
        ['--cwd', directory, 'init'],
        'provider-planner\nplanner-model\nprovider-builder\nbuilder-model\nn\ny\n',
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Configuration written to');
      const config = await loadConfig(join(directory, '.binaflow', 'config.json'), directory);
      expect(config.profiles.planner).toMatchObject({
        provider: 'provider-planner',
        model: 'planner-model',
        workspaceMode: 'read-only',
      });
      expect(config.profiles.builder).toMatchObject({
        provider: 'provider-builder',
        model: 'builder-model',
        workspaceMode: 'read-only',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('consumes non-TTY init input incrementally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-init-incremental-'));
    try {
      const child = spawn(process.execPath, [tsxEntry, cliEntry, '--cwd', directory, 'init'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.stdin.write('provider-planner\nplanner-model\nprovider-builder\n');
      await waitForOutput(child.stdout, () => stdout.includes('Builder model: '));
      expect(stdout).toContain('Builder model: ');

      child.stdin.end('builder-model\nn\ny\n');
      const code = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode) => resolve(exitCode ?? -1));
      });
      expect(code, stderr).toBe(0);
      expect(stdout).toContain('Configuration written to');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cancels init without writing and refuses an existing config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-init-cancel-'));
    try {
      const cancelled = await runCliWithInput(
        ['--cwd', directory, 'init'],
        'provider-planner\nplanner-model\nprovider-builder\nbuilder-model\nn\nn\n',
      );
      expect(cancelled.code).toBe(0);
      expect(cancelled.stdout).toContain('cancelled');
      await expect(access(join(directory, '.binaflow', 'config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const existing = await createFailureConfig();
      try {
        const refused = await runCli(['--cwd', existing, 'init']);
        expect(refused.code).toBe(2);
        expect(refused.stderr).toContain('refusing to overwrite');
      } finally {
        await rm(existing, { recursive: true, force: true });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves extra input fields through an interactive run', async () => {
    const directory = await createFailureConfig();
    const inputPath = join(directory, 'input.json');
    await writeFile(inputPath, JSON.stringify({ objective: 'From JSON', extra: 'keep me' }));
    const restoreStdin = forceTTY(process.stdin);
    const restoreStdout = forceTTY(process.stdout);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await createCli().parseAsync([
        'node',
        'binaflow',
        '--cwd',
        directory,
        'run',
        'plan-build',
        '--interactive',
        '--input-json',
        inputPath,
        '--objective',
        'Interactive objective',
      ]);

      const config = await loadConfig(join(directory, '.binaflow', 'config.json'), directory);
      const store = new SqliteRunStore(join(config.dataDir, 'runs.db'));
      const artifacts = new FileArtifactStore(join(config.dataDir, 'artifacts'));
      try {
        const [run] = await store.listRuns();
        expect(run).toBeDefined();
        const inputArtifact = (await store.getArtifacts(run!.id)).find(
          (artifact) => artifact.stepId === 'run' && artifact.name === 'input',
        );
        expect(inputArtifact).toBeDefined();
        expect(JSON.parse(await artifacts.read(inputArtifact!))).toEqual({
          objective: 'Interactive objective',
          extra: 'keep me',
        });
      } finally {
        store.close();
      }
    } finally {
      restoreStdin();
      restoreStdout();
      process.exitCode = previousExitCode;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps run and resume JSONL lifecycle records ordered', async () => {
    const directory = await createFailureConfig();
    try {
      const first = await runCli([
        '--cwd',
        directory,
        '--jsonl',
        'run',
        'plan-build',
        '--objective',
        'Check run protocol',
      ]);
      const firstRecords = protocolRecords(first.stdout);
      expect(first.code).toBe(1);
      expect(firstRecords[0]).toMatchObject({ type: 'run.started', command: 'run' });
      expect(firstRecords.slice(1, -1).every((record) => record.type === 'event')).toBe(true);
      expectTerminalRecord(firstRecords.at(-1), 'run');

      const runId = firstRecords[0]?.runId;
      expect(runId).toEqual(expect.any(String));
      const resumed = await runCli(['--cwd', directory, '--jsonl', 'resume', runId as string]);
      const resumedRecords = protocolRecords(resumed.stdout);
      expect(resumed.code).toBe(1);
      expect(resumedRecords[0]).toMatchObject({
        type: 'run.started',
        command: 'resume',
        runId,
      });
      expectTerminalRecord(resumedRecords.at(-1), 'resume', runId);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return runCliFrom(cliEntry, args);
}

function runCliFrom(
  entry: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxEntry, entry, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`CLI subprocess timed out: ${args.join(' ')}`));
    }, 10_000);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
  });
}

function runCliWithInput(
  args: string[],
  input: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxEntry, cliEntry, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function waitForOutput(stream: NodeJS.ReadableStream, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const onData = (): void => {
      if (!predicate()) return;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      resolve();
    };
    const timer = setTimeout(() => {
      stream.removeListener('data', onData);
      reject(new Error('Timed out waiting for CLI output'));
    }, 5_000);
    stream.on('data', onData);
  });
}

async function createFailureConfig(
  includeBuilder = true,
  includeResearch = false,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-'));
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
    join(directory, '.binaflow', 'config.json'),
    JSON.stringify({
      dataDir: 'data',
      piCommand: 'binaflow-test-driver-does-not-exist',
      profiles: {
        planner: profile,
        ...(includeBuilder ? { builder: { ...profile, workspaceMode: 'read-write' } } : {}),
        ...(includeResearch
          ? {
              researcher: profile,
              'research-reviewer': { ...profile, model: 'reviewer-model' },
            }
          : {}),
      },
    }),
  );
  return directory;
}

function completedRun(): WorkflowRun {
  return {
    id: 'resume-test-run',
    workflowId: 'plan-build',
    workflowVersion: 1,
    objective: 'Resume test',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function protocolRecords(output: string): Array<Record<string, unknown>> {
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function forceTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream): () => void {
  const previous = Object.getOwnPropertyDescriptor(stream, 'isTTY');
  Object.defineProperty(stream, 'isTTY', { configurable: true, value: true });
  return () => {
    if (previous) Object.defineProperty(stream, 'isTTY', previous);
    else Reflect.deleteProperty(stream, 'isTTY');
  };
}

function expectTerminalRecord(
  record: Record<string, unknown> | undefined,
  command: string,
  runId?: unknown,
): void {
  expect(['run.finished', 'run.failed']).toContain(record?.type);
  expect(record).toMatchObject({ command });
  if (runId !== undefined) {
    if (record?.type === 'run.failed') expect(record).toMatchObject({ runId });
    else expect(record).toMatchObject({ run: { id: runId } });
  }
}
