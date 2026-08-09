import type { AgentProfile } from '../config.js';
import type { AgentModel } from '../core/agent.js';
import type {
  ConfigurationDiagnosis,
  GeneratedConfiguration,
} from '../application/config-operations.js';
import type { WorkflowContract } from '../workflows/catalog.js';

export const SETUP_FIELDS = [
  { key: 'plannerProvider', title: 'Planner provider' },
  { key: 'plannerModel', title: 'Planner model' },
  { key: 'builderProvider', title: 'Builder provider' },
  { key: 'builderModel', title: 'Builder model' },
  { key: 'builderWriteAccess', title: 'Builder permissions (yes/no)' },
] as const;

export type SetupField = (typeof SETUP_FIELDS)[number];
export type SetupValues = Partial<Record<(typeof SETUP_FIELDS)[number]['key'], string>>;
export type SetupStep = 1 | 2 | 3 | 4;

export function setupChoices(
  fieldIndex: number,
  models: AgentModel[],
  values: SetupValues,
): string[] {
  const field = SETUP_FIELDS[fieldIndex];
  if (!field) return [];
  if (field.key.endsWith('Provider')) return [...new Set(models.map((model) => model.provider))];
  if (field.key.endsWith('Model')) {
    const provider =
      values[field.key.startsWith('planner') ? 'plannerProvider' : 'builderProvider'];
    return models.filter((model) => model.provider === provider).map((model) => model.model);
  }
  return [];
}

export interface LaunchInputState {
  workflow: WorkflowContract;
  values: Record<string, string>;
  field: number;
  error?: string | undefined;
  reviewedProfiles: Record<string, string>;
}

export function validateSetupValue(field: SetupField, value: string): string | undefined {
  if (field.key === 'builderWriteAccess') {
    const normalized = value.trim().toLowerCase();
    return ['y', 'yes', 'n', 'no'].includes(normalized) ? undefined : 'Answer yes or no.';
  }
  return value.trim() ? undefined : 'A non-empty value is required.';
}

export function setupValuesToGeneration(values: SetupValues): {
  plannerProvider: string;
  plannerModel: string;
  builderProvider: string;
  builderModel: string;
  builderWriteAccess: boolean;
} {
  const required = (key: Exclude<keyof SetupValues, 'builderWriteAccess'>): string => {
    const value = values[key];
    if (!value) throw new Error(`${key} is required.`);
    return value.trim();
  };
  const permissions = values.builderWriteAccess?.trim().toLowerCase();
  if (!permissions || !['y', 'yes', 'n', 'no'].includes(permissions)) {
    throw new Error('Answer yes or no.');
  }
  return {
    plannerProvider: required('plannerProvider'),
    plannerModel: required('plannerModel'),
    builderProvider: required('builderProvider'),
    builderModel: required('builderModel'),
    builderWriteAccess: permissions === 'y' || permissions === 'yes',
  };
}

export function workflowInputFields(workflow: WorkflowContract): string[] {
  return Object.keys(workflow.input.properties);
}

export function validateWorkflowValue(
  workflow: WorkflowContract,
  name: string,
  value: string,
): string | undefined {
  const property = workflow.input.properties[name];
  if (!property) return `Unknown workflow input ${name}.`;
  if (!value.trim() && workflow.input.required.includes(name)) return `${name} is required.`;
  if (
    value.trim() &&
    property.minLength !== undefined &&
    value.trim().length < property.minLength
  ) {
    return `${name} must be at least ${property.minLength} characters.`;
  }
  return undefined;
}

export function validateWorkflowValues(
  workflow: WorkflowContract,
  values: Record<string, string>,
): string | undefined {
  for (const name of workflow.input.required) {
    const error = validateWorkflowValue(workflow, name, values[name] ?? '');
    if (error) return error;
  }
  return undefined;
}

export function orderedWorkflows(workflows: WorkflowContract[]): WorkflowContract[] {
  return [
    ...workflows.filter((workflow) => workflow.experimental !== true),
    ...workflows.filter((workflow) => workflow.experimental === true),
  ];
}

export function configuredProfiles(
  diagnosis: ConfigurationDiagnosis,
): Record<string, AgentProfile> {
  return Object.fromEntries(
    diagnosis.profiles.flatMap((profile) =>
      profile.valid && profile.settings ? [[profile.name, profile.settings]] : [],
    ),
  );
}

export function missingProfiles(
  workflow: WorkflowContract,
  diagnosis: ConfigurationDiagnosis,
): string[] {
  const profiles = configuredProfiles(diagnosis);
  return workflow.requiredProfiles.filter((profile) => !profiles[profile]);
}

export function profileReview(
  workflow: WorkflowContract,
  diagnosis: ConfigurationDiagnosis,
): Record<string, string> {
  const profiles = configuredProfiles(diagnosis);
  return Object.fromEntries(
    workflow.requiredProfiles.map((name) => [name, JSON.stringify(profiles[name] ?? null)]),
  );
}

export function sameProfileReview(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].every((name) => left[name] === right[name]);
}

export function isWriteCapable(profile: AgentProfile): boolean {
  return (
    profile.workspaceMode === 'read-write' ||
    profile.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')
  );
}

export function workflowPermissionSummary(
  workflow: WorkflowContract,
  diagnosis: ConfigurationDiagnosis,
): string[] {
  const profiles = configuredProfiles(diagnosis);
  return workflow.requiredProfiles.map((name) => {
    const profile = profiles[name];
    if (!profile) return `${name}: missing`;
    return `${name}: ${isWriteCapable(profile) ? 'WRITE/SHELL access' : 'read-only access'}`;
  });
}

export function generatedConfigurationPreview(generated: GeneratedConfiguration): string {
  return JSON.stringify(generated.config, null, 2);
}
