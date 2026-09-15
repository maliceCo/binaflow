import { describe, expect, it, vi } from 'vitest';
import { handleWebApi } from '../src/web/routes.js';

describe('web transfer API', () => {
  it('returns safe progress DTOs and rejects path-shaped commands', async () => {
    const transfers = {
      preview: vi.fn(async () => ({
        transferId: 'transfer-1',
        requestId: 'request-1',
        projectId: 'project-1',
        blockers: [],
        packageBytes: 100,
        packagePath: '/private/package',
      })),
      start: vi.fn(),
      status: vi.fn(async () => ({
        transferId: 'transfer-1',
        projectId: 'project-1',
        stage: 'sending',
        bytesSent: 40,
        bytesReceived: 0,
        receivedPackagePath: '/private/received',
      })),
      resume: vi.fn(),
    };
    const input = {
      transferId: 'transfer-1',
      requestId: 'request-1',
      projectId: 'project-1',
      targetProjectId: 'project-1',
      targetDeviceId: 'a'.repeat(64),
    };
    await expect(
      handleWebApi(
        { method: 'POST', path: '/api/v1/transfers/preview', body: input },
        { transfers },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { transferId: 'transfer-1', totalBytes: 100 } },
    });
    await expect(
      handleWebApi({ method: 'GET', path: '/api/v1/transfers/transfer-1' }, { transfers }),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { stage: 'sending', bytesSent: 40 } },
    });
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/transfers/preview',
          body: { ...input, packagePath: '/x' },
        },
        { transfers },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
  });
});
