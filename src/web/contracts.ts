import { parseGuidedPreparationOperation } from '../application/guided-preparation.js';
import type { GuidedPreparationSource } from '../application/guided-preparation.js';
import type { WebOperationRequest, WebSourceDto, WebTaskCreateRequest } from './api-contract.js';

export { WEB_API_VERSION } from './api-contract.js';
export type {
  WebApiError,
  WebApiSuccess,
  WebMessageDto,
  WebOperationDto,
  WebOperationRequest,
  WebSessionDto,
  WebSourceDto,
  WebTaskCreateRequest,
  WebTaskDetailDto,
  WebTaskDto,
} from './api-contract.js';

export const WEB_PAGE_LIMIT_DEFAULT = 20;
export const WEB_PAGE_LIMIT_MAX = 50;

export function parseWebOperationRequest(value: unknown): WebOperationRequest {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !('operation' in value)) {
    throw new WebContractError('invalid-input', 'Expected an operation object');
  }
  return { operation: parseGuidedPreparationOperation(value.operation) };
}

export function parseWebTaskCreateRequest(value: unknown): WebTaskCreateRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ['contractId', 'objective'])) {
    throw new WebContractError('invalid-input', 'Invalid task creation request');
  }
  if (!isUuid(value.contractId) || typeof value.objective !== 'string') {
    throw new WebContractError('invalid-input', 'Invalid task creation values');
  }
  assertUtf8Length(value.objective, 4 * 1024, 'objective');
  if (!value.objective.trim()) {
    throw new WebContractError('invalid-input', 'Objective must not be empty');
  }
  return { contractId: value.contractId, objective: value.objective };
}

export function projectWebSource(source: GuidedPreparationSource): WebSourceDto {
  return {
    id: source.id,
    sequence: source.sequence,
    kind: source.kind,
    url: source.url,
    title: source.title,
    excerpt: source.excerpt,
    ...(source.query === undefined ? {} : { query: source.query }),
    retrievedAt: source.retrievedAt,
    truncated: source.truncated,
  };
}

export class WebContractError extends Error {
  readonly code: 'invalid-input' | 'too-large';

  constructor(code: 'invalid-input' | 'too-large', message: string) {
    super(message);
    this.name = 'WebContractError';
    this.code = code;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

function assertUtf8Length(value: string, maxBytes: number, label: string): void {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new WebContractError('too-large', `${label} exceeds its size limit`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
