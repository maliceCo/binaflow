import {
  createHash,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  X509Certificate,
} from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LauncherSettings } from './launcher-contracts.js';
import { parseLauncherSettings } from './launcher-contracts.js';
import { parseWebConfig, type WebConfig } from './config.js';

export interface WebSettingsEnvironment {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  appDataDir?: string;
}

export interface SaveWebSettingsOptions {
  path: string;
  expectedSourceHash?: string;
}

export interface WebSettingsController {
  get(): LauncherSettings;
  update(value: unknown): Promise<{ settings: LauncherSettings; restartRequired: boolean }>;
  importTlsMaterial(
    certificatePem: string,
    keyPem: string,
  ): Promise<{ certFile: string; keyFile: string }>;
}

export const DEFAULT_WEB_SETTINGS_FILE = 'web.json';

export function resolveDefaultWebSettingsPath(environment: WebSettingsEnvironment = {}): string {
  const platform = environment.platform ?? process.platform;
  const env = environment.env ?? process.env;
  if (platform === 'win32') {
    const base = environment.appDataDir ?? env.APPDATA;
    if (!base) throw new Error('APPDATA is required to resolve web settings');
    return join(base, 'binaflow', DEFAULT_WEB_SETTINGS_FILE);
  }
  const base = env.XDG_CONFIG_HOME ?? join(environment.homeDir ?? env.HOME ?? homedir(), '.config');
  return join(base, 'binaflow', DEFAULT_WEB_SETTINGS_FILE);
}

export function defaultWebSettings(): LauncherSettings {
  return {
    schemaVersion: 1,
    setupRequired: true,
    deviceName: 'Binaflow',
    web: {
      host: '127.0.0.1',
      port: 4317,
      origin: 'http://127.0.0.1:4317',
    },
    projectRoots: [],
  };
}

export async function loadOrBootstrapWebSettings(
  path = resolveDefaultWebSettingsPath(),
): Promise<LauncherSettings> {
  try {
    return parseLauncherSettings(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (!isMissingFile(error)) {
      const backup = `${path}.last-good`;
      try {
        return parseLauncherSettings(JSON.parse(await readFile(backup, 'utf8')));
      } catch {
        if (isMissingFile(error)) return defaultWebSettings();
        throw new Error(`Cannot load web settings ${path}`);
      }
    }
    return defaultWebSettings();
  }
}

export async function readWebSettingsSourceHash(path: string): Promise<string | undefined> {
  try {
    return hash(await readFile(path));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

export async function saveWebSettingsAtomically(
  settings: LauncherSettings,
  options: SaveWebSettingsOptions,
): Promise<string> {
  const validated = parseLauncherSettings(settings);
  const current = await readFileIfPresent(options.path);
  const currentHash = current === undefined ? undefined : hash(current);
  if (options.expectedSourceHash !== undefined && options.expectedSourceHash !== currentHash) {
    throw new Error('Web settings changed since the preview; confirm again');
  }
  await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${options.path}.${randomSuffix()}.tmp`;
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    if (current !== undefined) {
      await writeFile(`${options.path}.last-good`, current, { encoding: 'utf8', mode: 0o600 });
      await chmod(`${options.path}.last-good`, 0o600);
    }
    await rename(temporaryPath, options.path);
    await chmod(options.path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return hash(Buffer.from(serialized, 'utf8'));
}

export function launcherSettingsToWebConfig(settings: LauncherSettings): WebConfig {
  return parseWebConfig(
    {
      host: settings.web.host,
      port: settings.web.port,
      origin: settings.web.origin,
      ...(settings.web.tls === undefined ? {} : { tls: settings.web.tls }),
    },
    'global-web-settings.json',
  );
}

async function readFileIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomSuffix(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function webSettingsExist(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function removeWebSettings(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(`${path}.last-good`, { force: true });
}

export function validateWebSettingsPreview(value: unknown): LauncherSettings {
  return parseLauncherSettings(value);
}

export function createWebSettingsController(
  path: string,
  initial: LauncherSettings,
  initialSourceHash?: string,
): WebSettingsController {
  let current = initial;
  let sourceHash = initialSourceHash;
  return {
    get: () => current,
    update: async (value) => {
      const next = validateWebSettingsPreview(value);
      const previous = current;
      const nextHash = await saveWebSettingsAtomically(next, {
        path,
        ...(sourceHash === undefined ? {} : { expectedSourceHash: sourceHash }),
      });
      current = next;
      sourceHash = nextHash;
      return {
        settings: current,
        restartRequired:
          previous.web.host !== next.web.host ||
          previous.web.port !== next.web.port ||
          previous.web.origin !== next.web.origin ||
          JSON.stringify(previous.web.tls) !== JSON.stringify(next.web.tls) ||
          JSON.stringify(previous.peerTransport) !== JSON.stringify(next.peerTransport),
      };
    },
    importTlsMaterial: (certificatePem, keyPem) =>
      importTlsMaterial({ certificatePem, keyPem, directory: dirname(path) }),
  };
}

export async function importTlsMaterial(input: {
  certificatePem: string;
  keyPem: string;
  directory: string;
}): Promise<{ certFile: string; keyFile: string }> {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(input.certificatePem);
    const privateKey = createPrivateKey(input.keyPem);
    const certificateKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
    const privateKeyPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    if (
      certificateKey.byteLength !== privateKeyPublic.byteLength ||
      !timingSafeEqual(Buffer.from(certificateKey), Buffer.from(privateKeyPublic))
    ) {
      throw new Error('TLS certificate and key do not match');
    }
  } catch (error) {
    throw new Error(
      `Invalid TLS certificate or key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!certificate.subject) throw new Error('TLS certificate is invalid');
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const suffix = randomSuffix();
  const certFile = join(input.directory, `tls-${suffix}.crt.pem`);
  const keyFile = join(input.directory, `tls-${suffix}.key.pem`);
  try {
    await writeFile(certFile, input.certificatePem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(keyFile, input.keyPem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(certFile, 0o600);
    await chmod(keyFile, 0o600);
    return { certFile, keyFile };
  } catch (error) {
    await rm(certFile, { force: true });
    await rm(keyFile, { force: true });
    throw error;
  }
}

export async function copyWebSettings(path: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(path, destination);
  await chmod(destination, 0o600);
}
