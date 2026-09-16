import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebSettingsController, defaultWebSettings } from '../src/web/settings-store.js';
import { handleWebApi } from '../src/web/routes.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('web settings API', () => {
  it('returns safe settings and updates them only from loopback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-settings-api-'));
    directories.push(directory);
    const settings = defaultWebSettings();
    const controller = createWebSettingsController(join(directory, 'web.json'), settings);
    const api = { settings: controller };

    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/settings' }, api),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { setupRequired: true, projectRoots: [] } },
    });
    await expect(
      handleWebApi(
        {
          method: 'PUT',
          path: '/api/v1/settings',
          body: { deviceName: 'Missing address' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    await expect(
      handleWebApi(
        {
          method: 'PUT',
          path: '/api/v1/settings',
          remoteAddress: '192.0.2.10',
          body: { deviceName: 'Remote attempt' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    await expect(
      handleWebApi(
        {
          method: 'PUT',
          path: '/api/v1/settings',
          remoteAddress: '127.0.0.1',
          body: {
            deviceName: 'Desktop',
            web: { host: '127.0.0.1', port: 4317, origin: 'http://127.0.0.1:4317' },
            projectRoots: [
              {
                rootId: '00000000-0000-4000-8000-000000000001',
                label: 'Projects',
                path: '/tmp/projects',
              },
            ],
          },
        },
        api,
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { settings: { deviceName: 'Desktop' } } },
    });
    expect(controller.get().deviceName).toBe('Desktop');
  });

  it('rejects malformed and oversized TLS uploads before importing them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-settings-api-'));
    directories.push(directory);
    const controller = createWebSettingsController(
      join(directory, 'web.json'),
      defaultWebSettings(),
    );
    const api = { settings: controller };
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/settings/tls',
          body: { certificatePem: 'bad', keyPem: 'bad' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/settings/tls',
          remoteAddress: '127.0.0.1',
          body: { certificatePem: 'bad', keyPem: 'bad' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 422 });
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/settings/tls',
          remoteAddress: '127.0.0.1',
          body: { certificatePem: 'x'.repeat(65 * 1024), keyPem: 'key' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 413, body: { error: { code: 'too-large' } } });
  });
});
