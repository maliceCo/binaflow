import { TextInput } from '@inkjs/ui';
import { Box, useInput } from 'ink';
import type { ReviewThreadDetails } from '../../application/review-operations.js';
import { PaneSection, ScreenFrame, SafeText } from '../components.js';
import { sanitizeInkText } from '../text.js';
import type { ReviewFocus } from '../model.js';

export function ReviewThreadScreen({
  colors,
  entry,
  value,
  error,
  onChange,
  onSubmit,
  onBack,
  onExplain,
  onDecision,
  onFinalize,
  focus,
  selected,
  onFocus,
}: {
  colors: boolean;
  entry: ReviewThreadDetails;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
  onExplain: () => void;
  onDecision: (decision: 'approve' | 'correct' | 'accept-risk' | 'postpone') => void;
  onFinalize: () => void;
  focus: ReviewFocus;
  selected: number;
  onFocus: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) onBack();
    else if (key.tab) onFocus();
    else if (focus === 'actions' && key.return) {
      if (selected === 0) onExplain();
      else if (selected === 1) onDecision('approve');
      else if (selected === 2) onDecision('correct');
      else if (selected === 3) onDecision('accept-risk');
      else if (selected === 4) onDecision('postpone');
      else if (selected === 5) onFinalize();
      else onBack();
    }
  });

  return (
    <ScreenFrame
      title="Review thread"
      subtitle={`${entry.thread.phase}  ${entry.thread.target.kind}:${entry.thread.target.id}  ${entry.thread.state}`}
      status={error}
      footer="Tab focus editor/actions | Enter send or select | Esc back"
      colors={colors}
      border={false}
    >
      <PaneSection title="Messages" colors={colors} first>
        {entry.messages.length === 0 ? (
          <SafeText dimColor>No messages yet.</SafeText>
        ) : (
          entry.messages.map((message) => (
            <Box key={message.id} flexDirection="column">
              <SafeText bold>{`${message.role} (${message.generationStatus})`}</SafeText>
              <SafeText>
                {message.content ?? `[large content: ${message.contentArtifactId}]`}
              </SafeText>
            </Box>
          ))
        )}
      </PaneSection>
      {focus === 'editor' ? (
        <PaneSection title="Message [editor]" colors={colors}>
          <Box>
            <SafeText>&gt; </SafeText>
            <TextInput
              defaultValue={sanitizeInkText(value)}
              onChange={(next) => onChange(sanitizeInkText(next))}
              onSubmit={(next) => onSubmit(sanitizeInkText(next))}
            />
          </Box>
        </PaneSection>
      ) : (
        <PaneSection title="Actions [focused]" colors={colors}>
          {['Explain', 'Approve', 'Correct', 'Accept risk', 'Postpone', 'Finalize', 'Back'].map(
            (action, index) => (
              <SafeText key={action} {...(index === selected ? { color: 'cyan' } : {})}>
                {`${index === selected ? '>' : ' '} ${action}`}
              </SafeText>
            ),
          )}
        </PaneSection>
      )}
    </ScreenFrame>
  );
}
