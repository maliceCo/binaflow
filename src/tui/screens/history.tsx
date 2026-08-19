import { Box } from 'ink';
import type { WorkflowRun, RunStatus } from '../../core/run.js';
import {
  formatRelativeTime,
  humanRunStatus,
  runStatusColor,
  truncateDisplay,
} from '../../presentation/format.js';
import { ScreenFrame, SafeText } from '../components.js';

function filterLabel(status?: RunStatus, workflow?: string): string {
  const statusPart = status ? humanRunStatus(status) : 'all';
  const workflowPart = workflow ?? 'all';
  return `status=${statusPart}  workflow=${workflowPart}`;
}

export function HistoryScreen({
  colors,
  runs,
  selected,
  offset,
  visibleRows,
  status,
  workflow,
  hasNext,
  loading,
  error,
  columns = 80,
}: {
  colors: boolean;
  runs: WorkflowRun[];
  selected: number;
  offset: number;
  visibleRows: number;
  status?: RunStatus | undefined;
  workflow?: string | undefined;
  hasNext: boolean;
  loading: boolean;
  error?: string | undefined;
  columns?: number;
}) {
  const rows = runs.slice(offset, offset + Math.max(1, visibleRows));
  const objectiveWidth = Math.max(12, columns - 42);
  const filtersActive = status !== undefined || workflow !== undefined;
  return (
    <ScreenFrame
      title="Run history"
      subtitle="Persisted metadata only; event and artifact bodies are not loaded here."
      status={loading ? 'Loading history...' : error}
      footer="j/k move | s cycle status | w cycle workflow | n next page | r reload | Enter open | q back"
      colors={colors}
    >
      <SafeText>Filters: [s] status | [w] workflow — {filterLabel(status, workflow)}</SafeText>
      {filtersActive ? (
        colors ? (
          <SafeText color="yellow">
            Active filters applied. Press s or w until both show all to clear.
          </SafeText>
        ) : (
          <SafeText>Active filters applied. Press s or w until both show all to clear.</SafeText>
        )
      ) : (
        <SafeText dimColor>No filters active (showing all runs).</SafeText>
      )}
      {hasNext ? <SafeText>More runs available. Press n for next page.</SafeText> : null}
      {runs.length === 0 ? (
        <Box flexDirection="column">
          <SafeText>No workflow runs match these filters.</SafeText>
          <SafeText dimColor>
            Start a workflow from home, or press s/w to widen filters, then r to reload.
          </SafeText>
        </Box>
      ) : (
        <Box flexDirection="column">
          {offset > 0 ? <SafeText dimColor>^ previous items</SafeText> : null}
          {rows.map((run, index) => {
            const itemIndex = offset + index;
            const marker = itemIndex === selected ? '> ' : '  ';
            const statusLabel = humanRunStatus(run.status);
            const when = formatRelativeTime(run.updatedAt);
            const objective = truncateDisplay(
              run.objective.replace(/\s+/g, ' ').trim(),
              objectiveWidth,
            );
            const statusTone = colors ? runStatusColor(run.status) : undefined;
            return (
              <Box key={run.id}>
                <SafeText>{marker}</SafeText>
                {statusTone === undefined ? (
                  <SafeText bold={itemIndex === selected}>{statusLabel}</SafeText>
                ) : (
                  <SafeText color={statusTone} bold={itemIndex === selected}>
                    {statusLabel}
                  </SafeText>
                )}
                <SafeText>{`  ${when}  ${run.workflowId}  ${objective}`}</SafeText>
              </Box>
            );
          })}
          {offset + rows.length < runs.length ? <SafeText dimColor>v more items</SafeText> : null}
        </Box>
      )}
    </ScreenFrame>
  );
}
