import { validateAgentProfile, type AgentProfile, type BinaflowConfig } from '../config.js';
import type { WorkflowDefinition } from '../core/workflow.js';
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

export function validateWorkflowProfiles(
  workflow: WorkflowDefinition,
  profiles: Record<string, AgentProfile>,
): void {
  const required = [...new Set(workflow.steps.map((step) => step.profile))];
  const missing = required.filter(
    (profile) => !Object.prototype.hasOwnProperty.call(profiles, profile),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing agent profile(s): ${missing.join(', ')}. Add them to .binaflow/config.json`,
    );
  }
  for (const name of required) {
    const validation = validateAgentProfile(name, profiles[name]);
    if (validation.errors.length > 0) {
      throw new Error(`Profile ${name} has invalid configuration: ${validation.errors.join('; ')}`);
    }
  }
}
