import { formatDurationMs, humanRunStatus, humanStepStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import type { CompletionState } from '../execution.js';

export function completionNextAction(status: CompletionState['run']['status']): string {
  switch (status) {
    case 'failed':
      return 'Review in history';
    case 'interrupted':
      return 'Review recovery in history';
    case 'cancelled':
      return 'Return home';
    case 'waiting':
      return 'Open waiting run';
    default:
      return 'Return home';
  }
}

export function CompletionScreen({
  colors,
  completion,
  visibleRows,
}: {
  colors: boolean;
  completion: CompletionState;
  visibleRows: number;
}) {
  const duration = Math.max(
    0,
    Date.parse(completion.finishedAt) - Date.parse(completion.startedAt),
  );
  const tokens = completion.steps
    .map((step) => step.result?.usage?.totalTokens)
    .filter((value): value is number => value !== undefined)
    .reduce((total, value) => total + value, 0);
  const costs = completion.steps
    .map((step) => step.result?.costUsd)
    .filter((value): value is number => value !== undefined)
    .reduce((total, value) => total + value, 0);
  const nextAction = completionNextAction(completion.run.status);
  return (
    <ScreenFrame
      title="Run status"
      subtitle="Attached execution finished"
      footer="Enter/q continue"
      colors={colors}
    >
      <SafeText>Status card</SafeText>
      <SafeText>Run: {completion.run.id}</SafeText>
      <SafeText>Workflow: {completion.run.workflowId}</SafeText>
      <SafeText>Status: {humanRunStatus(completion.run.status)}</SafeText>
      <SafeText>Duration: {formatDurationMs(duration)}</SafeText>
      <SafeText>Usage: {tokens > 0 ? `${tokens} tokens` : '-'}</SafeText>
      <SafeText>Cost: {costs > 0 ? `$${costs.toFixed(4)}` : '-'}</SafeText>
      <SafeText>Steps:</SafeText>
      {completion.steps.map((step) => (
        <SafeText
          key={`${step.runId}-${step.stepId}`}
        >{`  ${step.stepId}  ${humanStepStatus(step.status)}${step.error ? `  ${step.error.message}` : ''}`}</SafeText>
      ))}
      <SafeText>Artifacts:</SafeText>
      <TextViewport
        lines={completion.artifacts.length > 0 ? completion.artifacts : ['No artifacts recorded.']}
        offset={0}
        visibleRows={visibleRows}
      />
      <SelectionList items={[nextAction]} selected={0} offset={0} visibleRows={1} />
    </ScreenFrame>
  );
}
