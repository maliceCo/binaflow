import { Box } from 'ink';
import type { QaDefect } from '../../core/qa-history.js';
import type {
  QaDefectDetails,
  QaHistoryMetric,
  QaHistoryStats,
} from '../../application/qa-history-operations.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList } from '../components.js';

export function BugsScreen({
  colors,
  defects,
  stats,
  details,
  selected,
  offset,
  visibleRows,
  error,
}: {
  colors: boolean;
  defects: QaDefect[];
  stats?: QaHistoryStats;
  details?: QaDefectDetails;
  selected: number;
  offset: number;
  visibleRows: number;
  error?: string | undefined;
}) {
  const items = defects.map((defect) => {
    const marker = defect.status === 'reopened' ? ' [regression]' : '';
    return `${defect.id}  [${defect.severity}] ${defect.status}${marker}  ${defect.title}`;
  });
  return (
    <ScreenFrame
      title="QA history"
      subtitle="Local defects, recurrence and regression tracking"
      status={error}
      footer="j/k move | Enter details | q back"
      colors={colors}
      border={false}
    >
      <PaneSection title="Metrics" colors={colors} first>
        <SafeText>{`Bugs: ${stats?.total ?? defects.length}`}</SafeText>
        <SafeText>{`Occurrences: ${stats?.totalOccurrences ?? 0}`}</SafeText>
        <SafeText>{`Recurring: ${stats?.recurring ?? 0}`}</SafeText>
        <SafeText>{`Regressions: ${stats?.regressions ?? 0}`}</SafeText>
        <SafeText>{`Candidates: ${defects.length}`}</SafeText>
      </PaneSection>
      <MetricSection colors={colors} title="Frequent bugs" metrics={stats?.frequent ?? []} />
      <MetricSection colors={colors} title="Recurrences" metrics={stats?.recurrences ?? []} />
      <MetricSection colors={colors} title="Regressions" metrics={stats?.regressionDefects ?? []} />
      <PaneSection title="Candidates" colors={colors}>
        {items.length > 0 ? (
          <SelectionList
            items={items}
            selected={selected}
            offset={offset}
            visibleRows={Math.max(1, visibleRows - 8)}
          />
        ) : (
          <SafeText dimColor>No QA defects recorded for this workspace.</SafeText>
        )}
      </PaneSection>
      {details ? <DefectDetails colors={colors} details={details} /> : null}
    </ScreenFrame>
  );
}

function MetricSection({
  colors,
  title,
  metrics,
}: {
  colors: boolean;
  title: string;
  metrics: QaHistoryMetric[];
}) {
  return (
    <PaneSection title={title} colors={colors}>
      {metrics.length === 0 ? (
        <SafeText dimColor>None.</SafeText>
      ) : (
        metrics
          .slice(0, 3)
          .map((metric) => (
            <SafeText
              key={metric.id}
            >{`${metric.id}  ${metric.occurrences} occurrence(s)  ${metric.title}`}</SafeText>
          ))
      )}
      {metrics.length > 3 ? (
        <SafeText dimColor>{`... and ${metrics.length - 3} more`}</SafeText>
      ) : null}
    </PaneSection>
  );
}

function DefectDetails({ colors, details }: { colors: boolean; details: QaDefectDetails }) {
  const { defect, occurrences, events } = details;
  return (
    <PaneSection title="Selected bug" colors={colors}>
      <SafeText>{`${defect.title} [${defect.severity}] ${defect.status}`}</SafeText>
      <SafeText>{defect.summary}</SafeText>
      {defect.resolution ? <SafeText>{`Resolution: ${defect.resolution}`}</SafeText> : null}
      <SafeText>{`Occurrences: ${occurrences.length}`}</SafeText>
      {occurrences.slice(0, 3).map((occurrence) => (
        <SafeText key={occurrence.id}>
          {`  ${occurrence.runId}  iteration=${occurrence.qaIteration}  finding=${occurrence.findingId}`}
        </SafeText>
      ))}
      {events.length > 0 ? (
        <Box flexDirection="column">
          <SafeText>Lifecycle:</SafeText>
          {events.slice(-3).map((event) => (
            <SafeText key={event.id ?? `${event.status}-${event.createdAt}`}>
              {`  ${event.status}${event.details ? `: ${event.details}` : ''}`}
            </SafeText>
          ))}
        </Box>
      ) : null}
    </PaneSection>
  );
}
