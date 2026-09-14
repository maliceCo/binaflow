import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import type {
  AgentProfileSnapshot,
  ArtifactReference,
  RunStatus,
  StepStatus,
} from '../core/run.js';
import type { AgentProfile } from '../core/agent-profile.js';
import type {
  TaskContractAction,
  TaskContractBrief,
  TaskContractDocument,
  TaskContractPlan,
  TaskContractTodo,
} from './task-contract.js';

export const GUIDED_EXECUTION_COORDINATOR_VERSION = 1 as const;
export const GUIDED_EXECUTION_WORKFLOW_ID = 'guided-task-build' as const;

export type GuidedExecutionStage = 'execution' | 'changes-review';
export type GuidedExecutionDecision = 'done' | 'blocked';
export type GuidedResumeDecision =
  'retry-task' | 'retry-verification' | 'continue' | 'reconcile-commit' | 'cancel';
export type GuidedExecutionBlockType =
  | 'agent-blocked'
  | 'verification-failed'
  | 'workspace-changed'
  | 'commit-unconfirmed'
  | 'interrupted-attempt';

export interface GuidedTaskEvidence {
  criterion: string;
  passed: boolean;
  details: string;
}

export interface GuidedTaskAgentResult {
  decision: GuidedExecutionDecision;
  summary: string;
  files: string[];
  evidence: GuidedTaskEvidence[];
  blockReason?: string;
}

export interface GuidedExecutionGitState {
  workspace: string;
  branch: string;
  head: string;
  clean: boolean;
  changes: GuidedGitChange[];
}

export interface GuidedGitChange {
  path: string;
  status: string;
  mode: string;
  contentHash: string | null;
}

export interface GuidedCommitInspection {
  sha: string;
  parent: string;
  tree: string;
  branch: string;
  trailer?: string;
  fingerprint: GuidedExecutionGitState;
}

export interface GuidedExecutionProfile extends AgentProfileSnapshot {
  name: string;
}

export interface GuidedExecutionCommand {
  command: string;
  args?: string[];
  shell: true;
}

export interface GuidedExecutionDocuments {
  brief: TaskContractDocument<TaskContractBrief>;
  plan: TaskContractDocument<TaskContractPlan>;
  todo: TaskContractDocument<TaskContractTodo>;
  approval: TaskContractAction;
}

export interface GuidedExecutionAuthorization {
  contractId: string;
  contractRevision: number;
  todoVersion: number;
  coordinatorVersion: number;
  workflowVersion: number;
  workspace: string;
  documents: {
    briefId: string;
    briefVersion: number;
    planId: string;
    planVersion: number;
    todoId: string;
    todoVersion: number;
    approvalId: string;
  };
  profile: GuidedExecutionProfile;
  commands: GuidedExecutionCommand[];
  files: string[];
  branch: string;
  head: string;
}

export interface GuidedExecutionPreview {
  authorization: GuidedExecutionAuthorization;
  todoMarkdown: { fileName: 'TODO.md'; content: string };
  git: GuidedExecutionGitState;
  digest: string;
}

export interface GuidedStartRequest {
  requestId: string;
  contractId: string;
  expectedRevision: number;
  todoVersion: number;
  previewDigest: string;
}

export interface GuidedResumeRequest {
  runId: string;
  expectedRevision: number;
  previewDigest: string;
  decision: GuidedResumeDecision;
  reason: string;
}

export interface GuidedExecutionBlock {
  id: string;
  revision: number;
  phaseId: string;
  taskId?: string;
  type: GuidedExecutionBlockType;
  reason: string;
  evidence: ArtifactReference[];
  fingerprint?: GuidedExecutionGitState;
}

export interface GuidedExecutionTaskProgress {
  id: string;
  phaseId: string;
  ordinal: number;
  status: StepStatus;
  attempt: number;
  agentStepId?: string;
  resultArtifact?: ArtifactReference;
  verificationArtifact?: ArtifactReference;
}

export interface GuidedExecutionPhaseProgress {
  id: string;
  ordinal: number;
  title: string;
  status: RunStatus;
  tasks: GuidedExecutionTaskProgress[];
  commitSha?: string;
  noChanges?: boolean;
}

export interface GuidedExecutionProgress {
  runId: string;
  contractId: string;
  revision: number;
  stage: GuidedExecutionStage;
  status: RunStatus;
  phases: GuidedExecutionPhaseProgress[];
  activeBlock: GuidedExecutionBlock | null;
  nextAction: 'execute' | 'review-changes' | 'resume' | 'cancel' | 'none';
}

export interface GuidedExecutionSnapshot {
  contractId: string;
  contractRevision: number;
  coordinatorVersion: number;
  workflowVersion: number;
  workspace: string;
  objective: string;
  brief: TaskContractDocument<TaskContractBrief>;
  plan: TaskContractDocument<TaskContractPlan>;
  todo: TaskContractDocument<TaskContractTodo>;
  approval: TaskContractAction;
  profile: GuidedExecutionProfile;
  git: GuidedExecutionGitState;
  commands: GuidedExecutionCommand[];
  files: string[];
}

export interface GuidedExecutionCreateRequest {
  requestId: string;
  snapshot: GuidedExecutionSnapshot;
  snapshotArtifact: ArtifactReference;
  todoArtifact: ArtifactReference;
  inputArtifact: ArtifactReference;
  authorizationDigest?: string;
}

export interface GuidedExecutionClaim {
  runId: string;
  token: string;
  revision: number;
}

