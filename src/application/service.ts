import type { BinaflowConfig } from '../config.js';
import type { AgentModel, AgentModelDiscovery } from '../core/agent.js';
import type { NormalizedEvent } from '../core/events.js';
import type { WorkflowRun } from '../core/run.js';
import type {
  PreparationConversation,
  PreparationDraft,
  PreparationModel,
  PreparationStoredView,
  TaskRunPage,
  PreparationTurnResult,
  UpdatePreparationSynthesisRequest,
} from './preparation.js';
import type {
  ApplicationArtifactStore as ArtifactStore,
  ApplicationRunEventPage as RunEventPage,
  ApplicationRunEventPageQuery as RunEventPageQuery,
  ApplicationRunListPage as RunListPage,
  ApplicationRunListQuery as RunListQuery,
  ApplicationRunStore as RunStore,
  WorkflowExecutor,
} from './ports.js';
import { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import { PlanBuildQaCoordinator } from './plan-build-qa-coordinator.js';
import { TodoBuildQaCoordinator } from './todo-build-qa-coordinator.js';
import {
  clarificationQuestions,
  decideApproval,
  diagnoseConfiguration,
  discoverWorkflows,
  explainRunRecovery,
  inspectRun,
  listRunEvents,
  listRuns,
  loadResearchApprovalPreviews,
  markRunInterrupted,
  readArtifact,
  readArtifactPage,
  resumeWorkflow,
  runWorkflow,
  type ApplicationInternals,
  type ApprovalDecisionRequest,
  type ArtifactContentView,
  type ConfigurationDiagnosis,
  type ReadArtifactOptions,
  type ReadArtifactPageOptions,
  type ResumeWorkflowRequest,
  type ResumeWorkflowResult,
  type RunInspection,
  type RunInspectionOptions,
  type RunRecoveryExplanation,
  type RunWorkflowRequest,
  type WorkflowContract,
} from './operations.js';
import { discoverAgentModels, discoverPreparationModels } from './config-operations.js';
import { getRunView, type RunView } from './run-view.js';
import {
  getTaskOutcome,
  getTaskQaRound,
  type TaskOutcome,
  type TaskQaRound,
} from './task-outcome.js';
import {
  createPreparation,
  getPreparation,
  listPreparations,
  replyPreparation,
  approveAndExecutePreparation,
  acknowledgePreparationReview,
  generatePreparationProposal,
  recoverPreparation,
  replyPreparationTurn,
  reviewPreparationProposal,
  retryPreparationReply,
  updatePreparationSettings,
  updatePreparationSynthesis,
  type CreatePreparationRequest,
  type ReplyPreparationRequest,
  type ApproveAndExecutePreparationRequest,
  type PreparationReplyResult,
  type UpdatePreparationSettingsRequest,
  type GeneratePreparationProposalRequest,
  type AcknowledgePreparationReviewRequest,
  type ReplyPreparationTurnRequest,
  type RetryPreparationReplyRequest,
  type ReviewPreparationProposalRequest,
} from './preparation-operations.js';
import {
  adjudicateReview,
  decideReview,
  explainReview,
  finalizeReview,
  getReview,
  postReviewMessage,
  replyReview,
  type ReviewAdjudicationRequest,
  type ReviewDecisionRequest,
  type ReviewExplanation,
  type ReviewExplanationRequest,
  type ReviewFinalizeRequest,
  type ReviewMessageRequest,
  type ReviewConversationRequest,
  type ReviewView,
} from './review-operations.js';
import {
  archiveQaHistory,
  getQaDefect,
  listQaDefects,
  purgeQaHistory,
  qaHistoryStats,
  reindexQaHistory,
  searchQaHistory,
  type QaDefectDetails,
  type QaHistoryStats,
} from './qa-history-operations.js';

export interface ApplicationQueries {
  inspectRun(runId: string, options?: RunInspectionOptions): Promise<RunInspection>;
  getRunView(runId: string): Promise<RunView>;
  getTaskOutcome?: (runId: string) => Promise<TaskOutcome>;
  getTaskQaRound?: (runId: string, roundId: string) => Promise<TaskQaRound>;
  listRunEvents(runId: string, query?: RunEventPageQuery): Promise<RunEventPage>;
  listRuns(query?: RunListQuery): Promise<RunListPage>;
  listTaskRunsPage?: (query?: { limit?: number; cursor?: string }) => Promise<TaskRunPage>;
  readArtifact(
    runId: string,
    artifactKey: string,
    options?: ReadArtifactOptions,
  ): Promise<ArtifactContentView>;
  readArtifactPage?: (
    runId: string,
    artifactKey: string,
    options?: ReadArtifactPageOptions,
  ) => Promise<import('./preparation.js').DocumentPage>;
  explainRunRecovery(runId: string): Promise<RunRecoveryExplanation>;
  clarificationQuestions(inspection: RunInspection): Promise<string[]>;
  loadResearchApprovalPreviews(inspection: RunInspection): Promise<ArtifactContentView[]>;
  discoverWorkflows(): WorkflowContract[];
  discoverModels(): Promise<AgentModel[]>;
  discoverPreparationModels?: () => Promise<PreparationModel[]>;
  diagnoseConfiguration(): ConfigurationDiagnosis;
  listQaDefects?: () => Promise<import('../core/qa-history.js').QaDefect[]>;
  getQaDefect?: (id: string) => Promise<QaDefectDetails>;
  searchQaHistory?: (
    fingerprint: string,
    query: string,
  ) => Promise<import('../core/qa-history.js').QaSearchResult[]>;
  qaHistoryStats?: () => Promise<QaHistoryStats>;
  reindexQaHistory?: () => Promise<void>;
  archiveQaHistory?: (before?: string) => Promise<number>;
  purgeQaHistory?: () => Promise<void>;
  getReview?: (runId: string) => Promise<ReviewView>;
  explainReview?: (request: ReviewExplanationRequest) => Promise<ReviewExplanation>;
  listPreparations?: (workspace?: string) => Promise<PreparationDraft[]>;
  getPreparation?: (draftId: string) => Promise<PreparationConversation>;
  getPreparationOverview?: (draftId: string) => Promise<PreparationStoredView>;
}

export interface ApplicationCommands {
  runWorkflow(request: RunWorkflowRequest): Promise<WorkflowRun>;
  resumeWorkflow(request: ResumeWorkflowRequest): Promise<ResumeWorkflowResult>;
  decideApproval(request: ApprovalDecisionRequest): Promise<WorkflowRun>;
  markRunInterrupted(runId: string): Promise<WorkflowRun>;
  postReviewMessage?: (request: ReviewMessageRequest) => Promise<ReviewView>;
  replyReview?: (request: ReviewConversationRequest) => Promise<ReviewView>;
  decideReview?: (request: ReviewDecisionRequest) => Promise<WorkflowRun>;
  finalizeReview?: (request: ReviewFinalizeRequest) => Promise<WorkflowRun>;
  adjudicateReview?: (request: ReviewAdjudicationRequest) => Promise<ReviewView>;
  createPreparation?: (request: CreatePreparationRequest) => Promise<PreparationConversation>;
  replyPreparation?: (request: ReplyPreparationRequest) => Promise<PreparationReplyResult>;
  approveAndExecutePreparation?: (
    request: ApproveAndExecutePreparationRequest,
  ) => Promise<WorkflowRun>;
  updatePreparationSettings?: (
    request: UpdatePreparationSettingsRequest,
  ) => Promise<PreparationStoredView>;
  updatePreparationSynthesis?: (
    request: UpdatePreparationSynthesisRequest,
  ) => Promise<PreparationStoredView>;
  replyPreparationTurn?: (request: ReplyPreparationTurnRequest) => Promise<PreparationTurnResult>;
  retryPreparationReply?: (request: RetryPreparationReplyRequest) => Promise<PreparationTurnResult>;
  generatePreparationProposal?: (
    request: GeneratePreparationProposalRequest,
  ) => Promise<PreparationTurnResult>;
  recoverPreparation?: (request: {
    draftId: string;
    expectedRevision: number;
  }) => Promise<PreparationStoredView>;
  reviewPreparationProposal?: (
    request: ReviewPreparationProposalRequest,
  ) => Promise<PreparationStoredView>;
  acknowledgePreparationReview?: (
    request: AcknowledgePreparationReviewRequest,
  ) => Promise<PreparationStoredView>;
}

export interface ApplicationService extends ApplicationQueries, ApplicationCommands {
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationServiceOptions {
  config: Pick<BinaflowConfig, 'profiles'> &
    Partial<Pick<BinaflowConfig, 'qaHistory' | 'preparation'>>;
  store: RunStore;
  artifacts: ArtifactStore;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
  planBuildQaCoordinator?: PlanBuildQaCoordinator;
  todoBuildQaCoordinator?: TodoBuildQaCoordinator;
  interactivePlanBuildQaCoordinator?: import('./interactive-plan-build-qa-coordinator.js').InteractivePlanBuildQaCoordinator;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
  preparationStore?: import('./ports.js').ApplicationPreparationStore;
  preparationArtifacts?: import('./ports.js').ApplicationPreparationArtifactStore;
  preparationDriver?: import('../core/agent.js').AgentDriver;
  readPreparationReviewMode?: () => Promise<import('../config.js').PreparationReviewMode>;
  qaHistory?: import('./ports.js').ApplicationQaHistoryStore;
  modelDiscovery: AgentModelDiscovery;
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationQueriesOptions {
  config: Pick<BinaflowConfig, 'profiles'> &
    Partial<Pick<BinaflowConfig, 'qaHistory' | 'preparation'>>;
  store: RunStore;
  artifacts: ArtifactStore;
  qaHistory?: import('./ports.js').ApplicationQaHistoryStore;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
  preparationStore?: import('./ports.js').ApplicationPreparationStore;
  modelDiscovery: AgentModelDiscovery;
}

export function createApplicationQueries(
  options: CreateApplicationQueriesOptions,
): ApplicationQueries {
  const context = {
    config: options.config,
    store: options.store,
    artifacts: options.artifacts,
    ...(options.qaHistory ? { qaHistory: options.qaHistory } : {}),
    ...(options.reviewStore ? { reviewStore: options.reviewStore } : {}),
    ...(options.preparationStore ? { preparationStore: options.preparationStore } : {}),
  } satisfies Pick<
    ApplicationInternals,
    'config' | 'store' | 'artifacts' | 'qaHistory' | 'reviewStore'
  >;

  return {
    inspectRun: (runId, inspectionOptions) => inspectRun(context, runId, inspectionOptions),
    getRunView: (runId) => getRunView(context, runId),
    getTaskOutcome: (runId) => getTaskOutcome(context, runId),
    getTaskQaRound: (runId, roundId) => getTaskQaRound(context, runId, roundId),
    listRunEvents: (runId, query) => listRunEvents(context, runId, query),
    listRuns: (query) => listRuns(context, query),
    listTaskRunsPage: async (query) => {
      if (!options.store.listTaskRunsPage) {
        throw new Error('Task run pages are not supported by this storage adapter');
      }
      return options.store.listTaskRunsPage(query);
    },
    readArtifact: (runId, artifactKey, readOptions) =>
      readArtifact(context, runId, artifactKey, readOptions),
    readArtifactPage: (runId, artifactKey, pageOptions) =>
      readArtifactPage(context, runId, artifactKey, pageOptions),
    explainRunRecovery: (runId) => explainRunRecovery(context, runId),
    clarificationQuestions: (inspection) => clarificationQuestions(context, inspection),
    loadResearchApprovalPreviews: (inspection) => loadResearchApprovalPreviews(context, inspection),
    discoverWorkflows,
    discoverModels: () => discoverAgentModels(options.modelDiscovery),
    discoverPreparationModels: () => discoverPreparationModels(options.modelDiscovery),
    diagnoseConfiguration: () => diagnoseConfiguration(options.config),
    listQaDefects: () => listQaDefects(context),
    getQaDefect: (id) => getQaDefect(context, id),
    searchQaHistory: (fingerprint, query) => searchQaHistory(context, fingerprint, query),
    qaHistoryStats: () => qaHistoryStats(context),
    reindexQaHistory: () => reindexQaHistory(context),
    archiveQaHistory: (before) => archiveQaHistory(context, before),
    purgeQaHistory: () => purgeQaHistory(context),
    getReview: (runId) => getReview(context, runId),
    explainReview: (request) => explainReview(context, request),
    listPreparations: (workspace) => listPreparations(context, workspace),
    getPreparation: (draftId) => getPreparation(context, draftId),
    getPreparationOverview: async (draftId) => {
      const overview = await context.preparationStore?.getPreparationOverview?.(draftId);
      if (!overview) throw new Error(`Preparation overview is unavailable: ${draftId}`);
      return overview;
    },
  };
}

export function createApplicationService(
  options: CreateApplicationServiceOptions,
): ApplicationService {
  const internals: ApplicationInternals = {
    config: options.config,
    store: options.store,
    artifacts: options.artifacts,
    engine: options.engine,
    researchCoordinator: options.researchCoordinator,
    ...(options.planBuildQaCoordinator
      ? { planBuildQaCoordinator: options.planBuildQaCoordinator }
      : {}),
    ...(options.todoBuildQaCoordinator
      ? { todoBuildQaCoordinator: options.todoBuildQaCoordinator }
      : {}),
    ...(options.interactivePlanBuildQaCoordinator
      ? { interactivePlanBuildQaCoordinator: options.interactivePlanBuildQaCoordinator }
      : {}),
    ...(options.reviewStore ? { reviewStore: options.reviewStore } : {}),
    ...(options.preparationStore ? { preparationStore: options.preparationStore } : {}),
    ...(options.preparationArtifacts ? { preparationArtifacts: options.preparationArtifacts } : {}),
    ...(options.preparationDriver ? { preparationDriver: options.preparationDriver } : {}),
    ...(options.readPreparationReviewMode
      ? { readPreparationReviewMode: options.readPreparationReviewMode }
      : {}),
    ...(options.qaHistory ? { qaHistory: options.qaHistory } : {}),
  };

  return {
    ...createApplicationQueries(options),
    subscribeEvents: options.subscribeEvents,
    runWorkflow: (request) => runWorkflow(internals, request),
    resumeWorkflow: (request) => resumeWorkflow(internals, request),
    decideApproval: (request) => decideApproval(internals, request),
    markRunInterrupted: (runId) => markRunInterrupted(internals, runId),
    reindexQaHistory: () => reindexQaHistory(internals),
    archiveQaHistory: (before) => archiveQaHistory(internals, before),
    purgeQaHistory: () => purgeQaHistory(internals),
    postReviewMessage: (request) => postReviewMessage(internals, request),
    replyReview: (request) => replyReview(internals, request),
    decideReview: (request) => decideReview(internals, request),
    finalizeReview: (request) => finalizeReview(internals, request),
    adjudicateReview: (request) => adjudicateReview(internals, request),
    createPreparation: (request) => createPreparation(internals, request),
    replyPreparation: (request) => replyPreparation(internals, request),
    approveAndExecutePreparation: (request) => approveAndExecutePreparation(internals, request),
    updatePreparationSettings: (request) => updatePreparationSettings(internals, request),
    updatePreparationSynthesis: (request) => updatePreparationSynthesis(internals, request),
    replyPreparationTurn: (request) => replyPreparationTurn(internals, request),
    retryPreparationReply: (request) => retryPreparationReply(internals, request),
    generatePreparationProposal: (request) => generatePreparationProposal(internals, request),
    recoverPreparation: (request) => recoverPreparation(internals, request),
    reviewPreparationProposal: (request) => reviewPreparationProposal(internals, request),
    acknowledgePreparationReview: (request) => acknowledgePreparationReview(internals, request),
  };
}
