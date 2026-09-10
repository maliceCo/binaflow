import type {
  PreparationConversation,
  PreparationOutput,
  PreparationSelection,
  PreparationStoredView,
} from '../../application/preparation.js';
import { PaneSection, ScreenFrame, SafeText } from '../components.js';

export function ProposalScreen({
  colors,
  preparation,
  overview,
}: {
  colors: boolean;
  preparation?: PreparationConversation;
  overview?: PreparationStoredView;
}) {
  const proposal = preparation?.proposal;
  return (
    <ScreenFrame
      title="Proposal"
      subtitle={proposal ? `${proposal.workflowId} revision ${proposal.revision}` : 'No proposal'}
      footer="Esc/q back"
      colors={colors}
      border={false}
    >
      {!proposal ? (
        <SafeText dimColor>Generate a proposal from the confirmed preparation first.</SafeText>
      ) : (
        <>
          {overview?.draft.validProposalId !== proposal.id ? (
            <SafeText {...(colors ? { color: 'yellow' } : {})}>
              This proposal is stale and cannot be approved.
            </SafeText>
          ) : null}
          <PaneSection title="Identity" colors={colors} first>
            <SafeText>{`Proposal ${proposal.id} | revision ${proposal.revision} | workflow ${proposal.workflowId}@${proposal.workflowVersion}`}</SafeText>
            <SafeText>{`Producer: ${selectionLabel(overview?.draft.producer)}`}</SafeText>
            <SafeText>{`Reviewer: ${selectionLabel(overview?.draft.reviewer)}`}</SafeText>
          </PaneSection>
          <PaneSection title="Objective" colors={colors}>
            <SafeText>{proposal.objective}</SafeText>
          </PaneSection>
          <PaneSection title="Scope and plan" colors={colors}>
            {proposal.outputs.flatMap((output) =>
              outputLines(output).map((line, index) => (
                <SafeText key={`${output.stepId}-${index}`}>{line}</SafeText>
              )),
            )}
          </PaneSection>
          <PaneSection title="Review" colors={colors}>
            {overview?.review ? (
              <SafeText>
                {`${overview.review.counts.critical} critical, ${overview.review.counts.high} high, ${overview.review.counts.medium} medium, ${overview.review.counts.low} low${overview.review.acknowledged ? ' (read)' : ' (unread)'}`}
              </SafeText>
            ) : (
              <SafeText dimColor>No review report yet.</SafeText>
            )}
          </PaneSection>
        </>
      )}
    </ScreenFrame>
  );
}

function outputLines(output: PreparationOutput): string[] {
  const value = output.value;
  const lines = [`${output.stepId}.${output.name}`];
  if ('strategy' in value) lines.push(`Strategy: ${value.strategy}`);
  if ('summary' in value) lines.push(`Summary: ${value.summary}`);
  addList(lines, 'In scope', 'inScope' in value ? value.inScope : undefined);
  addList(lines, 'Out of scope', 'outOfScope' in value ? value.outOfScope : undefined);
  addList(
    lines,
    'Tasks',
    'tasks' in value ? value.tasks.map((task) => `${task.id}: ${task.title}`) : undefined,
  );
  addList(
    lines,
    'Acceptance',
    'acceptanceCriteria' in value ? value.acceptanceCriteria : undefined,
  );
  addList(lines, 'Verification', 'verification' in value ? value.verification : undefined);
  return lines;
}

function addList(lines: string[], title: string, values: string[] | undefined): void {
  if (!values || values.length === 0) return;
  lines.push(`${title}:`);
  lines.push(...values.map((value) => `  - ${value}`));
}

function selectionLabel(selection: PreparationSelection | null | undefined): string {
  if (!selection) return 'not configured';
  return (
    [selection.provider, selection.model, selection.thinking].filter(Boolean).join('/') ||
    'configured'
  );
}
