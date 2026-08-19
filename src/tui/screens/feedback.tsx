import { TextInput } from '@inkjs/ui';
import { ScreenFrame, SafeText } from '../components.js';
import { sanitizeInkText } from '../text.js';

export function RecoveryConfirmScreen({
  colors,
  error,
  initialValue,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  error?: string | undefined;
  initialValue: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  return (
    <ScreenFrame
      title="Recover interrupted run"
      status={error}
      footer="Type YES | Enter confirm | q cancel"
      colors={colors}
    >
      <SafeText>Type YES to confirm recovery. This only marks the run interrupted.</SafeText>
      <TextInput
        defaultValue={sanitizeInkText(initialValue)}
        onChange={(value) => onChange(sanitizeInkText(value))}
        onSubmit={(value) => onSubmit(sanitizeInkText(value))}
      />
    </ScreenFrame>
  );
}

export function RejectionFeedbackScreen({
  colors,
  error,
  initialValue,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  error?: string | undefined;
  initialValue: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  return (
    <ScreenFrame
      title="Reject research"
      status={error}
      footer="Type feedback | Enter submit | q cancel"
      colors={colors}
    >
      <SafeText>Feedback for another research iteration:</SafeText>
      <TextInput
        defaultValue={sanitizeInkText(initialValue)}
        onChange={(value) => onChange(sanitizeInkText(value))}
        onSubmit={(value) => onSubmit(sanitizeInkText(value))}
      />
    </ScreenFrame>
  );
}
