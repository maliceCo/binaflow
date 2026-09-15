import { describe, expect, it, vi } from 'vitest';
import { handleWebApi } from '../src/web/routes.js';

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

  it('does not expose an unavailable capability as a server error', async () => {
    await expect(handleWebApi({ method: 'GET', path: '/api/v1/tasks' }, {})).resolves.toMatchObject(
      {
        status: 503,
        body: { error: { code: 'unavailable' } },
      },
    );
  });
});
