import { TextInput } from '@inkjs/ui';
import { Box, useInput } from 'ink';
import type { ReviewThreadDetails } from '../../application/review-operations.js';
import { PaneSection, ScreenFrame, SafeText } from '../components.js';
import { sanitizeInkText } from '../text.js';

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
}) {
  useInput((input, key) => {
    if (key.escape || input === 'q') onBack();
    else if (input === 'E') onExplain();
    else if (input === 'A') onDecision('approve');
    else if (input === 'C') onDecision('correct');
    else if (input === 'F') onFinalize();
  });

  return (
    <ScreenFrame
      title="Review thread"
      subtitle={`${entry.thread.phase}  ${entry.thread.target.kind}:${entry.thread.target.id}  ${entry.thread.state}`}
      status={error}
      footer="Type a message | Enter send | q/Esc back"
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
      <PaneSection title="Message" colors={colors}>
        <Box>
          <SafeText>&gt; </SafeText>
          <TextInput
            defaultValue={sanitizeInkText(value)}
            onChange={(next) => onChange(sanitizeInkText(next))}
            onSubmit={(next) => onSubmit(sanitizeInkText(next))}
          />
        </Box>
      </PaneSection>
      <SafeText dimColor>E explain | A approve | C correct | F finalize</SafeText>
    </ScreenFrame>
  );
}
