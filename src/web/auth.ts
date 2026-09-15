import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEB_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 8;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_GLOBAL = 30;

export interface WebSession {
  token: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface WebAuth {
  readonly accessCode: string;
  login(code: string, ip: string, now?: number): WebSession | undefined;
  getSession(token: string | undefined, now?: number): WebSession | undefined;
  revoke(token: string): void;
  checkCsrf(session: WebSession, token: string | undefined): boolean;
}

export function createWebAuth(
  options: {
    randomBytes?: (size: number) => Buffer;
    now?: () => number;
  } = {},
): WebAuth {
  const random = options.randomBytes ?? ((size) => randomBytes(size));
  const now = options.now ?? (() => Date.now());
  const accessCode = random(32).toString('hex');
  const accessHash = sha256(accessCode);
  const sessions = new Map<string, WebSession>();
  const failuresByIp = new Map<string, { count: number; expiresAt: number }>();
  let globalFailures = { count: 0, expiresAt: 0 };

  return {
    accessCode,
    login(code, ip, timestamp = now()) {
      prune(timestamp);
      const ipFailures = failuresByIp.get(ip);
      if (
        (ipFailures?.count ?? 0) >= MAX_FAILURES_PER_IP ||
        globalFailures.count >= MAX_FAILURES_GLOBAL
      )
        return undefined;
      const supplied = sha256(code);
      const valid =
        supplied.length === accessHash.length &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(accessHash));
      if (!valid) {
        recordFailure(ip, timestamp);
        return undefined;
      }
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (oldest) sessions.delete(oldest.token);
      }
      const session: WebSession = {
        token: random(32).toString('hex'),
        csrfToken: random(32).toString('hex'),
        createdAt: timestamp,
        expiresAt: timestamp + WEB_SESSION_TTL_MS,
      };
      sessions.set(session.token, session);
      return session;
    },
    getSession(token, timestamp = now()) {
      if (!token) return undefined;
      prune(timestamp);
      return sessions.get(token);
    },
    revoke(token) {
      sessions.delete(token);
    },
    checkCsrf(session, token) {
      if (!token || token.length !== session.csrfToken.length) return false;
      return timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken));
    },
  };

  function recordFailure(ip: string, timestamp: number): void {
    const expiresAt = timestamp + 60_000;
    const current = failuresByIp.get(ip);
    failuresByIp.set(ip, { count: (current?.count ?? 0) + 1, expiresAt });
    if (globalFailures.expiresAt <= timestamp) globalFailures = { count: 0, expiresAt };
    globalFailures.count += 1;
  }

  function prune(timestamp: number): void {
    for (const [ip, failure] of failuresByIp)
      if (failure.expiresAt <= timestamp) failuresByIp.delete(ip);
    if (globalFailures.expiresAt <= timestamp)
      globalFailures = { count: 0, expiresAt: timestamp + 60_000 };
    for (const [token, session] of sessions)
      if (session.expiresAt <= timestamp) sessions.delete(token);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
