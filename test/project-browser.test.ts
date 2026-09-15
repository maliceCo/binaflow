import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listProjectDirectory } from '../src/web/project-catalog.js';

const directories: string[] = [];
const rootId = '123e4567-e89b-42d3-a456-426614174000';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project browser', () => {
  it('lists one deterministic page of directories and marks project configs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-project-browser-'));
    directories.push(root);
    for (const name of ['zulu', 'alpha', 'middle'])
      await mkdir(join(root, name), { recursive: true });
    await mkdir(join(root, 'middle', '.binaflow'), { recursive: true });
    await writeFile(join(root, 'middle', '.binaflow', 'config.json'), '{}');
    await writeFile(join(root, 'file.txt'), 'not a directory');

    const first = await listProjectDirectory(
      [{ rootId, label: 'Projects', path: root }],
      rootId,
      [],
      0,
      2,
    );
    expect(first.items.map((item) => item.name)).toEqual(['alpha', 'middle']);
    expect(first.items[1]).toMatchObject({ hasBinaflowConfig: true, segments: ['middle'] });
    expect(first.nextOffset).toBe(2);
    const second = await listProjectDirectory(
      [{ rootId, label: 'Projects', path: root }],
      rootId,
      [],
      2,
      2,
    );
    expect(second.items.map((item) => item.name)).toEqual(['zulu']);
    expect(second.nextOffset).toBeNull();
  });

  it('rejects invalid segments and excessive depth before touching the filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-project-browser-'));
    directories.push(root);
    await expect(
      listProjectDirectory([{ rootId, label: 'Projects', path: root }], rootId, ['..']),
    ).rejects.toThrow(/segment/i);
    await expect(
      listProjectDirectory(
        [{ rootId, label: 'Projects', path: root }],
        rootId,
        Array.from({ length: 33 }, () => 'x'),
      ),
    ).rejects.toThrow(/depth/i);
  });
});
