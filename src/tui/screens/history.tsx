import type { WorkflowRun, RunStatus } from '../../core/run.js';
import { humanRunStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, SelectionList } from '../components.js';
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
}) {
  return (
    <ScreenFrame
      title="Run history"
      subtitle="Persisted metadata only; event and artifact bodies are not loaded here."
      status={loading ? 'Loading history...' : error}
      footer="j/k move | s status | w workflow | n next page | Enter open | q back"
      colors={colors}
    >
      <SafeText>
        Filters: status={status ?? 'all'} workflow={workflow ?? 'all'}
      </SafeText>
      {hasNext ? <SafeText>More runs available. Press n for next page.</SafeText> : null}
      <SelectionList
        items={runs.map(
          (run) => `${humanRunStatus(run.status)}  ${run.workflowId}  ${run.id}  ${run.objective}`,
        )}
        selected={selected}
        offset={offset}
        visibleRows={visibleRows}
      />
      {runs.length === 0 ? <SafeText>No workflow runs found.</SafeText> : null}
    </ScreenFrame>
  );
}
