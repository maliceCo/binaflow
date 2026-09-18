import type { GuidedTaskSummaryView } from '../../application/guided-task-view.js';
import { SafeText, ScreenFrame, SelectionList } from '../components.js';

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
    <ScreenFrame
      title="Guided tasks"
      subtitle="Guided  |  Observe only  |  Use Web for preparation and changes"
      footer="j/k move | Enter open | r refresh | q back"
      colors={colors}
      border={false}
    >
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
    </ScreenFrame>
  );
}
