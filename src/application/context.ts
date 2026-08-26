import type { BinaflowConfig } from '../config.js';
import type { ApplicationArtifactStore, ApplicationRunStore, WorkflowExecutor } from './ports.js';
import type { ResearchPlanBuildCoordinator } from './research-plan-build-coordinator.js';

/** Internal composition surface. Presentation must use ApplicationService. */
export interface ApplicationInternals {
  config: Pick<BinaflowConfig, 'profiles'>;
  store: ApplicationRunStore;
  artifacts: ApplicationArtifactStore;
  engine: WorkflowExecutor;
  researchCoordinator: ResearchPlanBuildCoordinator;
}
