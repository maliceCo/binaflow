export type WorkflowStep = AgentStep;

export interface WorkflowDefinition {
  version: number;
  id: string;
  input: WorkflowInputDefinition;
  steps: WorkflowStep[];
  approval?: WorkflowApprovalDefinition;
}

export interface WorkflowApprovalDefinition {
  id: string;
  after: string;
  message: string;
}

export interface WorkflowInputDefinition {
  required: string[];
  properties: Record<string, WorkflowInputProperty>;
}

export interface WorkflowInputProperty {
  type: 'string';
  minLength?: number;
}

export interface AgentStep {
  kind: 'agent';
  id: string;
  profile: string;
  prompt: string;
  dependsOn: string[];
  inputReferences: StepInputReference[];
  outputs: StepOutputDefinition[];
}

export interface StepInputReference {
  name: string;
  source: WorkflowInputReference | StepOutputReference;
}

export interface WorkflowInputReference {
  kind: 'workflow-input';
  key: string;
}

export interface StepOutputReference {
  kind: 'step-output';
  stepId: string;
  output: string;
}

export interface StepOutputDefinition {
  name: string;
  kind: 'artifact';
  format: 'json' | 'text';
  schema?: Record<string, unknown>;
}

export function validateWorkflowDefinition(
  workflow: unknown,
): asserts workflow is WorkflowDefinition {
  const errors: string[] = [];

  if (!isRecord(workflow)) {
    throw new Error('Invalid workflow definition: expected an object');
  }

  if (!isPositiveInteger(workflow.version)) errors.push('version must be a positive integer');
  if (!isNonEmptyString(workflow.id)) errors.push('id must be a non-empty string');
  if (!isRecord(workflow.input)) errors.push('input must be an object');
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push('steps must be a non-empty array');
  }

  if (errors.length > 0) throw new Error(`Invalid workflow definition: ${errors.join('; ')}`);

  const steps = workflow.steps as unknown[];
  const stepIds = new Set<string>();
  const stepsById = new Map<string, AgentStep>();

  for (const step of steps) {
    if (!isAgentStep(step)) {
      errors.push('every step must be a valid agent step');
      continue;
    }

    if (stepIds.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);
    stepsById.set(step.id, step);

    if (step.dependsOn.includes(step.id)) errors.push(`step ${step.id} cannot depend on itself`);
    if (new Set(step.dependsOn).size !== step.dependsOn.length) {
      errors.push(`step ${step.id} has duplicate dependencies`);
    }
    if (new Set(step.outputs.map((output) => output.name)).size !== step.outputs.length) {
      errors.push(`step ${step.id} has duplicate output names`);
    }
  }

  for (const step of stepsById.values()) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency))
        errors.push(`step ${step.id} depends on unknown step ${dependency}`);
    }

    for (const reference of step.inputReferences) {
      const source = reference.source;
      if (source.kind === 'workflow-input') {
        if (!(workflow.input as WorkflowInputDefinition).properties[source.key]) {
          errors.push(`step ${step.id} references unknown input ${source.key}`);
        }
      } else {
        const sourceStep = stepsById.get(source.stepId);
        if (!sourceStep) {
          errors.push(`step ${step.id} references unknown source step ${source.stepId}`);
        } else if (!sourceStep.outputs.some((output) => output.name === source.output)) {
          errors.push(`step ${step.id} references unknown output ${source.output}`);
        }
      }
    }
  }

  if (workflow.approval !== undefined) {
    if (!isRecord(workflow.approval)) {
      errors.push('approval must be an object');
    } else if (
      !isNonEmptyString(workflow.approval.id) ||
      !isNonEmptyString(workflow.approval.after) ||
      typeof workflow.approval.message !== 'string'
    ) {
      errors.push('approval must have id, after, and message');
    } else if (!stepsById.has(workflow.approval.after)) {
      errors.push(`approval references unknown step ${workflow.approval.after}`);
    } else if (stepsById.has(workflow.approval.id)) {
      errors.push(`approval id conflicts with step ${workflow.approval.id}`);
    }
  }

  if (hasDependencyCycle(stepsById)) errors.push('steps contain a dependency cycle');
  if (errors.length > 0) throw new Error(`Invalid workflow definition: ${errors.join('; ')}`);
}

export function serializeWorkflow(workflow: WorkflowDefinition): string {
  validateWorkflowDefinition(workflow);
  return JSON.stringify(workflow);
}

function hasDependencyCycle(stepsById: Map<string, AgentStep>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(stepId: string): boolean {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;

    visiting.add(stepId);
    const step = stepsById.get(stepId);
    if (step?.dependsOn.some(visit)) return true;
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  }

  return [...stepsById.keys()].some(visit);
}

function isAgentStep(value: unknown): value is AgentStep {
  if (!isRecord(value)) return false;
  if (
    value.kind !== 'agent' ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.profile) ||
    typeof value.prompt !== 'string' ||
    !isStringArray(value.dependsOn) ||
    !Array.isArray(value.inputReferences) ||
    !Array.isArray(value.outputs)
  ) {
    return false;
  }

  return (
    value.inputReferences.every(isStepInputReference) && value.outputs.every(isStepOutputDefinition)
  );
}

function isStepInputReference(value: unknown): value is StepInputReference {
  if (!isRecord(value) || !isNonEmptyString(value.name) || !isRecord(value.source)) return false;
  if (value.source.kind === 'workflow-input') return isNonEmptyString(value.source.key);
  return (
    value.source.kind === 'step-output' &&
    isNonEmptyString(value.source.stepId) &&
    isNonEmptyString(value.source.output)
  );
}

function isStepOutputDefinition(value: unknown): value is StepOutputDefinition {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    value.kind === 'artifact' &&
    (value.format === 'json' || value.format === 'text')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
