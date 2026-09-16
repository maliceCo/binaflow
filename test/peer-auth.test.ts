import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceRecord, loadOrCreateDeviceIdentity } from '../src/web/device-identity.js';
import { FileDeviceStore } from '../src/web/device-store.js';
import { PeerAuth } from '../src/web/peer-auth.js';

const directories: string[] = [];
const fingerprint = 'c'.repeat(64);

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('peer authentication', () => {
  it('pairs with a one-use code and authenticates signed nonces', async () => {
    const root = await mkdtemp(joinTemp());
    directories.push(root);
    const identityA = await loadOrCreateDeviceIdentity({ directory: `${root}/a` });
    const identityB = await loadOrCreateDeviceIdentity({ directory: `${root}/b` });
    let now = 1_000_000;
    const authA = new PeerAuth(identityA, { now: () => now, randomCode: () => '12345678' });
    const authB = new PeerAuth(identityB, { now: () => now, randomCode: () => '87654321' });
    const offer = authA.beginPairing();
    const answer = authA.answerPairingChallenge({
      pairingId: offer.pairingId,
      code: offer.code,
      name: 'Laptop',
      origin: 'https://laptop.test:4317',
      publicKey: identityB.publicKeyPem,
      certificateFingerprint: fingerprint,
    });
    const recordB = createDeviceRecord({
      identity: identityB,
      name: 'Laptop',
      origin: answer.origin,
      certificateFingerprint: fingerprint,
      pairedAt: new Date(now).toISOString(),
    });
    authA.confirmPeerFingerprint(recordB);
    const recordA = createDeviceRecord({
      identity: identityA,
      name: 'Desktop',
      origin: 'https://desktop.test:4317',
      certificateFingerprint: fingerprint,
      pairedAt: new Date(now).toISOString(),
    });
    authB.confirmPeerFingerprint(recordA);
    const signed = authB.signRequest(identityA.deviceId, { transferId: 'transfer-1' });
    expect(authA.verifyRequest(signed)).toEqual({ transferId: 'transfer-1' });
    expect(() => authA.verifyRequest(signed)).toThrow(/replayed/i);
    const late = authB.signRequest(identityA.deviceId, { transferId: 'late' });
    now += 100_000;
    expect(() => authA.verifyRequest(late)).toThrow(/timestamp/i);
  });

  it('persists paired and revoked peers across auth restarts', async () => {
    const root = await mkdtemp(joinTemp());
    directories.push(root);
    const identity = await loadOrCreateDeviceIdentity({ directory: `${root}/local` });
    const peer = await loadOrCreateDeviceIdentity({ directory: `${root}/peer` });
    const store = new FileDeviceStore(`${root}/devices.json`);
    const auth = new PeerAuth(identity, { persistPeers: (peers) => store.save(peers) });
    const record = createDeviceRecord({
      identity: peer,
      name: 'Peer',
      origin: 'https://peer.test',
      certificateFingerprint: fingerprint,
    });
    auth.confirmPeerFingerprint(record);
    const reloaded = new PeerAuth(identity, {
      peers: store.load(),
      persistPeers: (peers) => store.save(peers),
    });
    expect(reloaded.listPeers()).toEqual([record]);
    reloaded.revokePeer(record.deviceId);
    const revoked = new PeerAuth(identity, { peers: store.load() });
    expect(revoked.listPeers()[0]).toMatchObject({ deviceId: record.deviceId, status: 'revoked' });
  });

  it('expires, limits, and revokes pairing', async () => {
    const root = await mkdtemp(joinTemp());
    directories.push(root);
    const identity = await loadOrCreateDeviceIdentity({ directory: `${root}/local` });
    const peer = await loadOrCreateDeviceIdentity({ directory: `${root}/peer` });
    let now = 10_000;
    const auth = new PeerAuth(identity, {
      now: () => now,
      randomCode: () => 'code',
      pairingTtlMs: 100,
      maxAttempts: 1,
    });
    const offer = auth.beginPairing();
    expect(() =>
      auth.answerPairingChallenge({
        pairingId: offer.pairingId,
        code: 'bad',
        name: 'Peer',
        origin: 'https://peer.test',
        publicKey: peer.publicKeyPem,
        certificateFingerprint: fingerprint,
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      auth.answerPairingChallenge({
        pairingId: offer.pairingId,
        code: 'bad',
        name: 'Peer',
        origin: 'https://peer.test',
        publicKey: peer.publicKeyPem,
        certificateFingerprint: fingerprint,
      }),
    ).toThrow(/attempts/i);
    const second = auth.beginPairing();
    now += 101;
    expect(() =>
      auth.answerPairingChallenge({
        pairingId: second.pairingId,
        code: second.code,
        name: 'Peer',
        origin: 'https://peer.test',
        publicKey: peer.publicKeyPem,
        certificateFingerprint: fingerprint,
      }),
    ).toThrow(/expired/i);
  });
});

function joinTemp(): string {
  return `${tmpdir()}/binaflow-peer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
