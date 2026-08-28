import type { ArtifactContentView } from '../../application/operations.js';
import type { RunView } from '../../application/run-view.js';
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

export type DetailAction =
  | { kind: 'resume' | 'mark-interrupted'; label: string }
  | { kind: 'clarification' | 'browse-artifacts' | 'back'; label: string };

export function detailActionItems(view: RunView): DetailAction[] {
  const actions: DetailAction[] = [];
  for (const action of view.availableActions) {
    if (action.kind === 'mark-interrupted' || action.kind === 'resume')
      actions.push({ kind: action.kind, label: action.label });
  }
  if (view.followUp?.kind === 'clarification')
    actions.push({ kind: 'clarification', label: 'New run with revised objective' });
  actions.push(
    { kind: 'browse-artifacts', label: 'Browse artifacts' },
    { kind: 'back', label: 'Back to history' },
  );
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
  view,
  clarifications,
  previews,
  previewOffset,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  view: RunView;
  clarifications: string[];
  previews: ArtifactContentView[];
  previewOffset: number;
  error?: string | undefined;
  selected: number;
  offset: number;
  visibleRows: number;
}) {
  const actions = detailActionItems(view);
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
  const runTone = colors ? runStatusColor(view.status) : undefined;
  const artifactBytes = view.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
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
            <SafeText>{humanRunStatus(view.status)}</SafeText>
          ) : (
            <SafeText color={runTone}>{humanRunStatus(view.status)}</SafeText>
          )}
          <SafeText>{`  updated ${formatRelativeTime(view.updatedAt)}`}</SafeText>
        </Box>
        <SafeText>{`Workflow: ${view.workflow.id} v${view.workflow.version}`}</SafeText>
        <SafeText>{`Objective: ${view.objective}`}</SafeText>
        <SafeText>{`Run ID: ${view.id}`}</SafeText>
        <SafeText>{`Created: ${formatTimestamp(view.createdAt)}`}</SafeText>
        <SafeText>{`Events: ${view.eventCount} persisted events`}</SafeText>
        <SafeText>{`Available actions: ${view.availableActions.length}`}</SafeText>
        {view.qa ? (
          <SafeText>{`QA: iteration ${view.qa.iteration}/${view.qa.limit}  blocking findings=${view.qa.blockingFindings}  action=${view.qa.recoveryAction}`}</SafeText>
        ) : null}
        {clarifications.length > 0 ? (
          <SafeText>{`Clarification: ${clarifications.join(' | ')}`}</SafeText>
        ) : null}
        {previewLines.length > 0 ? (
          <TextViewport
            lines={previewLines}
            offset={previewOffset}
            visibleRows={Math.max(1, Math.min(8, visibleRows))}
          />
        ) : null}
        <SafeText>
          {`Artifacts: ${view.artifacts.length} reference${view.artifacts.length === 1 ? '' : 's'}${
            view.artifacts.length > 0 ? ` (${formatBytes(artifactBytes)})` : ''
          }`}
        </SafeText>
      </PaneSection>

      <PaneSection title="Steps" colors={colors}>
        {view.phases.length === 0 ? (
          <SafeText dimColor>No step records for this run.</SafeText>
        ) : (
          view.phases.map((phase) => {
            const stepTone = colors ? runStatusColor(phase.status) : undefined;
            const suffix = phase.error ? `  - ${phase.error.message}` : '';
            return (
              <Box key={phase.id}>
                <SafeText>{`  ${phase.id}  `}</SafeText>
                {stepTone === undefined ? (
                  <SafeText>{humanStepStatus(phase.status)}</SafeText>
                ) : (
                  <SafeText color={stepTone}>{humanStepStatus(phase.status)}</SafeText>
                )}
                {suffix ? <SafeText>{suffix}</SafeText> : null}
              </Box>
            );
          })
        )}
      </PaneSection>

      <PaneSection title="Actions" colors={colors}>
        <SelectionList
          items={actions.map((action) => action.label)}
          selected={selected}
          offset={offset}
          visibleRows={visibleRows}
        />
        {selectedAction ? (
          <SafeText dimColor>{detailActionHelp(selectedAction.label)}</SafeText>
        ) : null}
      </PaneSection>
    </ScreenFrame>
  );
}
