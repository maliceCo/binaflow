import type { WorkflowDefinition } from '../core/workflow.js';
import { planBuildWorkflow } from './plan-build.js';
import { researchPlanBuildWorkflow } from './research-plan-build.js';

export interface WorkflowSummary {
  id: string;
  description: string;
  experimental?: boolean;
}

export interface WorkflowRegistration {
  definition: WorkflowDefinition;
  description: string;
  experimental?: boolean;
}

const registrations: readonly WorkflowRegistration[] = [
  {
    definition: planBuildWorkflow,
    description: 'Plan the work, then implement the validated plan',
  },
  {
    definition: researchPlanBuildWorkflow,
    description: 'Research the repository, review findings, then build',
    experimental: true,
  },
];

const workflows: Record<string, WorkflowDefinition> = Object.fromEntries(
  registrations.map((entry) => [entry.definition.id, entry.definition]),
);

export const workflowSummaries: readonly WorkflowSummary[] = registrations.map((entry) => ({
  id: entry.definition.id,
  description: entry.description,
  ...(entry.experimental ? { experimental: true as const } : {}),
}));

export function resolveWorkflow(workflowId: string): WorkflowDefinition {
  const workflow = workflows[workflowId];
  if (!workflow) {
    throw new Error(
      `Unknown workflow: ${workflowId}. Available workflows: ${workflowSummaries.map((item) => item.id).join(', ')}`,
    );
  }
  return workflow;
}

export interface WorkflowContract {
  id: string;
  version: number;
  description: string;
  experimental?: boolean;
  input: WorkflowDefinition['input'];
  requiredProfiles: string[];
  steps: Array<{
    id: string;
    profile: string;
    dependsOn: string[];
    outputs: WorkflowDefinition['steps'][number]['outputs'];
  }>;
  approval?: WorkflowDefinition['approval'];
}

export function listWorkflowContracts(): WorkflowContract[] {
  return registrations.map((entry) => {
    const workflow = entry.definition;
    return {
      id: workflow.id,
      version: workflow.version,
      description: entry.description,
      ...(entry.experimental ? { experimental: true } : {}),
      input: workflow.input,
      requiredProfiles: [...new Set(workflow.steps.map((step) => step.profile))],
      steps: workflow.steps.map((step) => ({
        id: step.id,
        profile: step.profile,
        dependsOn: step.dependsOn,
        outputs: step.outputs,
      })),
      ...(workflow.approval ? { approval: workflow.approval } : {}),
    };
  });
}
