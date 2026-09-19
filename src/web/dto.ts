import type { GuidedPreparationRequestRecord } from '../application/guided-preparation.js';
import type { GuidedExecutionProgress } from '../application/guided-execution.js';
import type {
  GuidedExecutionProgressView,
  GuidedPreparationMessageView,
  GuidedPreparationOperationView,
  GuidedPreparationSourceView,
  GuidedTaskDetailView,
  GuidedTaskSummaryView,
} from '../application/guided-task-view.js';
import type { TaskContractView } from '../application/task-contract.js';
import type {
  WebExecutionArtifactDto,
  WebExecutionProgressDto,
  WebMessageDto,
  WebOperationDto,
  WebTaskDetailDto,
  WebSourceDto,
  WebTaskDto,
  WebTransferDto,
  WebTransferPreviewDto,
} from './api-contract.js';

type WebArtifactDto = WebExecutionArtifactDto;
type WebGuidedExecutionProgressDto = WebExecutionProgressDto;

export type {
  WebExecutionArtifactDto,
  WebExecutionPreviewDto,
  WebExecutionProgressDto,
  WebExecutionResumePreviewDto,
  WebTransferDto,
  WebTransferPreviewDto,
} from './api-contract.js';

export function toWebGuidedExecutionProgress(
  progress: GuidedExecutionProgress,
): WebGuidedExecutionProgressDto {
  return toWebProgress(progress);
}

export function toWebGuidedExecutionProgressView(
  progress: GuidedExecutionProgressView,
): WebGuidedExecutionProgressDto {
  return toWebProgress(progress);
}

function toWebProgress(
  progress: GuidedExecutionProgress | GuidedExecutionProgressView,
): WebGuidedExecutionProgressDto {
  return {
    runId: progress.runId,
    contractId: progress.contractId,
    revision: progress.revision,
    stage: progress.stage,
    status: progress.status,
    phases: progress.phases.map((phase) => ({
      id: phase.id,
      ordinal: phase.ordinal,
      title: phase.title,
      status: phase.status,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        phaseId: task.phaseId,
        ordinal: task.ordinal,
        status: task.status,
        attempt: task.attempt,
        ...(task.resultArtifact ? { resultArtifact: toWebArtifact(task.resultArtifact) } : {}),
        ...(task.verificationArtifact
          ? { verificationArtifact: toWebArtifact(task.verificationArtifact) }
          : {}),
      })),
      ...(phase.commitSha ? { commitSha: phase.commitSha } : {}),
      ...(phase.noChanges === undefined ? {} : { noChanges: phase.noChanges }),
    })),
    activeBlock: progress.activeBlock
      ? {
          id: progress.activeBlock.id,
          revision: progress.activeBlock.revision,
          phaseId: progress.activeBlock.phaseId,
          ...(progress.activeBlock.taskId ? { taskId: progress.activeBlock.taskId } : {}),
          type: progress.activeBlock.type,
          reason: progress.activeBlock.reason,
          evidence: progress.activeBlock.evidence.map(toWebArtifact),
        }
      : null,
    nextAction: progress.nextAction,
    ...(progress.changeSet ? { changeSet: progress.changeSet } : {}),
  };
}

function toWebArtifact(reference: WebExecutionArtifactDto): WebArtifactDto {
  return {
    id: reference.id,
    runId: reference.runId,
    stepId: reference.stepId,
    name: reference.name,
    kind: reference.kind,
    mediaType: reference.mediaType,
    sizeBytes: reference.sizeBytes,
  };
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

export function toWebTaskSummaryDto(view: GuidedTaskSummaryView): WebTaskDto {
  return {
    id: view.id,
    revision: view.revision,
    readiness: view.readiness,
    phase: view.phase,
    brief: view.brief,
    plan: view.plan,
    approvedPlan: view.approvedPlan,
    todo: view.todo,
    ...(view.executionRunId ? { executionRunId: view.executionRunId } : {}),
  };
}

export function toWebTaskDetailDto(view: GuidedTaskDetailView): WebTaskDetailDto {
  const preparation = view.preparation;
  return {
    ...toWebTaskSummaryDto(view),
    currentBrief: view.brief.body,
    draftBrief: preparation?.draftBrief ?? view.brief.body,
    planDocument: view.plan?.body ?? null,
    briefConfirmedThroughSequence: preparation?.briefConfirmedThroughSequence ?? 0,
    messagesCompactedThroughSequence: preparation?.messagesCompactedThroughSequence ?? 0,
    ...(preparation?.sessionRecoveredAt
      ? { sessionRecoveredAt: preparation.sessionRecoveredAt }
      : {}),
    messages: preparation?.messages.items.map(toWebMessageDto) ?? [],
    sources: preparation?.sources.items.map(toWebSourceDto) ?? [],
    preparationRevision: preparation?.revision ?? 0,
    lastSequence: preparation?.lastSequence ?? 0,
    confirmedSourceIds: preparation?.confirmedSourceIds ?? [],
    activeOperation: preparation?.activeOperation
      ? toWebPreparationOperationDto(preparation.activeOperation)
      : null,
  };
}

export function toWebMessageDto(message: GuidedPreparationMessageView): WebMessageDto {
  return {
    id: message.id,
    sequence: message.sequence,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };
}

export function toWebSourceDto(source: GuidedPreparationSourceView): WebSourceDto {
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

function toWebPreparationOperationDto(operation: GuidedPreparationOperationView): WebOperationDto {
  return {
    requestId: operation.requestId,
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
    ...(operation.publishedDocumentId
      ? { publishedDocumentId: operation.publishedDocumentId }
      : {}),
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
    ...(record.result === undefined ? {} : { result: record.result }),
  };
}
