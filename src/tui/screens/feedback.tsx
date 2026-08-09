import { TextInput } from '@inkjs/ui';
import { ScreenFrame, SafeText } from '../components.js';
import { sanitizeInkText } from '../text.js';

export function FeedbackScreen({
  colors,
  prompt,
  error,
  initialValue,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  prompt: 'recovery' | 'rejection';
  error?: string | undefined;
  initialValue: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  return (
    <ScreenFrame
      title={prompt === 'recovery' ? 'Recover interrupted run' : 'Reject research'}
      status={error}
      footer="Type a value | Enter submit | q cancel"
      colors={colors}
    >
      <SafeText>{prompt === 'recovery' ? 'Type YES to confirm recovery:' : 'Feedback:'}</SafeText>
      <TextInput
        defaultValue={sanitizeInkText(initialValue)}
        onChange={(value) => onChange(sanitizeInkText(value))}
        onSubmit={(value) => onSubmit(sanitizeInkText(value))}
      />
    </ScreenFrame>
  );
}
