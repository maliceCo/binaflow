import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { dirname, normalize, relative, resolve, sep } from 'node:path';
import ipaddr from 'ipaddr.js';
import type { PeerAuth, SignedPeerRequest } from './peer-auth.js';

export type PeerTransportMode = 'loopback' | 'lan-experimental';

export interface PeerTransferFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface PeerTransferPackage {
  transferId: string;
  digest: string;
  files: readonly PeerTransferFile[];
  open: (path: string, start: number, end: number) => NodeJS.ReadableStream;
}

export interface PeerTransportSource {
  getPackage: (transferId: string, requestId: string) => Promise<PeerTransferPackage | undefined>;
}

export interface PeerTransportOptions {
  host: string;
  port: number;
  mode?: PeerTransportMode;
  experimentalLanOptIn?: boolean;
  auth: PeerAuth;
  source: PeerTransportSource;
}

export interface PeerTransport {
  readonly origin: string;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface DownloadTransferResult {
  transferId: string;
  digest: string;
  bytesReceived: number;
  files: number;
}

const MAX_RANGE_BYTES = 16 * 1024 * 1024;

export function validatePeerEndpoint(
  endpoint: string,
  options: { mode?: PeerTransportMode; experimentalLanOptIn?: boolean } = {},
): URL {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Peer endpoint must be an origin without credentials or paths');
  }
  const mode = options.mode ?? 'loopback';
  if (url.protocol !== 'http:')
    throw new Error('Only HTTP peer transport is supported by this adapter');
  const address = parseAddress(url.hostname);
  if (address === undefined) throw new Error('Peer endpoint must use a literal IP address');
  const loopback = address.range() === 'loopback';
  if (!loopback && (mode !== 'lan-experimental' || options.experimentalLanOptIn !== true)) {
    throw new Error('LAN experimental peer transport requires explicit opt-in');
  }
  if (!loopback && !isPrivateAddress(address)) throw new Error('Peer endpoint must be private');
  return url;
}

export function createPeerTransport(options: PeerTransportOptions): PeerTransport {
  const mode = options.mode ?? 'loopback';
  if (mode === 'lan-experimental' && options.experimentalLanOptIn !== true) {
    throw new Error('LAN experimental peer transport requires explicit opt-in');
  }
  if (mode === 'loopback' && !isLoopbackHost(options.host)) {
    throw new Error('Loopback peer transport must bind to loopback');
  }
  if (mode === 'lan-experimental' && !isAllowedBindHost(options.host)) {
    throw new Error('LAN experimental peer transport must bind to a private address');
  }
  const server = createServer((request, response) => {
    void serveTransferRange(request, response, options).catch((cause: unknown) => {
      if (!response.headersSent) sendError(response, cause);
      else response.destroy();
    });
  });
  return {
    origin: `http://${formatHost(options.host)}:${options.port}`,
    start: () => listen(server, options.port, options.host),
    close: () => close(server),
  };
}

export async function serveTransferRange(
  request: IncomingMessage,
  response: ServerResponse,
  options: PeerTransportOptions,
): Promise<void> {
  if (request.method !== 'GET')
    return sendError(response, new Error('Peer method is not allowed'), 405);
  const manifestMatch = request.url?.match(/^\/peer\/v1\/transfers\/([^/]+)\/manifest$/);
  const fileMatch = request.url?.match(/^\/peer\/v1\/transfers\/([^/]+)\/files\/(.+)$/);
  if (!manifestMatch && !fileMatch)
    return sendError(response, new Error('Peer target is not found'), 404);
  const transferId = decodeSegment((manifestMatch ?? fileMatch)![1]!);
  const filePath = fileMatch ? decodeRelativePath(fileMatch[2]!) : undefined;
  const requestId = header(request, 'x-binaflow-request-id');
  if (!requestId) throw new Error('Peer request ID is required');
  const signed = signedRequest(request, {
    method: request.method,
    target: request.url ?? '',
    transferId,
    requestId,
    range: header(request, 'range') ?? '',
  });
  options.auth.verifyRequest(signed);
  const packageData = await options.source.getPackage(transferId, requestId);
  if (!packageData) return sendError(response, new Error('Transfer is not available'), 404);
  if (!filePath) {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({ transferId, digest: packageData.digest, files: packageData.files }),
    );
    return;
  }
  const file = packageData.files.find((item) => item.path === filePath);
  if (!file) return sendError(response, new Error('Transfer file is not available'), 404);
  const range = parseRange(header(request, 'range'), file.sizeBytes);
  const end = range?.end ?? file.sizeBytes - 1;
  const start = range?.start ?? 0;
  if (end - start + 1 > MAX_RANGE_BYTES)
    return sendError(response, new Error('Range is too large'), 416);
  response.statusCode = range ? 206 : 200;
  response.setHeader('Content-Type', 'application/octet-stream');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Range', `bytes ${start}-${end}/${file.sizeBytes}`);
  response.setHeader('Content-Length', String(end - start + 1));
  response.setHeader('X-Binaflow-Transfer-Digest', packageData.digest);
  packageData.open(file.path, start, end).pipe(response);
}

