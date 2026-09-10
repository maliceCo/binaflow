import type { AgentProfileSnapshot } from '../core/run.js';
import type { AgentModel } from '../core/agent.js';
import { randomUUID } from 'node:crypto';
import { parseBuildPlan, type BuildPlan } from '../workflows/plan-build.js';
import {
  parseInteractiveScope,
  type InteractiveScope,
} from '../workflows/plan-build-qa-interactive.js';
import {
  parsePlanBuildQaPlan,
  parsePlanBuildQaScope,
  type PlanBuildQaPlan,
  type PlanBuildQaScope,
} from '../workflows/plan-build-qa.js';
import type { ReviewDecision, ReviewThread } from '../core/interactive-review.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';

export const PREPARATION_CONTRACT_VERSION = 1;
export const PREPARATION_WORKFLOWS = [
  'plan-build',
  'plan-build-qa',
  'plan-build-qa-interactive',
] as const;
export type PreparationWorkflowId = (typeof PREPARATION_WORKFLOWS)[number];

export type PreparationDraftStatus = 'active' | 'consumed';
export type PreparationMessageRole = 'user' | 'assistant' | 'system';
export type PreparationGenerationStatus = 'pending' | 'sent' | 'failed' | 'interrupted';
export type PreparationReviewMode = 'human' | 'optional-auto' | 'required-auto';
export type PreparationDocumentKind = 'message' | 'synthesis' | 'scope' | 'plan' | 'review';
export type PreparationSynthesisOrigin = 'initial' | 'human' | 'legacy';
export type PreparationSynthesisSuggestionStatus = 'pending' | 'accepted' | 'discarded';
export type PreparationExperienceOrigin = 'legacy' | 'current';
export type PreparationBlockReason =
  | 'consumed'
  | 'busy'
  | 'policy-changed'
  | 'synthesis-unconfirmed'
  | 'context-uncovered'
  | 'proposal-missing'
  | 'proposal-stale'
  | 'review-required'
  | 'review-stale'
  | 'review-blocking'
  | 'review-unread'
  | 'profile-invalid'
  | 'workspace-invalid';

export interface PreparationModel extends AgentModel {
  thinkingLevels?: readonly string[];
}

export interface PreparationRevision {
  draftId: string;
  revision: number;
}

export interface PreparationDraft {
  id: string;
  workspace: string;
  workflowId: PreparationWorkflowId;
  workflowVersion: number;
  objective: string;
  revision: number;
  status: PreparationDraftStatus;
  createdAt: string;
  updatedAt: string;
  consumedRunId?: string;
}

export interface PreparationSelection {
  provider?: string;
  model: string;
  thinking?: string;
}

export interface PreparationSynthesis {
  objective: string;
  agreements: string[];
  constraints: string[];
  assumptions: string[];
  questions: string[];
}

export interface PreparationDraftView extends PreparationDraft {
  contentVersion: number;
  producer: PreparationSelection | null;
  reviewer: PreparationSelection | null;
  reviewMode: PreparationReviewMode;
  appliedReviewMode: PreparationReviewMode;
  synthesisVersion: number;
  validProposalId: string | null;
  validReviewId: string | null;
  blockingReviewId: string | null;
}

