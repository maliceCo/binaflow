import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWebAuth } from '../../src/web/auth.js';
import { parseWebConfig } from '../../src/web/config.js';
import { createWebServer, type WebServer } from '../../src/web/server.js';

export interface BrowserFixture {
  server: WebServer;
  url: string;
  accessCode: string;
  close(): Promise<void>;
}

export async function startBrowserFixture(): Promise<BrowserFixture> {
  const port = await freePort();
  const config = parseWebConfig({ host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` });
  const auth = createWebAuth();
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const server = createWebServer({
    config,
    auth,
    assets: {
      index: readFileSync(resolve('dist/web/index.html'), 'utf8'),
      app: readFileSync(resolve('dist/web/app.js'), 'utf8'),
      css: readFileSync(resolve('dist/web/styles.css'), 'utf8'),
    },
    api: {
      taskViews: {
        async listGuidedTaskViews() {
          return {
            items: [
              {
                id,
                revision: 1,
                readiness: 'needs-plan' as const,
                phase: 'exploration' as const,
                brief: {
                  id,
                  contractId: id,
                  kind: 'brief' as const,
                  version: 1,
                  sourceDocumentId: null,
                  createdAt: '',
                },
                plan: null,
                approvedPlan: null,
                todo: null,
              },
            ],
          };
        },
        async getGuidedTaskView() {
          return {
            id,
            revision: 1,
            readiness: 'needs-plan' as const,
            phase: 'exploration' as const,
            brief: {
              id,
              contractId: id,
              kind: 'brief' as const,
              version: 1,
              sourceDocumentId: null,
              createdAt: '',
              body: { objective: 'Fixture task', conclusions: [], constraints: [], outOfScope: [] },
            },
            plan: null,
            approvedPlan: null,
            todo: null,
            createdAt: '',
            updatedAt: '',
            contractVersion: 1,
            actions: { items: [] },
            preparation: null,
            execution: null,
          };
        },
      },
    },
    stderr: { write: () => undefined },
  });
  await server.start();
  return { server, url: config.origin, accessCode: auth.accessCode, close: () => server.close() };
}

async function freePort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
