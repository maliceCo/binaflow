import { readFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { WebConfig } from './config.js';
import { createWebAuth, type WebAuth, type WebSession } from './auth.js';

const MAX_BODY_BYTES = 128 * 1024;
const SESSION_COOKIE = 'binaflow_session';

export interface WebServerAssets {
  index: string;
  app: string;
  css: string;
}

export interface WebServerOptions {
  config: WebConfig;
  auth?: WebAuth;
  assets?: WebServerAssets;
  stderr?: { write(message: string): void };
}

export interface WebServer {
  readonly auth: WebAuth;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const auth = options.auth ?? createWebAuth();
  const stderr = options.stderr ?? process.stderr;
  const assets = options.assets ?? loadAssets();
  const authority = new URL(options.config.origin).host;
  let server: Server | undefined;
  let closePromise: Promise<void> | undefined;

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void dispatch(request, response).catch(() => {
      if (!response.headersSent)
        sendJson(response, 500, {
          version: 1,
          error: { code: 'internal-error', message: 'Internal server error' },
        });
      else response.destroy();
    });
  };

  return {
    auth,
    start: async () => {
      if (server) return;
      server = options.config.tls
        ? createHttpsServer(
            {
              cert: readFileSync(options.config.tls.certFile),
              key: readFileSync(options.config.tls.keyFile),
              maxHeaderSize: 16 * 1024,
            },
            handler,
          )
        : createHttpServer({ maxHeaderSize: 16 * 1024 }, handler);
      await new Promise<void>((resolveStart, reject) => {
        server!.once('error', reject);
        server!.listen(options.config.port, options.config.host, () => {
          server!.off('error', reject);
          resolveStart();
        });
      });
      stderr.write(`Binaflow web listening at ${options.config.origin}\n`);
      stderr.write(`Binaflow access code: ${auth.accessCode}\n`);
    },
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise<void>((resolveClose, reject) => {
        if (!server) {
          resolveClose();
          return;
        }
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
      return closePromise;
    },
  };

  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setSecurityHeaders(response, options.config.origin.startsWith('https:'));
    if (request.headers.host !== authority) {
      sendJson(response, 400, {
        version: 1,
        error: { code: 'invalid-host', message: 'Invalid host' },
      });
      return;
    }
    const method = request.method ?? 'GET';
    const path = new URL(request.url ?? '/', options.config.origin).pathname;
    if (method === 'GET' && path === '/') {
      send(response, 200, 'text/html; charset=utf-8', assets.index);
      return;
    }
    if (method === 'GET' && path === '/app.js') {
      send(response, 200, 'text/javascript; charset=utf-8', assets.app);
      return;
    }
    if (method === 'GET' && path === '/app.css') {
      send(response, 200, 'text/css; charset=utf-8', assets.css);
      return;
    }
    if (path === '/login' && method === 'POST') {
      if (!validOrigin(request)) {
        sendJson(response, 403, { version: 1, error: { code: 'forbidden', message: 'Forbidden' } });
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        const tooLarge = error instanceof Error && /too large/i.test(error.message);
        sendJson(response, tooLarge ? 413 : 400, {
          version: 1,
          error: {
            code: tooLarge ? 'too-large' : 'invalid-input',
            message: tooLarge ? 'Request too large' : 'Invalid request',
          },
        });
        return;
      }
      if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.code !== 'string') {
        sendJson(response, 400, {
          version: 1,
          error: { code: 'invalid-input', message: 'Invalid login request' },
        });
        return;
      }
      const session = auth.login(body.code, request.socket.remoteAddress ?? 'unknown');
      if (!session) {
        sendJson(response, 401, {
          version: 1,
          error: { code: 'login-failed', message: 'Login failed' },
        });
        return;
      }
      setSessionCookie(response, session, options.config.origin.startsWith('https:'));
      sendJson(response, 200, {
        version: 1,
        data: { authenticated: true, csrfToken: session.csrfToken },
      });
      return;
    }
    if (path === '/session' && method === 'GET') {
      const session = getSession(request);
      sendJson(response, 200, {
        version: 1,
        data: session
          ? { authenticated: true, csrfToken: session.csrfToken }
          : { authenticated: false },
      });
      return;
    }
    if (path === '/logout' && method === 'POST') {
      const session = requireMutationSession(request, response);
      if (!session) return;
      auth.revoke(session.token);
      response.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${options.config.origin.startsWith('https:') ? '; Secure' : ''}`,
      );
      sendJson(response, 200, { version: 1, data: { authenticated: false } });
      return;
    }
    sendJson(response, 404, {
      version: 1,
      error: { code: 'unknown-target', message: 'Not found' },
    });
  }

  function getSession(request: IncomingMessage): WebSession | undefined {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    return auth.getSession(cookie?.slice(`${SESSION_COOKIE}=`.length));
  }

  function requireMutationSession(
    request: IncomingMessage,
    response: ServerResponse,
  ): WebSession | undefined {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, {
        version: 1,
        error: { code: 'session-required', message: 'Session required' },
      });
      return undefined;
    }
    if (
      !validOrigin(request) ||
      request.headers['content-type'] !== 'application/json' ||
      !auth.checkCsrf(session, header(request, 'x-csrf-token'))
    ) {
      sendJson(response, 403, { version: 1, error: { code: 'forbidden', message: 'Forbidden' } });
      return undefined;
    }
    return session;
  }

  function validOrigin(request: IncomingMessage): boolean {
    return request.headers.origin === options.config.origin;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new Error('Unsupported request encoding');
  }
  if (request.headers['content-type'] !== 'application/json')
    throw new Error('JSON content type required');
  const chunks: Buffer[] = [];
  let size = 0;
  request.setTimeout(15_000, () => request.destroy());
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function setSecurityHeaders(response: ServerResponse, secure: boolean): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function setSessionCookie(response: ServerResponse, session: WebSession, secure: boolean): void {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`,
  );
}

function send(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function loadAssets(): WebServerAssets {
  const root = resolve(fileURLToPath(new URL('../../web/', import.meta.url)));
  return {
    index: readFileSync(resolve(root, 'index.html'), 'utf8'),
    app: readFileSync(resolve(root, 'app.js'), 'utf8'),
    css: readFileSync(resolve(root, 'styles.css'), 'utf8'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
