export type QaDefectStatus =
  | 'detected'
  | 'linked'
  | 'fixed'
  | 'verified'
  | 'reopened'
  | 'withdrawn'
  | 'accepted-risk'
  | 'archived';

export interface QaDefect {
  id: string;
  fingerprint: string;
  title: string;
  summary: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: QaDefectStatus;
  createdAt: string;
  updatedAt: string;
  locations?: string[];
  symbols?: string[];
  resolution?: string;
}

export interface QaSearchResult {
  defect: QaDefect;
  exact: boolean;
}

export interface QaOccurrence {
  id: string;
  runId: string;
  defectId: string;
  qaIteration: number;
  findingId: string;
  reportArtifactId: string;
  createdAt: string;
}

export interface QaDefectEvent {
  id?: number;
  defectId: string;
  occurrenceId?: string;
  status: QaDefectStatus;
  details?: string;
  createdAt: string;
}
