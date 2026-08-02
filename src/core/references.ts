import type { AgentStep, WorkflowDefinition } from './workflow.js';

export function resolveStepOrder(workflow: WorkflowDefinition): AgentStep[] {
  const steps = new Map(workflow.steps.map((step) => [step.id, step]));
  const ordered: AgentStep[] = [];
  const visited = new Set<string>();

  function visit(stepId: string): void {
    if (visited.has(stepId)) return;
    const step = steps.get(stepId);
    if (!step) throw new Error(`Unknown workflow step: ${stepId}`);
    for (const dependency of step.dependsOn) visit(dependency);
    visited.add(stepId);
    ordered.push(step);
  }

  for (const step of workflow.steps) visit(step.id);
  return ordered;
}
