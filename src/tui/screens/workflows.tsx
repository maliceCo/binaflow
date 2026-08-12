import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { discoverWorkflows } from '../../application/operations.js';
import { ScreenFrame, SafeText, SelectionList } from '../components.js';
import { missingProfiles, orderedWorkflows } from '../launch.js';
export function workflowItems(
  workflows: ReturnType<typeof discoverWorkflows>,
  diagnosis?: ConfigurationDiagnosis | undefined,
): string[] {
  return orderedWorkflows(workflows).map((workflow) => {
    const missing = diagnosis ? missingProfiles(workflow, diagnosis) : [];
    const label = `${workflow.id}${workflow.experimental ? ' [Experimental]' : ''}: ${workflow.description}`;
    return missing.length > 0 ? `${label} (missing: ${missing.join(', ')})` : label;
  });
}
export function WorkflowsScreen({
  colors,
  workflows,
  diagnosis,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  workflows: ReturnType<typeof discoverWorkflows>;
  diagnosis?: ConfigurationDiagnosis | undefined;
  error?: string | undefined;
  selected: number;
  offset: number;
  visibleRows: number;
}) {
  return (
    <ScreenFrame
      title="Choose workflow"
      status={error}
      footer="j/k move | Enter select | q cancel"
      colors={colors}
    >
      <SafeText>Stable workflows appear before experimental workflows.</SafeText>
      <SelectionList
        items={workflowItems(workflows, diagnosis)}
        selected={selected}
        offset={offset}
        visibleRows={visibleRows}
      />
    </ScreenFrame>
  );
}
