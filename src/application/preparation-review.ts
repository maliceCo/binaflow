import type { PreparationReviewMode } from './preparation.js';

export const PREPARATION_REVIEW_SCHEMA_VERSION = 1 as const;

export const preparationReviewReportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'summary', 'findings'],
  properties: {
    schemaVersion: { const: PREPARATION_REVIEW_SCHEMA_VERSION },
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'severity',
          'title',
          'explanation',
          'impact',
          'evidence',
          'suggestedCorrection',
          'verifications',
        ],
        properties: {
          id: { type: 'string', minLength: 1 },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string', minLength: 1 },
          explanation: { type: 'string', minLength: 1 },
          impact: { type: 'string', minLength: 1 },
          evidence: { type: 'array', items: { type: 'string' } },
          suggestedCorrection: { type: 'string', minLength: 1 },
          verifications: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export type PreparationReviewSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface PreparationReviewFinding {
  id: string;
  severity: PreparationReviewSeverity;
  title: string;
  explanation: string;
  impact: string;
  evidence: string[];
  suggestedCorrection: string;
  verifications: string[];
}

export interface PreparationReviewReport {
  schemaVersion: typeof PREPARATION_REVIEW_SCHEMA_VERSION;
  summary: string;
  findings: PreparationReviewFinding[];
}

export function parsePreparationReviewReport(value: unknown): PreparationReviewReport {
  if (!isRecord(value) || value.schemaVersion !== PREPARATION_REVIEW_SCHEMA_VERSION) {
    throw new Error('Invalid preparation review schema version');
  }
  assertKeys(value, ['schemaVersion', 'summary', 'findings']);
  if (!isNonEmptyString(value.summary) || !Array.isArray(value.findings)) {
    throw new Error('Preparation review report requires summary and findings');
  }

  const ids = new Set<string>();
  const findings = value.findings.map((candidate) => {
    if (!isRecord(candidate)) throw new Error('Invalid preparation review finding');
    assertKeys(candidate, [
      'id',
      'severity',
      'title',
      'explanation',
      'impact',
      'evidence',
      'suggestedCorrection',
      'verifications',
    ]);
    const id = requiredString(candidate, 'id');
    if (ids.has(id)) throw new Error(`Duplicate preparation review finding: ${id}`);
    ids.add(id);
    const severity = candidate.severity;
    if (
      severity !== 'critical' &&
      severity !== 'high' &&
      severity !== 'medium' &&
      severity !== 'low'
    ) {
      throw new Error(`Invalid preparation review severity for ${id}`);
    }
    return {
      id,
      severity,
      title: requiredString(candidate, 'title'),
      explanation: requiredString(candidate, 'explanation'),
      impact: requiredString(candidate, 'impact'),
      evidence: stringArray(candidate, 'evidence'),
      suggestedCorrection: requiredString(candidate, 'suggestedCorrection'),
      verifications: stringArray(candidate, 'verifications'),
    } satisfies PreparationReviewFinding;
  });

  return {
    schemaVersion: PREPARATION_REVIEW_SCHEMA_VERSION,
    summary: value.summary.trim(),
    findings,
  };
}

export function reviewFindingCounts(report: PreparationReviewReport): {
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  return report.findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

export function reviewBlocksApproval(report: PreparationReviewReport): boolean {
  return report.findings.some(
    (finding) => finding.severity === 'critical' || finding.severity === 'high',
  );
}

export function reviewNeedsAcknowledgement(report: PreparationReviewReport): boolean {
  return report.findings.some(
    (finding) => finding.severity === 'medium' || finding.severity === 'low',
  );
}

export function effectivePreparationReviewMode(
  globalMode: PreparationReviewMode,
  draftMode: PreparationReviewMode,
): PreparationReviewMode {
  return globalMode === 'required-auto' ? 'required-auto' : draftMode;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (!isNonEmptyString(candidate)) throw new Error(`Preparation review ${key} must be non-empty`);
  return candidate.trim();
}

function stringArray(value: Record<string, unknown>, key: string): string[] {
  const candidate = value[key];
  if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== 'string')) {
    throw new Error(`Preparation review ${key} must contain strings`);
  }
  return candidate.map((item) => item.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`Unexpected preparation review field: ${key}`);
  }
}
