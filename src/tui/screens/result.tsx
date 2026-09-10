import type { RunView } from '../../application/run-view.js';
import type { TaskOutcome } from '../../application/task-outcome.js';
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
  outcome,
}: {
  colors: boolean;
  view: RunView;
  selected: number;
  offset: number;
  visibleRows: number;
  error?: string;
  outcome?: TaskOutcome;
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
      <PaneSection title="Outcome" colors={colors} first>
        <SafeText>Objective: {view.objective}</SafeText>
        <SafeText>Run status: {humanRunStatus(view.status)}</SafeText>
        {view.todoResult ? (
          <>
            <SafeText>Result: {view.todoResult.status}</SafeText>
            <SafeText>
              Summary:{' '}
              {view.todoResult.implementation?.summary ??
                view.todoResult.assessment?.summary ??
                'No implementation summary is available.'}
            </SafeText>
            {view.todoResult.implementation?.resolvedItems.slice(0, 5).map((item) => (
              <SafeText key={`resolved-${item.id}`}>
                {' '}
                [x] {item.title}: {item.resolution}
              </SafeText>
            ))}
            {(view.todoResult.implementation?.resolvedItems.length ?? 0) > 5 ? (
              <SafeText> More resolved items are available in FINAL-REPORT.md.</SafeText>
            ) : null}
            {view.todoResult.implementation?.pendingItems.slice(0, 5).map((item) => (
              <SafeText key={`pending-${item.id}`}>
                {' '}
                [!] {item.title}: {item.reason}
              </SafeText>
            ))}
            {view.todoResult.assessment?.blockers.map((blocker) => (
              <SafeText key={blocker}> [!] Blocker: {blocker}</SafeText>
            ))}
            <SafeText>
              QA: {view.todoResult.qa.status}; found={view.todoResult.qa.found}; corrected=
              {view.todoResult.qa.corrected}; pending={view.todoResult.qa.pending.length}
            </SafeText>
          </>
        ) : (
          <SafeText dimColor>
            No structured implementation summary is available. Review the builder output below.
          </SafeText>
        )}
        {view.followUp?.kind === 'clarification' ? (
          <SafeText>
            Pending: clarification is required before this work can be considered complete.
          </SafeText>
        ) : null}
      </PaneSection>
      <PaneSection title="Execution metadata" colors={colors}>
        <SafeText>Workflow: {view.workflow.id}</SafeText>
        <SafeText>Duration: {duration === undefined ? '-' : formatDurationMs(duration)}</SafeText>
        <SafeText>Usage: {tokens === undefined ? '-' : `${tokens} tokens`}</SafeText>
        <SafeText>Cost: {cost === undefined ? '-' : `$${cost.toFixed(4)}`}</SafeText>
        {view.qa ? (
          <SafeText>
            QA reported: iteration {view.qa.iteration}/{view.qa.limit} blocking findings=
            {view.qa.blockingFindings} action={view.qa.recoveryAction}
          </SafeText>
        ) : null}
      </PaneSection>
      <PaneSection title="Builder declarations and evidence" colors={colors}>
        {outcome?.builderDeclarations.length ? (
          outcome.builderDeclarations.flatMap((declaration) => [
            <SafeText key={declaration.artifact.id}>
              {declaration.structured
                ? `${declaration.phase}: ${declaration.structured.summary}`
                : `${declaration.phase}: ${declaration.preview ?? 'Declaration is unavailable.'}`}
            </SafeText>,
            ...(declaration.structured?.changedFiles
              .slice(0, 5)
              .map((file) => (
                <SafeText key={`${declaration.artifact.id}-${file}`}>
                  Reported change: {file}
                </SafeText>
              )) ?? []),
            ...(declaration.structured?.verifications.slice(0, 5).map((verification) => (
              <SafeText key={`${declaration.artifact.id}-${verification.command}`}>
                Verification: {verification.command} ({verification.status})
              </SafeText>
            )) ?? []),
          ])
        ) : (
          <SafeText dimColor>No builder declaration was projected.</SafeText>
        )}
        {outcome?.qaRoundIds.length ? (
          <SafeText>QA rounds: {outcome.qaRoundIds.join(', ')}</SafeText>
        ) : null}
        {outcome?.limitations.map((limitation) => (
          <SafeText key={limitation} dimColor>
            Limitation: {limitation}
          </SafeText>
        ))}
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
