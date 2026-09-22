import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { WEB_API_VERSION, type WebTaskDetailDto } from '../src/web/api-contract.js';
import type { ExecutionProgress, LauncherSettings, TaskDetail } from '../src/web/client/api.js';

const header = {
  id: 'brief-1',
  contractId: 'task-1',
  kind: 'brief' as const,
  version: 1,
  sourceDocumentId: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const detail: WebTaskDetailDto = {
  id: 'task-1',
  revision: 2,
  readiness: 'needs-plan',
  phase: 'planning',
  brief: header,
  plan: null,
  approvedPlan: null,
  todo: null,
  currentBrief: {
    objective: 'Validate input',
    conclusions: [],
    constraints: [],
    outOfScope: [],
  },
  draftBrief: {
    objective: 'Validate input',
    conclusions: [],
    constraints: [],
    outOfScope: [],
  },
  planDocument: null,
  todoDocument: null,
  briefConfirmedThroughSequence: 3,
  messagesCompactedThroughSequence: 0,
  messages: [],
  sources: [],
  preparationRevision: 4,
  lastSequence: 3,
  confirmedSourceIds: [],
  activeOperation: null,
};

function acceptsClientDetail(value: TaskDetail): TaskDetail {
  return value;
}

function acceptsClientExecution(value: ExecutionProgress): ExecutionProgress {
  return value;
}

function acceptsClientSettings(value: LauncherSettings): LauncherSettings {
  return value;
}

describe('shared browser HTTP contract', () => {
  it('keeps server and browser task forms assignable in both directions', () => {
    const clientDetail = acceptsClientDetail(detail);
    const serverDetail: WebTaskDetailDto = clientDetail;

    expect(WEB_API_VERSION).toBe(1);
    expect(serverDetail.preparationRevision).toBe(4);
    expect(serverDetail.lastSequence).toBe(3);
    expect(serverDetail.confirmedSourceIds).toEqual([]);
  });

  it('keeps the browser-only aliases tied to the versioned contract', () => {
    const execution = acceptsClientExecution({
      runId: 'run-1',
      contractId: 'task-1',
      revision: 1,
      stage: 'execution',
      status: 'running',
      phases: [],
      activeBlock: null,
      nextAction: 'cancel',
    });
    const settings = acceptsClientSettings({
      setupRequired: false,
      deviceName: 'Desktop',
      web: { host: '127.0.0.1', port: 4317, origin: 'http://127.0.0.1:4317', tlsConfigured: false },
      projectRoots: [],
    });

    expect(execution.nextAction).toBe('cancel');
    expect(settings.web.tlsConfigured).toBe(false);
  });

  it('is browser-safe and leaves runtime validation outside the contract module', async () => {
    const source = await readFile(new URL('../src/web/api-contract.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/from ['"].*\/(storage|artifacts|drivers)\//);
    expect(source).not.toMatch(/configPath|dataDirPath|workspacePath/);
  });
});
