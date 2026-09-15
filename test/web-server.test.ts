import { request as httpRequest, createServer as createHttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { parseWebConfig } from '../src/web/config.js';
import { createWebAuth } from '../src/web/auth.js';
import { createWebServer } from '../src/web/server.js';

const servers: Array<ReturnType<typeof createWebServer>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function freePort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function request(
  port: number,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

describe('web config, auth, and server', () => {
  it('rejects unknown fields and requires TLS for non-loopback hosts', () => {
    expect(() => parseWebConfig({ unknown: true })).toThrow(/unknown/i);
    expect(() =>
      parseWebConfig({ host: '0.0.0.0', port: 4317, origin: 'http://0.0.0.0:4317' }),
    ).toThrow(/HTTPS/i);
    expect(parseWebConfig({})).toMatchObject({
      host: '127.0.0.1',
      port: 4317,
      origin: 'http://127.0.0.1:4317',
    });
  });

  it('supports login, CSRF-protected logout, expiry, and bounded sessions', () => {
    let timestamp = 1000;
    const auth = createWebAuth({
      now: () => timestamp,
      randomBytes: (size) => Buffer.alloc(size, 1),
    });
    const session = auth.login(auth.accessCode, '127.0.0.1');
    expect(session).toBeDefined();
    expect(auth.checkCsrf(session!, session!.csrfToken)).toBe(true);
    timestamp += 8 * 60 * 60 * 1000 + 1;
    expect(auth.getSession(session!.token)).toBeUndefined();
  });

  it('serves only explicit assets and protects session mutations', async () => {
    const port = await freePort();
    const config = parseWebConfig({ host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` });
    const auth = createWebAuth({ randomBytes: (size) => Buffer.alloc(size, 2) });
    const server = createWebServer({
      config,
      auth,
      assets: { index: '<div id="root"></div>', app: 'app', css: 'css' },
      stderr: { write: () => undefined },
    });
    servers.push(server);
    await server.start();

    await expect(request(port, '/session')).resolves.toMatchObject({
      status: 200,
      body: expect.stringContaining('false'),
    });
    await expect(request(port, '/nope')).resolves.toMatchObject({ status: 404 });
    const login = await request(port, '/login', {
      method: 'POST',
      body: { code: auth.accessCode },
      headers: { Origin: config.origin },
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] as string[])[0]!.split(';', 1)[0]!;
    const csrf = JSON.parse(login.body).data.csrfToken as string;
    expect(
      (
        await request(port, '/logout', {
          method: 'POST',
          headers: { Origin: config.origin, Cookie: cookie, 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(port, '/logout', {
          method: 'POST',
          body: {},
          headers: { Origin: config.origin, Cookie: cookie, 'X-CSRF-Token': csrf },
        })
      ).status,
    ).toBe(200);
  });
});
