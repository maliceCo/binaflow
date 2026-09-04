import type { PlanBuildQaReport, QaFinding } from './plan-build-qa.js';
import type { TodoAssessment, TodoBuildResult } from './todo-build-qa.js';

export interface TodoQaIterationResult {
  iteration: number;
  report: PlanBuildQaReport;
}

export interface TodoFinalResult {
  version: 1;
  status: 'completed' | 'blocked' | 'incomplete' | 'qa_failed' | 'failed' | 'cancelled';
  objective: string;
  todoSource: string;
  assessment?: Pick<TodoAssessment, 'decision' | 'summary' | 'blockers'>;
  implementation?: TodoBuildResult;
  qa: {
    status: 'passed' | 'blocked' | 'not_run';
    iterations: number;
    found: number;
    corrected: number;
    pending: QaFinding[];
  };
}

export function createTodoFinalResult(input: {
  objective: string;
  todoSource?: string;
  assessment?: TodoAssessment;
  builds: TodoBuildResult[];
  qaReports: TodoQaIterationResult[];
  executionStatus: 'completed' | 'failed' | 'cancelled';
}): TodoFinalResult {
  const implementation = mergeBuildResults(input.builds);
  const latestQa = input.qaReports[input.qaReports.length - 1]?.report;
  const allFindings = uniqueFindings(input.qaReports.flatMap((entry) => entry.report.findings));
  const pending = latestQa?.findings ?? [];
  const pendingIds = new Set(pending.map((finding) => finding.id));
  const corrected = allFindings.filter(
    (finding) =>
      (finding.severity === 'critical' || finding.severity === 'high') &&
      !pendingIds.has(finding.id),
  ).length;
  const status = finalStatus(input.executionStatus, input.assessment, implementation, latestQa);

  return {
    version: 1,
    status,
    objective: input.objective,
    todoSource: input.todoSource ?? 'workflow input',
    ...(input.assessment
      ? {
          assessment: {
            decision: input.assessment.decision,
            summary: input.assessment.summary,
            blockers: input.assessment.blockers,
          },
        }
      : {}),
    ...(implementation ? { implementation } : {}),
    qa: {
      status: latestQa ? (latestQa.decision === 'pass' ? 'passed' : 'blocked') : 'not_run',
      iterations: input.qaReports.length,
      found: allFindings.length,
      corrected,
      pending,
    },
  };
}

export function parseTodoFinalResult(value: unknown): TodoFinalResult {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.objective !== 'string' ||
    typeof value.todoSource !== 'string' ||
    !['completed', 'blocked', 'incomplete', 'qa_failed', 'failed', 'cancelled'].includes(
      String(value.status),
    ) ||
    !isRecord(value.qa) ||
    !['passed', 'blocked', 'not_run'].includes(String(value.qa.status)) ||
    !isNonNegativeInteger(value.qa.iterations) ||
    !isNonNegativeInteger(value.qa.found) ||
    !isNonNegativeInteger(value.qa.corrected) ||
    !Array.isArray(value.qa.pending)
  ) {
    throw new Error('Invalid TODO final result');
  }
  if (
    value.assessment !== undefined &&
    (!isRecord(value.assessment) || !isStringArray(value.assessment.blockers))
  ) {
    throw new Error('Invalid TODO final result');
  }
  if (value.implementation !== undefined) {
    if (
      !isRecord(value.implementation) ||
      typeof value.implementation.summary !== 'string' ||
      !Array.isArray(value.implementation.resolvedItems) ||
      !value.implementation.resolvedItems.every(isRecord) ||
      !Array.isArray(value.implementation.pendingItems) ||
      !value.implementation.pendingItems.every(isRecord) ||
      !isStringArray(value.implementation.changedFiles) ||
      !Array.isArray(value.implementation.verifications)
    ) {
      throw new Error('Invalid TODO final result');
    }
  }
  return value as unknown as TodoFinalResult;
}

