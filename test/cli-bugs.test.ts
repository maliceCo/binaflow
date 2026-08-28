import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCli } from '../src/cli/index.js';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('QA history CLI', () => {
  it('lists and shows defects through versioned JSON results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-bugs-'));
    directories.push(directory);
    await mkdir(join(directory, '.binaflow'));
    await mkdir(join(directory, '.binaflow', 'data'));
    await writeFile(
      join(directory, '.binaflow', 'config.json'),
      JSON.stringify({ qaHistory: { enabled: true }, profiles: {} }),
    );
    const store = new SqliteRunStore(join(directory, '.binaflow', 'data', 'runs.db'));
    await store.saveQaDefect({
      id: 'defect-1',
      fingerprint: 'fingerprint-1',
      title: 'Broken behavior',
      summary: 'The behavior is incorrect',
      category: 'correctness',
      severity: 'high',
      status: 'detected',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    store.close();
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--json', 'bugs']);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      protocol: 'binaflow-cli',
      version: 1,
      command: 'bugs',
      data: { bugs: [{ id: 'defect-1', severity: 'high' }] },
    });

    await createCli().parseAsync([
      'node',
      'binaflow',
      '--cwd',
      directory,
      '--json',
      'bug',
      'defect-1',
    ]);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      command: 'bug',
      data: { defect: { id: 'defect-1' }, occurrences: [], events: [] },
    });
  });

  it('does not expose history queries when the workspace setting is disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-cli-bugs-disabled-'));
    directories.push(directory);
    await mkdir(join(directory, '.binaflow'));
    await writeFile(join(directory, '.binaflow', 'config.json'), JSON.stringify({ profiles: {} }));

    await expect(
      createCli().parseAsync(['node', 'binaflow', '--cwd', directory, '--json', 'bugs']),
    ).rejects.toThrow('QA history is disabled');
  });
});
