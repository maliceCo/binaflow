import { describe, expect, it } from 'vitest';
import {
  createPublicSourceReader,
  PublicSourceError,
  validatePublicAddress,
  validatePublicUrl,
  type PublicSourceHttpRequest,
  type PublicSourceHttpResponse,
} from '../src/research/public-sources.js';

const publicAddress = '93.184.216.34';
const fixedDate = new Date('2026-01-01T00:00:00.000Z');

function response(
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/html' },
  statusCode = 200,
): PublicSourceHttpResponse {
  return {
    statusCode,
    headers,
    body: new TextEncoder().encode(body),
    remoteAddress: publicAddress,
  };
}

describe('public source reader', () => {
  it('does not search without an explicitly configured Brave key', async () => {
    const reader = createPublicSourceReader();
    await expect(reader.search('binaflow', new AbortController().signal)).rejects.toMatchObject({
      code: 'search-unavailable',
    });
  });

  it('searches the fixed endpoint and bounds results without opening real network access', async () => {
    const requests: PublicSourceHttpRequest[] = [];
    const reader = createPublicSourceReader({
      searchKey: 'test-key',
      now: () => fixedDate,
      resolve: async () => [publicAddress],
      request: async (request) => {
        requests.push(request);
        return response(
          JSON.stringify({
            web: {
              results: Array.from({ length: 6 }, (_, index) => ({
                url: `https://example.com/${index}`,
                title: `Result ${index}`,
                description: `Description ${index}`,
              })),
            },
          }),
          { 'content-type': 'application/json' },
        );
      },
    });
    const results = await reader.search('bounded query', new AbortController().signal);
    expect(results).toHaveLength(5);
    expect(requests[0]?.url.hostname).toBe('api.search.brave.com');
    expect(requests[0]?.headers['x-subscription-token']).toBe('test-key');
  });

  it('rejects private, mapped, link-local, and mixed DNS answers', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '::1', '::ffff:127.0.0.1']) {
      expect(() => validatePublicAddress(address)).toThrow(PublicSourceError);
    }
    const reader = createPublicSourceReader({
      resolve: async () => [publicAddress, '192.168.1.2'],
      request: async () => response('never'),
    });
    await expect(
      reader.readUrl('https://example.com', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'blocked-address',
    });
  });

  it('validates URL scheme, port, credentials, and redirects', async () => {
    for (const url of [
      'http://example.com',
      'https://example.com:444/path',
      'https://user@example.com',
      'file:///tmp/secret',
      'data:text/plain,secret',
    ]) {
      expect(() => validatePublicUrl(url)).toThrow(PublicSourceError);
    }
    const reader = createPublicSourceReader({
      resolve: async () => [publicAddress],
      request: async () => response('', { location: 'https://other.example/' }, 302),
    });
    await expect(
      reader.readUrl('https://example.com', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'redirect',
    });
  });

  it('extracts HTML as bounded text and discards active content', async () => {
    const reader = createPublicSourceReader({
      now: () => fixedDate,
      resolve: async () => [publicAddress],
      request: async () =>
        response(
          '<html><head><title>Docs</title><style>hide</style></head><body>Hello <b>world</b><script>bad()</script></body></html>',
        ),
    });
    const source = await reader.readUrl('https://example.com/docs', new AbortController().signal);
    expect(source).toMatchObject({
      kind: 'page',
      title: 'Docs',
      retrievedAt: fixedDate.toISOString(),
    });
    expect(source.excerpt).toContain('Hello world');
    expect(source.excerpt).not.toContain('bad');
    expect(source.excerpt).not.toContain('hide');
  });

  it('rejects unsupported encodings/content and oversized bodies', async () => {
    const unsupported = createPublicSourceReader({
      resolve: async () => [publicAddress],
      request: async () => response('data', { 'content-type': 'application/pdf' }),
    });
    await expect(
      unsupported.readUrl('https://example.com', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'unsupported-content',
    });

    const oversized = createPublicSourceReader({
      resolve: async () => [publicAddress],
      request: async () => response('x'.repeat(1024 * 1024 + 1)),
    });
    await expect(
      oversized.readUrl('https://example.com', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'too-large',
    });
  });
});
