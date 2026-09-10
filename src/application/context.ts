import type { BinaflowConfig, PreparationReviewMode } from '../config.js';
import type {
  ApplicationArtifactStore,
  ApplicationPreparationStore,
  ApplicationPreparationArtifactStore,
  ApplicationQaHistoryStore,
  ApplicationRunStore,
  WorkflowExecutor,
} from './ports.js';
import type { AgentDriver } from '../core/agent.js';
import type { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import type { PlanBuildQaCoordinator } from './plan-build-qa-coordinator.js';
import type { InteractivePlanBuildQaCoordinator } from './interactive-plan-build-qa-coordinator.js';
import type { TodoBuildQaCoordinator } from './todo-build-qa-coordinator.js';

/** Internal composition surface. Presentation must use ApplicationService. */
export type ApplicationConfig = Pick<BinaflowConfig, 'profiles'> &
  Partial<Pick<BinaflowConfig, 'qaHistory' | 'preparation'>>;

export interface ApplicationInternals {
  config: ApplicationConfig;
  store: ApplicationRunStore;
  artifacts: ApplicationArtifactStore;
  preparationStore?: ApplicationPreparationStore;
  preparationArtifacts?: ApplicationPreparationArtifactStore;
  preparationDriver?: AgentDriver;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
  planBuildQaCoordinator?: PlanBuildQaCoordinator;
  todoBuildQaCoordinator?: TodoBuildQaCoordinator;
  interactivePlanBuildQaCoordinator?: InteractivePlanBuildQaCoordinator;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
  qaHistory?: ApplicationQaHistoryStore;
  readPreparationReviewMode?: () => Promise<PreparationReviewMode>;
}
