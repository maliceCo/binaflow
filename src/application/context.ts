import type { BinaflowConfig } from '../config.js';
import type {
  ApplicationArtifactStore,
  ApplicationQaHistoryStore,
  ApplicationRunStore,
  WorkflowExecutor,
} from './ports.js';
import type { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';
import type { PlanBuildQaCoordinator } from './plan-build-qa-coordinator.js';
import type { InteractivePlanBuildQaCoordinator } from './interactive-plan-build-qa-coordinator.js';

/** Internal composition surface. Presentation must use ApplicationService. */
export type ApplicationConfig = Pick<BinaflowConfig, 'profiles'> &
  Partial<Pick<BinaflowConfig, 'qaHistory'>>;

export interface ApplicationInternals {
  config: ApplicationConfig;
  store: ApplicationRunStore;
  artifacts: ApplicationArtifactStore;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
  planBuildQaCoordinator?: PlanBuildQaCoordinator;
  interactivePlanBuildQaCoordinator?: InteractivePlanBuildQaCoordinator;
  reviewStore?: import('./ports.js').ApplicationReviewStore;
  qaHistory?: ApplicationQaHistoryStore;
}
