import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateDeviceIdentity } from '../src/web/device-identity.js';
import { PeerAuth } from '../src/web/peer-auth.js';
import { FileProjectCatalog } from '../src/web/project-catalog.js';
import { createWebSettingsController, defaultWebSettings } from '../src/web/settings-store.js';
import { createLauncherTransferResources } from '../src/cli/commands/web-transfer.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('launcher transfer composition', () => {
  it('connects the experimental peer transport and transfer capability at the composition root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binaflow-launcher-composition-'));
    directories.push(root);
    const identity = await loadOrCreateDeviceIdentity({ directory: join(root, 'device') });
    const settingsPath = join(root, 'web.json');
    const settings = {
      ...defaultWebSettings(),
      peerTransport: {
        mode: 'lan-experimental' as const,
        host: '127.0.0.1',
        port: 4318,
        warningAccepted: true,
      },
    };
    const controller = createWebSettingsController(settingsPath, settings);
    const resources = await createLauncherTransferResources({
      settingsPath,
      settings: controller,
      identity,
      peerAuth: new PeerAuth(identity),
      catalog: new FileProjectCatalog(join(root, 'projects.json')),
      getActiveProject: () => undefined,
    });
    try {
      expect(resources.peerTransport).toBeDefined();
      await expect(
        resources.transfers.preview({
          transferId: 'transfer',
          requestId: 'request',
          projectId: 'project',
          targetProjectId: 'project',
          targetDeviceId: 'b'.repeat(64),
        }),
      ).resolves.toMatchObject({ blockers: ['project-not-active', 'peer-not-paired'] });
    } finally {
      await resources.close();
    }
  });
});
