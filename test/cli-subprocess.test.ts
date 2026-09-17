import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const cliEntry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const tsxEntry = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));

describe('CLI subprocess protocol boundary', { timeout: 30_000 }, () => {
  it('shows help for a no-argument non-TTY invocation', async () => {
    const result = await runCli([]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: binaflow');
    expect(result.stdout).toContain('tui');
    expect(result.stderr).toBe('');
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

  it('keeps JSONL run lifecycle records ordered', async () => {
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
      expect(first.stderr).not.toMatch(/^\s*\{/);
      expect(firstRecords[0]).toMatchObject({
        protocol: 'binaflow-cli',
        version: 1,
        type: 'run.started',
        command: 'run',
      });
      expect(firstRecords.slice(1, -1).every((record) => record.type === 'event')).toBe(true);
      expectTerminalRecord(firstRecords.at(-1), 'run');
      for (const line of first.stdout.trim().split(/\r?\n/).filter(Boolean)) {
        expect(() => JSON.parse(line)).not.toThrow();
      }

      expect(firstRecords[0]?.runId).toEqual(expect.any(String));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps machine JSON stdout free of human progress text', async () => {
    const directory = await createFailureConfig();
    try {
      const result = await runCli([
        '--cwd',
        directory,
        '--json',
        'run',
        'plan-build',
        '--objective',
        'Check json stdout purity',
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain('Started run');
      const records = protocolRecords(result.stdout);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        protocol: 'binaflow-cli',
        version: 1,
        type: 'result',
        command: 'run',
      });
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
    child.stdin.end(input);
  });
}

function waitForOutput(stream: NodeJS.ReadableStream, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (predicate()) {
      resolve();
      return;
    }
    const onData = (): void => {
      if (!predicate()) return;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      resolve();
    };
    const timer = setTimeout(() => {
      stream.removeListener('data', onData);
      reject(new Error('Timed out waiting for CLI output'));
    }, 10_000);
    stream.on('data', onData);
  });
}

async function createFailureConfig(includeBuilder = true): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-'));
  await mkdir(join(directory, '.binaflow'));
  const profile = {
    driver: 'pi',
    model: 'test-model',
    tools: ['read'],
    workspaceMode: 'read-only',
    timeoutMs: 1000,
    retryLimit: 1,
  };
  await writeFile(
    join(directory, '.binaflow', 'config.json'),
    JSON.stringify({
      dataDir: 'data',
      piCommand: 'binaflow-test-driver-does-not-exist',
      profiles: {
        planner: profile,
        ...(includeBuilder ? { builder: { ...profile, workspaceMode: 'read-write' } } : {}),
      },
    }),
  );
  return directory;
}

function protocolRecords(output: string): Array<Record<string, unknown>> {
  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectTerminalRecord(record: Record<string, unknown> | undefined, command: string): void {
  expect(['run.finished', 'run.failed']).toContain(record?.type);
  expect(record).toMatchObject({ command });
}
