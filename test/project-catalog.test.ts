import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileProjectCatalog, registerProjectFromDirectory } from '../src/web/project-catalog.js';

const directories: string[] = [];
const deviceId = 'a'.repeat(64);
const rootId = '123e4567-e89b-42d3-a456-426614174000';

async function project(root: string, name: string): Promise<string> {
  const workspace = join(root, name);
  await mkdir(join(workspace, '.binaflow'), { recursive: true });
  await writeFile(join(workspace, '.binaflow', 'config.json'), '{"dataDir":"./data"}\n');
  await writeFile(join(workspace, 'README.md'), 'project');
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('project catalog', () => {
  it('registers, persists, deduplicates, and removes without deleting the workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-project-catalog-'));
    directories.push(directory);
    const workspace = await project(directory, 'one');
    const catalog = new FileProjectCatalog(join(directory, 'projects.json'));
    const entry = await catalog.register({ workspacePath: workspace, ownerDeviceId: deviceId });
    expect(entry.name).toBe('one');
    expect(await catalog.register({ workspacePath: workspace, ownerDeviceId: deviceId })).toEqual(
      entry,
    );
    expect((await catalog.list()).projects).toHaveLength(1);
    await catalog.remove(entry.projectId);
    expect((await catalog.list()).projects).toEqual([]);
    expect(await readFile(join(workspace, 'README.md'), 'utf8')).toBe('project');
    expect(await readFile(join(workspace, '.binaflow', 'config.json'), 'utf8')).toContain(
      'dataDir',
    );
  });

  it('registers only a directory selected below an authorized root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-project-catalog-'));
    directories.push(directory);
    const workspace = await project(directory, 'one');
    const catalog = new FileProjectCatalog(join(directory, 'projects.json'));
    await expect(
      registerProjectFromDirectory(
        catalog,
        [{ rootId, label: 'Projects', path: directory }],
        rootId,
        ['one'],
        deviceId,
      ),
    ).resolves.toMatchObject({ workspacePath: workspace });
    await expect(
      registerProjectFromDirectory(
        catalog,
        [{ rootId, label: 'Projects', path: directory }],
        rootId,
        ['..'],
        deviceId,
      ),
    ).rejects.toThrow(/segment|outside/i);
  });

  it('rejects invalid configuration and duplicate project IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-project-catalog-'));
    directories.push(directory);
    await mkdir(join(directory, 'bad', '.binaflow'), { recursive: true });
    await writeFile(join(directory, 'bad', '.binaflow', 'config.json'), '{broken');
    const catalog = new FileProjectCatalog(join(directory, 'projects.json'));
    await expect(
      catalog.register({ workspacePath: join(directory, 'bad'), ownerDeviceId: deviceId }),
    ).rejects.toThrow(/JSON/i);
    const workspace = await project(directory, 'one');
    const projectId = '123e4567-e89b-42d3-a456-426614174001';
    await catalog.register({ workspacePath: workspace, ownerDeviceId: deviceId, projectId });
    const other = await project(directory, 'two');
    await expect(
      catalog.register({ workspacePath: other, ownerDeviceId: deviceId, projectId }),
    ).rejects.toThrow(/already registered/i);
  });

  it('rejects symlink escapes while listing or registering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-project-catalog-'));
    const outside = await mkdtemp(join(tmpdir(), 'binaflow-project-outside-'));
    directories.push(directory, outside);
    await symlink(outside, join(directory, 'outside-link'), 'dir');
    const { listProjectDirectory } = await import('../src/web/project-catalog.js');
    await expect(
      listProjectDirectory([{ rootId, label: 'Projects', path: directory }], rootId),
    ).rejects.toThrow(/outside/i);
  });
});
