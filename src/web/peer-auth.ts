import { createHash, randomBytes, verify } from 'node:crypto';
import type { DeviceRecord } from './launcher-contracts.js';
import { parseDeviceRecord } from './launcher-contracts.js';
import {
  deviceIdFromPublicKey,
  signDevicePayload,
  type DeviceIdentity,
} from './device-identity.js';

export interface PairingOffer {
  pairingId: string;
  code: string;
  deviceId: string;
  expiresAt: number;
}

export interface PairingAnswer {
  pairingId: string;
  deviceId: string;
  name: string;
  origin: string;
  publicKey: string;
  certificateFingerprint: string;
}

export interface SignedPeerRequest {
  deviceId: string;
  nonce: string;
  timestamp: number;
  body: unknown;
  signature: string;
}

export interface PeerAuthOptions {
  now?: () => number;
  randomCode?: () => string;
  pairingTtlMs?: number;
  maxAttempts?: number;
  maxClockSkewMs?: number;
  allowExperimentalHttpOrigin?: boolean;
}

interface PendingPairing {
  readonly codeHash: string;
  readonly expiresAt: number;
  attempts: number;
}

export class PeerAuth {
  private readonly pending = new Map<string, PendingPairing>();
  private readonly peers = new Map<string, DeviceRecord>();
  private readonly usedNonces = new Set<string>();
  private readonly now: () => number;
  private readonly randomCode: () => string;
  private readonly pairingTtlMs: number;
  private readonly maxAttempts: number;
  private readonly maxClockSkewMs: number;
  private readonly allowExperimentalHttpOrigin: boolean;

  constructor(
    private readonly identity: DeviceIdentity,
    options: PeerAuthOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.randomCode = options.randomCode ?? (() => randomBytes(4).toString('hex'));
    this.pairingTtlMs = options.pairingTtlMs ?? 5 * 60 * 1000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.maxClockSkewMs = options.maxClockSkewMs ?? 60 * 1000;
    this.allowExperimentalHttpOrigin = options.allowExperimentalHttpOrigin === true;
  }

  beginPairing(): PairingOffer {
    const pairingId = randomBytes(16).toString('hex');
    const code = this.randomCode();
    const expiresAt = this.now() + this.pairingTtlMs;
    this.pending.set(pairingId, {
      codeHash: hash(code),
      expiresAt,
      attempts: 0,
    });
    return { pairingId, code, deviceId: this.identity.deviceId, expiresAt };
  }

  answerPairingChallenge(input: {
    pairingId: string;
    code: string;
    name: string;
    origin: string;
    publicKey: string;
    certificateFingerprint: string;
  }): PairingAnswer {
    const pending = this.pending.get(input.pairingId);
    if (!pending || pending.expiresAt < this.now()) {
      this.pending.delete(input.pairingId);
      throw new Error('Pairing code expired or unknown');
    }
    pending.attempts += 1;
    if (pending.attempts > this.maxAttempts) {
      this.pending.delete(input.pairingId);
      throw new Error('Pairing attempts exceeded');
    }
    if (hash(input.code) !== pending.codeHash) throw new Error('Invalid pairing code');
    const deviceId = deviceIdFromPublicKey(input.publicKey);
    const secureOrigin = /^https:\/\//.test(input.origin);
    const experimentalHttpOrigin =
      this.allowExperimentalHttpOrigin && /^http:\/\//.test(input.origin);
    if (!secureOrigin && !experimentalHttpOrigin) {
      throw new Error('Peer origin must use HTTPS unless experimental HTTP is enabled');
    }
    this.pending.delete(input.pairingId);
    return {
      pairingId: input.pairingId,
      deviceId,
      name: input.name,
      origin: input.origin,
      publicKey: input.publicKey,
      certificateFingerprint: input.certificateFingerprint,
    };
  }

  confirmPeerFingerprint(record: DeviceRecord, expectedFingerprint?: string): DeviceRecord {
    const parsed = parseDeviceRecord(record);
    if (parsed.status !== 'paired') throw new Error('Revoked device cannot be paired');
    if (parsed.deviceId === this.identity.deviceId) throw new Error('Cannot pair the local device');
    if (deviceIdFromPublicKey(parsed.publicKey) !== parsed.deviceId) {
      throw new Error('Peer public key does not match device ID');
    }
    if (
      expectedFingerprint !== undefined &&
      parsed.certificateFingerprint !== expectedFingerprint
    ) {
      throw new Error('Peer certificate fingerprint changed');
    }
    this.peers.set(parsed.deviceId, parsed);
    return parsed;
  }

  listPeers(): DeviceRecord[] {
    return [...this.peers.values()];
  }

  revokePeer(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (!peer) return;
    this.peers.set(deviceId, {
      ...peer,
      status: 'revoked',
      revokedAt: new Date(this.now()).toISOString(),
    });
  }

  signRequest(peerId: string, body: unknown): SignedPeerRequest {
    const peer = this.peers.get(peerId);
    if (!peer || peer.status !== 'paired') throw new Error('Peer is not paired');
    const request = {
      deviceId: this.identity.deviceId,
      nonce: randomBytes(16).toString('hex'),
      timestamp: this.now(),
      body,
    };
    return { ...request, signature: signDevicePayload(this.identity, canonicalPayload(request)) };
  }

  verifyRequest(request: SignedPeerRequest): unknown {
    const peer = this.peers.get(request.deviceId);
    if (!peer || peer.status !== 'paired') throw new Error('Peer is not paired');
    if (Math.abs(this.now() - request.timestamp) > this.maxClockSkewMs) {
      throw new Error('Peer request timestamp is outside the allowed window');
    }
    if (this.usedNonces.has(request.nonce)) throw new Error('Peer request was replayed');
    const valid = verify(
      null,
      Buffer.from(
        canonicalPayload({
          deviceId: request.deviceId,
          nonce: request.nonce,
          timestamp: request.timestamp,
          body: request.body,
        }),
        'utf8',
      ),
      peer.publicKey,
      Buffer.from(request.signature, 'base64url'),
    );
    if (!valid) throw new Error('Peer request signature is invalid');
    this.usedNonces.add(request.nonce);
    return request.body;
  }
}

export function beginPairing(auth: PeerAuth): PairingOffer {
  return auth.beginPairing();
}

export function answerPairingChallenge(
  auth: PeerAuth,
  input: Parameters<PeerAuth['answerPairingChallenge']>[0],
): PairingAnswer {
  return auth.answerPairingChallenge(input);
}

export function confirmPeerFingerprint(
  auth: PeerAuth,
  record: DeviceRecord,
  expectedFingerprint?: string,
): DeviceRecord {
  return auth.confirmPeerFingerprint(record, expectedFingerprint);
}

export function revokePeer(auth: PeerAuth, deviceId: string): void {
  auth.revokePeer(deviceId);
}

function canonicalPayload(value: {
  deviceId: string;
  nonce: string;
  timestamp: number;
  body: unknown;
}): string {
  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
