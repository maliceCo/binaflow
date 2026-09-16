import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceRecord, loadOrCreateDeviceIdentity } from '../src/web/device-identity.js';
import { PeerAuth } from '../src/web/peer-auth.js';
import {
  createPeerTransport,
  downloadTransferWithResume,
  validatePeerEndpoint,
} from '../src/web/peer-transport.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('experimental LAN peer transport', () => {
  it('authenticates requests and resumes package files by Range', async () => {
    const root = await mkdtemp(join('/tmp', 'binaflow-peer-transport-'));
    directories.push(root);
    const identityA = await loadOrCreateDeviceIdentity({ directory: join(root, 'a-device') });
    const identityB = await loadOrCreateDeviceIdentity({ directory: join(root, 'b-device') });
    const authA = new PeerAuth(identityA);
    const authB = new PeerAuth(identityB);
    const recordA = createDeviceRecord({
      identity: identityA,
      name: 'A',
      origin: 'http://127.0.0.1:1',
      certificateFingerprint: 'a'.repeat(64),
    });
    const recordB = createDeviceRecord({
      identity: identityB,
      name: 'B',
      origin: 'http://127.0.0.1:2',
      certificateFingerprint: 'b'.repeat(64),
    });
    authA.confirmPeerFingerprint(recordB);
    authB.confirmPeerFingerprint(recordA);
    const packagePath = join(root, 'package', 'payload.bin');
    const destination = join(root, 'received');
    const content = Buffer.from('0123456789'.repeat(200_000));
    await mkdir(join(root, 'package'), { recursive: true });
    await writeFile(packagePath, content);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'payload.bin'), content.subarray(0, 100));
    const digest = createHash('sha256').update(content).digest('hex');
    const port = await freePort();
    const transport = createPeerTransport({
      host: '127.0.0.1',
      port,
      auth: authB,
      source: {
        async getPackage(transferId) {
          if (transferId !== 'transfer-1') return undefined;
          return {
            transferId,
            digest,
            files: [{ path: 'payload.bin', sizeBytes: content.byteLength, sha256: digest }],
            open: (_path, start, end) => createReadStream(packagePath, { start, end }),
          };
        },
      },
    });
    await transport.start();
    try {
      const result = await downloadTransferWithResume({
        endpoint: transport.origin,
        peerId: identityB.deviceId,
        auth: authA,
        transferId: 'transfer-1',
        requestId: 'request-1',
        destination,
      });
      expect(result).toMatchObject({ transferId: 'transfer-1', digest, files: 1 });
      expect(await readFile(join(destination, 'payload.bin'))).toEqual(content);
    } finally {
      await transport.close();
    }
  });

  it('rejects non-private endpoints and unauthenticated requests', async () => {
    expect(() =>
      validatePeerEndpoint('http://8.8.8.8:4318/', {
        mode: 'lan-experimental',
        experimentalLanOptIn: true,
      }),
    ).toThrow(/private/i);
    expect(() => validatePeerEndpoint('http://192.168.1.20:4318/')).toThrow(/opt-in/i);
  });
});

async function freePort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
