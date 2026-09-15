import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceIdFromPublicKey, loadOrCreateDeviceIdentity } from '../src/web/device-identity.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('device identity', () => {
  it('creates one Ed25519 identity and reloads the same fingerprint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-device-'));
    directories.push(directory);
    const first = await loadOrCreateDeviceIdentity({ directory });
    const second = await loadOrCreateDeviceIdentity({ directory });
    expect(second.deviceId).toBe(first.deviceId);
    expect(deviceIdFromPublicKey(first.publicKeyPem)).toBe(first.deviceId);
    if (process.platform !== 'win32')
      expect((await stat(first.privateKeyPath)).mode & 0o777).toBe(0o600);
  });

  it('rejects an incomplete or mismatched key pair', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binaflow-device-'));
    directories.push(directory);
    const identity = await loadOrCreateDeviceIdentity({ directory });
    await rm(identity.publicKeyPath);
    await expect(loadOrCreateDeviceIdentity({ directory })).rejects.toThrow(/incomplete/i);
  });
});
