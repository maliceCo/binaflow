import type { NormalizedEvent } from '../core/events.js';
import type {
  ReviewDecision,
  ReviewMessage,
  ReviewPhase,
  ReviewThread,
  ReviewThreadState,
} from '../core/interactive-review.js';
import type { ExecuteWorkflowRequest } from '../core/execute-request.js';
import type { ExecutionClaim } from '../core/ports.js';
import type { WorkflowDefinition } from '../core/workflow.js';
import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { QaDefect, QaDefectEvent, QaOccurrence, QaSearchResult } from '../core/qa-history.js';
import type { WorkflowRuntime } from '../core/workflow-runtime.js';
import type {
  BeginPreparationReviewRequest,
  BeginPreparationReviewResult,
  BeginPreparationTurnRequest,
  BeginPreparationTurnResult,
  DocumentPage,
  FinishPreparationReviewRequest,
  FinishPreparationTurnRequest,
  PreparationDraftPage,
  PreparationConversation,
  PreparationDraft,
  PreparationMessage,
  PreparationMessagePage,
  PreparationProposalPage,
  PreparationProposal,
  PreparationRevision,
  PreparationStoredView,
  TaskRunPage,
  UpdatePreparationRequest,
  UpdatePreparationSynthesisRequest,
} from './preparation.js';

export interface ApplicationArtifactStore {
  read(artifact: ArtifactReference): Promise<string>;
  readBounded(
    artifact: ArtifactReference,
    maxBytes: number,
  ): Promise<{
    content: string;
    truncated: boolean;
  }>;
  readPage?(
    artifact: ArtifactReference,
    options: { offset: number; maxBytes: number; maxLines: number },
  ): Promise<{
    content: string;
    endOffset: number;
    hasMore: boolean;
    startsMidLine: boolean;
    endsMidLine: boolean;
    version: string;
  }>;
}

export interface ApplicationPreparationArtifactStore {
  write(
    runId: string,
    stepId: string,
    name: string,
    kind: 'json' | 'text',
    content: string,
    mediaType: string,
  ): Promise<ArtifactReference>;
  remove(artifact: ArtifactReference): Promise<void>;
}

