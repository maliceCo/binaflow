import type { GuidedPreparationRequestRecord } from '../application/guided-preparation.js';
import type { TaskContractView } from '../application/task-contract.js';
import type { WebOperationDto, WebTaskDto } from './contracts.js';

export interface WebTransferDto {
  transferId: string;
  projectId: string;
  stage: string;
  bytesSent: number;
  bytesReceived: number;
  totalBytes?: number;
  packageDigest?: string;
  errorCode?: string;
}

export interface WebTransferPreviewDto {
  transferId: string;
  requestId: string;
  projectId: string;
  blockers: string[];
  digest?: string;
  totalBytes?: number;
}

export function toWebTaskDto(view: TaskContractView): WebTaskDto {
  return {
    id: view.contract.id,
    revision: view.contract.revision,
    readiness: view.readiness,
    phase: view.contract.phase,
    brief: view.currentBrief,
    plan: view.currentPlan,
    approvedPlan: view.approvedPlan,
    todo: view.currentTodo,
    ...(view.execution ? { executionRunId: view.execution.runId } : {}),
  };
}

export function toWebTransferDto(value: unknown): WebTransferDto {
  const record = transferRecord(value);
  const totalBytes = nonNegativeIntegerOrUndefined(record.totalBytes);
  return {
    transferId: requiredString(record.transferId, 'transferId'),
    projectId: requiredString(record.projectId, 'projectId'),
    stage: requiredString(record.stage, 'stage'),
    bytesSent: nonNegativeInteger(record.bytesSent),
    bytesReceived: nonNegativeInteger(record.bytesReceived),
    ...(totalBytes === undefined ? {} : { totalBytes }),
    ...(typeof record.packageDigest === 'string' ? { packageDigest: record.packageDigest } : {}),
    ...(typeof record.errorCode === 'string' ? { errorCode: record.errorCode } : {}),
  };
}

export function toWebTransferPreviewDto(value: unknown): WebTransferPreviewDto {
  const record = transferRecord(value);
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.filter((item): item is string => typeof item === 'string')
    : [];
  const totalBytes = nonNegativeIntegerOrUndefined(record.packageBytes);
  return {
    transferId: requiredString(record.transferId, 'transferId'),
    requestId: requiredString(record.requestId, 'requestId'),
    projectId: requiredString(record.projectId, 'projectId'),
    blockers,
    ...(typeof record.digest === 'string' ? { digest: record.digest } : {}),
    ...(totalBytes === undefined ? {} : { totalBytes }),
  };
}

function transferRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid transfer result');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid transfer ${name}`);
  return value;
}

function nonNegativeInteger(value: unknown): number {
  const result = nonNegativeIntegerOrUndefined(value);
  if (result === undefined) throw new Error('Invalid transfer byte count');
  return result;
}

function nonNegativeIntegerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function toWebOperationDto(record: GuidedPreparationRequestRecord): WebOperationDto {
  return {
    requestId: record.requestId,
    operationId: record.operationId,
    kind: record.kind,
    status: record.status,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    ...(record.publishedDocumentId ? { publishedDocumentId: record.publishedDocumentId } : {}),
  };
}
