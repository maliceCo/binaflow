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
}

export interface ApplicationCommands {
  runWorkflow(request: RunWorkflowRequest): Promise<WorkflowRun>;
  resumeWorkflow(request: ResumeWorkflowRequest): Promise<ResumeWorkflowResult>;
  decideApproval(request: ApprovalDecisionRequest): Promise<WorkflowRun>;
  markRunInterrupted(runId: string): Promise<WorkflowRun>;
}

export interface ApplicationService extends ApplicationQueries, ApplicationCommands {
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationServiceOptions {
  config: Pick<BinaflowConfig, 'profiles'>;
  store: RunStore;
  artifacts: ArtifactStore;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
  modelDiscovery: AgentModelDiscovery;
  subscribeEvents(listener: (event: NormalizedEvent) => void | Promise<void>): () => void;
}

export interface CreateApplicationQueriesOptions {
  config: Pick<BinaflowConfig, 'profiles'>;
  store: RunStore;
  artifacts: ArtifactStore;
  modelDiscovery: AgentModelDiscovery;
}

export function createApplicationQueries(
  options: CreateApplicationQueriesOptions,
): ApplicationQueries {
  const context = {
    config: options.config,
    store: options.store,
    artifacts: options.artifacts,
  } satisfies Pick<ApplicationInternals, 'config' | 'store' | 'artifacts'>;

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
  };

  return {
    ...createApplicationQueries(options),
    subscribeEvents: options.subscribeEvents,
    runWorkflow: (request) => runWorkflow(internals, request),
    resumeWorkflow: (request) => resumeWorkflow(internals, request),
    decideApproval: (request) => decideApproval(internals, request),
    markRunInterrupted: (runId) => markRunInterrupted(internals, runId),
  };
}