export function renderTodoFinalReport(result: TodoFinalResult): string {
  const implementation = result.implementation;
  return [
    '# Final Result',
    '',
    `Status: ${result.status}`,
    `Objective: ${result.objective}`,
    `TODO source: ${result.todoSource}`,
    '',
    '## Summary',
    implementation?.summary ??
      result.assessment?.summary ??
      'No implementation summary is available.',
    '',
    '## What was resolved',
    ...(implementation?.resolvedItems.length
      ? implementation.resolvedItems.map(
          (item) =>
            `- [x] ${item.title}: ${item.resolution}${item.evidence.length ? ` Evidence: ${item.evidence.join(', ')}` : ''}`,
        )
      : ['- Nothing was confirmed as resolved.']),
    '',
    '## What changed',
    ...(implementation?.changedFiles.length
      ? implementation.changedFiles.map((file) => `- ${file}`)
      : ['- No changed files were declared.']),
    '',
    '## Verification',
    ...(implementation?.verifications.length
      ? implementation.verifications.map(
          (verification) => `- ${verification.command}: ${verification.status}`,
        )
      : ['- No verification was completed.']),
    '',
    '## QA result',
    `- Status: ${result.qa.status}`,
    `- Iterations: ${result.qa.iterations}`,
    `- Findings detected: ${result.qa.found}`,
    `- Blocking findings corrected and verified: ${result.qa.corrected}`,
    '',
    '## Pending work',
    ...(implementation?.pendingItems ?? []).map((item) => `- ${item.title}: ${item.reason}`),
    ...result.qa.pending.map(
      (finding) => `- [${finding.severity}] ${finding.title}: ${finding.explanation}`,
    ),
    ...(result.assessment?.blockers ?? []).map((blocker) => `- Blocker: ${blocker}`),
    ...(hasPending(result) ? [] : ['- No pending work was reported.']),
    '',
  ].join('\n');
}

function mergeBuildResults(builds: TodoBuildResult[]): TodoBuildResult | undefined {
  if (builds.length === 0) return undefined;
  const resolved = new Map<string, TodoBuildResult['resolvedItems'][number]>();
  const pending = new Map<string, TodoBuildResult['pendingItems'][number]>();
  const changedFiles = new Set<string>();
  const verifications = new Map<string, TodoBuildResult['verifications'][number]>();

  for (const build of builds) {
    for (const item of build.resolvedItems) {
      resolved.set(item.id, item);
      pending.delete(item.id);
    }
    for (const item of build.pendingItems) {
      if (!resolved.has(item.id)) pending.set(item.id, item);
    }
    for (const file of build.changedFiles) changedFiles.add(file);
    for (const verification of build.verifications) {
      verifications.set(verification.command, verification);
    }
  }
  const latest = builds[builds.length - 1]!;
  return {
    status:
      latest.status === 'passed' &&
      pending.size === 0 &&
      [...verifications.values()].every((verification) => verification.status !== 'failed')
        ? 'passed'
        : 'failed',
    summary: latest.summary,
    resolvedItems: [...resolved.values()],
    pendingItems: [...pending.values()],
    changedFiles: [...changedFiles],
    verifications: [...verifications.values()],
  };
}

function finalStatus(
  executionStatus: 'completed' | 'failed' | 'cancelled',
  assessment: TodoAssessment | undefined,
  implementation: TodoBuildResult | undefined,
  qa: PlanBuildQaReport | undefined,
): TodoFinalResult['status'] {
  if (executionStatus === 'cancelled') return 'cancelled';
  if (executionStatus === 'failed') return 'failed';
  if (assessment?.decision === 'blocked') return 'blocked';
  if (!implementation || implementation.status === 'failed') return 'incomplete';
  if (qa?.decision === 'block') return 'qa_failed';
  return 'completed';
}

function uniqueFindings(findings: QaFinding[]): QaFinding[] {
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasPending(result: TodoFinalResult): boolean {
  return (
    (result.implementation?.pendingItems.length ?? 0) > 0 ||
    result.qa.pending.length > 0 ||
    (result.assessment?.blockers.length ?? 0) > 0
  );
}
