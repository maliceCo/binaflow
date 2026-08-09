import { formatDurationMs, humanRunStatus, humanStepStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, TextViewport } from '../components.js';
import type { LiveState } from '../execution.js';
export function LiveScreen({
  colors,
  live,
  detail,
  offset,
  visibleRows,
}: {
  colors: boolean;
  live: LiveState;
  detail: boolean;
  offset: number;
  visibleRows: number;
}) {
  const activity = live.activity.map((item) => `[${item.stepId}] ${item.type}: ${item.message}`);
  const displayed = detail ? activity : activity.slice(-8);
  return (
    <ScreenFrame
      title="Workflow running"
      subtitle="Attached execution"
      status={
        live.cancellationRequested
          ? 'Cancellation requested. Waiting for the active agent to stop.'
          : undefined
      }
      footer="q cancel | Ctrl-C cancel | d toggle activity detail | j/k scroll"
      colors={colors}
    >
      <SafeText>Run: {live.run.id}</SafeText>
      <SafeText>Workflow: {live.workflow.id}</SafeText>
      <SafeText>Status: {humanRunStatus(live.run.status)}</SafeText>
      <SafeText>
        Elapsed: {formatDurationMs(Math.max(0, Date.now() - Date.parse(live.startedAt)))}
      </SafeText>
      <SafeText>Usage: {live.tokens === undefined ? '-' : `${live.tokens} tokens`}</SafeText>
      <SafeText>Cost: {live.costUsd === undefined ? '-' : `$${live.costUsd.toFixed(4)}`}</SafeText>
      <SafeText>Steps:</SafeText>
      {live.steps.map((step) => (
        <SafeText
          key={step.id}
        >{`  ${step.id}  ${humanStepStatus(step.status)}  profile=${step.profile}`}</SafeText>
      ))}
      <SafeText>Activity:</SafeText>
      <TextViewport
        lines={displayed.length > 0 ? displayed : ['Waiting for agent activity...']}
        offset={offset}
        visibleRows={visibleRows}
      />
    </ScreenFrame>
  );
}
