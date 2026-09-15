import { describe, expect, it } from 'vitest';
import { handleWebApi } from '../src/web/routes.js';

const projectId = '123e4567-e89b-42d3-a456-426614174000';
const deviceId = 'a'.repeat(64);
const project = {
  projectId,
  name: 'Project',
  workspacePath: '/private/project',
  configPath: '/private/project/.binaflow/config.json',
  dataDirPath: '/private/project/.binaflow/data',
  ownership: { status: 'active' as const, ownerDeviceId: deviceId },
  updatedAt: '2026-03-22T10:00:00.000Z',
};

const api = {
  projectRuntime: {
    getActiveProject: () => project,
    selectProject: async () => project,
    closeActiveProject: async () => undefined,
  },
  projectCatalog: {
    getRoots: () => [{ id: 'root-1', label: 'Projects' }],
    listProjects: async () => [project],
    listDirectory: async () => ({
      rootId: 'root-1',
      segments: [],
      items: [{ name: 'Project', segments: ['Project'], hasBinaflowConfig: true }],
      nextOffset: null,
    }),
    register: async () => project,
  },
};

describe('web project routes', () => {
  it('returns safe catalog and directory references without local paths', async () => {
    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/project-roots' }, api),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { items: [{ id: 'root-1', label: 'Projects' }] } },
    });
    await expect(
      handleWebApi(
        {
          method: 'GET',
          path: '/api/v1/project-directories',
          query: new URLSearchParams([
            ['rootId', 'root-1'],
            ['segment', 'child'],
          ]),
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 200, body: { data: { items: [{ name: 'Project' }] } } });
    const result = await handleWebApi({ method: 'GET', path: '/api/v1/projects' }, api);
    expect(JSON.stringify(result)).not.toContain('/private/');
  });

  it('selects and closes projects through explicit lifecycle endpoints', async () => {
    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/projects/current' }, api),
    ).resolves.toMatchObject({ status: 200, body: { data: { project: { id: projectId } } } });
    await expect(
      handleWebApi({ method: 'POST', path: `/api/v1/projects/${projectId}/select`, body: {} }, api),
    ).resolves.toMatchObject({ status: 200, body: { data: { id: projectId } } });
    await expect(
      handleWebApi({ method: 'POST', path: '/api/v1/projects/current/close', body: {} }, api),
    ).resolves.toMatchObject({ status: 200, body: { data: { project: null } } });
  });

  it('registers only through root references', async () => {
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/projects',
          body: { rootId: 'root-1', segments: ['Project'] },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 201, body: { data: { id: projectId } } });
    await expect(
      handleWebApi(
        { method: 'POST', path: '/api/v1/projects', body: { path: '/private/project' } },
        api,
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
  });
});
