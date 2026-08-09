import { TextInput } from '@inkjs/ui';
import type { GeneratedConfiguration } from '../../application/config-operations.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import { generatedConfigurationPreview, type SetupField, type SetupStep } from '../launch.js';
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

export function SetupWizardScreen({
  colors,
  step,
  diagnosis,
  field,
  choices,
  error,
  value,
  selected,
  generated,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  step: SetupStep;
  diagnosis?: { piCommandMessage?: string; piCommandLaunchable?: boolean };
  field?: SetupField;
  choices: string[];
  error?: string;
  value: string;
  selected: number;
  generated?: GeneratedConfiguration;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  if (step === 1) {
    return (
      <ScreenFrame
        title="Setup wizard"
        subtitle="Step 1 of 4: environment diagnosis"
        footer="j/k move | Enter select | q cancel"
        colors={colors}
      >
        <SafeText>No configuration exists yet. Nothing is written until the final review.</SafeText>
        <SafeText>{diagnosis?.piCommandMessage ?? 'Checking whether Pi is available...'}</SafeText>
        <SafeText>
          {diagnosis?.piCommandLaunchable
            ? 'Pi is ready.'
            : 'Pi is not ready; you can still enter provider and model values manually.'}
        </SafeText>
        <SelectionList
          items={['Continue', 'Retry diagnosis', 'Exit']}
          selected={selected}
          offset={0}
          visibleRows={3}
        />
      </ScreenFrame>
    );
  }
  if (step === 4 && generated) {
    return (
      <SetupPreviewScreen
        colors={colors}
        generated={generated}
        error={error}
        selected={selected}
        offset={0}
        visibleRows={8}
      />
    );
  }
  return (
    <ScreenFrame
      title="Setup wizard"
      subtitle={`Step ${step} of 4: ${step === 2 ? 'planner' : 'builder'}`}
      status={error}
      footer="Type a value | Enter submit | q cancel"
      colors={colors}
    >
      <SafeText>{field?.title ?? ''}</SafeText>
      {choices.length > 0 ? (
        <>
          <SelectionList items={choices} selected={selected} offset={0} visibleRows={5} />
          <SafeText>Use j/k and Enter to choose a discovered value.</SafeText>
        </>
      ) : null}
      {field?.key === 'builderWriteAccess' ? (
        <SafeText>
          Choose no to keep the builder read-only. Yes enables write, edit, shell, and trust.
        </SafeText>
      ) : null}
      {choices.length === 0 ? (
        <TextInput
          defaultValue={sanitizeInkText(value)}
          onChange={(next) => onChange(sanitizeInkText(next))}
          onSubmit={(next) => onSubmit(sanitizeInkText(next))}
        />
      ) : null}
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
      title="Setup wizard"
      subtitle="Step 4 of 4: review configuration"
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
