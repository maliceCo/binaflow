import type {
  ArtifactContentView,
  RunInspection,
  RunRecoveryExplanation,
} from '../../application/operations.js';
import {
  formatBytes,
  formatRelativeTime,
  formatTimestamp,
  humanRunStatus,
  humanStepStatus,
  runStatusColor,
} from '../../presentation/format.js';
import { Box } from 'ink';
import { PaneSection, ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

export function detailActions(
  detail: RunInspection,
  recovery?: RunRecoveryExplanation,
  clarifications: string[] = [],
): string[] {
  const actions: string[] = [];
  if (recovery?.actions?.some((action) => action.kind === 'mark-interrupted'))
    actions.push('Mark interrupted and review recovery');
  if (recovery?.eligible) actions.push('Resume retryable work');
  if (clarifications.length > 0) actions.push('New run with revised objective');
  actions.push('Browse artifacts', 'Back to history');
  return actions;
}

export function detailActionHelp(action: string): string {
  switch (action) {
    case 'Mark interrupted and review recovery':
      return 'Mark a stuck run interrupted so recovery options can be reviewed safely.';
    case 'Resume retryable work':
      return 'Continue from completed steps without redoing finished work.';
    case 'New run with revised objective':
      return 'Start a fresh run using clarification guidance and the prior objective.';
    case 'Browse artifacts':
      return 'Open bounded previews of persisted step outputs.';
    case 'Back to history':
      return 'Return to the run list.';
    default:
      return '';
  }
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
  const actions = detailActions(detail, recovery, clarifications);
  const selectedAction = actions[selected];
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
  const runTone = colors ? runStatusColor(detail.run.status) : undefined;
  const artifactBytes = detail.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
  return (
    <ScreenFrame
      title="Run detail"
      subtitle="Historical inspection and safe recovery actions"
      status={error}
      footer="j/k move | Enter select | q back"
      colors={colors}
      border={false}
    >
      <PaneSection title="Summary" colors={colors} first>
        <Box>
          <SafeText>Status: </SafeText>
          {runTone === undefined ? (
            <SafeText>{humanRunStatus(detail.run.status)}</SafeText>
          ) : (
            <SafeText color={runTone}>{humanRunStatus(detail.run.status)}</SafeText>
          )}
          <SafeText>{`  updated ${formatRelativeTime(detail.run.updatedAt)}`}</SafeText>
        </Box>
        <SafeText>{`Workflow: ${detail.run.workflowId} v${detail.run.workflowVersion}`}</SafeText>
        <SafeText>{`Objective: ${detail.run.objective}`}</SafeText>
        <SafeText>{`Run ID: ${detail.run.id}`}</SafeText>
        <SafeText>{`Created: ${formatTimestamp(detail.run.createdAt)}`}</SafeText>
        <SafeText>{`Events: ${detail.eventCount} persisted events`}</SafeText>
        <SafeText>{`Recovery: ${recovery?.reason ?? 'Loading recovery explanation...'}`}</SafeText>
        {clarifications.length > 0 ? (
          <SafeText>{`Clarification: ${clarifications.join(' | ')}`}</SafeText>
        ) : null}
        {approvalMessage ? <SafeText>{`Approval: ${approvalMessage}`}</SafeText> : null}
        {previewLines.length > 0 ? (
          <TextViewport
            lines={previewLines}
            offset={previewOffset}
            visibleRows={Math.max(1, Math.min(8, visibleRows))}
          />
        ) : null}
        <SafeText>
          {`Artifacts: ${detail.artifacts.length} reference${detail.artifacts.length === 1 ? '' : 's'}${
            detail.artifacts.length > 0 ? ` (${formatBytes(artifactBytes)})` : ''
          }`}
        </SafeText>
      </PaneSection>

      <PaneSection title="Steps" colors={colors}>
        {detail.steps.length === 0 ? (
          <SafeText dimColor>No step records for this run.</SafeText>
        ) : (
          detail.steps.map((step) => {
            const stepTone = colors ? runStatusColor(step.status) : undefined;
            const suffix = step.error ? `  - ${step.error.message}` : '';
            return (
              <Box key={step.stepId}>
                <SafeText>{`  ${step.stepId}  `}</SafeText>
                {stepTone === undefined ? (
                  <SafeText>{humanStepStatus(step.status)}</SafeText>
                ) : (
                  <SafeText color={stepTone}>{humanStepStatus(step.status)}</SafeText>
                )}
                {suffix ? <SafeText>{suffix}</SafeText> : null}
              </Box>
            );
          })
        )}
      </PaneSection>

      <PaneSection title="Actions" colors={colors}>
        <SelectionList
          items={actions}
          selected={selected}
          offset={offset}
          visibleRows={visibleRows}
        />
        {selectedAction ? <SafeText dimColor>{detailActionHelp(selectedAction)}</SafeText> : null}
      </PaneSection>
    </ScreenFrame>
  );
}
