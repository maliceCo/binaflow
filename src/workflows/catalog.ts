import type { WorkflowDefinition } from '../core/workflow.js';
import { planBuildWorkflow } from './plan-build.js';
import { researchPlanBuildWorkflow } from './research-plan-build.js';

const workflows: Record<string, WorkflowDefinition> = {
  [planBuildWorkflow.id]: planBuildWorkflow,
  [researchPlanBuildWorkflow.id]: researchPlanBuildWorkflow,
};

export function resolveWorkflow(workflowId: string): WorkflowDefinition {
  const workflow = workflows[workflowId];
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  return workflow;
}
