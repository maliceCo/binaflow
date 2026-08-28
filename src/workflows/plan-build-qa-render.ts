import type {
  PlanBuildQaBuildResult,
  PlanBuildQaPlan,
  PlanBuildQaReport,
  PlanBuildQaScope,
} from './plan-build-qa.js';

export interface FinalReportBuild {
  phase: string;
  result: PlanBuildQaBuildResult;
}

export interface FinalReportQa {
  iteration: number;
  report: PlanBuildQaReport;
}

export interface FinalReportInput {
  objective: string;
  scope?: PlanBuildQaScope;
  plan?: PlanBuildQaPlan;
  builds: FinalReportBuild[];
  qaReports: FinalReportQa[];
  status: 'completed' | 'failed' | 'cancelled';
}

export function renderScope(scope: PlanBuildQaScope): string {
  return [
    '# Scope',
    '',
    `Decision: ${scope.decision}`,
    '',
    '## Strategy',
    scope.strategy,
    '',
    '## In scope',
    ...bulletList(scope.inScope),
    '',
    '## Out of scope',
    ...bulletList(scope.outOfScope),
    '',
    '## Acceptance criteria',
    ...bulletList(scope.acceptanceCriteria),
    '',
    '## Risks',
    ...scope.risks.map((risk) => `- ${risk.description} Mitigation: ${risk.mitigation}`),
    ...(scope.risks.length === 0 ? ['- None declared.'] : []),
    '',
    '## Questions',
    ...bulletList(scope.questions),
    '',
  ].join('\n');
}

export function renderTodo(plan: PlanBuildQaPlan): string {
  return [
    '# TODO',
    '',
    plan.summary,
    '',
    ...plan.tasks.flatMap((task) => [
      `## ${task.id}: ${task.title}`,
      '',
      task.description,
      '',
      `Files: ${task.files.length > 0 ? task.files.join(', ') : 'None declared.'}`,
      '',
      'Acceptance criteria:',
      ...bulletList(task.acceptanceCriteria),
      '',
    ]),
    '## Verification',
    ...bulletList(plan.verification),
    '',
    '## Risks',
    ...plan.risks.map((risk) => `- ${risk.description} Mitigation: ${risk.mitigation}`),
    ...(plan.risks.length === 0 ? ['- None declared.'] : []),
    '',
    '## Questions',
    ...bulletList(plan.questions),
    '',
  ].join('\n');
}

export function renderQaFixes(iteration: number, report: PlanBuildQaReport): string {
  return [
    `# QA Fixes ${iteration}`,
    '',
    report.summary,
    '',
    ...report.findings
      .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
      .flatMap((finding) => [
        `## ${finding.id}: ${finding.title}`,
        '',
        `Severity: ${finding.severity}`,
        `Category: ${finding.category}`,
        '',
        finding.explanation,
        '',
        `Impact: ${finding.impact}`,
        '',
        `Evidence: ${finding.evidence.join('; ')}`,
        '',
        `Suggested correction: ${finding.suggestedCorrection}`,
        '',
        'Verifications:',
        ...bulletList(finding.verifications),
        '',
      ]),
    '',
  ].join('\n');
}

export function renderFinalReport(input: FinalReportInput): string {
  const latestQa = input.qaReports[input.qaReports.length - 1];
  const allFindings = input.qaReports.flatMap(({ iteration, report }) =>
    report.findings.map((finding) => ({ iteration, finding })),
  );
  const latestFindingIds = new Set(latestQa?.report.findings.map((finding) => finding.id) ?? []);
  const resolved = allFindings.filter(
    ({ finding }) => !latestFindingIds.has(finding.id) && latestQa?.report.decision === 'pass',
  );
  const pending = allFindings.filter(({ finding }) => latestFindingIds.has(finding.id));
  const verifications = input.builds.flatMap(({ phase, result }) =>
    result.verifications.map(
      (verification) => `${phase}: ${verification.command} (${verification.status})`,
    ),
  );
  const commits = [...new Set(input.builds.flatMap(({ result }) => result.commits))];

  return [
    '# Final Report',
    '',
    `Status: ${input.status}`,
    `Objective: ${input.objective}`,
    '',
    '## Scope',
    input.scope ? input.scope.strategy : 'Scope was not completed.',
    '',
    '## Tasks',
    ...(input.plan
      ? input.plan.tasks.map((task) => `- ${task.id}: ${task.title}`)
      : ['- Plan was not completed.']),
    '',
    '## Builder verifications',
    ...bulletList(verifications),
    '',
    '## QA findings by iteration',
    ...input.qaReports.flatMap(({ iteration, report }) => [
      `### Iteration ${iteration}: ${report.decision}`,
      report.summary,
      ...report.findings.map(
        (finding) =>
          `- ${finding.id} [${finding.severity}] ${finding.title}: ${finding.explanation}`,
      ),
      '',
    ]),
    ...(input.qaReports.length === 0 ? ['- QA was not completed.', ''] : []),
    '## Resolved findings',
    ...resolved.map(
      ({ iteration, finding }) => `- ${finding.id} (reported in iteration ${iteration})`,
    ),
    ...(resolved.length === 0 ? ['- None recorded.'] : []),
    '',
    '## Pending findings',
    ...pending.map(
      ({ iteration, finding }) => `- ${finding.id} (last reported in iteration ${iteration})`,
    ),
    ...(pending.length === 0 ? ['- None recorded.'] : []),
    '',
    '## Risks',
    ...(input.scope?.risks ?? []).map(
      (risk) => `- ${risk.description} Mitigation: ${risk.mitigation}`,
    ),
    ...(input.plan?.risks ?? []).map(
      (risk) => `- ${risk.description} Mitigation: ${risk.mitigation}`,
    ),
    ...((input.scope?.risks.length ?? 0) + (input.plan?.risks.length ?? 0) === 0
      ? ['- None declared.']
      : []),
    '',
    '## Declared commits',
    ...bulletList(commits),
    '',
  ].join('\n');
}

function bulletList(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ['- None declared.'];
}
