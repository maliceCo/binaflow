import { describe, expect, it, vi } from 'vitest';
import { GuidedPreparationError } from '../src/application/guided-preparation.js';
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
  it('lists and updates project agent profiles through the local contract', async () => {
    const profile = {
      driver: 'pi',
      model: 'test-model',
      tools: ['ls', 'find', 'read'],
      workspaceMode: 'read-only' as const,
      projectTrust: 'never' as const,
      timeoutMs: 1000,
      retryLimit: 0,
      skills: { mode: 'none' as const },
    };
    const update = vi.fn(async (input: { profileName: string }) => ({
      sourceHash: 'next',
      profiles: { [input.profileName]: profile },
    }));
    const api: WebApiCapabilities = {
      agentProfiles: {
        list: async () => ({ sourceHash: 'current', profiles: {} }),
        update,
      },
    };
    await expect(
      handleWebApi(
        { method: 'GET', path: '/api/v1/project-agent-profiles', remoteAddress: '127.0.0.1' },
        api,
      ),
    ).resolves.toMatchObject({ status: 200, body: { data: { profiles: {} } } });
    await expect(
      handleWebApi(
        {
          method: 'PUT',
          path: '/api/v1/project-agent-profiles/planner',
          remoteAddress: '127.0.0.1',
          body: { profile, expectedSourceHash: 'current' },
        },
        api,
      ),
    ).resolves.toMatchObject({ status: 200, body: { data: { sourceHash: 'next' } } });
    expect(update).toHaveBeenCalledWith({
      profile,
      expectedSourceHash: 'current',
      profileName: 'planner',
    });
  });

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

  it('explains when a conversation message exceeds its size limit', async () => {
    const reply = {
      ...operation,
      kind: 'reply' as const,
      message: 'x'.repeat(4097),
      sourceIds: [],
    };

    await expect(
      handleWebApi(
        {
          method: 'POST',
          path: `/api/v1/tasks/${contractId}/operations`,
          body: { operation: reply },
        },
        { guidedPreparation: { execute: vi.fn() } },
      ),
    ).resolves.toEqual({
      status: 413,
      body: {
        version: 1,
        error: {
          code: 'too-large',
          message: 'Message must be at most 4 KiB (4096 bytes)',
        },
      },
    });
  });

  it('returns actionable messages for safe preparation errors', async () => {
    const cases = [
      {
        error: new GuidedPreparationError('busy', 'Another guided preparation request is active'),
        status: 409,
        code: 'busy',
        message: 'Another guided preparation request is active',
      },
      {
        error: new GuidedPreparationError('source-invalid', 'Source URL is invalid'),
        status: 400,
        code: 'source-invalid',
        message: 'Source URL is invalid',
      },
      {
        error: new GuidedPreparationError(
          'prompt-too-large',
          'planner prompt exceeds its size limit',
        ),
        status: 413,
        code: 'prompt-too-large',
        message:
          'The conversation and evidence exceed the context limit. Confirm the brief or remove sources.',
      },
      {
        error: new GuidedPreparationError(
          'brief-not-confirmed',
          'Confirm the brief before generating a plan',
        ),
        status: 409,
        code: 'brief-not-confirmed',
        message: 'Confirm the brief before generating a plan.',
      },
    ] as const;

    for (const testCase of cases) {
      await expect(
        handleWebApi(
          { method: 'POST', path: `/api/v1/tasks/${contractId}/operations`, body: { operation } },
          { guidedPreparation: { execute: vi.fn(async () => Promise.reject(testCase.error)) } },
        ),
      ).resolves.toEqual({
        status: testCase.status,
        body: {
          version: 1,
          error: { code: testCase.code, message: testCase.message },
        },
      });
    }
  });

  it('keeps safe validation details for malformed preparation input', async () => {
    const response = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/operations`,
        body: { operation: { ...operation, query: '' } },
      },
      { guidedPreparation: { execute: vi.fn() } },
    );

    expect(response).toMatchObject({ status: 400, body: { error: { code: 'invalid-input' } } });
    expect(JSON.stringify(response)).toContain('/query');
    expect(JSON.stringify(response)).not.toContain('Invalid request');
  });

  it('does not expose internal details for unknown preparation errors', async () => {
    const response = await handleWebApi(
      { method: 'POST', path: `/api/v1/tasks/${contractId}/operations`, body: { operation } },
      {
        guidedPreparation: {
          execute: vi.fn(async () => {
            throw Object.assign(new Error('database password'), { code: 'invalid-input' });
          }),
        },
      },
    );

    expect(response).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid-input', message: 'Invalid request' } },
    });
    expect(JSON.stringify(response)).not.toContain('database password');
  });

  it('reports invalid planner output as a retryable generation failure', async () => {
    const failure = Object.assign(new Error('planner details must stay private'), {
      code: 'planner-output-invalid',
    });
    const response = await handleWebApi(
      { method: 'POST', path: `/api/v1/tasks/${contractId}/operations`, body: { operation } },
      { guidedPreparation: { execute: vi.fn(async () => Promise.reject(failure)) } },
    );

    expect(response).toEqual({
      status: 422,
      body: {
        version: 1,
        error: {
          code: 'planner-output-invalid',
          message: 'The planner returned an invalid result. Generate it again.',
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain('planner details');
  });

  it('recovers an interrupted guided operation through its dedicated route', async () => {
    const recover = vi.fn(async () => ({
      contractId,
      requestId,
      operationId: requestId,
      kind: 'reply' as const,
      requestHash: 'hash',
      preparationRevision: 2,
      contractRevision: 1,
      status: 'interrupted' as const,
      ownerToken: null,
      errorCode: 'recovery-required',
    }));
    const response = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/operations/${requestId}/recover`,
        body: {},
      },
      { guidedPreparation: { execute: vi.fn(), recover } },
    );

    expect(response).toMatchObject({
      status: 200,
      body: { data: { status: 'interrupted', errorCode: 'recovery-required' } },
    });
    expect(recover).toHaveBeenCalledWith(contractId, requestId);
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

  it('explains an incompatible planner profile without exposing internals', async () => {
    const response = await handleWebApi(
      {
        method: 'POST',
        path: `/api/v1/tasks/${contractId}/operations`,
        body: { operation },
      },
      {
        guidedPreparation: {
          execute: async () => {
            const error = new Error('profile details') as Error & { code: string };
            error.code = 'profile-invalid';
            throw error;
          },
        },
      },
    );

    expect(response).toEqual({
      status: 422,
      body: {
        version: 1,
        error: {
          code: 'profile-invalid',
          message:
            'The planner profile is incompatible with guided preparation; set planner skills mode to none',
        },
      },
    });
  });
});
