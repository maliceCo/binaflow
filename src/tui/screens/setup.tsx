import { TextInput } from '@inkjs/ui';
import type { GeneratedConfiguration } from '../../application/config-operations.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import { generatedConfigurationPreview, type SetupField } from '../launch.js';
import { sanitizeInkText } from '../text.js';

export function SetupChoiceScreen({ colors, selected }: { colors: boolean; selected: number }) {
  return (
    <ScreenFrame title="Setup required" footer="j/k move | Enter select | q cancel" colors={colors}>
      <SafeText>
        No configuration was found at the displayed path. Create one to configure the planner and
        builder.
      </SafeText>
      <SelectionList
        items={['Create configuration', 'Read documentation', 'Exit']}
        selected={selected}
        offset={0}
        visibleRows={3}
      />
    </ScreenFrame>
  );
}
export function SetupInputScreen({
  colors,
  field,
  error,
  value,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  field: SetupField;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const prompt =
    field.key === 'builderWriteAccess' ? 'Enable write/edit/shell/project trust? (yes/no): ' : '> ';
  return (
    <ScreenFrame
      title="Create configuration"
      subtitle="No credentials are requested"
      status={error}
      footer="Type a value | Enter submit | q cancel"
      colors={colors}
    >
      <SafeText>{field.title}</SafeText>
      <SafeText>{prompt}</SafeText>
      <TextInput
        defaultValue={sanitizeInkText(value)}
        onChange={(next) => onChange(sanitizeInkText(next))}
        onSubmit={(next) => onSubmit(sanitizeInkText(next))}
      />
      {field.key === 'builderWriteAccess' ? (
        <SafeText>Choose no to keep the builder read-only.</SafeText>
      ) : null}
    </ScreenFrame>
  );
}
export function SetupPreviewScreen({
  colors,
  generated,
  error,
  selected,
  offset,
  visibleRows,
}: {
  colors: boolean;
  generated: GeneratedConfiguration;
  error?: string | undefined;
  selected: number;
  offset: number;
  visibleRows: number;
}) {
  return (
    <ScreenFrame
      title="Review configuration"
      status={error}
      footer="j/k move | Enter select | q cancel"
      colors={colors}
    >
      <TextViewport
        lines={generatedConfigurationPreview(generated).split('\n')}
        offset={0}
        visibleRows={visibleRows}
      />
      <SafeText>Nothing has been written yet.</SafeText>
      <SelectionList
        items={['Write configuration', 'Cancel']}
        selected={selected}
        offset={offset}
        visibleRows={2}
      />
    </ScreenFrame>
  );
}