export async function downloadTransferWithResume(input: {
  endpoint: string;
  peerId: string;
  auth: PeerAuth;
  transferId: string;
  requestId: string;
  destination: string;
  mode?: PeerTransportMode;
  experimentalLanOptIn?: boolean;
  onProgress?: (receivedBytes: number, totalBytes: number) => void;
}): Promise<DownloadTransferResult> {
  const endpoint = validatePeerEndpoint(input.endpoint, input);
  const manifestPath = `/peer/v1/transfers/${encodeURIComponent(input.transferId)}/manifest`;
  const manifestResponse = await signedFetch({ ...input, endpoint, path: manifestPath, range: '' });
  if (!manifestResponse.ok)
    throw new Error(`Peer manifest request failed (${manifestResponse.status})`);
  const manifest = (await manifestResponse.json()) as {
    transferId: string;
    digest: string;
    files: PeerTransferFile[];
  };
  if (manifest.transferId !== input.transferId || !Array.isArray(manifest.files)) {
    throw new Error('Peer manifest is invalid');
  }
  let receivedBytes = 0;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  await mkdir(input.destination, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    const relativePath = decodeRelativePath(file.path);
    const destination = resolve(input.destination, relativePath);
    if (
      destination !== resolve(input.destination, relativePath) ||
      relative(resolve(input.destination), destination).startsWith(`..${sep}`)
    ) {
      throw new Error('Peer manifest contains an unsafe path');
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const existing = await existingSize(destination);
    if (existing > file.sizeBytes)
      throw new Error('Existing transfer file is larger than manifest');
    let fileBytes = existing;
    receivedBytes += existing;
    input.onProgress?.(receivedBytes, totalBytes);
    while (fileBytes < file.sizeBytes) {
      const end = Math.min(fileBytes + MAX_RANGE_BYTES - 1, file.sizeBytes - 1);
      const range = `bytes=${fileBytes}-${end}`;
      const response = await signedFetch({
        ...input,
        endpoint,
        path: `/peer/v1/transfers/${encodeURIComponent(input.transferId)}/files/${encodePath(file.path)}`,
        range,
      });
      if (!response.ok || response.status !== 206) {
        throw new Error(`Peer file request failed (${response.status})`);
      }
      if (!response.body) throw new Error('Peer response has no body');
      const offset = fileBytes;
      const output = createWriteStream(destination, {
        flags: offset === 0 ? 'w' : 'r+',
        start: offset,
      });
      await pipeWebStream(response.body, output, (chunkBytes) => {
        fileBytes += chunkBytes;
        receivedBytes += chunkBytes;
        input.onProgress?.(receivedBytes, totalBytes);
      });
      if (fileBytes > file.sizeBytes || fileBytes === offset) {
        throw new Error('Peer file response is incomplete');
      }
    }
    if (fileBytes !== file.sizeBytes) throw new Error('Peer file response is incomplete');
    if ((await sha256(destination)) !== file.sha256)
      throw new Error('Peer file digest does not match');
  }
  return {
    transferId: manifest.transferId,
    digest: manifest.digest,
    bytesReceived: receivedBytes,
    files: manifest.files.length,
  };
}

async function signedFetch(input: {
  endpoint: URL;
  path: string;
  range: string;
  peerId: string;
  auth: PeerAuth;
  transferId: string;
  requestId: string;
}): Promise<Response> {
  const target = `${input.path}`;
  const body = {
    method: 'GET',
    target,
    transferId: input.transferId,
    requestId: input.requestId,
    range: input.range,
  };
  const signed = input.auth.signRequest(input.peerId, body);
  return fetch(new URL(target, input.endpoint), {
    headers: {
      'X-Binaflow-Device-Id': signed.deviceId,
      'X-Binaflow-Nonce': signed.nonce,
      'X-Binaflow-Timestamp': String(signed.timestamp),
      'X-Binaflow-Signature': signed.signature,
      'X-Binaflow-Request-Id': input.requestId,
      ...(input.range ? { Range: input.range } : {}),
    },
  });
}

function signedRequest(request: IncomingMessage, body: Record<string, string>): SignedPeerRequest {
  const deviceId = header(request, 'x-binaflow-device-id');
  const nonce = header(request, 'x-binaflow-nonce');
  const timestamp = Number(header(request, 'x-binaflow-timestamp'));
  const signature = header(request, 'x-binaflow-signature');
  if (!deviceId || !nonce || !Number.isSafeInteger(timestamp) || !signature) {
    throw new Error('Peer signature headers are required');
  }
  return { deviceId, nonce, timestamp, signature, body };
}

function parseRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) throw new Error('Invalid byte range');
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start > requestedEnd ||
    requestedEnd >= size
  ) {
    throw new Error('Invalid byte range');
  }
  return { start, end: requestedEnd };
}

function decodeRelativePath(value: string): string {
  const decoded = decodeURIComponent(value);
  const normalized = normalize(decoded).replaceAll('\\', '/');
  if (
    !decoded ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/')
  ) {
    throw new Error('Peer path is unsafe');
  }
  return normalized;
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function decodeSegment(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.includes('/') || decoded.includes('\\'))
    throw new Error('Transfer ID is invalid');
  return decoded;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseAddress(value: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  try {
    return ipaddr.parse(value.replace(/^\[(.*)\]$/, '$1'));
  } catch {
    return undefined;
  }
}

function isPrivateAddress(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  return ['private', 'uniquelocal'].includes(address.range());
}

function isLoopbackHost(host: string): boolean {
  const address = parseAddress(host);
  return address?.range() === 'loopback';
}

function isAllowedBindHost(host: string): boolean {
  const address = parseAddress(host);
  return address !== undefined && (address.range() === 'loopback' || isPrivateAddress(address));
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function sendError(response: ServerResponse, cause: unknown, status = 400): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({ error: cause instanceof Error ? cause.message : 'Peer request failed' }),
  );
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function existingSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function pipeWebStream(
  input: ReadableStream<Uint8Array>,
  output: NodeJS.WritableStream,
  onChunk: (bytes: number) => void,
): Promise<void> {
  const readable = Readable.fromWeb(input as never);
  await new Promise<void>((resolvePipe, reject) => {
    readable.on('data', (chunk: Buffer) => {
      onChunk(chunk.byteLength);
    });
    readable.once('error', reject);
    output.once('error', reject);
    output.once('finish', resolvePipe);
    readable.pipe(output);
  });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
