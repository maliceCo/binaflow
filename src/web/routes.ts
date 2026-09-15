import type { GuidedPreparationService } from '../application/guided-preparation-operations.js';
import type { TaskContractBrief, TaskContractService } from '../application/task-contract.js';
import {
  parseWebOperationRequest,
  parseWebTaskCreateRequest,
  type WebApiError,
  type WebApiSuccess,
  type WebMessageDto,
  type WebSourceDto,
  type WebTaskDetailDto,
  WebContractError,
} from './contracts.js';
import { toWebOperationDto, toWebTaskDto } from './dto.js';

export interface WebApiCapabilities {
  readonly taskContracts?: Pick<TaskContractService, 'list' | 'get' | 'create'>;
  readonly guidedPreparation?: Pick<GuidedPreparationService, 'execute'>;
  readonly getTaskDetail?: (contractId: string) => Promise<WebTaskDetailDto>;
  readonly listMessages?: (
    contractId: string,
    afterSequence?: number,
  ) => Promise<{ items: WebMessageDto[]; nextCursor?: number }>;
  readonly listSources?: (
    contractId: string,
    afterSequence?: number,
  ) => Promise<{ items: WebSourceDto[]; nextCursor?: number }>;
}

export interface WebApiRequest {
  method: string;
  path: string;
  body?: unknown;
}

export type WebApiResponse =
  { status: number; body: WebApiSuccess<unknown> } | { status: number; body: WebApiError };

export async function handleWebApi(
  request: WebApiRequest,
  api: WebApiCapabilities,
): Promise<WebApiResponse> {
  try {
    const taskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)$/)?.[1];
    const operationTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/operations$/)?.[1];
    if (request.method === 'GET' && request.path === '/api/v1/tasks') {
      if (!api.taskContracts) return unavailable();
      const result = await api.taskContracts.list({});
      const items = await Promise.all(result.items.map((item) => api.taskContracts!.get(item.id)));
      return ok(200, {
        items: items.map(toWebTaskDto),
        nextAfterId: result.nextCursor ?? null,
      });
    }
    if (request.method === 'POST' && request.path === '/api/v1/tasks') {
      if (!api.taskContracts) return unavailable();
      const input = parseWebTaskCreateRequest(request.body);
      const brief: TaskContractBrief = {
        objective: input.objective,
        conclusions: [],
        constraints: [],
        outOfScope: [],
      };
      return ok(
        201,
        toWebTaskDto(await api.taskContracts.create({ contractId: input.contractId, brief })),
      );
    }
    const messagesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/messages$/)?.[1];
    if (messagesTaskId && request.method === 'GET') {
      if (!api.listMessages) return unavailable();
      return ok(200, await api.listMessages(messagesTaskId));
    }
    const sourcesTaskId = request.path.match(/^\/api\/v1\/tasks\/([^/]+)\/sources$/)?.[1];
    if (sourcesTaskId && request.method === 'GET') {
      if (!api.listSources) return unavailable();
      return ok(200, await api.listSources(sourcesTaskId));
    }
    if (taskId && request.method === 'GET') {
      if (api.getTaskDetail) return ok(200, await api.getTaskDetail(taskId));
      if (!api.taskContracts) return unavailable();
      return ok(200, toWebTaskDto(await api.taskContracts.get(taskId)));
    }
    if (operationTaskId && request.method === 'POST') {
      if (!api.guidedPreparation) return unavailable();
      const input = parseWebOperationRequest(request.body);
      if (input.operation.contractId !== operationTaskId) {
        throw new WebContractError('invalid-input', 'Operation target does not match the task');
      }
      const result = await api.guidedPreparation.execute(input.operation);
      return ok(202, toWebOperationDto(result));
    }
    return error(404, 'unknown-target', 'Not found');
  } catch (cause) {
    return mapError(cause);
  }
}

function ok(status: number, data: unknown): WebApiResponse {
  return { status, body: { version: 1, data } };
}

function error(status: number, code: string, message: string): WebApiResponse {
  return { status, body: { version: 1, error: { code, message } } };
}

function unavailable(): WebApiResponse {
  return error(503, 'unavailable', 'Operation is not available');
}

function mapError(cause: unknown): WebApiResponse {
  if (cause instanceof WebContractError)
    return error(cause.code === 'too-large' ? 413 : 400, cause.code, cause.message);
  const code =
    cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : 'operation-failed';
  const status =
    code === 'invalid-target' || code === 'not-found'
      ? 404
      : code === 'conflict' || code === 'stale-revision'
        ? 409
        : 422;
  return error(status, code, cause instanceof Error ? cause.message : 'Operation failed');
}
