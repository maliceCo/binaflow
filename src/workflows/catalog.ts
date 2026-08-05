import type { WorkflowDefinition } from '../core/workflow.js';
import { planBuildWorkflow } from './plan-build.js';
import { researchPlanBuildWorkflow } from './research-plan-build.js';
import { workflowSummaries } from './catalog-info.js';

const workflows: Record<string, WorkflowDefinition> = {
  [planBuildWorkflow.id]: planBuildWorkflow,
  [researchPlanBuildWorkflow.id]: researchPlanBuildWorkflow,
};

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
  return workflowSummaries.map((summary) => {
    const workflow = workflows[summary.id]!;
    return {
      id: workflow.id,
      version: workflow.version,
      description: summary.description,
      ...(summary.experimental ? { experimental: true } : {}),
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
