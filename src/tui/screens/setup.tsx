import { TextInput } from '@inkjs/ui';
import type { GeneratedConfiguration } from '../../application/config-operations.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import {
  generatedConfigurationPreview,
  isWriteCapable,
  type SetupField,
  type SetupStep,
} from '../launch.js';
import { sanitizeInkText } from '../text.js';

export function SetupWizardScreen({
  colors,
  step,
  diagnosis,
  field,
  choices,
  error,
  value,
  selected,
  setupPreviewOffset,
  generated,
  showFullConfig,
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
  setupPreviewOffset: number;
  generated?: GeneratedConfiguration;
  showFullConfig: boolean;
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
          items={['Continue', 'Retry diagnosis', 'Cancel']}
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
        setupPreviewOffset={setupPreviewOffset}
        showFullConfig={showFullConfig}
      />
    );
  }
  return (
    <ScreenFrame
      title="Setup wizard"
      subtitle={`Step ${step} of 4: ${step === 2 ? 'planner' : 'builder'}`}
      status={error}
      footer="Type a value | Enter submit | Esc cancel"
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
          key={`${step}-${field?.key ?? 'input'}`}
          defaultValue={sanitizeInkText(value)}
          {...(field?.key?.endsWith('Provider')
            ? { placeholder: 'openai' }
            : field?.key?.endsWith('Model')
              ? { placeholder: 'gpt-4.1' }
              : {})}
          onChange={(next) => onChange(sanitizeInkText(next))}
          onSubmit={(next) => onSubmit(sanitizeInkText(next))}
        />
      ) : null}
    </ScreenFrame>
  );
}
export function SetupPreviewScreen({
  colors,
  generated,
  error,
  selected,
  setupPreviewOffset,
  showFullConfig,
}: {
  colors: boolean;
  generated: GeneratedConfiguration;
  error?: string | undefined;
  selected: number;
  setupPreviewOffset: number;
  showFullConfig: boolean;
}) {
  const planner = generated.config.profiles.planner;
  const builder = generated.config.profiles.builder;
  const summary = [
    `Planner: ${planner?.provider ?? '-'} / ${planner?.model ?? '-'} (read-only)`,
    `Builder: ${builder?.provider ?? '-'} / ${builder?.model ?? '-'} (${builder && isWriteCapable(builder) ? 'WRITE+SHELL' : 'read-only'})`,
    `Config path: ${generated.configPath}`,
    `Pi command: ${generated.config.piCommand}`,
  ];
  const lines = showFullConfig ? generatedConfigurationPreview(generated).split('\n') : summary;
  return (
    <ScreenFrame
      title="Setup wizard"
      subtitle="Step 4 of 4: review configuration"
      status={error}
      footer="j/k move | Enter select | q cancel"
      colors={colors}
    >
      <TextViewport
        lines={lines}
        offset={showFullConfig ? setupPreviewOffset : 0}
        visibleRows={Math.min(8, lines.length)}
      />
      <SafeText>Nothing has been written yet.</SafeText>
      <SelectionList
        items={['Save', 'Show full config', 'Go back', 'Cancel']}
        selected={selected}
        offset={0}
        visibleRows={4}
      />
    </ScreenFrame>
  );
}
