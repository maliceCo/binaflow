import { promises as dns } from 'node:dns';
import { createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import ipaddr from 'ipaddr.js';
import { parse as parseHtml } from 'parse5';
import type { PublicSourceReader } from '../application/ports.js';
import type { PublicSourceResult } from '../application/guided-preparation.js';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_EXCERPT_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

type HeaderMap = Readonly<Record<string, string | string[] | undefined>>;

export interface PublicSourceHttpRequest {
  url: URL;
  address: string;
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
}

export interface PublicSourceHttpResponse {
  statusCode: number;
  headers: HeaderMap;
  body: Uint8Array;
  remoteAddress?: string;
}

export interface PublicSourceReaderOptions {
  searchKey?: string;
  resolve?: (hostname: string) => Promise<readonly string[]>;
  request?: (request: PublicSourceHttpRequest) => Promise<PublicSourceHttpResponse>;
  now?: () => Date;
}

export type PublicSourceErrorCode =
  | 'search-unavailable'
  | 'invalid-url'
  | 'blocked-address'
  | 'network-error'
  | 'too-large'
  | 'redirect'
  | 'unsupported-content';

export class PublicSourceError extends Error {
  readonly code: PublicSourceErrorCode;

  constructor(code: PublicSourceErrorCode, message: string) {
    super(message);
    this.name = 'PublicSourceError';
    this.code = code;
  }
}

export function createPublicSourceReader(
  options: PublicSourceReaderOptions = {},
): PublicSourceReader {
  const resolveAddresses = options.resolve ?? resolvePublicAddresses;
  const makeRequest = options.request ?? nativeGet;
  const now = options.now ?? (() => new Date());

  return {
    async search(query, signal) {
      if (typeof options.searchKey !== 'string' || options.searchKey.length === 0) {
        throw new PublicSourceError('search-unavailable', 'Public search is not configured');
      }
      if (!query.trim() || utf8Length(query) > 1000) {
        throw new PublicSourceError('invalid-url', 'Search query is invalid');
      }
      const endpoint = new URL(BRAVE_SEARCH_URL);
      const addresses = await validatedAddresses(endpoint.hostname, resolveAddresses);
      const response = await makeRequest({
        url: new URL(`${endpoint}?${new URLSearchParams({ q: query }).toString()}`),
        address: addresses[0]!,
        signal,
        headers: {
          accept: 'application/json',
          'accept-encoding': 'identity',
          'x-subscription-token': options.searchKey,
        },
      });
      validateResponseAddress(response, addresses);
      assertIdentityEncoding(response.headers);
      const body = decodeBody(response);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new PublicSourceError('redirect', 'Search endpoint returned a redirect');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new PublicSourceError('network-error', 'Search endpoint returned an error');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new PublicSourceError('network-error', 'Search endpoint returned invalid JSON');
      }
      const results = extractBraveResults(payload);
      return results.slice(0, 5).map((result) => toSourceResult(result, query, now));
    },

    async readUrl(inputUrl, signal) {
      const url = validatePublicUrl(inputUrl);
      const addresses = await validatedAddresses(url.hostname, resolveAddresses);
      const response = await makeRequest({
        url,
        address: addresses[0]!,
        signal,
        headers: { accept: 'text/html, text/plain', 'accept-encoding': 'identity' },
      });
      validateResponseAddress(response, addresses);
      assertIdentityEncoding(response.headers);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = headerValue(response.headers, 'location');
        throw new PublicSourceError(
          'redirect',
          `Source returned a redirect${location ? ` to ${location}` : ''}; request it explicitly`,
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new PublicSourceError('network-error', 'Source returned an error');
      }
      const contentType = headerValue(response.headers, 'content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== 'text/html' && contentType !== 'text/plain') {
        throw new PublicSourceError('unsupported-content', 'Source is not text or HTML');
      }
      const body = decodeBody(response);
      const extracted =
        contentType === 'text/html' ? extractHtml(body, url.toString()) : body.trim();
      const excerpt = truncateUtf8(extracted, MAX_EXCERPT_BYTES);
      return {
        kind: 'page',
        url: url.toString(),
        title: contentType === 'text/html' ? extractHtmlTitle(body) || url.hostname : url.hostname,
        excerpt,
        retrievedAt: now().toISOString(),
        contentHash: sha256(excerpt),
        truncated: utf8Length(extracted) > utf8Length(excerpt),
      };
    },
  };
}

export function validatePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PublicSourceError('invalid-url', 'Source URL is invalid');
  }
  if (
    url.protocol !== 'https:' ||
    (url.port !== '' && url.port !== '443') ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    throw new PublicSourceError(
      'invalid-url',
      'Source URL must use HTTPS port 443 without credentials',
    );
  }
  return url;
}

export function validatePublicAddress(address: string): void {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    throw new PublicSourceError('blocked-address', 'DNS returned an invalid address');
  }
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    throw new PublicSourceError('blocked-address', 'Mapped IPv6 addresses are not allowed');
  }
  if (parsed.range() !== 'unicast') {
    throw new PublicSourceError('blocked-address', 'DNS returned a non-public address');
  }
}

