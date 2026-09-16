import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateDeviceIdentity } from '../src/web/device-identity.js';
import { PeerAuth } from '../src/web/peer-auth.js';
import { createPeerTransport } from '../src/web/peer-transport.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('web peer transport boundary', () => {
  it('keeps the experimental listener opt-in and separate from the browser listener', async () => {
    const root = await mkdtemp(join('/tmp', 'binaflow-web-peer-'));
    directories.push(root);
    const identity = await loadOrCreateDeviceIdentity({ directory: root });
    const auth = new PeerAuth(identity);
    const source = { getPackage: async () => undefined };
    expect(() =>
      createPeerTransport({
        host: '192.168.1.5',
        port: 4318,
        mode: 'lan-experimental',
        auth,
        source,
      }),
    ).toThrow(/opt-in/i);
    expect(() =>
      createPeerTransport({
        host: '8.8.8.8',
        port: 4318,
        mode: 'lan-experimental',
        experimentalLanOptIn: true,
        auth,
        source,
      }),
    ).toThrow(/private/i);
    const transport = createPeerTransport({ host: '127.0.0.1', port: 4318, auth, source });
    expect(transport.origin).toBe('http://127.0.0.1:4318');
  });
});
