import { describe, expect, it, vi } from 'vitest';
import { handleWebApi, type WebApiCapabilities } from '../src/web/routes.js';

const contractId = '123e4567-e89b-42d3-a456-426614174000';
const requestId = '123e4567-e89b-42d3-a456-426614174001';

const operation = {
  schemaVersion: 1 as const,
  requestId,
  contractId,
  expectedRevision: 1,
  expectedPreparationRevision: 1,
  kind: 'search' as const,
  query: 'node security',
};

describe('web API routes', () => {
  it('validates operation targets and projects accepted records', async () => {
    const execute = vi.fn(async () => ({
      contractId,
      requestId,
      operationId: requestId,
      kind: 'search' as const,
      requestHash: 'hash',
      preparationRevision: 1,
      contractRevision: 1,
      status: 'pending' as const,
      ownerToken: null,
    }));
    const api = { guidedPreparation: { execute } };
    await expect(
      handleWebApi(
        { method: 'POST', path: `/api/v1/tasks/${contractId}/operations`, body: { operation } },
        api,
      ),
    ).resolves.toMatchObject({ status: 202, body: { data: { status: 'pending' } } });
    expect(execute).toHaveBeenCalledWith(operation);

    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: `/api/v1/tasks/${contractId}/operations`,
          body: { operation: { ...operation, contractId: '123e4567-e89b-42d3-a456-426614174002' } },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
  });

  it('validates transfer commands without accepting server paths', async () => {
    const transfers = {
      preview: vi.fn(async (value: unknown) => ({
        ...(value as object),
        blockers: [],
        digest: 'b'.repeat(64),
        packageBytes: 10,
      })),
      start: vi.fn(async (value: unknown) => ({
        ...(value as object),
        stage: 'sending',
        bytesSent: 0,
        bytesReceived: 0,
      })),
      status: vi.fn(async (id: string) => ({
        transferId: id,
        projectId: contractId,
        stage: 'sending',
        bytesSent: 0,
        bytesReceived: 0,
      })),
      resume: vi.fn(async (id: string) => ({
        transferId: id,
        projectId: contractId,
        stage: 'sending',
        bytesSent: 0,
        bytesReceived: 0,
      })),
    };
    const body = {
      transferId: requestId,
      requestId,
      projectId: contractId,
      targetProjectId: contractId,
      targetDeviceId: 'a'.repeat(64),
    };
    await expect(
      handleWebApi({ method: 'POST', path: '/api/v1/transfers/preview', body }, { transfers }),
    ).resolves.toMatchObject({
      status: 200,
      body: { data: { transferId: requestId, requestId, projectId: contractId, blockers: [] } },
    });
    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: '/api/v1/transfers/preview',
          body: { ...body, packagePath: '/secret' },
        },
        { transfers },
      ),
    ).resolves.toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
    await expect(
      handleWebApi(
        { method: 'POST', path: `/api/v1/transfers/${requestId}`, body: {} },
        { transfers },
      ),
    ).resolves.toMatchObject({ status: 202, body: { data: { stage: 'sending' } } });
  });

  it('does not expose an unavailable capability as a server error', async () => {
    await expect(handleWebApi({ method: 'GET', path: '/api/v1/tasks' }, {})).resolves.toMatchObject(
      {
        status: 503,
        body: { error: { code: 'unavailable' } },
      },
    );
  });

  it('sanitizes internal failures while preserving public error categories', async () => {
    const internalFailure = new Error('Cannot load /secret/data/catalog.json') as Error & {
      code: string;
    };
    internalFailure.code = 'not-found';
    const response = await handleWebApi({ method: 'GET', path: '/api/v1/projects' }, {
      projectCatalog: {
        listProjects: async () => {
          throw internalFailure;
        },
      },
    } as unknown as WebApiCapabilities);
    expect(response).toEqual({
      status: 404,
      body: {
        version: 1,
        error: { code: 'not-found', message: 'The requested resource was not found' },
      },
    });
    expect(JSON.stringify(response)).not.toContain('/secret');

    const unknownFailure = await handleWebApi({ method: 'GET', path: '/api/v1/projects' }, {
      projectCatalog: {
        listProjects: async () => {
          throw new Error('/secret/catalog');
        },
      },
    } as unknown as WebApiCapabilities);
    expect(unknownFailure).toMatchObject({
      status: 422,
      body: { error: { code: 'operation-failed', message: 'Operation failed' } },
    });
    expect(JSON.stringify(unknownFailure)).not.toContain('/secret');
  });
});
