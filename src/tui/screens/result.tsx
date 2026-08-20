import type { RunInspection } from '../../application/operations.js';
import type { StepRun } from '../../core/run.js';
import { formatDurationMs, humanRunStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, SelectionList } from '../components.js';
import { sumStepCosts, sumStepTokens } from '../execution.js';

function stepMarker(status: StepRun['status']): string {
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
  inspection,
  selected,
  offset,
  visibleRows,
  error,
}: {
  colors: boolean;
  inspection: RunInspection;
  selected: number;
  offset: number;
  visibleRows: number;
  error?: string;
}) {
  const run = inspection.run;
  const duration = formatDurationMs(
    Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.createdAt)),
  );
  const tokens = sumStepTokens(inspection.steps);
  const cost = sumStepCosts(inspection.steps);
  const artifactItems = inspection.artifacts.map(
    (artifact) => `${artifact.stepId}.${artifact.name}`,
  );
  return (
    <ScreenFrame
      title="Run status"
      subtitle={`Run ${run.id}`}
      status={error}
      footer="j/k move | Enter browse artifacts | q back"
      colors={colors}
    >
      <SafeText>Status: {humanRunStatus(run.status)}</SafeText>
      <SafeText>Workflow: {run.workflowId}</SafeText>
      <SafeText>Duration: {duration}</SafeText>
      <SafeText>Usage: {tokens === undefined ? '-' : `${tokens} tokens`}</SafeText>
      <SafeText>Cost: {cost === undefined ? '-' : `$${cost.toFixed(4)}`}</SafeText>
      <SafeText>Checklist:</SafeText>
      {inspection.steps.map((step) => (
        <SafeText key={step.stepId}>
          {'  '}
          {stepMarker(step.status)} {step.stepId} {step.profile}
        </SafeText>
      ))}
      <SafeText>Artifacts:</SafeText>
      {artifactItems.length > 0 ? (
        <SelectionList
          items={artifactItems}
          selected={selected}
          offset={offset}
          visibleRows={Math.max(1, Math.min(visibleRows, artifactItems.length))}
        />
      ) : (
        <SafeText> None</SafeText>
      )}
    </ScreenFrame>
  );
}
