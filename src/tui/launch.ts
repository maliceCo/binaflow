import type { AgentProfile } from '../config.js';
import type { AgentModel } from '../core/agent.js';
import type {
  ConfigurationDiagnosis,
  GeneratedConfiguration,
} from '../application/config-operations.js';
import type { WorkflowContract } from '../application/operations.js';
import { isReadOnlyPiTool } from '../pi-tools.js';

export const SETUP_PROFILES = ['analyst', 'planner', 'qa', 'builder'] as const;
export type SetupProfileName = (typeof SETUP_PROFILES)[number];

export interface SetupProfileValues {
  provider?: string;
  model?: string;
  thinking?: string;
  writeAccess?: boolean;
}

export const PI_THINKING_LEVELS = [
  'Default',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type SetupProfileField =
  | { key: 'provider'; title: string }
  | { key: 'model'; title: string }
  | { key: 'thinking'; title: string }
  | { key: 'writeAccess'; title: string };

export function setupProfileFields(profile: SetupProfileName): SetupProfileField[] {
  const fields: SetupProfileField[] = [
    { key: 'provider', title: `${profile} provider` },
    { key: 'model', title: `${profile} model` },
    { key: 'thinking', title: `${profile} thinking effort` },
  ];
  if (profile === 'builder')
    fields.push({ key: 'writeAccess', title: 'builder permissions (yes/no)' });
  return fields;
}

export type SetupProfileValuesByName = Partial<Record<SetupProfileName, SetupProfileValues>>;

export const SETUP_FIELDS = [
  { key: 'plannerProvider', title: 'Planner provider' },
  { key: 'plannerModel', title: 'Planner model' },
  { key: 'builderProvider', title: 'Builder provider' },
  { key: 'builderModel', title: 'Builder model' },
  { key: 'builderWriteAccess', title: 'Builder permissions (yes/no)' },
] as const;

export type SetupField = (typeof SETUP_FIELDS)[number];
export type SetupValues = Partial<Record<(typeof SETUP_FIELDS)[number]['key'], string>>;

export function setupProfileValuesFromLegacy(values: SetupValues): SetupProfileValuesByName {
  return {
    ...(values.plannerProvider || values.plannerModel
      ? {
          planner: {
            ...(values.plannerProvider ? { provider: values.plannerProvider } : {}),
            ...(values.plannerModel ? { model: values.plannerModel } : {}),
          },
        }
      : {}),
    ...(values.builderProvider || values.builderModel || values.builderWriteAccess
      ? {
          builder: {
            ...(values.builderProvider ? { provider: values.builderProvider } : {}),
            ...(values.builderModel ? { model: values.builderModel } : {}),
            ...(values.builderWriteAccess
              ? { writeAccess: values.builderWriteAccess.toLowerCase() === 'yes' }
              : {}),
          },
        }
      : {}),
  };
}
export type SetupStep = 1 | 2 | 3 | 4;

export interface SetupChoice {
  label: string;
  value: string;
  model?: AgentModel;
}

export function setupChoices(fieldIndex: number, models: AgentModel[]): SetupChoice[] {
  const field = SETUP_FIELDS[fieldIndex];
  if (!field) return [];
  if (field.key === 'plannerProvider') return modelChoices(models);
  if (field.key === 'builderProvider') return modelChoices(models);
  if (field.key === 'builderWriteAccess') {
    return [
      { label: 'no', value: 'no' },
      { label: 'yes', value: 'yes' },
    ];
  }
  return [];
}

export function setupProfileChoices(
  profile: SetupProfileName,
  fieldIndex: number,
  models: AgentModel[],
  values: SetupProfileValuesByName,
): SetupChoice[] {
  const field = setupProfileFields(profile)[fieldIndex];
  if (!field) return [];
  if (field.key === 'provider') return providerChoices(models);
  if (field.key === 'model') {
    const provider = values[profile]?.provider;
    if (!provider) return modelChoices(models);
    return modelChoices(models.filter((model) => model.provider === provider));
  }
  if (field.key === 'thinking') {
    return PI_THINKING_LEVELS.map((level) => ({
      label: level,
      value: level === 'Default' ? '' : level,
    }));
  }
  return [
    { label: 'no', value: 'no' },
    { label: 'yes', value: 'yes' },
  ];
}

export function setupProfileFieldTitle(
  profile: SetupProfileName,
  fieldIndex: number,
  modelsAvailable: boolean,
): string {
  const field = setupProfileFields(profile)[fieldIndex];
  if (!field) return '';
  if (modelsAvailable && field.key === 'provider') return `${profile} provider`;
  return field.title;
}

function providerChoices(models: AgentModel[]): SetupChoice[] {
  return [...new Set(models.map((model) => model.provider))]
    .sort((left, right) => left.localeCompare(right))
    .map((provider) => ({ label: provider, value: provider }));
}

export function setupFieldTitle(field: SetupField, modelsAvailable: boolean): string {
  if (modelsAvailable && field.key === 'plannerProvider') return 'Planning model';
  if (modelsAvailable && field.key === 'builderProvider') return 'Build model';
  return field.title;
}

export function usesDiscoveredModels(models: AgentModel[]): boolean {
  return models.length > 0;
}

function modelChoices(models: AgentModel[]): SetupChoice[] {
  const unique = new Map<string, AgentModel>();
  for (const model of models) unique.set(`${model.provider}\u0000${model.model}`, model);
  return [...unique.values()]
    .sort((left, right) => formatModel(left).localeCompare(formatModel(right)))
    .map((model) => ({ label: formatModel(model), value: model.model, model }));
}

function formatModel(model: AgentModel): string {
  const name = model.displayName?.trim() || model.model;
  return `${name} (${model.provider})`;
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
  if (workflow.id === 'todo-build-qa') return ['objective'];
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
    profile.workspaceMode === 'read-write' || profile.tools.some((tool) => !isReadOnlyPiTool(tool))
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
