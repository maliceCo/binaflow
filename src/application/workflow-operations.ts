import type { BinaflowConfig } from '../config.js';
import { listWorkflowContracts, type WorkflowContract } from '../workflows/catalog.js';

export type { WorkflowContract };

export function discoverWorkflows(): WorkflowContract[] {
  return listWorkflowContracts();
}

export interface WorkflowConfigurationDiagnosis {
  id: string;
  experimental?: boolean;
  requiredProfiles: string[];
  missingProfiles: string[];
}

export interface ConfigurationDiagnosis {
  configuredProfiles: string[];
  workflows: WorkflowConfigurationDiagnosis[];
}

export function diagnoseConfiguration(
  config: Pick<BinaflowConfig, 'profiles'>,
): ConfigurationDiagnosis {
  const configuredProfiles = Object.keys(config.profiles).sort();
  return {
    configuredProfiles,
    workflows: discoverWorkflows().map((workflow) => ({
      id: workflow.id,
      ...(workflow.experimental ? { experimental: true } : {}),
      requiredProfiles: workflow.requiredProfiles,
      missingProfiles: workflow.requiredProfiles.filter(
        (profile) => !Object.prototype.hasOwnProperty.call(config.profiles, profile),
      ),
    })),
  };
}
