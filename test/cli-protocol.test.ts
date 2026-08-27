import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import { createCli } from '../src/cli/index.js';
import { installCliStreamFailure, runAttachedCli } from '../src/cli/commands/common.js';
import * as applicationRuntime from '../src/application/runtime.js';
import {
  CliError,
  machineModeFromArgv,
  machineOutputRequestedFromArgv,
  runEventRecord,
  runFinishedRecord,
  runStartedRecord,
  writeJsonlFailure,
} from '../src/cli/protocol.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../src/core/run.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';
import { listWorkflowContracts } from '../src/workflows/catalog.js';

describe('CLI protocol', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a versioned JSON workflow contract without opening workspace storage', async () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    await createCli().parseAsync(['node', 'binaflow', '--json', 'workflows']);

    const result = JSON.parse(output) as {
      protocol: string;
      version: number;
      type: string;
      command: string;
      data: { workflows: Array<{ id: string; input: unknown; requiredProfiles: string[] }> };
    };
    expect(result).toMatchObject({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'result',
      command: 'workflows',
    });
    expect(result.data.workflows).toHaveLength(2);
    expect(result.data.workflows[0]).toHaveProperty('input');
    expect(result.data.workflows[0]?.requiredProfiles.length).toBeGreaterThan(0);
  });

  it('describes the same workflow contracts used by execution', () => {
    const contracts = listWorkflowContracts();

    expect(contracts.map((workflow) => workflow.id)).toEqual(['plan-build', 'research-plan-build']);
    expect(contracts.find((workflow) => workflow.id === 'research-plan-build')?.experimental).toBe(
      true,
    );
    expect(contracts.find((workflow) => workflow.id === 'plan-build')?.steps).toEqual([
      expect.objectContaining({ id: 'plan', profile: 'planner' }),
      expect.objectContaining({ id: 'build', profile: 'builder' }),
    ]);
  });

  it('rejects conflicting machine output modes', async () => {
    await expect(
      createCli().parseAsync(['node', 'binaflow', '--json', '--jsonl', 'workflows']),
    ).rejects.toMatchObject({ code: 'CONFLICTING_OUTPUT_MODES', exitCode: 2 });
  });

  it('reads machine-output flags only before the bare -- delimiter', () => {
    expect(machineModeFromArgv(['node', 'binaflow', '--jsonl', 'run', 'plan-build'])).toBe('jsonl');
    expect(machineModeFromArgv(['node', 'binaflow', '--json', 'workflows'])).toBe('json');
    expect(
      machineModeFromArgv(['node', 'binaflow', 'run', '--', '--jsonl', 'not-a-flag']),
    ).toBeUndefined();
    expect(machineOutputRequestedFromArgv(['node', 'binaflow', '--', '--json'])).toBe(false);
    expect(machineOutputRequestedFromArgv(['node', 'binaflow', '--json', '--', 'x'])).toBe(true);
  });

  it('keeps shared JSONL lifecycle constructors synchronized', () => {
    const event = {
      runId: 'run-1',
      stepId: 'plan',
      type: 'status' as const,
      message: 'started',
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    const run: WorkflowRun = {
      id: 'run-1',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'sync constructors',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const steps: StepRun[] = [
      {
        runId: 'run-1',
        stepId: 'plan',
        profile: 'planner',
        status: 'completed',
        attempt: 1,
      },
    ];
    const artifacts: ArtifactReference[] = [];

    expect(runStartedRecord('run', 'run-1', 'plan-build')).toEqual({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'run.started',
      command: 'run',
      runId: 'run-1',
      workflowId: 'plan-build',
    });
    expect(runEventRecord(3, event)).toEqual({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'event',
      sequence: 3,
      event,
    });
    expect(runFinishedRecord('resume', run, steps, artifacts)).toEqual({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'run.finished',
      command: 'resume',
      run,
      steps,
      artifacts,
    });
  });

  it('rejects unsupported JSONL modes before opening SQLite or reading config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-jsonl-reject-'));
    const configDirectory = join(directory, '.binaflow');
    mkdirSync(configDirectory);
    // Intentionally omit config.json and runs.db so any storage/config open would fail first.
    try {
      await expect(
        createCli().parseAsync([
          'node',
          'binaflow',
          '--cwd',
          directory,
          '--jsonl',
          'show',
          'run-1',
        ]),
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_OUTPUT_MODE',
        exitCode: 2,
        message: expect.stringContaining('show'),
      });
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--jsonl', 'runs']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
      await expect(
        createCli().parseAsync([
          'node',
          'binaflow',
          '--cwd',
          directory,
          '--jsonl',
          'artifacts',
          'r',
        ]),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
      await expect(
        createCli().parseAsync([
          'node',
          'binaflow',
          '--cwd',
          directory,
          '--jsonl',
          'artifact',
          'r',
          'plan.plan',
        ]),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--jsonl', 'doctor']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--jsonl', 'workflows']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
      await expect(
        createCli().parseAsync(['node', 'binaflow', '--jsonl', 'update', '--check']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OUTPUT_MODE', exitCode: 2 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the CLI usage-error contract for invalid update options', async () => {
    await expect(
      createCli().parseAsync(['node', 'binaflow', 'update', '--check', '--rollback']),
    ).rejects.toMatchObject({
      code: 'CONFLICTING_UPDATE_OPTIONS',
      exitCode: 2,
    });
    await expect(
      createCli().parseAsync(['node', 'binaflow', 'update', '--channel', 'nightly']),
    ).rejects.toMatchObject({
      code: 'INVALID_UPDATE_CHANNEL',
      exitCode: 2,
    });
  });

  it('emits a correlatable JSONL failure record', () => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    writeJsonlFailure('run', 'run-1', new CliError('BROKEN', 'The run broke'));

    expect(JSON.parse(output)).toEqual({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'run.failed',
      command: 'run',
      runId: 'run-1',
      error: { code: 'BROKEN', message: 'The run broke' },
    });
  });

  it('captures the first attached stream failure and skips later output', () => {
    const controller = new AbortController();
    const streamFailure = installCliStreamFailure(controller);
    const first = new Error('stdout closed');
    const second = new Error('stderr closed');
    let writes = 0;

    try {
      process.stdout.emit('error', first);
      process.stderr.emit('error', second);

      expect(streamFailure.error).toBe(first);
      expect(controller.signal.reason).toBe(first);
      expect(streamFailure.write(() => (writes += 1))).toBe(false);
      expect(writes).toBe(0);
    } finally {
      streamFailure.remove();
    }
  });

  it('aborts and joins active work before closing context after stdout failure', async () => {
    const previousExitCode = process.exitCode;
    const order: string[] = [];
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    vi.spyOn(applicationRuntime, 'openApplicationContext').mockResolvedValue({
      application: {} as never,
      close: () => order.push('context closed'),
    });
    const running = runAttachedCli({}, 'stream-failure-run', 'run', async (_context, lifecycle) => {
      lifecycle.signal.addEventListener('abort', () => order.push('aborted'));
      await operation;
      order.push('operation settled');
    });

    try {
      await new Promise((resolve) => setImmediate(resolve));
      process.stdout.emit('error', new Error('stdout closed'));
      await new Promise((resolve) => setImmediate(resolve));

      expect(order).toEqual(['aborted']);
      releaseOperation();
      await running;
      expect(order).toEqual(['aborted', 'operation settled', 'context closed']);
    } finally {
      releaseOperation();
      await running.catch(() => undefined);
      process.exitCode = previousExitCode;
    }
  });

  it('defers second-signal force until operation and context cleanup complete', async () => {
    const previousExitCode = process.exitCode;
    const order: string[] = [];
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    vi.spyOn(applicationRuntime, 'openApplicationContext').mockResolvedValue({
      application: {} as never,
      close: () => order.push('context closed'),
    });
    const running = runAttachedCli({}, 'signal-order-run', 'run', async (_context, lifecycle) => {
      lifecycle.signal.addEventListener('abort', () => order.push('aborted'));
      await operation;
      order.push('operation settled');
    });
    const forceSignal = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await new Promise((resolve) => setImmediate(resolve));
      process.emit('SIGINT');
      process.emit('SIGTERM');
      expect(forceSignal).not.toHaveBeenCalled();

      releaseOperation();
      await running;

      expect(order).toEqual(['aborted', 'operation settled', 'context closed']);
      expect(forceSignal).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    } finally {
      releaseOperation();
      await running.catch(() => undefined);
      process.exitCode = previousExitCode;
      write.mockRestore();
      forceSignal.mockRestore();
    }
  });

  it('inspects a persisted run without execution profiles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-inspection-'));
    const configDirectory = join(directory, '.binaflow');
    await mkdir(configDirectory);
    await writeFile(join(configDirectory, 'config.json'), JSON.stringify({ dataDir: '..' }));
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const run: WorkflowRun = {
      id: 'inspection-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Inspect this run',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const artifact: ArtifactReference = {
      id: 'legacy-plan-artifact',
      runId: run.id,
      stepId: 'plan',
      name: 'plan',
      kind: 'json',
      path: join(directory, 'missing-plan.json'),
      mediaType: 'application/json',
      sizeBytes: 2,
    };
    await store.createRun(run, [artifact]);
    const step: StepRun = {
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(step);
    await store.saveRun({ ...run, status: 'completed' }, 'running');
    store.close();

    let output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += `${args.join(' ')}\n`;
    });

    await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, 'show', run.id]);

    expect(output).toContain('Run inspection-run');
    expect(output).toContain('driver=-');
    expect(output).toContain('Artifact plan.plan');
    expect(output).toContain(`binaflow artifact ${run.id} plan`);
    await rm(directory, { recursive: true, force: true });
  });

  it('shows persisted execution metadata in normal human output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-show-metadata-'));
    const configDirectory = join(directory, '.binaflow');
    await mkdir(configDirectory);
    await writeFile(join(configDirectory, 'config.json'), JSON.stringify({ dataDir: '..' }));
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const run: WorkflowRun = {
      id: 'metadata-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Show execution metadata',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:03.000Z',
    };
    await store.createRun(run);
    await store.saveStepRun({
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'completed',
      attempt: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
      profileSnapshot: {
        driver: 'pi',
        model: 'persisted-model',
        tools: [],
        workspaceMode: 'read-only',
        timeoutMs: 1_000,
        retryLimit: 0,
      },
    });
    await store.saveRun({ ...run, status: 'completed' }, 'running');
    store.close();

    let output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += `${args.join(' ')}\n`;
    });
    try {
      await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, 'show', run.id]);

      expect(output).toContain('driver=pi  model=persisted-model');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('shows elapsed duration for an active persisted run in human output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-show-duration-'));
    const configDirectory = join(directory, '.binaflow');
    await mkdir(configDirectory);
    await writeFile(join(configDirectory, 'config.json'), JSON.stringify({ dataDir: '..' }));
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const run: WorkflowRun = {
      id: 'active-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'Show active duration',
      status: 'running',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    };
    await store.createRun(run);
    await store.saveStepRun({
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'running',
      attempt: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    store.close();

    let output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += `${args.join(' ')}\n`;
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    try {
      await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, 'show', run.id]);

      expect(output).toContain('plan  profile=planner');
      expect(output).toContain('duration=5s');
    } finally {
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('lists semantic artifact references through the versioned JSON contract', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-artifacts-'));
    const configDirectory = join(directory, '.binaflow');
    await mkdir(configDirectory);
    await writeFile(join(configDirectory, 'config.json'), JSON.stringify({ dataDir: '..' }));
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const run: WorkflowRun = {
      id: 'artifact-run',
      workflowId: 'plan-build',
      workflowVersion: 1,
      objective: 'List this artifact',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const artifact: ArtifactReference = {
      id: 'artifact-1',
      runId: run.id,
      stepId: 'plan',
      name: 'plan',
      kind: 'json',
      path: 'artifacts/plan.plan.json',
      mediaType: 'application/json',
      sizeBytes: 2,
    };
    await store.createRun(run, [artifact]);
    store.close();

    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    await createCli().parseAsync([
      'node',
      'binaflow',
      '--cwd',
      directory,
      '--json',
      'artifacts',
      run.id,
    ]);

    expect(JSON.parse(output)).toMatchObject({
      protocol: 'binaflow-cli',
      version: 1,
      type: 'result',
      command: 'artifacts',
      data: { artifacts: [artifact] },
    });
    await rm(directory, { recursive: true, force: true });
  });

  it('paginates run history and keeps default show output bounded', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-history-cli-'));
    const configDirectory = join(directory, '.binaflow');
    await mkdir(configDirectory);
    await writeFile(join(configDirectory, 'config.json'), JSON.stringify({ dataDir: '..' }));
    const store = new SqliteRunStore(join(directory, 'runs.db'));
    const createdAt = '2026-01-01T00:00:00.000Z';
    for (const id of ['run-a', 'run-b', 'run-c']) {
      const run: WorkflowRun = {
        id,
        workflowId: 'plan-build',
        workflowVersion: 1,
        objective: id,
        status: id === 'run-c' ? 'running' : 'completed',
        createdAt,
        updatedAt: createdAt,
      };
      await store.createRun(run);
    }
    const step: StepRun = {
      runId: 'run-c',
      stepId: 'plan',
      profile: 'planner',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(step);
    await store.saveStepRun({
      ...step,
      status: 'completed',
      result: { text: 'x'.repeat(100_000) },
      finishedAt: createdAt,
    });
    await store.saveEvent({
      runId: 'run-c',
      stepId: 'plan',
      type: 'status',
      message: 'completed',
      occurredAt: createdAt,
    });
    const activeRun = await store.getRun('run-c');
    expect(activeRun).toBeDefined();
    await store.saveRun({ ...activeRun!, status: 'completed' }, 'running');
    store.close();

    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);
    try {
      await createCli().parseAsync([
        'node',
        'binaflow',
        '--cwd',
        directory,
        '--json',
        'runs',
        '--limit',
        '2',
      ]);
      const firstPage = JSON.parse(output) as {
        data: { runs: WorkflowRun[]; nextCursor?: string };
      };
      expect(firstPage.data.runs.map((run) => run.id)).toEqual(['run-c', 'run-b']);
      expect(firstPage.data.nextCursor).toEqual(expect.any(String));

      output = '';
      await createCli().parseAsync([
        'node',
        'binaflow',
        '--cwd',
        directory,
        '--json',
        'runs',
        '--limit',
        '2',
        '--cursor',
        firstPage.data.nextCursor!,
      ]);
      const secondPage = JSON.parse(output) as { data: { runs: WorkflowRun[] } };
      expect(secondPage.data.runs.map((run) => run.id)).toEqual(['run-a']);

      output = '';
      await createCli().parseAsync([
        'node',
        'binaflow',
        '--cwd',
        directory,
        '--json',
        'show',
        'run-c',
      ]);
      const inspection = JSON.parse(output) as {
        data: { eventCount: number; steps: StepRun[] };
      };
      expect(inspection.data.eventCount).toBe(1);
      expect(inspection.data.steps[0]?.result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