async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const [ipv4, ipv6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [...ipv4, ...ipv6];
}

async function validatedAddresses(
  hostname: string,
  resolveAddresses: (hostname: string) => Promise<readonly string[]>,
): Promise<readonly string[]> {
  const addresses = await resolveAddresses(hostname);
  if (addresses.length === 0) {
    throw new PublicSourceError('network-error', 'Hostname did not resolve');
  }
  for (const address of addresses) validatePublicAddress(address);
  return addresses;
}

function nativeGet(input: PublicSourceHttpRequest): Promise<PublicSourceHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: input.url.hostname,
        port: 443,
        path: `${input.url.pathname}${input.url.search}`,
        method: 'GET',
        headers: input.headers,
        servername: input.url.hostname,
        timeout: REQUEST_TIMEOUT_MS,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address, ipaddr.parse(input.address).kind() === 'ipv6' ? 6 : 4);
        },
      },
      (response) => collectResponse(response, resolve, reject),
    );
    const abort = () => request.destroy(new Error('Request aborted'));
    if (input.signal.aborted) abort();
    else input.signal.addEventListener('abort', abort, { once: true });
    request.on('error', (error) => reject(new PublicSourceError('network-error', error.message)));
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.end();
  });
}

function collectResponse(
  response: IncomingMessage,
  resolve: (response: PublicSourceHttpResponse) => void,
  reject: (error: Error) => void,
): void {
  const chunks: Buffer[] = [];
  let total = 0;
  response.on('data', (chunk: Buffer | string) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      response.destroy(new PublicSourceError('too-large', 'Source response exceeds 1 MiB'));
      return;
    }
    chunks.push(buffer);
  });
  response.on('end', () => {
    resolve({
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      body: Buffer.concat(chunks),
      ...(response.socket?.remoteAddress ? { remoteAddress: response.socket.remoteAddress } : {}),
    });
  });
  response.on('error', reject);
}

function validateResponseAddress(
  response: PublicSourceHttpResponse,
  addresses: readonly string[],
): void {
  if (response.remoteAddress === undefined) return;
  validatePublicAddress(response.remoteAddress);
  if (!addresses.includes(response.remoteAddress)) {
    throw new PublicSourceError('blocked-address', 'Connection address changed during request');
  }
}

function assertIdentityEncoding(headers: HeaderMap): void {
  const encoding = headerValue(headers, 'content-encoding');
  if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
    throw new PublicSourceError(
      'unsupported-content',
      'Compressed source responses are not supported',
    );
  }
}

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function decodeBody(response: PublicSourceHttpResponse): string {
  if (response.body.byteLength > MAX_RESPONSE_BYTES) {
    throw new PublicSourceError('too-large', 'Source response exceeds 1 MiB');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(response.body);
  } catch {
    throw new PublicSourceError('network-error', 'Source response is not valid UTF-8');
  }
}

function extractBraveResults(
  value: unknown,
): Array<{ url: string; title: string; excerpt: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const web = (value as Record<string, unknown>).web;
  if (!web || typeof web !== 'object' || Array.isArray(web)) return [];
  const results = (web as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    const item = result as Record<string, unknown>;
    if (
      typeof item.url !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.description !== 'string'
    ) {
      return [];
    }
    try {
      validatePublicUrl(item.url);
    } catch {
      return [];
    }
    return [
      {
        url: item.url,
        title: item.title,
        excerpt: truncateUtf8(item.description, MAX_EXCERPT_BYTES),
      },
    ];
  });
}

function toSourceResult(
  result: { url: string; title: string; excerpt: string },
  query: string,
  now: () => Date,
): PublicSourceResult {
  return {
    kind: 'search-result',
    url: result.url,
    title: result.title,
    excerpt: result.excerpt,
    query,
    retrievedAt: now().toISOString(),
    contentHash: sha256(result.excerpt),
    truncated: utf8Length(result.excerpt) >= MAX_EXCERPT_BYTES,
  };
}

function extractHtml(value: string, fallback: string): string {
  const document = parseHtml(value) as TreeNode;
  const parts: string[] = [];
  collectText(document, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim() || fallback;
}

function extractHtmlTitle(value: string): string {
  const document = parseHtml(value) as TreeNode;
  const parts: string[] = [];
  collectTitle(document, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

interface TreeNode {
  nodeName?: string;
  value?: string;
  childNodes?: TreeNode[];
}

function collectText(node: TreeNode, output: string[]): void {
  if (
    node.nodeName &&
    ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed'].includes(node.nodeName)
  )
    return;
  if (node.nodeName === '#text' && node.value) output.push(node.value);
  for (const child of node.childNodes ?? []) collectText(child, output);
}

function collectTitle(node: TreeNode, output: string[]): void {
  if (node.nodeName === 'title') {
    collectText(node, output);
    return;
  }
  for (const child of node.childNodes ?? []) collectTitle(child, output);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (utf8Length(result + character) > maxBytes) break;
    result += character;
  }
  return result;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
