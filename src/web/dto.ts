import type { GuidedPreparationRequestRecord } from '../application/guided-preparation.js';
import type { GuidedExecutionProgress } from '../application/guided-execution.js';
import type { TaskContractView } from '../application/task-contract.js';
import type { WebOperationDto, WebTaskDto } from './contracts.js';

export interface WebExecutionPreviewDto {
  digest: string;
  todoFileName: 'TODO.md';
  gitClean: boolean;
  blockerCount: number;
}

export interface WebArtifactDto {
  id: string;
  runId: string;
  stepId: string;
  name: string;
  kind: 'json' | 'text';
  mediaType: string;
  sizeBytes: number;
}

export interface WebGuidedExecutionProgressDto {
  runId: string;
  contractId: string;
  revision: number;
  stage: 'execution' | 'changes-review';
  status: string;
  phases: Array<{
    id: string;
    ordinal: number;
    title: string;
    status: string;
    tasks: Array<{
      id: string;
      phaseId: string;
      ordinal: number;
      status: string;
      attempt: number;
      resultArtifact?: WebArtifactDto;
      verificationArtifact?: WebArtifactDto;
    }>;
    commitSha?: string;
    noChanges?: boolean;
  }>;
  activeBlock: {
    id: string;
    revision: number;
    phaseId: string;
    taskId?: string;
    type: string;
    reason: string;
    evidence: WebArtifactDto[];
  } | null;
  nextAction: 'execute' | 'review-changes' | 'resume' | 'cancel' | 'none';
}

export function toWebGuidedExecutionProgress(
  progress: GuidedExecutionProgress,
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
  };
}

function toWebArtifact(reference: import('../core/run.js').ArtifactReference): WebArtifactDto {
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
    ...(record.result === undefined ? {} : { result: record.result }),
  };
}
