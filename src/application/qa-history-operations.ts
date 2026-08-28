import type { QaDefect, QaDefectEvent, QaOccurrence, QaSearchResult } from '../core/qa-history.js';
import type { ApplicationInternals } from './context.js';
import type { ApplicationQaHistoryStore } from './ports.js';

export interface QaDefectDetails {
  defect: QaDefect;
  occurrences: QaOccurrence[];
  events: QaDefectEvent[];
}

export interface QaHistoryStats {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
}

export function listQaDefects(context: QaHistoryContext): Promise<QaDefect[]> {
  return assertEnabled(context).getQaDefects();
}

export async function getQaDefect(context: QaHistoryContext, id: string): Promise<QaDefectDetails> {
  const history = assertEnabled(context);
  const defect = (await history.getQaDefects()).find((candidate) => candidate.id === id);
  if (!defect) throw new Error(`Unknown QA defect: ${id}`);
  const [occurrences, events] = await Promise.all([
    history.getQaOccurrences(id),
    history.getQaDefectEvents(id),
  ]);
  return { defect, occurrences, events };
}

export function searchQaHistory(
  context: QaHistoryContext,
  fingerprint: string,
  query: string,
): Promise<QaSearchResult[]> {
  return assertEnabled(context).searchQaDefects(fingerprint, query);
}

export async function qaHistoryStats(context: QaHistoryContext): Promise<QaHistoryStats> {
  const defects = await listQaDefects(context);
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const defect of defects) {
    bySeverity[defect.severity] = (bySeverity[defect.severity] ?? 0) + 1;
    byStatus[defect.status] = (byStatus[defect.status] ?? 0) + 1;
  }
  return { total: defects.length, bySeverity, byStatus };
}

export async function reindexQaHistory(context: QaHistoryContext): Promise<void> {
  await assertEnabled(context).reindexQaSearch();
}

export async function archiveQaHistory(
  context: QaHistoryContext,
  before?: string,
): Promise<number> {
  return assertEnabled(context).archiveQaDefects(before);
}

export async function purgeQaHistory(context: QaHistoryContext): Promise<void> {
  await assertEnabled(context).purgeQaHistory();
}

type QaHistoryContext = Pick<ApplicationInternals, 'config' | 'qaHistory'>;

function assertEnabled(context: QaHistoryContext): ApplicationQaHistoryStore {
  if (context.config.qaHistory?.enabled !== true || !context.qaHistory) {
    throw new Error('QA history is disabled for this workspace');
  }
  return context.qaHistory;
}
