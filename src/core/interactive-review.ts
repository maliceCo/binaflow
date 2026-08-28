import type { AgentProfileSnapshot } from './run.js';

export type ReviewPhase = 'scope' | 'changes' | 'qa';
export type ReviewThreadState = 'waiting' | 'decided' | 'finalized';
export type ReviewMessageRole = 'user' | 'assistant' | 'system';
export type ReviewGenerationStatus = 'pending' | 'sent' | 'failed' | 'interrupted';
export type ReviewDecisionKind =
  'approve' | 'reject' | 'correct' | 'withdraw' | 'accept-risk' | 'postpone';

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
