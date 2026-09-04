import { TextInput } from '@inkjs/ui';
import type { GeneratedConfiguration } from '../../application/config-operations.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import {
  generatedConfigurationPreview,
  isWriteCapable,
  setupFieldTitle,
  type SetupChoice,
  type SetupField,
  type SetupProfileField,
  type SetupStep,
} from '../launch.js';
import { sanitizeInkText } from '../text.js';

export function SetupWizardScreen({
  colors,
  step,
  diagnosis,
  field,
  profileField,
  choices,
  error,
  value,
  selected,
  offset,
  setupProfileSelection,
  profileLabels,
  setupPreviewOffset,
  generated,
  editing,
  showFullConfig,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  step: SetupStep;
  diagnosis?: { piCommandMessage?: string; piCommandLaunchable?: boolean };
  field?: SetupField;
  profileField?: SetupProfileField;
  choices: SetupChoice[];
  error?: string;
  value: string;
  selected: number;
  offset: number;
  setupProfileSelection: boolean;
  profileLabels: string[];
  setupPreviewOffset: number;
  generated?: GeneratedConfiguration;
  editing: boolean;
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
  if (step === 2 && setupProfileSelection) {
    return (
      <ProfileSelectionScreen
        colors={colors}
        labels={profileLabels}
        selected={selected}
        offset={offset}
      />
    );
  }
  if (step === 4 && generated) {
    return (
      <SetupPreviewScreen
        colors={colors}
        generated={generated}
        editing={editing}
        error={error}
        selected={selected}
        setupPreviewOffset={setupPreviewOffset}
        showFullConfig={showFullConfig}
      />
    );
  }
  return (
    <ScreenFrame
      title={editing ? 'Agent configuration' : 'Setup wizard'}
      subtitle={
        profileField
          ? `Editing ${profileField.title}`
          : `Step ${step} of 4: ${step === 2 ? 'planner' : 'builder'}`
      }
      status={error}
      footer="Type a value | Enter submit | Esc cancel"
      colors={colors}
    >
      <SafeText>
        {profileField
          ? profileField.title
          : field
            ? setupFieldTitle(
                field,
                choices.some((choice) => choice.model !== undefined),
              )
            : ''}
      </SafeText>
      {choices.length > 0 ? (
        <>
          <SelectionList
            items={choices.map((choice) => choice.label)}
            selected={selected}
            offset={offset}
            visibleRows={5}
          />
          <SafeText>Use j/k and Enter to choose.</SafeText>
        </>
      ) : null}
      {field?.key === 'builderWriteAccess' || profileField?.key === 'writeAccess' ? (
        <SafeText>
          Choose no to keep the builder read-only. Yes enables write, edit, shell, and trust.
        </SafeText>
      ) : null}
      {choices.length === 0 ? (
        <TextInput
          key={`${step}-${profileField?.key ?? field?.key ?? 'input'}`}
          defaultValue={sanitizeInkText(value)}
          {...(field?.key?.endsWith('Provider') || profileField?.key === 'provider'
            ? { placeholder: 'openai' }
            : field?.key?.endsWith('Model') || profileField?.key === 'model'
              ? { placeholder: 'gpt-4.1' }
              : {})}
          onChange={(next) => onChange(sanitizeInkText(next))}
          onSubmit={(next) => onSubmit(sanitizeInkText(next))}
        />
      ) : null}
    </ScreenFrame>
  );
}
function ProfileSelectionScreen({
  colors,
  labels,
  selected,
  offset,
}: {
  colors: boolean;
  labels: string[];
  selected: number;
  offset: number;
}) {
  return (
    <ScreenFrame
      title="Agent configuration"
      subtitle="Choose a profile to edit"
      footer="j/k move | Enter select | q cancel"
      colors={colors}
    >
      <SelectionList items={labels} selected={selected} offset={offset} visibleRows={5} />
    </ScreenFrame>
  );
}

export function SetupPreviewScreen({
  colors,
  generated,
  editing,
  error,
  selected,
  setupPreviewOffset,
  showFullConfig,
}: {
  colors: boolean;
  generated: GeneratedConfiguration;
  editing: boolean;
  error?: string | undefined;
  selected: number;
  setupPreviewOffset: number;
  showFullConfig: boolean;
}) {
  const analyst = generated.config.profiles.analyst;
  const planner = generated.config.profiles.planner;
  const qa = generated.config.profiles.qa;
  const builder = generated.config.profiles.builder;
  const summary = [
    `Analyst: ${analyst?.provider ?? '-'} / ${analyst?.model ?? '-'} (read-only)`,
    `Planner: ${planner?.provider ?? '-'} / ${planner?.model ?? '-'} (read-only)`,
    `QA: ${qa?.provider ?? '-'} / ${qa?.model ?? '-'} (read-only, no shell)`,
    `Builder: ${builder?.provider ?? '-'} / ${builder?.model ?? '-'} (${builder && isWriteCapable(builder) ? 'WRITE+SHELL' : 'read-only'})`,
    `Config path: ${generated.configPath}`,
    `Pi command: ${generated.config.piCommand}`,
  ];
  const lines = showFullConfig ? generatedConfigurationPreview(generated).split('\n') : summary;
  return (
    <ScreenFrame
      title={editing ? 'Agent configuration' : 'Setup wizard'}
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
        items={[editing ? 'Save changes' : 'Save', 'Show full config', 'Go back', 'Cancel']}
        selected={selected}
        offset={0}
        visibleRows={4}
      />
    </ScreenFrame>
  );
}
