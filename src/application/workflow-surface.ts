import { listWorkflowContracts } from '../workflows/catalog.js';

export const WORKFLOW_SURFACE_CONTRACT_VERSION = 1 as const;

export type WorkflowSurface = 'web' | 'tui' | 'cli';
export type WorkflowSurfaceMode = 'operate' | 'observe' | 'unsupported';
export type WorkflowSurfaceCapability =
  | 'create-task'
  | 'prepare-task'
  | 'approve-plan'
  | 'execute-task'
  | 'observe-execution'
  | 'resume-execution'
  | 'cancel-execution'
  | 'view-change-summary'
  | 'view-structured-diff'
  | 'comment-diff'
  | 'edit-files'
  | 'approve-changes'
  | 'review-qa'
  | 'decide-qa';

export interface WorkflowSurfaceContract {
  contractVersion: typeof WORKFLOW_SURFACE_CONTRACT_VERSION;
  workflowId: string;
  surface: WorkflowSurface;
  mode: WorkflowSurfaceMode;
  capabilities: WorkflowSurfaceCapability[];
}

const DIRECT_CAPABILITIES: WorkflowSurfaceCapability[] = [
  'execute-task',
  'observe-execution',
  'resume-execution',
  'cancel-execution',
];

const DIRECT_QA_CAPABILITIES: WorkflowSurfaceCapability[] = [
  ...DIRECT_CAPABILITIES,
  'review-qa',
  'decide-qa',
];

const GUIDED_WEB_CAPABILITIES: WorkflowSurfaceCapability[] = [
  'create-task',
  'prepare-task',
  'approve-plan',
  'execute-task',
  'observe-execution',
  'resume-execution',
  'cancel-execution',
  'view-change-summary',
  'view-structured-diff',
];

const GUIDED_OBSERVATION_CAPABILITIES: WorkflowSurfaceCapability[] = [
  'observe-execution',
  'view-change-summary',
  'view-structured-diff',
];

export function discoverWorkflowSurfaceContracts(): WorkflowSurfaceContract[] {
  const direct = listWorkflowContracts();
  const contracts: WorkflowSurfaceContract[] = [];
  for (const workflow of direct) {
    const capabilities =
      workflow.id === 'plan-build' ? DIRECT_CAPABILITIES : DIRECT_QA_CAPABILITIES;
    contracts.push(
      surfaceContract(workflow.id, 'cli', 'operate', capabilities),
      surfaceContract(workflow.id, 'tui', 'operate', capabilities),
      surfaceContract(workflow.id, 'web', 'unsupported', []),
    );
  }
  for (const surface of ['cli', 'tui'] as const) {
    contracts.push(
      surfaceContract('guided-task-build', surface, 'observe', GUIDED_OBSERVATION_CAPABILITIES),
    );
  }
  contracts.push(surfaceContract('guided-task-build', 'web', 'operate', GUIDED_WEB_CAPABILITIES));
  return contracts;
}

export function supportForWorkflowSurface(
  workflowId: string,
  surface: WorkflowSurface,
): WorkflowSurfaceContract | undefined {
  return discoverWorkflowSurfaceContracts().find(
    (contract) => contract.workflowId === workflowId && contract.surface === surface,
  );
}

function surfaceContract(
  workflowId: string,
  surface: WorkflowSurface,
  mode: WorkflowSurfaceMode,
  capabilities: WorkflowSurfaceCapability[],
): WorkflowSurfaceContract {
  return {
    contractVersion: WORKFLOW_SURFACE_CONTRACT_VERSION,
    workflowId,
    surface,
    mode,
    capabilities: [...capabilities],
  };
}
