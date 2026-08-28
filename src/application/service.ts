import type { BinaflowConfig } from '../config.js';
import type { AgentModel, AgentModelDiscovery } from '../core/agent.js';
import type { NormalizedEvent } from '../core/events.js';
import type { WorkflowRun } from '../core/run.js';
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
  resumeWorkflow,
  runWorkflow,
  type ApplicationInternals,
  type ApprovalDecisionRequest,
  type ArtifactContentView,
  type ConfigurationDiagnosis,
  type ReadArtifactOptions,
  type ResumeWorkflowRequest,
  type ResumeWorkflowResult,
  type RunInspection,
  type RunInspectionOptions,
  type RunRecoveryExplanation,
  type RunWorkflowRequest,
  type WorkflowContract,
} from './operations.js';
import { discoverAgentModels } from './config-operations.js';
import { getRunView, type RunView } from './run-view.js';
import {
  adjudicateReview,
  decideReview,
  explainReview,
  finalizeReview,
  getReview,
  postReviewMessage,
  type ReviewAdjudicationRequest,
  type ReviewDecisionRequest,
  type ReviewExplanation,
  type ReviewExplanationRequest,
  type ReviewFinalizeRequest,
  type ReviewMessageRequest,
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
  listRunEvents(runId: string, query?: RunEventPageQuery): Promise<RunEventPage>;
  listRuns(query?: RunListQuery): Promise<RunListPage>;
  readArtifact(
    runId: string,
    artifactKey: string,
    options?: ReadArtifactOptions,
  ): Promise<ArtifactContentView>;
  explainRunRecovery(runId: string): Promise<RunRecoveryExplanation>;
  clarificationQuestions(inspection: RunInspection): Promise<string[]>;
  loadResearchApprovalPreviews(inspection: RunInspection): Promise<ArtifactContentView[]>;
  discoverWorkflows(): WorkflowContract[];
  discoverModels(): Promise<AgentModel[]>;
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
}

export interface ApplicationCommands {
  runWorkflow(request: RunWorkflowRequest): Promise<WorkflowRun>;
  resumeWorkflow(request: ResumeWorkflowRequest): Promise<ResumeWorkflowResult>;
  decideApproval(request: ApprovalDecisionRequest): Promise<WorkflowRun>;
  markRunInterrupted(runId: string): Promise<WorkflowRun>;
  postReviewMessage?: (request: ReviewMessageRequest) => Promise<ReviewView>;
  decideReview?: (request: ReviewDecisionRequest) => Promise<WorkflowRun>;
  finalizeReview?: (request: ReviewFinalizeRequest) => Promise<WorkflowRun>;
  adjudicateReview?: (request: ReviewAdjudicationRequest) => Promise<ReviewView>;
}

export interface ApplicationService extends ApplicationQueries, ApplicationCommands {
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationServiceOptions {
  config: Pick<BinaflowConfig, 'profiles'> & Partial<Pick<BinaflowConfig, 'qaHistory'>>;
  store: RunStore;
  artifacts: ArtifactStore;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
  planBuildQaCoordinator?: PlanBuildQaCoordinator;
  interactivePlanBuildQaCoordinator?: import('./interactive-plan-build-qa-coordinator.js').InteractivePlanBuildQaCoordinator;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
  qaHistory?: import('./ports.js').ApplicationQaHistoryStore;
  modelDiscovery: AgentModelDiscovery;
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationQueriesOptions {
  config: Pick<BinaflowConfig, 'profiles'> & Partial<Pick<BinaflowConfig, 'qaHistory'>>;
  store: RunStore;
  artifacts: ArtifactStore;
  qaHistory?: import('./ports.js').ApplicationQaHistoryStore;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
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
  } satisfies Pick<
    ApplicationInternals,
    'config' | 'store' | 'artifacts' | 'qaHistory' | 'reviewStore'
  >;

  return {
    inspectRun: (runId, inspectionOptions) => inspectRun(context, runId, inspectionOptions),
    getRunView: (runId) => getRunView(context, runId),
    listRunEvents: (runId, query) => listRunEvents(context, runId, query),
    listRuns: (query) => listRuns(context, query),
    readArtifact: (runId, artifactKey, readOptions) =>
      readArtifact(context, runId, artifactKey, readOptions),
    explainRunRecovery: (runId) => explainRunRecovery(context, runId),
    clarificationQuestions: (inspection) => clarificationQuestions(context, inspection),
    loadResearchApprovalPreviews: (inspection) => loadResearchApprovalPreviews(context, inspection),
    discoverWorkflows,
    discoverModels: () => discoverAgentModels(options.modelDiscovery),
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
    ...(options.interactivePlanBuildQaCoordinator
      ? { interactivePlanBuildQaCoordinator: options.interactivePlanBuildQaCoordinator }
      : {}),
    ...(options.reviewStore ? { reviewStore: options.reviewStore } : {}),
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
    decideReview: (request) => decideReview(internals, request),
    finalizeReview: (request) => finalizeReview(internals, request),
    adjudicateReview: (request) => adjudicateReview(internals, request),
  };
}
