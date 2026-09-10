import { Box } from 'ink';
import type {
  PreparationConversation,
  PreparationDraft,
  PreparationModel,
} from '../../application/preparation.js';
import {
  preparationActionLabels,
  preparationSettingChoices,
  type PreparationFocus,
  type PreparationSettingRole,
} from '../model.js';
import { PaneSection, SafeText, ScreenFrame, SelectionList } from '../components.js';
import { MessageEditor } from '../message-editor.js';

export function PreparationScreen({
  colors,
  preparation,
  overview,
  focus,
  selected,
  value,
  status,
  error,
  drafts,
  models,
  settingRole,
}: {
  colors: boolean;
  preparation?: PreparationConversation;
  overview?: import('../../application/preparation.js').PreparationStoredView;
  focus: PreparationFocus;
  selected: number;
  value: string;
  status?: string;
  error?: string;
  drafts: PreparationDraft[];
  models: PreparationModel[];
  settingRole?: PreparationSettingRole;
}) {
  const actions = preparationActionLabels(preparation, overview, drafts);
  const generating =
    preparation?.messages.some((message) => message.generationStatus === 'pending') ?? false;
  return (
    <ScreenFrame
      title="Preparation"
      subtitle={
        preparation
          ? `${preparation.draft.workflowId}  revision ${preparation.draft.revision}`
          : 'Opening draft'
      }
      status={error ?? status}
      footer="Tab focus | Ctrl+Enter save synthesis | Enter select | Esc back"
      colors={colors}
      border={false}
    >
      <PaneSection title="Conversation" colors={colors} first>
        {preparation?.messages.slice(-8).map((message) => (
          <Box key={message.id} flexDirection="column">
            <SafeText bold>{`${message.role} (${message.generationStatus})`}</SafeText>
            <SafeText>{message.content}</SafeText>
          </Box>
        )) ?? <SafeText dimColor>Creating a preparation draft...</SafeText>}
      </PaneSection>
      <PaneSection title="Proposal" colors={colors}>
        {preparation?.proposal ? (
          <>
            <SafeText bold>{preparation.proposal.objective}</SafeText>
            <SafeText>{`${preparation.proposal.outputs.length} validated planning output(s)`}</SafeText>
          </>
        ) : (
          <SafeText dimColor>
            {generating
              ? 'Waiting for the planner...'
              : 'Ask questions or describe the desired change.'}
          </SafeText>
        )}
      </PaneSection>
      {overview?.synthesis ? (
        <PaneSection title="Confirmed synthesis" colors={colors}>
          <SafeText>{overview.synthesis.value.objective}</SafeText>
          <SafeText>{`Agreements: ${overview.synthesis.value.agreements.length} | Constraints: ${overview.synthesis.value.constraints.length} | Assumptions: ${overview.synthesis.value.assumptions.length}`}</SafeText>
          {overview.suggestion ? (
            <SafeText dimColor>A suggested synthesis is waiting for confirmation.</SafeText>
          ) : null}
        </PaneSection>
      ) : null}
      {focus === 'synthesis' ? (
        <PaneSection title="Synthesis editor" colors={colors}>
          <SafeText dimColor>Use objective: and one list section per line.</SafeText>
          <MessageEditor value={value} colors={colors} active />
        </PaneSection>
      ) : focus === 'settings' ? (
        <PaneSection title={`Select ${settingRole ?? 'producer'}`} colors={colors}>
          <SelectionList
            items={preparationSettingChoices(settingRole ?? 'producer', models)}
            selected={selected}
            offset={0}
            visibleRows={Math.max(1, models.length || 3)}
          />
        </PaneSection>
      ) : focus === 'editor' ? (
        <PaneSection title="Message [editor]" colors={colors}>
          <MessageEditor value={value} colors={colors} active />
        </PaneSection>
      ) : (
        <PaneSection title="Actions [focused]" colors={colors}>
          {actions.map((action, index) => (
            <SafeText key={action} {...(index === selected && colors ? { color: 'cyan' } : {})}>
              {`${index === selected ? '>' : ' '} ${action}`}
            </SafeText>
          ))}
        </PaneSection>
      )}
    </ScreenFrame>
  );
}
