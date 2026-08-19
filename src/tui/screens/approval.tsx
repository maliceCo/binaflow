import type { ArtifactContentView } from '../../application/operations.js';
import type { WorkflowRun } from '../../core/run.js';
import { humanRunStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

export const APPROVAL_ACTIONS = [
  'Approve research and continue',
  'Reject research with feedback',
  'Leave waiting',
] as const;

export function ApprovalScreen({
  colors,
  run,
  message,
  previews,
  previewOffset,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  run: WorkflowRun;
  message: string;
  previews: ArtifactContentView[];
  previewOffset: number;
  error?: string | undefined;
  selected: number;
  offset: number;
  visibleRows: number;
}) {
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
    >
      <SafeText>{`Status: ${humanRunStatus(run.status)}`}</SafeText>
      <SafeText>{`Workflow: ${run.workflowId} v${run.workflowVersion}`}</SafeText>
      <SafeText>{`Objective: ${run.objective}`}</SafeText>
      <SafeText>{`Run ID: ${run.id}`}</SafeText>
      <SafeText>{`Approval: ${message}`}</SafeText>
      <SafeText>WARNING: approving continues the workflow and can modify the workspace.</SafeText>
      {previewLines.length > 0 ? (
        <TextViewport
          lines={previewLines}
          offset={previewOffset}
          visibleRows={Math.max(1, Math.min(8, visibleRows))}
        />
      ) : (
        <SafeText>No approval previews available.</SafeText>
      )}
      <SelectionList
        items={[...APPROVAL_ACTIONS]}
        selected={selected}
        offset={offset}
        visibleRows={visibleRows}
      />
    </ScreenFrame>
  );
}
