import { describe, expect, it } from 'vitest';
import { createPersonalWebRuntime, ProjectBusyError } from '../src/application/web-runtime.js';
import type { ExecutionHost } from '../src/application/execution-host.js';
import type { ProjectCatalogEntry } from '../src/web/launcher-contracts.js';

const deviceId = 'a'.repeat(64);
const project = (id: string, name: string): ProjectCatalogEntry => ({
  projectId: id,
  name,
  workspacePath: `/projects/${name}`,
  configPath: `/projects/${name}/.binaflow/config.json`,
  dataDirPath: `/projects/${name}/.binaflow/data`,
  ownership: { status: 'active', ownerDeviceId: deviceId },
  updatedAt: '2026-03-22T10:00:00.000Z',
});

function fakeHost(
  state: () => 'idle' | 'busy' | 'closing' | 'closed',
  close: () => Promise<void>,
): ExecutionHost {
  return { getLifecycleState: state, close } as ExecutionHost;
}

describe('personal web project lifecycle', () => {
  it('owns one project and refuses switching while its host is busy', async () => {
    const first = project('123e4567-e89b-42d3-a456-426614174000', 'one');
    const second = project('123e4567-e89b-42d3-a456-426614174001', 'two');
    let current = [first, second];
    let state: 'idle' | 'busy' = 'idle';
    let closes = 0;
    const runtime = createPersonalWebRuntime({
      catalog: {
        list: async () => ({ schemaVersion: 1, projects: current }),
        updateOwnership: async (projectId, ownership) => {
          current = current.map((item) =>
            item.projectId === projectId ? { ...item, ownership } : item,
          );
          return current.find((item) => item.projectId === projectId)!;
        },
      },
      ownerDeviceId: deviceId,
      openProject: async (item) => ({
        project: item,
        context: {} as never,
        host: fakeHost(
          () => state,
          async () => {
            closes += 1;
          },
        ),
      }),
    });

    await expect(runtime.selectProject(first.projectId)).resolves.toMatchObject({ name: 'one' });
    expect(runtime.getActiveProject()?.projectId).toBe(first.projectId);
    state = 'busy';
    await expect(runtime.selectProject(second.projectId)).rejects.toBeInstanceOf(ProjectBusyError);
    expect(runtime.getActiveProject()?.projectId).toBe(first.projectId);
    state = 'idle';
    await expect(runtime.selectProject(second.projectId)).resolves.toMatchObject({ name: 'two' });
    expect(closes).toBe(1);
  });

  it('does not publish a failed destination and leaves no partial active owner', async () => {
    const first = project('123e4567-e89b-42d3-a456-426614174000', 'one');
    let opens = 0;
    const runtime = createPersonalWebRuntime({
      catalog: {
        list: async () => ({ schemaVersion: 1, projects: [first] }),
        updateOwnership: async () => {
          throw new Error('catalog failure');
        },
      },
      ownerDeviceId: deviceId,
      openProject: async () => {
        opens += 1;
        return {
          project: first,
          context: {} as never,
          host: fakeHost(
            () => 'idle',
            async () => undefined,
          ),
        };
      },
    });

    await expect(runtime.selectProject(first.projectId)).rejects.toThrow('catalog failure');
    expect(opens).toBe(1);
    expect(runtime.getActiveProject()).toBeUndefined();
  });
});
