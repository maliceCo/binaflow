import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCli } from '../src/cli/index.js';
import { CliError, writeJsonlFailure } from '../src/cli/protocol.js';
import type { StepRun, WorkflowRun } from '../src/core/run.js';
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
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.createRun(run);
    const step: StepRun = {
      runId: run.id,
      stepId: 'plan',
      profile: 'planner',
      status: 'pending',
      attempt: 1,
    };
    await store.saveStepRun(step);
    store.close();

    let output = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output += `${args.join(' ')}\n`;
    });

    await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, 'show', run.id]);

    expect(output).toContain('Run inspection-run');
    expect(output).toContain('driver=-');
    await rm(directory, { recursive: true, force: true });
  });
});