export interface GuidedExecutionCheckpoint {
  runId: string;
  phaseId: string;
  taskId?: string;
  fingerprint: GuidedExecutionGitState;
  artifactIds: string[];
  revision: number;
}

export interface GuidedExecutionCommitIntent {
  runId: string;
  phaseId: string;
  token: string;
  branch: string;
  parent: string;
  tree?: string;
  fingerprint: GuidedExecutionGitState;
  paths: string[];
  message: string;
  evidenceArtifactIds: string[];
}

export interface GuidedExecutionDecisionRecord {
  id: string;
  runId: string;
  sequence: number;
  revision: number;
  decision: GuidedResumeDecision | 'cancel';
  reason: string;
  fingerprint: string;
  createdAt: string;
}

export interface WorkspaceExecutionLease {
  workspace: string;
  token: string;
  release(): Promise<void>;
}

export interface WorkspaceCommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  ok: boolean;
  error?: string;
}

export interface WorkspaceCommandOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface GuidedTaskStepInput {
  objective: string;
  constraints: string[];
  plan: string;
  phase: string;
  task: string;
  instructions: string[];
  verification: string[];
  stopConditions: string[];
  previousCheckpoint?: string;
}

export class GuidedExecutionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuidedExecutionContractError';
  }
}

export const guidedTaskAgentResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary', 'files', 'evidence'],
  properties: {
    decision: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string', minLength: 1 },
    files: { type: 'array', items: { type: 'string', minLength: 1 } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'passed', 'details'],
        properties: {
          criterion: { type: 'string', minLength: 1 },
          passed: { type: 'boolean' },
          details: { type: 'string', minLength: 1 },
        },
      },
    },
    blockReason: { type: 'string', minLength: 1 },
  },
} as const;

export const guidedExecutionSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contractId',
    'contractRevision',
    'coordinatorVersion',
    'workflowVersion',
    'workspace',
    'objective',
    'brief',
    'plan',
    'todo',
    'approval',
    'profile',
    'git',
    'commands',
    'files',
  ],
  properties: {
    contractId: { type: 'string', minLength: 1 },
    contractRevision: { type: 'integer', minimum: 1 },
    coordinatorVersion: { type: 'integer', minimum: 1 },
    workflowVersion: { type: 'integer', minimum: 1 },
    workspace: { type: 'string', minLength: 1 },
    objective: { type: 'string', minLength: 1 },
    brief: { type: 'object' },
    plan: { type: 'object' },
    todo: { type: 'object' },
    approval: { type: 'object' },
    profile: { type: 'object' },
    git: { type: 'object' },
    commands: { type: 'array' },
    files: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateAgentResult = ajv.compile<GuidedTaskAgentResult>(guidedTaskAgentResultSchema);
const validateSnapshot = ajv.compile<GuidedExecutionSnapshot>(guidedExecutionSnapshotSchema);

export function parseGuidedTaskAgentResult(value: unknown): GuidedTaskAgentResult {
  if (!validateAgentResult(value))
    throw schemaError('guided task agent result', validateAgentResult);
  const result = value as GuidedTaskAgentResult;
  if (result.decision === 'blocked' && !result.blockReason) {
    throw new GuidedExecutionContractError('blocked agent result requires blockReason');
  }
  return result;
}

export function parseGuidedExecutionSnapshot(value: unknown): GuidedExecutionSnapshot {
  if (!validateSnapshot(value)) throw schemaError('guided execution snapshot', validateSnapshot);
  return value as GuidedExecutionSnapshot;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function createGuidedExecutionDigest(authorization: GuidedExecutionAuthorization): string {
  return createHash('sha256').update(canonicalizeJson(authorization)).digest('hex');
}

export function guidedStepId(phaseOrdinal: number, taskOrdinal: number, attempt: number): string {
  assertPositiveInteger(phaseOrdinal, 'phaseOrdinal');
  assertPositiveInteger(taskOrdinal, 'taskOrdinal');
  assertPositiveInteger(attempt, 'attempt');
  return `p${String(phaseOrdinal).padStart(3, '0')}-t${String(taskOrdinal).padStart(3, '0')}-a${String(attempt).padStart(3, '0')}`;
}

export function isGuidedStepId(value: string): boolean {
  return /^p\d{3}-t\d{3}-a\d{3}$/.test(value);
}

export function canTransitionGuidedTask(from: StepStatus, to: StepStatus): boolean {
  if (from === to) return true;
  const allowed: Record<StepStatus, readonly StepStatus[]> = {
    pending: ['running', 'cancelled', 'interrupted', 'skipped'],
    running: ['completed', 'failed', 'cancelled', 'interrupted', 'waiting'],
    waiting: ['running', 'cancelled', 'interrupted'],
    failed: ['running', 'cancelled', 'interrupted'],
    interrupted: ['running', 'cancelled'],
    cancelled: [],
    completed: [],
    skipped: ['running'],
  };
  return allowed[from].includes(to);
}

export function assertGuidedTaskTransition(from: StepStatus, to: StepStatus): void {
  if (!canTransitionGuidedTask(from, to)) {
    throw new GuidedExecutionContractError(`invalid guided task transition: ${from} -> ${to}`);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, sortJson(record[key])]),
    );
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new GuidedExecutionContractError(`${name} must be a positive integer`);
  }
}

function schemaError(
  name: string,
  validator: { errors?: Array<{ message?: string }> | null },
): Error {
  const details = validator.errors
    ?.map((error) => error.message)
    .filter(Boolean)
    .join(', ');
  return new GuidedExecutionContractError(`invalid ${name}${details ? `: ${details}` : ''}`);
}

export type { AgentProfile };
