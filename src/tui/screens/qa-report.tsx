import type { TaskOutcome, TaskQaRound } from '../../application/task-outcome.js';
import type { QaFinding, QaFindingSeverity } from '../../workflows/plan-build-qa.js';
import type { QaReportFocus, QaSeverityFilter } from '../model.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

const SEVERITIES: QaFindingSeverity[] = ['critical', 'high', 'medium', 'low'];

export function QaReportScreen({
  colors,
  outcome,
  round,
  roundId,
  findingId,
  focus,
  filter,
  detailOffset,
  visibleRows,
  error,
}: {
  colors: boolean;
  outcome: TaskOutcome;
  round?: TaskQaRound;
  roundId?: string;
  findingId?: string;
  focus: QaReportFocus;
  filter: QaSeverityFilter;
  detailOffset: number;
  visibleRows: number;
  error?: string;
}) {
  const report = round?.report;
  const findings = report?.findings ?? [];
  const filtered =
    filter === 'all' ? findings : findings.filter((item) => item.severity === filter);
  const selectedFinding = filtered.find((finding) => finding.id === findingId);
  const roundItems = outcome.qaRoundIds.map((id) => `${id} (iteration ${iterationOf(id)})`);
  const detailLines = selectedFinding
    ? findingLines(selectedFinding)
    : report
      ? [
          'Select a finding to inspect its evidence and suggested correction.',
          report.findings.length === 0
            ? 'No findings were reported. This is not an independent quality guarantee.'
            : `No finding matches the ${filter} filter.`,
        ]
      : [
          'QA report details are unavailable.',
          ...(round?.limitations ?? ['Select a round to load its report.']),
          round?.artifact
            ? `Source artifact: ${round.artifact.stepId}.${round.artifact.name}`
            : 'Source artifact: unavailable.',
        ];
  return (
    <ScreenFrame
      title="QA report"
      subtitle={`Run ${outcome.run.id} | ${outcome.run.workflowId}`}
      status={error}
      footer="Tab focus | j/k move/scroll | f filter | Enter select | q back"
      colors={colors}
      border={false}
    >
      <SafeText dimColor>{`Focus: ${focus}`}</SafeText>
      <PaneSection title="QA rounds" colors={colors} first>
        <SelectionList
          items={roundItems}
          selected={Math.max(0, outcome.qaRoundIds.indexOf(roundId ?? ''))}
          offset={0}
          visibleRows={Math.max(1, Math.min(4, visibleRows))}
        />
      </PaneSection>
      <PaneSection title="Summary" colors={colors}>
        {report ? (
          <>
            <SafeText>{`Decision: ${report.decision}`}</SafeText>
            <SafeText>{report.summary}</SafeText>
            <SafeText>{severitySummary(findings)}</SafeText>
          </>
        ) : (
          <SafeText dimColor>
            {round ? 'Report not available.' : 'Loading selected round...'}
          </SafeText>
        )}
        <SafeText>{`Filter: ${filter}  Findings shown: ${filtered.length}`}</SafeText>
      </PaneSection>
      <PaneSection title="Findings" colors={colors}>
        {filtered.length > 0 ? (
          <SelectionList
            items={filtered.map(
              (finding) => `${finding.severity} | ${finding.id} | ${finding.title}`,
            )}
            selected={Math.max(
              0,
              filtered.findIndex((finding) => finding.id === findingId),
            )}
            offset={0}
            visibleRows={Math.max(1, Math.min(5, visibleRows))}
          />
        ) : (
          <SafeText dimColor>
            {report?.findings.length === 0
              ? 'No findings. This is not an independent quality guarantee.'
              : 'No findings match the selected filter.'}
          </SafeText>
        )}
      </PaneSection>
      <PaneSection title="Finding detail" colors={colors}>
        <TextViewport
          lines={detailLines}
          offset={detailOffset}
          visibleRows={Math.max(1, Math.min(8, visibleRows))}
        />
      </PaneSection>
    </ScreenFrame>
  );
}

function severitySummary(findings: QaFinding[]): string {
  return SEVERITIES.map(
    (severity) =>
      `${severity}=${findings.filter((finding) => finding.severity === severity).length}`,
  ).join('  ');
}

function findingLines(finding: QaFinding): string[] {
  return [
    `${finding.id} | ${finding.severity} | ${finding.category}`,
    `Title: ${finding.title}`,
    `Explanation: ${finding.explanation}`,
    `Impact: ${finding.impact}`,
    'Evidence:',
    ...finding.evidence.map((value) => `- ${value}`),
    `Suggested correction: ${finding.suggestedCorrection}`,
    'Verifications:',
    ...finding.verifications.map((value) => `- ${value}`),
  ];
}

function iterationOf(roundId: string): number {
  return roundId === 'qa' ? 1 : Number(roundId.slice(3));
}
