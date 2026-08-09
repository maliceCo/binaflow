import type {
  ArtifactContentView,
  RunInspection,
  RunRecoveryExplanation,
} from '../../application/operations.js';
import { humanRunStatus, humanStepStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

export function detailActions(
  detail: RunInspection,
  recovery?: RunRecoveryExplanation,
  clarifications: string[] = [],
): string[] {
  const actions: string[] = [];
  if (recovery?.actions?.some((action) => action.kind === 'mark-interrupted'))
    actions.push('Mark interrupted and review recovery');
  if (recovery?.eligible) actions.push('Resume retryable work');
  if (detail.run.status === 'waiting' && detail.run.workflowId === 'research-plan-build')
    actions.push('Approve research and continue', 'Reject research with feedback', 'Leave waiting');
  if (clarifications.length > 0) actions.push('New run with revised objective');
  actions.push('Browse artifacts', 'Back to history');
  return actions;
}
export function DetailScreen({
  colors,
  detail,
  recovery,
  clarifications,
  approvalMessage,
  previews,
  previewOffset,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  detail: RunInspection;
  recovery?: RunRecoveryExplanation | undefined;
  clarifications: string[];
  approvalMessage?: string | undefined;
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
  const writeWarning =
    detail.run.workflowId === 'research-plan-build' && detail.run.status === 'waiting';
  return (
    <ScreenFrame
      title="Run detail"
      subtitle="Historical inspection and safe recovery actions"
      status={error}
      footer="j/k move | Enter select | q back"
      colors={colors}
    >
      <SafeText>{`Status: ${humanRunStatus(detail.run.status)}`}</SafeText>
      <SafeText>{`Workflow: ${detail.run.workflowId} v${detail.run.workflowVersion}`}</SafeText>
      <SafeText>{`Objective: ${detail.run.objective}`}</SafeText>
      <SafeText>{`Run ID: ${detail.run.id}`}</SafeText>
      <SafeText>{`Events: ${detail.eventCount} persisted events`}</SafeText>
      <SafeText>{`Recovery: ${recovery?.reason ?? 'Loading recovery explanation...'}`}</SafeText>
      {clarifications.length > 0 ? (
        <SafeText>{`Clarification: ${clarifications.join(' | ')}`}</SafeText>
      ) : null}
      {approvalMessage ? <SafeText>{`Approval: ${approvalMessage}`}</SafeText> : null}
      {writeWarning ? (
        <SafeText>WARNING: approving continues the workflow and can modify the workspace.</SafeText>
      ) : null}
      {previewLines.length > 0 ? (
        <TextViewport
          lines={previewLines}
          offset={previewOffset}
          visibleRows={Math.max(1, Math.min(8, visibleRows))}
        />
      ) : null}
      <SafeText>{`Artifacts: ${detail.artifacts.length} references`}</SafeText>
      <SafeText>Steps:</SafeText>
      {detail.steps.map((step) => (
        <SafeText key={step.stepId}>{`  ${step.stepId}  ${humanStepStatus(step.status)}`}</SafeText>
      ))}
      <SelectionList
        items={detailActions(detail, recovery, clarifications)}
        selected={selected}
        offset={offset}
        visibleRows={visibleRows}
      />
    </ScreenFrame>
  );
}