export interface ApplicationPreparationStore {
  createPreparation(draft: PreparationDraft): Promise<void>;
  listPreparations(workspace?: string): Promise<PreparationDraft[]>;
  getPreparation(draftId: string): Promise<PreparationConversation | undefined>;
  claimPreparation(draftId: string, revision: PreparationRevision): Promise<string | undefined>;
  releasePreparation(draftId: string, claimToken: string): Promise<void>;
  savePreparationMessage(
    message: PreparationMessage,
    expectedRevision: number,
    claimToken: string,
  ): Promise<void>;
  publishPreparationProposal(
    proposal: PreparationProposal,
    expectedRevision: number,
    claimToken: string,
  ): Promise<void>;
  recoverPreparation(draftId: string): Promise<void>;
  getPreparationOverview?(draftId: string): Promise<PreparationStoredView | undefined>;
  listPreparationDraftsPage?(query: {
    workspace?: string;
    cursor?: string;
    limit?: number;
  }): Promise<PreparationDraftPage>;
  listPreparationMessagesPage?(query: {
    draftId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PreparationMessagePage>;
  listPreparationProposalsPage?(query: {
    draftId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PreparationProposalPage>;
  readPreparationDocumentPage?(query: {
    draftId: string;
    kind: import('./preparation.js').PreparationDocumentKind;
    documentId: string;
    view?: 'readable' | 'source';
    cursor?: string;
  }): Promise<DocumentPage>;
  updatePreparationSettings?(request: UpdatePreparationRequest): Promise<PreparationStoredView>;
  updatePreparationSynthesis?(
    request: UpdatePreparationSynthesisRequest,
  ): Promise<PreparationStoredView>;
  beginPreparationTurn?(request: BeginPreparationTurnRequest): Promise<BeginPreparationTurnResult>;
  finishPreparationTurn?(request: FinishPreparationTurnRequest): Promise<PreparationStoredView>;
  beginPreparationReview?(
    request: BeginPreparationReviewRequest,
  ): Promise<BeginPreparationReviewResult>;
  finishPreparationReview?(request: FinishPreparationReviewRequest): Promise<PreparationStoredView>;
  acknowledgePreparationReview?(request: {
    draftId: string;
    expectedRevision: number;
    reviewId: string;
  }): Promise<PreparationStoredView>;
  recoverPreparationView?(
    draftId: string,
    expectedRevision: number,
  ): Promise<PreparationStoredView>;
}

export interface WorkflowExecutor {
  execute(workflow: WorkflowDefinition, request: ExecuteWorkflowRequest): Promise<WorkflowRun>;
}

export type ResearchWorkflowRuntime = Pick<
  WorkflowRuntime,
  | 'resolveInput'
  | 'prepareRun'
  | 'notifyRunStarted'
  | 'executeStep'
  | 'skipStep'
  | 'saveRunStatus'
  | 'emitStatus'
>;

export interface ApplicationRunListQuery {
  limit?: number;
  status?: RunStatus;
  statuses?: readonly RunStatus[];
  workflowId?: string;
  cursor?: string;
}

export interface ApplicationRunListPage {
  runs: WorkflowRun[];
  nextCursor?: string;
}

export interface ApplicationRunEventPageQuery {
  afterId?: number;
  limit?: number;
}

export interface ApplicationRunEventPage {
  events: Array<NormalizedEvent & { id: number }>;
  nextCursor?: number;
}

export interface ApplicationQaHistoryStore {
  saveQaDefect(defect: QaDefect): Promise<void>;
  saveQaOccurrence(occurrence: QaOccurrence): Promise<void>;
  saveQaDefectEvent(event: QaDefectEvent): Promise<void>;
  getQaDefects(): Promise<QaDefect[]>;
  getQaOccurrences(defectId?: string): Promise<QaOccurrence[]>;
  getQaDefectEvents(defectId: string): Promise<QaDefectEvent[]>;
  searchQaDefects(fingerprint: string, query: string): Promise<QaSearchResult[]>;
  reindexQaSearch(): Promise<void>;
  archiveQaDefects(before?: string): Promise<number>;
  purgeQaHistory(): Promise<void>;
}

export interface ApplicationReviewStore {
  createReviewThread(thread: ReviewThread): Promise<void>;
  getReviewThread(threadId: string): Promise<ReviewThread | undefined>;
  listReviewThreads(runId: string, phase?: ReviewPhase): Promise<ReviewThread[]>;
  saveReviewMessage(message: ReviewMessage): Promise<void>;
  getReviewMessages(threadId: string): Promise<ReviewMessage[]>;
  saveReviewDecision(decision: ReviewDecision, nextState: ReviewThreadState): Promise<void>;
  saveReviewAdjudication(decision: ReviewDecision): Promise<void>;
  getReviewDecisions(threadId: string): Promise<ReviewDecision[]>;
}

export interface ApplicationRunStore {
  createRun(run: WorkflowRun, artifacts?: ArtifactReference[]): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | undefined>;
  claimRun(runId: string, eligibleStatuses: readonly RunStatus[]): Promise<WorkflowRun | undefined>;
  claimRunForExecution(
    runId: string,
    eligibleStatuses: readonly RunStatus[],
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined>;
  claimApprovalForExecution(
    runId: string,
    approvalStep: StepRun,
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined>;
  assertExecutionClaim(claim: ExecutionClaim): Promise<void>;
  claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined>;
  markRunInterrupted(runId: string): Promise<WorkflowRun | undefined>;
  releaseExecution(runId: string): Promise<void>;
  assertExecutionOwner(runId: string): Promise<void>;
  listRunsPage(query?: ApplicationRunListQuery): Promise<ApplicationRunListPage>;
  saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void>;
  saveStepRun(stepRun: StepRun): Promise<void>;
  getStepRuns(runId: string, options?: { includeResult?: boolean | 'usage' }): Promise<StepRun[]>;
  getArtifacts(runId: string): Promise<ArtifactReference[]>;
  saveCoordinatorArtifacts(runId: string, artifacts: ArtifactReference[]): Promise<void>;
  completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void>;
  saveEvent(event: NormalizedEvent): Promise<void>;
  saveEvents(events: NormalizedEvent[]): Promise<void>;
  countEvents(runId: string): Promise<number>;
  getEvents(runId: string): Promise<NormalizedEvent[]>;
  listRunEventsPage(
    runId: string,
    query?: ApplicationRunEventPageQuery,
  ): Promise<ApplicationRunEventPage>;
  listTaskRunsPage?(query?: { limit?: number; cursor?: string }): Promise<TaskRunPage>;
  createRunFromPreparation?(seed: import('./preparation.js').PreparationExecutionSeed): Promise<{
    run: WorkflowRun;
    claim: ExecutionClaim;
  }>;
}

export interface ResearchPersistence extends Pick<
  ApplicationRunStore,
  'getRun' | 'getStepRuns' | 'getArtifacts' | 'saveStepRun'
> {
  checkpointResearchIteration(
    inputArtifact: ArtifactReference,
    researchStep: StepRun,
    reviewStep: StepRun,
    approvalStep?: StepRun,
  ): Promise<void>;
}
