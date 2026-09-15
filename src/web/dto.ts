import type { GuidedPreparationRequestRecord } from '../application/guided-preparation.js';
import type { TaskContractView } from '../application/task-contract.js';
import type { WebOperationDto, WebTaskDto } from './contracts.js';

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
