import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';

export interface WebTlsConfig {
  certFile: string;
  keyFile: string;
}

export interface WebConfig {
  host: string;
  port: number;
  origin: string;
  tls?: WebTlsConfig;
  sources?: { searchKeyFile?: string };
}

export async function loadWebConfig(path: string): Promise<WebConfig> {
  const text = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Web configuration is not valid JSON');
  }
  return parseWebConfig(value, path);
}

export function parseWebConfig(value: unknown, configPath = 'web-config.json'): WebConfig {
  if (!isRecord(value)) throw new Error('Web configuration must be an object');
  assertOnly(value, ['host', 'port', 'origin', 'tls', 'sources']);
  const host = value.host === undefined ? '127.0.0.1' : value.host;
  const port = value.port === undefined ? 4317 : value.port;
  if (
    typeof host !== 'string' ||
    !host ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Web host or port is invalid');
  }
  const origin = value.origin === undefined ? `http://${formatHost(host)}:${port}` : value.origin;
  if (typeof origin !== 'string') throw new Error('Web origin is invalid');
  const parsedOrigin = parseOrigin(origin);
  if (
    parsedOrigin.port !== String(port) &&
    !(
      parsedOrigin.port === '' &&
      ((parsedOrigin.protocol === 'http:' && port === 80) ||
        (parsedOrigin.protocol === 'https:' && port === 443))
    )
  ) {
    throw new Error('Web origin port must match the configured port');
  }
  const base = dirname(resolve(configPath));
  const tls = parseTls(value.tls, base);
  const sources = parseSources(value.sources, base);
  if (!isLoopbackHost(host) && (parsedOrigin.protocol !== 'https:' || !tls)) {
    throw new Error('Non-loopback web access requires HTTPS and cert/key files');
  }
  if (parsedOrigin.protocol === 'http:' && tls) {
    throw new Error('HTTP origin cannot be configured with TLS files');
  }
  return {
    host,
    port,
    origin,
    ...(tls ? { tls } : {}),
    ...(sources ? { sources } : {}),
  };
}

export function isLoopbackHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return host === '127.0.0.1';
  if (isIP(host) === 6) return host === '::1';
  return false;
}

function parseOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new Error('Web origin is invalid');
  }
  if (
    (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('Web origin must be an exact HTTP(S) origin');
  }
  return origin;
}

function parseTls(value: unknown, base: string): WebTlsConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasKeys(value, ['certFile', 'keyFile'])) {
    throw new Error('Web TLS configuration is invalid');
  }
  if (
    typeof value.certFile !== 'string' ||
    typeof value.keyFile !== 'string' ||
    !value.certFile ||
    !value.keyFile
  ) {
    throw new Error('Web TLS certificate paths are invalid');
  }
  return { certFile: resolve(base, value.certFile), keyFile: resolve(base, value.keyFile) };
}

function parseSources(value: unknown, base: string): WebConfig['sources'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Web source configuration is invalid');
  assertOnly(value, ['searchKeyFile']);
  if (value.searchKeyFile === undefined) return {};
  if (typeof value.searchKeyFile !== 'string' || !value.searchKeyFile) {
    throw new Error('Web search key path is invalid');
  }
  return { searchKeyFile: resolve(base, value.searchKeyFile) };
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function assertOnly(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('Unknown web configuration field');
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  assertOnly(value, keys);
  return keys.every((key) => typeof value[key] === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
