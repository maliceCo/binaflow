import { describe, expect, it } from 'vitest';
import { handleWebApi } from '../src/web/routes.js';

const device = {
  schemaVersion: 1 as const,
  deviceId: 'a'.repeat(64),
  name: 'Laptop',
  origin: 'https://laptop.test:4317',
  publicKey: '-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----\n',
  certificateFingerprint: 'b'.repeat(64),
  status: 'paired' as const,
  pairedAt: '2026-03-22T10:00:00.000Z',
};

const api = {
  devices: {
    list: () => [device],
    beginPairing: () => ({
      pairingId: 'pair-1',
      code: '12345678',
      deviceId: 'c'.repeat(64),
      expiresAt: 1000,
    }),
    confirmPeer: () => device,
    revokePeer: () => undefined,
  },
};

describe('web device API', () => {
  it('projects device records and keeps pairing actions explicit', async () => {
    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/devices' }, api),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { items: [{ id: device.deviceId, name: 'Laptop', status: 'paired' }] } },
    });
    await expect(
      handleWebApi({ method: 'POST', path: '/api/v1/devices/pairing', body: {} }, api),
    ).resolves.toMatchObject({ status: 200, body: { data: { code: '12345678' } } });
    await expect(
      handleWebApi(
        { method: 'POST', path: '/api/v1/devices/revoke', body: { deviceId: device.deviceId } },
        api,
      ),
    ).resolves.toMatchObject({ status: 200, body: { data: { revoked: true } } });
  });

  it('rejects arbitrary device ids and unknown action fields', async () => {
    await expect(
      handleWebApi(
        { method: 'POST', path: '/api/v1/devices/revoke', body: { deviceId: '/etc/passwd' } },
        api,
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
    await expect(
      handleWebApi(
        { method: 'POST', path: '/api/v1/devices/pairing', body: { path: '/tmp' } },
        api,
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
  });
});