export interface PreparationMessage {
  id: string;
  draftId: string;
  sequence: number;
  role: PreparationMessageRole;
  content: string;
  generationStatus: PreparationGenerationStatus;
  profileSnapshot?: AgentProfileSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface PreparationMessageItem {
  id: string;
  sequence: number;
  role: PreparationMessageRole;
  generationStatus: PreparationGenerationStatus;
  contentRevision: number;
  preview: string;
  previewTruncated: boolean;
  profileSnapshot?: AgentProfileSnapshot;
  createdAt: string;
}

export interface PreparationSynthesisVersion {
  id: string;
  version: number;
  value: PreparationSynthesis;
  coveredThroughSequence: number;
  origin: PreparationSynthesisOrigin;
  confirmed: boolean;
  createdAt: string;
}

export interface PreparationSynthesisSuggestion {
  id: string;
  baseVersion: number;
  synthesis: PreparationSynthesis;
  coveredThroughSequence: number;
  sourceMessageId: string;
  status: PreparationSynthesisSuggestionStatus;
}

export interface PreparationOutput {
  stepId: 'scope' | 'plan';
  name: 'scope' | 'plan';
  value: BuildPlan | InteractiveScope | PlanBuildQaPlan | PlanBuildQaScope;
}

export interface PreparationProvenance {
  profile: string;
  profileSnapshot: AgentProfileSnapshot;
}

export interface PreparationProposal {
  readonly id: string;
  readonly draftId: string;
  readonly revision: number;
  readonly workflowId: PreparationWorkflowId;
  readonly workflowVersion: number;
  readonly objective: string;
  readonly outputs: readonly PreparationOutput[];
  readonly provenance: PreparationProvenance;
  readonly createdAt: string;
  readonly contentVersion?: number;
  readonly experienceOrigin?: PreparationExperienceOrigin;
}

export interface PreparationProposalSummary {
  id: string;
  revision: number;
  contentVersion: number;
  createdAt: string;
  outputNames: Array<'scope' | 'plan'>;
  experienceOrigin: PreparationExperienceOrigin;
  provenance: PreparationProvenance;
  source: 'current' | 'historical';
}

export interface PreparationOperationView {
  requestId: string;
  kind: 'reply' | 'retry' | 'proposal' | 'review';
  status: PreparationGenerationStatus;
  userMessageId?: string;
  assistantMessageId?: string;
  proposalId?: string;
  reviewId?: string;
  attempt: number;
  recoverable: boolean;
  error?: { code: string; message: string };
}

export interface PreparationReviewSummary {
  id: string;
  proposalId: string;
  contentVersion: number;
  mode: PreparationReviewMode;
  provenance: PreparationProvenance;
  createdAt: string;
  counts: { critical: number; high: number; medium: number; low: number };
  acknowledged: boolean;
  source: 'current' | 'historical';
}

export interface PreparationStoredView {
  draft: PreparationDraftView;
  synthesis: PreparationSynthesisVersion;
  suggestion: PreparationSynthesisSuggestion | null;
  proposal: PreparationProposalSummary | null;
  operation: PreparationOperationView | null;
  review: PreparationReviewSummary | null;
}

export interface PreparationOverview extends PreparationStoredView {
  effectiveReviewMode: PreparationReviewMode;
  canGenerateProposal: boolean;
  canApprove: boolean;
  blockedReasons: PreparationBlockReason[];
}

export interface PreparationDraftItem {
  id: string;
  workflowId: PreparationWorkflowId;
  status: PreparationDraftStatus;
  objectivePreview: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PreparationDraftPage {
  items: PreparationDraftItem[];
  previousCursor?: string;
  nextCursor?: string;
}

export interface PreparationMessagePage {
  items: PreparationMessageItem[];
  previousCursor?: string;
  nextCursor?: string;
}

export interface PreparationProposalPage {
  items: PreparationProposalSummary[];
  previousCursor?: string;
  nextCursor?: string;
}

export interface TaskRunItem {
  id: string;
  workflowId: string;
  status: WorkflowRun['status'];
  objectivePreview: string;
  previewTruncated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRunPage {
  items: TaskRunItem[];
  previousCursor?: string;
  nextCursor?: string;
}

export interface DocumentPage {
  documentId: string;
  version: string;
  content: string;
  startOffset: number;
  endOffset: number;
  previousCursor?: string;
  nextCursor?: string;
  startsMidLine: boolean;
  endsMidLine: boolean;
  format: 'text' | 'markdown' | 'json';
  limitations: string[];
}

export type PreparationTurnInput =
  | { kind: 'reply'; content: string }
  | { kind: 'retry'; userMessageId: string }
  | { kind: 'proposal' };

export interface PreparationTurnProvenance {
  profile: string;
  profileSnapshot: AgentProfileSnapshot;
  reviewMode?: PreparationReviewMode;
}

export interface BeginPreparationTurnRequest {
  draftId: string;
  expectedRevision: number;
  claimToken: string;
  requestId: string;
  input: PreparationTurnInput;
  provenance: PreparationTurnProvenance;
}

export interface BeginPreparationTurnResult {
  turnId: string;
  userMessageId?: string;
  assistantMessageId?: string;
  attempt: number;
  draftRevision: number;
  contentVersion: number;
  duplicate: boolean;
}

export type PreparationTurnOutcome =
  | {
      kind: 'response';
      assistantMessage?: PreparationMessage;
      synthesisSuggestion?: PreparationSynthesisSuggestion;
      proposal?: PreparationProposal;
    }
  | {
      kind: 'failure';
      status: Extract<PreparationGenerationStatus, 'failed' | 'interrupted'>;
      error: { code: string; message: string };
    };

export interface FinishPreparationTurnRequest {
  draftId: string;
  turnId: string;
  claimToken: string;
  expectedRevision: number;
  contentVersion: number;
  outcome: PreparationTurnOutcome;
}

export interface BeginPreparationReviewRequest {
  draftId: string;
  expectedRevision: number;
  claimToken: string;
  proposalId: string;
  requestId: string;
  effectivePolicy: PreparationReviewMode;
  provenance: PreparationTurnProvenance;
}

export interface BeginPreparationReviewResult {
  reviewRequestId: string;
  draftRevision: number;
  contentVersion: number;
  duplicate: boolean;
}

export type PreparationReviewOutcome =
  | {
      kind: 'report';
      reviewId: string;
      report: import('./preparation-review.js').PreparationReviewReport;
      reviewerSnapshot: AgentProfileSnapshot;
      mode: PreparationReviewMode;
      proposalId: string;
    }
  | {
      kind: 'failure';
      status: Extract<PreparationGenerationStatus, 'failed' | 'interrupted'>;
      error: { code: string; message: string };
    };

export interface FinishPreparationReviewRequest {
  draftId: string;
  reviewRequestId: string;
  claimToken: string;
  expectedRevision: number;
  contentVersion: number;
  outcome: PreparationReviewOutcome;
}

export interface PreparationSettingsPatch {
  producer?: PreparationSelection | null;
  reviewer?: PreparationSelection | null;
  reviewMode?: PreparationReviewMode;
}

export interface UpdatePreparationRequest {
  draftId: string;
  expectedRevision: number;
  patch: PreparationSettingsPatch;
}

export interface UpdatePreparationSynthesisRequest {
  draftId: string;
  expectedRevision: number;
  synthesis: PreparationSynthesis;
  coveredThroughSequence: number;
  suggestionId?: string;
}

export interface PreparationTurnResult {
  overview: PreparationStoredView;
  operation: PreparationOperationView;
  userMessageId?: string;
  assistantMessageId?: string;
  proposalId?: string;
}

export interface PreparationConversation {
  draft: PreparationDraft;
  messages: PreparationMessage[];
  proposal?: PreparationProposal;
}

export interface PreparationApproval {
  proposalId: string;
  draftId: string;
  revision: number;
  approvedAt: string;
  decision: 'approve';
}

export interface PreparationExecutionSeed {
  draftId: string;
  proposalRevision: number;
  claimToken: string;
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: ArtifactReference[];
  approval: PreparationApproval;
  reviewApproval?: { thread: ReviewThread; decision: ReviewDecision };
  expectedDraftRevision?: number;
  contentVersion?: number;
  effectiveReviewMode?: PreparationReviewMode;
  reviewId?: string;
}

export interface PreparationAgentMessageResponse {
  schemaVersion?: 1;
  kind: 'message';
  content: string;
  synthesisSuggestion?: {
    baseVersion: number;
    synthesis: PreparationSynthesis;
    coveredThroughSequence: number;
  };
}

export interface PreparationAgentProposalResponse {
  schemaVersion?: 1;
  kind: 'proposal';
  content: string;
  objective: string;
  outputs: PreparationOutput[];
}

export type PreparationAgentResponse =
  PreparationAgentMessageResponse | PreparationAgentProposalResponse;

export function parsePreparationAgentResponse(value: unknown): PreparationAgentResponse {
  if (!isRecord(value) || (value.kind !== 'message' && value.kind !== 'proposal')) {
    throw new Error('Invalid preparation agent response');
  }
  if ('schemaVersion' in value && value.schemaVersion !== 1) {
    throw new Error('Unsupported preparation response schema version');
  }
  if (value.schemaVersion === 1) {
    assertResponseKeys(
      value,
      value.kind === 'message'
        ? ['schemaVersion', 'kind', 'content', 'synthesisSuggestion']
        : ['schemaVersion', 'kind', 'content', 'objective', 'outputs'],
    );
  }
  if (!isNonEmptyString(value.content)) {
    throw new Error('Preparation agent response content must be non-empty');
  }
  if (value.kind === 'message') {
    rejectAuthorizationFields(value);
    const suggestion = value.synthesisSuggestion;
    if (suggestion !== undefined) {
      if (!isRecord(suggestion)) throw new Error('Invalid preparation synthesis suggestion');
      if (
        typeof suggestion.baseVersion !== 'number' ||
        !Number.isInteger(suggestion.baseVersion) ||
        suggestion.baseVersion < 1 ||
        typeof suggestion.coveredThroughSequence !== 'number' ||
        !Number.isInteger(suggestion.coveredThroughSequence) ||
        suggestion.coveredThroughSequence < 0
      ) {
        throw new Error('Invalid preparation synthesis suggestion versions');
      }
      const normalized = normalizeSynthesis(suggestion.synthesis);
      return {
        kind: 'message',
        content: value.content,
        ...(value.schemaVersion === 1 ? { schemaVersion: 1 as const } : {}),
        synthesisSuggestion: {
          baseVersion: suggestion.baseVersion,
          synthesis: normalized,
          coveredThroughSequence: suggestion.coveredThroughSequence,
        },
      };
    }
    return {
      kind: 'message',
      content: value.content,
      ...(value.schemaVersion === 1 ? { schemaVersion: 1 as const } : {}),
    };
  }
  rejectAuthorizationFields(value);
  if (!isNonEmptyString(value.objective) || !Array.isArray(value.outputs)) {
    throw new Error('Preparation proposal requires an objective and outputs');
  }
  return {
    kind: 'proposal',
    content: value.content,
    objective: value.objective.trim(),
    outputs: value.outputs.map((output) => normalizeOutput(output)),
    ...(value.schemaVersion === 1 ? { schemaVersion: 1 as const } : {}),
  };
}

export function validatePreparationProposal(
  proposal: Omit<PreparationProposal, 'id' | 'createdAt'>,
): void {
  if (!isNonEmptyString(proposal.draftId))
    throw new Error('Preparation proposal draft is required');
  if (!Number.isInteger(proposal.revision) || proposal.revision < 1) {
    throw new Error('Preparation proposal revision must be positive');
  }
  if (!isNonEmptyString(proposal.objective)) {
    throw new Error('Preparation proposal objective must be non-empty');
  }
  if (proposal.workflowVersion !== 1) {
    throw new Error(`Unsupported preparation workflow version: ${proposal.workflowVersion}`);
  }
  const outputs = new Map(
    proposal.outputs.map((output) => [`${output.stepId}:${output.name}`, output]),
  );
  if (proposal.outputs.length !== outputs.size)
    throw new Error('Preparation proposal has duplicate outputs');

  if (proposal.workflowId === 'plan-build') {
    if (proposal.outputs.length !== 1 || !outputs.has('plan:plan')) {
      throw new Error('plan-build preparation requires exactly the plan output');
    }
    const plan = parseBuildPlan(outputs.get('plan:plan')!.value);
    if (plan.decision !== 'build') {
      throw new Error('A plan with clarification questions is not executable');
    }
    return;
  }

  if (proposal.workflowId === 'plan-build-qa') {
    if (proposal.outputs.length !== 2 || !outputs.has('scope:scope') || !outputs.has('plan:plan')) {
      throw new Error('plan-build-qa preparation requires scope and plan outputs');
    }
    const scope = parsePlanBuildQaScope(outputs.get('scope:scope')!.value);
    if (scope.questions.length > 0 || scope.decision !== 'proceed') {
      throw new Error('A scope with clarification questions is not executable');
    }
    const plan = parsePlanBuildQaPlan(outputs.get('plan:plan')!.value);
    if (plan.questions.length > 0) {
      throw new Error('A plan with clarification questions is not executable');
    }
    return;
  }

  if (proposal.outputs.length !== 2 || !outputs.has('scope:scope') || !outputs.has('plan:plan')) {
    throw new Error('plan-build-qa-interactive preparation requires scope and plan outputs');
  }
  const scope = parseInteractiveScope(outputs.get('scope:scope')!.value);
  if (scope.questions.length > 0)
    throw new Error('A scope with clarification questions is not executable');
  const plan = parsePlanBuildQaPlan(outputs.get('plan:plan')!.value);
  if (plan.questions.length > 0)
    throw new Error('A plan with clarification questions is not executable');
}

export function createPreparationProposal(
  proposal: Omit<PreparationProposal, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): PreparationProposal {
  validatePreparationProposal(proposal);
  return deepFreeze({
    ...proposal,
    id: proposal.id ?? randomUUID(),
    createdAt: proposal.createdAt ?? new Date().toISOString(),
    outputs: proposal.outputs.map((output) => ({ ...output })),
  });
}

function normalizeOutput(value: unknown): PreparationOutput {
  if (
    !isRecord(value) ||
    !isOutputStep(value.stepId) ||
    !isOutputName(value.name) ||
    !('value' in value)
  ) {
    throw new Error('Invalid preparation proposal output');
  }
  return {
    stepId: value.stepId,
    name: value.name,
    value: value.value as PreparationOutput['value'],
  };
}

function normalizeSynthesis(value: unknown): PreparationSynthesis {
  if (!isRecord(value)) throw new Error('Invalid preparation synthesis');
  const sections = ['agreements', 'constraints', 'assumptions', 'questions'] as const;
  if (!isNonEmptyString(value.objective))
    throw new Error('Preparation synthesis objective is required');
  const result = { objective: value.objective.trim() } as PreparationSynthesis;
  for (const section of sections) {
    const values = value[section];
    if (!Array.isArray(values) || values.some((item) => !isNonEmptyString(item))) {
      throw new Error(`Preparation synthesis ${section} must contain non-empty strings`);
    }
    result[section] = values.map((item) => item.trim());
  }
  return result;
}

function rejectAuthorizationFields(value: Record<string, unknown>): void {
  for (const field of ['approved', 'approval', 'execute', 'authorized', 'authorization']) {
    if (field in value) {
      throw new Error(`Preparation agent response cannot contain authorization field ${field}`);
    }
  }
}

function assertResponseKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`Unexpected preparation response field: ${key}`);
  }
}

function isOutputStep(value: unknown): value is PreparationOutput['stepId'] {
  return value === 'scope' || value === 'plan';
}

function isOutputName(value: unknown): value is PreparationOutput['name'] {
  return value === 'scope' || value === 'plan';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
