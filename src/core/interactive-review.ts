import type { AgentProfileSnapshot } from './run.js';

export type ReviewPhase = 'scope' | 'changes' | 'qa';
export type ReviewThreadState = 'waiting' | 'decided' | 'finalized';
export type ReviewMessageRole = 'user' | 'assistant' | 'system';
export type ReviewGenerationStatus = 'pending' | 'sent' | 'failed' | 'interrupted';
export type ReviewDecisionKind =
  | 'approve'
  | 'reject'
  | 'correct'
  | 'withdraw'
  | 'withdrawn'
  | 'accept-risk'
  | 'postpone'
  | 'confirmed'
  | 'reclassified'
  | 'needs-human-decision';

export type InteractiveDecision = Extract<
  ReviewDecisionKind,
  'approve' | 'reject' | 'correct' | 'withdraw' | 'accept-risk' | 'postpone'
>;

export type InteractiveDecisionEffect = 'advance' | 'correct' | 'stay';

export function interactiveDecisionEffect(
  phase: ReviewPhase,
  decision: InteractiveDecision,
): InteractiveDecisionEffect {
  if (decision === 'reject' || decision === 'postpone') return 'stay';
  if (phase === 'qa' && decision === 'correct') return 'correct';
  if (
    phase === 'qa' &&
    (decision === 'approve' || decision === 'withdraw' || decision === 'accept-risk')
  ) {
    return 'advance';
  }
  return decision === 'approve' ? 'advance' : 'stay';
}

export type ReviewTargetKind = 'scope' | 'task' | 'change' | 'finding';

export interface ReviewTarget {
  kind: ReviewTargetKind;
  id: string;
}

export interface ReviewThread {
  id: string;
  runId: string;
  phase: ReviewPhase;
  target: ReviewTarget;
  artifactRevision: number;
  state: ReviewThreadState;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: ReviewMessageRole;
  content?: string;
  contentArtifactId?: string;
  generationStatus: ReviewGenerationStatus;
  profileSnapshot?: AgentProfileSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewDecision {
  id?: number;
  threadId: string;
  target: ReviewTarget;
  decision: ReviewDecisionKind;
  revision: number;
  details?: string;
  createdAt: string;
}
