import type { ArtifactContentView } from '../../application/operations.js';
import type { RunView } from '../../application/run-view.js';
import { humanRunStatus } from '../../presentation/format.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

export type ApprovalSelection =
  | { kind: 'approve-research'; label: string }
  | { kind: 'reject-research'; label: string }
  | { kind: 'leave-waiting'; label: 'Leave waiting' };

export function approvalActionItems(view: RunView): ApprovalSelection[] {
  return [
    ...view.availableActions
      .filter((action) => action.kind === 'approve-research' || action.kind === 'reject-research')
      .map((action) => ({ kind: action.kind, label: action.label }) as const),
    { kind: 'leave-waiting', label: 'Leave waiting' },
  ];
}

export function ApprovalScreen({
  colors,
  view,
  previews,
  previewOffset,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  view: RunView;
  previews: ArtifactContentView[];
  previewOffset: number;
  error?: string | undefined;
  selected: number;
  offset: number;
  visibleRows: number;
}) {
  const actions = approvalActionItems(view);
  const previewLines = previews.flatMap((preview) => {
    const label = `${preview.artifact.stepId}.${preview.artifact.name}`;
    if (preview.error) return [`${label}: ${preview.error}`];
    return [
      label,
      ...(preview.content ?? '')
        .split('\n')
        .slice(0, 12)
        .map((line) => `  ${line}`),
    ];
  });
  return (
    <ScreenFrame
      title="Approval required"
      subtitle="Attached run is waiting for a decision"
      status={error}
      footer="j/k move | Enter select | q leave waiting"
      colors={colors}
      border={false}
    >
      <PaneSection title="Approval" colors={colors} first>
        <SafeText>{`Status: ${humanRunStatus(view.status)}`}</SafeText>
        <SafeText>{`Workflow: ${view.workflow.id} v${view.workflow.version}`}</SafeText>
        <SafeText>{`Objective: ${view.objective}`}</SafeText>
        <SafeText>{`Run ID: ${view.id}`}</SafeText>
        <SafeText>{`Request: ${view.pendingAction?.message ?? 'Review the pending action.'}`}</SafeText>
        <SafeText {...(colors ? { color: 'red' as const, bold: true } : { bold: true })}>
          WARNING: approving continues the workflow and can modify the workspace.
        </SafeText>
      </PaneSection>
      <PaneSection title="Preview" colors={colors}>
        {previewLines.length > 0 ? (
          <TextViewport
            lines={previewLines}
            offset={previewOffset}
            visibleRows={Math.max(1, Math.min(8, visibleRows))}
          />
        ) : (
          <SafeText dimColor>No approval previews available.</SafeText>
        )}
      </PaneSection>
      <PaneSection title="Decision" colors={colors}>
        <SelectionList
          items={actions.map((action) => action.label)}
          selected={selected}
          offset={offset}
          visibleRows={visibleRows}
        />
      </PaneSection>
    </ScreenFrame>
  );
}
