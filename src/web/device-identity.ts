import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeviceRecord } from './launcher-contracts.js';

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
  readonly privateKeyPath: string;
  readonly publicKeyPath: string;
}

export interface DeviceIdentityOptions {
  directory: string;
  privateKeyFile?: string;
  publicKeyFile?: string;
}

export async function loadOrCreateDeviceIdentity(
  options: DeviceIdentityOptions,
): Promise<DeviceIdentity> {
  const privateKeyPath = join(options.directory, options.privateKeyFile ?? 'device-key.pem');
  const publicKeyPath = join(options.directory, options.publicKeyFile ?? 'device-public.pem');
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const existingPrivateKeyPem = await readOptional(privateKeyPath);
  const existingPublicKeyPem = await readOptional(publicKeyPath);
  if (existingPrivateKeyPem !== undefined || existingPublicKeyPem !== undefined) {
    if (existingPrivateKeyPem === undefined || existingPublicKeyPem === undefined) {
      throw new Error('Device key pair is incomplete');
    }
    const derivedPublicKeyPem = publicKeyPemFromPrivate(existingPrivateKeyPem);
    if (normalizePem(derivedPublicKeyPem) !== normalizePem(existingPublicKeyPem)) {
      throw new Error('Device key pair does not match');
    }
    return {
      deviceId: deviceIdFromPublicKey(existingPublicKeyPem),
      publicKeyPem: existingPublicKeyPem,
      privateKeyPem: existingPrivateKeyPem,
      privateKeyPath,
      publicKeyPath,
    };
  }

  const generated = generateKeyPairSync('ed25519');
  const privateKeyPem = generated.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = generated.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    await writeFile(privateKeyPath, privateKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(publicKeyPath, publicKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    await chmod(privateKeyPath, 0o600);
    await chmod(publicKeyPath, 0o644);
  } catch (error) {
    await rm(privateKeyPath, { force: true });
    await rm(publicKeyPath, { force: true });
    throw error;
  }
  return {
    deviceId: deviceIdFromPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    privateKeyPath,
    publicKeyPath,
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export function deviceIdFromPublicKey(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(publicKey).digest('hex');
}

export function createDeviceRecord(input: {
  identity: DeviceIdentity;
  name: string;
  origin: string;
  certificateFingerprint: string;
  pairedAt?: string;
}): DeviceRecord {
  return {
    schemaVersion: 1,
    deviceId: input.identity.deviceId,
    name: input.name,
    origin: input.origin,
    publicKey: input.identity.publicKeyPem,
    certificateFingerprint: input.certificateFingerprint,
    status: 'paired',
    pairedAt: input.pairedAt ?? new Date().toISOString(),
  };
}

export function signDevicePayload(identity: DeviceIdentity, payload: string): string {
  const privateKey = createPrivateKey(identity.privateKeyPem);
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
}

function publicKeyPemFromPrivate(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

function normalizePem(value: string): string {
  return value.replace(/\s+/g, '');
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
