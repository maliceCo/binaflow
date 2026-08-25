import type { RunView } from '../../application/run-view.js';
import type { StepStatus } from '../../core/run.js';
import { formatDurationMs, humanRunStatus } from '../../presentation/format.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList } from '../components.js';

function stepMarker(status: StepStatus): string {
  switch (status) {
    case 'completed':
      return '[x]';
    case 'failed':
      return '[!]';
    case 'cancelled':
    case 'interrupted':
    case 'skipped':
      return '[-]';
    case 'waiting':
      return '[?]';
    case 'running':
      return '[>]';
    default:
      return '[ ]';
  }
}

export function ResultScreen({
  colors,
  view,
  selected,
  offset,
  visibleRows,
  error,
}: {
  colors: boolean;
  view: RunView;
  selected: number;
  offset: number;
  visibleRows: number;
  error?: string;
}) {
  const duration = view.metrics.durationMs;
  const tokens = view.metrics.usage?.totalTokens;
  const cost = view.metrics.costUsd;
  const artifactItems = view.artifacts.map((artifact) => `${artifact.stepId}.${artifact.name}`);
  return (
    <ScreenFrame
      title="Run status"
      subtitle={`Run ${view.id}`}
      status={error}
      footer={artifactItems.length > 0 ? 'j/k move | Enter browse artifacts | q back' : 'q back'}
      colors={colors}
      border={false}
    >
      <PaneSection title="Summary" colors={colors} first>
        <SafeText>Status: {humanRunStatus(view.status)}</SafeText>
        <SafeText>Workflow: {view.workflow.id}</SafeText>
        <SafeText>Duration: {duration === undefined ? '-' : formatDurationMs(duration)}</SafeText>
        <SafeText>Usage: {tokens === undefined ? '-' : `${tokens} tokens`}</SafeText>
        <SafeText>Cost: {cost === undefined ? '-' : `$${cost.toFixed(4)}`}</SafeText>
      </PaneSection>
      <PaneSection title="Checklist" colors={colors}>
        {view.phases.map((phase) => (
          <SafeText key={phase.id}>
            {'  '}
            {stepMarker(phase.status)} {phase.id} {phase.profile ?? '-'}
          </SafeText>
        ))}
      </PaneSection>
      <PaneSection title="Artifacts" colors={colors}>
        {artifactItems.length > 0 ? (
          <SelectionList
            items={artifactItems}
            selected={selected}
            offset={offset}
            visibleRows={Math.max(1, Math.min(visibleRows, artifactItems.length))}
          />
        ) : (
          <SafeText dimColor>None</SafeText>
        )}
      </PaneSection>
    </ScreenFrame>
  );
}
