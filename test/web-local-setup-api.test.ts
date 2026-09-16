import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverProjectRootCandidates } from '../src/web/project-catalog.js';
import { handleWebApi } from '../src/web/routes.js';
import { createWebSettingsController, defaultWebSettings } from '../src/web/settings-store.js';

const directories: string[] = [];
const candidateId = '00000000-0000-4000-8000-000000000001';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('local setup roots API', () => {
  it('discovers existing directories with opaque UUID candidates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-local-setup-'));
    directories.push(directory);
    const candidates = await discoverProjectRootCandidates({ candidates: [directory] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ label: directory.split('/').pop() });
    expect(candidates[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(candidates[0]?.path).toBe(directory);
  });

  it('authorizes an opaque server-side candidate only from loopback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-local-setup-'));
    directories.push(directory);
    const controller = createWebSettingsController(
      join(directory, 'web.json'),
      defaultWebSettings(),
    );
    const api = {
      settings: controller,
      projectCatalog: {
        getRoots: () => [],
        listSetupRoots: async () => [{ id: candidateId, label: 'Projects' }],
        authorizeSetupRoot: async (id: string) => {
          expect(id).toBe(candidateId);
          return controller.update({
            ...controller.get(),
            projectRoots: [{ rootId: id, label: 'Projects', path: directory }],
          });
        },
        listProjects: async () => [],
        listDirectory: async () => ({
          rootId: candidateId,
          segments: [],
          items: [],
          nextOffset: null,
        }),
        register: async () => {
          throw new Error('not used');
        },
      },
    };

    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/setup-roots' }, api),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { items: [{ id: candidateId, label: 'Projects' }] } },
    });
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/setup-roots',
          remoteAddress: '192.0.2.10',
          body: { candidateId },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 403 });
    const response = await handleWebApi(
      {
        method: 'POST',
        path: '/api/v1/setup-roots',
        remoteAddress: '127.0.0.1',
        body: { candidateId },
      },
      api,
    );
    expect(response).toMatchObject({
      status: 200,
      body: { data: { settings: { projectRoots: [{ id: candidateId }] } } },
    });
    expect(JSON.stringify(response)).not.toContain(directory);
  });
});
