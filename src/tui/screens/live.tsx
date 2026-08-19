import { Box } from 'ink';
import { Spinner } from '@inkjs/ui';
import { formatDurationMs, humanRunStatus } from '../../presentation/format.js';
import { ScreenFrame, SafeText, TextViewport } from '../components.js';
import type { LiveState, LiveStep } from '../execution.js';

function stepMarker(status: LiveStep['status']): string {
  switch (status) {
    case 'completed':
      return '[x]';
    case 'failed':
      return '[!]';
    case 'cancelled':
    case 'interrupted':
      return '[-]';
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

function formatStepMeta(step: LiveStep): string {
  const parts: string[] = [];
  if (step.durationMs !== undefined) parts.push(formatDurationMs(step.durationMs));
  if (step.costUsd !== undefined) parts.push(`$${step.costUsd.toFixed(4)}`);
  return parts.length > 0 ? `  ${parts.join('  ')}` : '';
}

function StepChecklistRow({ step, colors }: { step: LiveStep; colors: boolean }) {
  const meta = formatStepMeta(step);
  const label = `${step.id}  ${step.profile}${meta}`;
  if (step.status === 'running') {
    return (
      <Box>
        <Spinner label={label} />
      </Box>
    );
  }
  const line = `  ${stepMarker(step.status)} ${label}`;
  if (step.status === 'failed' && colors) {
    return <SafeText color="red">{line}</SafeText>;
  }
  if (step.status === 'completed' && colors) {
    return <SafeText color="green">{line}</SafeText>;
  }
  return <SafeText>{line}</SafeText>;
}

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
      <SafeText>Checklist:</SafeText>
      {live.steps.map((step) => (
        <StepChecklistRow key={step.id} step={step} colors={colors} />
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
