import type { GuidedTaskSummaryView } from '../../application/guided-task-view.js';
import { PaneSection, SafeText, SelectionList } from '../components.js';

export function GuidedTasksScreen({
  colors,
  tasks,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  tasks: GuidedTaskSummaryView[];
  selected: number;
  offset: number;
  visibleRows: number;
}) {
  const items = tasks.map(
    (task) =>
      `${task.id}  ${task.phase}  ${task.readiness}${task.executionRunId ? `  run:${task.executionRunId}` : ''}`,
  );
  return (
    <PaneSection title="Guided tasks" colors={colors}>
      {items.length > 0 ? (
        <SelectionList
          items={items}
          selected={selected}
          offset={offset}
          visibleRows={visibleRows}
        />
      ) : (
        <SafeText dimColor>No guided tasks in this workspace.</SafeText>
      )}
      <SafeText dimColor>Read-only. Use binaflow web for preparation and changes.</SafeText>
    </PaneSection>
  );
}
