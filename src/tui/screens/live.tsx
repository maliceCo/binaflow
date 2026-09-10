import { Box } from 'ink';
import { Spinner } from '@inkjs/ui';
import { formatDurationMs, humanRunStatus } from '../../presentation/format.js';
import { PaneSection, ScreenFrame, SafeText, TextViewport } from '../components.js';
import { liveActivityLabel, type LiveState, type LiveStep } from '../execution.js';

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
  const displayed = detail ? activity : activity.slice(-1);
  const phases = live.view?.phases;
  const status = live.view?.status ?? live.run.status;
  const tokens = live.view?.metrics.usage?.totalTokens ?? live.tokens;
  const cost = live.view?.metrics.costUsd ?? live.costUsd;
  const duration = live.view?.metrics.durationMs;
  const activeStep = (phases ?? []).find((step) => step.status === 'running');
  const activeStart = activeStep?.startedAt ?? live.startedAt;
  const activityLabel = liveActivityLabel(live);
  const humanStatus = live.cancellationRequested
    ? 'Cancellation requested. Waiting for cleanup.'
    : status === 'waiting'
      ? 'Waiting for human input.'
      : humanRunStatus(status);
  return (
    <ScreenFrame
      title="Attached execution"
      subtitle={activityLabel}
      status={
        live.cancellationRequested ? 'Cancellation requested. Waiting for cleanup.' : undefined
      }
      footer="q cancel | Ctrl-C cancel | d toggle activity detail | j/k scroll"
      colors={colors}
      border={false}
    >
      <PaneSection title="Run" colors={colors} first>
        <SafeText>{`${live.view?.id ?? live.run.id}  ${live.view?.workflow.id ?? live.workflow.id}`}</SafeText>
        <SafeText>
          Status: {humanStatus} Active:{' '}
          {duration === undefined
            ? formatDurationMs(Math.max(0, Date.now() - Date.parse(activeStart)))
            : formatDurationMs(duration)}
        </SafeText>
        <SafeText>
          Usage: {tokens === undefined ? '-' : `${tokens} tokens`} Cost:{' '}
          {cost === undefined ? '-' : `$${cost.toFixed(4)}`}
        </SafeText>
        {live.view?.qa ? (
          <SafeText>
            QA: iteration {live.view.qa.iteration}/{live.view.qa.limit} blocking findings=
            {live.view.qa.blockingFindings} action={live.view.qa.recoveryAction}
          </SafeText>
        ) : null}
      </PaneSection>
      <PaneSection title="Checklist" colors={colors}>
        {(phases ?? live.steps).map((step) => (
          <StepChecklistRow
            key={step.id}
            step={
              'kind' in step
                ? {
                    id: step.id,
                    profile: step.profile ?? '-',
                    status: step.status,
                    durationMs: step.durationMs,
                    costUsd: step.costUsd,
                  }
                : step
            }
            colors={colors}
          />
        ))}
      </PaneSection>
      <PaneSection title={detail ? 'Activity detail' : 'Latest activity'} colors={colors}>
        <TextViewport
          lines={displayed.length > 0 ? displayed : ['No activity reported yet.']}
          offset={offset}
          visibleRows={visibleRows}
        />
      </PaneSection>
    </ScreenFrame>
  );
}
