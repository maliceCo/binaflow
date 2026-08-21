import { TextInput } from '@inkjs/ui';
import { Box } from 'ink';
import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList } from '../components.js';
import {
  configuredProfiles,
  isWriteCapable,
  workflowInputFields,
  workflowPermissionSummary,
  type LaunchInputState,
} from '../launch.js';
import { sanitizeInkText } from '../text.js';
export function LaunchInputScreen({
  colors,
  launchInput,
  error,
  value,
  onChange,
  onSubmit,
}: {
  colors: boolean;
  launchInput: LaunchInputState;
  error?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const field = workflowInputFields(launchInput.workflow)[launchInput.field]!;
  return (
    <ScreenFrame
      title={`${launchInput.workflow.id} input`}
      status={error}
      footer="Type a value | Enter submit | Esc cancel"
      colors={colors}
      border={false}
    >
      <PaneSection title="Input" colors={colors} first>
        <SafeText>
          {field}
          {launchInput.workflow.input.required.includes(field) ? ' (required)' : ' (optional)'}
        </SafeText>
        <Box>
          <SafeText>&gt; </SafeText>
          <TextInput
            key={`${launchInput.workflow.id}-${launchInput.field}`}
            defaultValue={sanitizeInkText(value)}
            onChange={(next) => onChange(sanitizeInkText(next))}
            onSubmit={(next) => onSubmit(sanitizeInkText(next))}
          />
        </Box>
      </PaneSection>
    </ScreenFrame>
  );
}
export function LaunchConfirmationScreen({
  colors,
  diagnosis,
  launchInput,
  error,
  launching,
  selected,
  offset,
}: {
  colors: boolean;
  diagnosis: ConfigurationDiagnosis;
  launchInput: LaunchInputState;
  error?: string | undefined;
  launching: boolean;
  selected: number;
  offset: number;
}) {
  const profiles = configuredProfiles(diagnosis);
  const permissionLines = workflowPermissionSummary(launchInput.workflow, diagnosis);
  return (
    <ScreenFrame
      title="Confirm workflow"
      status={error ?? (launching ? 'Launching...' : undefined)}
      footer="j/k move | Enter select | q cancel"
      colors={colors}
      border={false}
    >
      <PaneSection title="Review" colors={colors} first>
        <SafeText>Workflow: {launchInput.workflow.id}</SafeText>
        <SafeText>Description: {launchInput.workflow.description}</SafeText>
        <SafeText>Objective: {launchInput.values.objective ?? '(missing)'}</SafeText>
        {launchInput.workflow.experimental ? (
          <SafeText {...(colors ? { color: 'yellow' as const } : {})}>
            Experimental workflow
          </SafeText>
        ) : null}
        {Object.values(profiles).some(isWriteCapable) ? (
          <SafeText {...(colors ? { color: 'red' as const, bold: true } : { bold: true })}>
            WARNING: this workflow can modify the workspace.
          </SafeText>
        ) : null}
        {permissionLines.map((line) => (
          <SafeText key={line}>{line}</SafeText>
        ))}
        <SafeText>
          Steps:{' '}
          {launchInput.workflow.steps.map((step) => `${step.id} (${step.profile})`).join(', ')}
        </SafeText>
      </PaneSection>
      <PaneSection title="Action" colors={colors}>
        <SelectionList
          items={['Confirm and launch', 'Edit objective', 'Cancel']}
          selected={selected}
          offset={offset}
          visibleRows={3}
        />
      </PaneSection>
    </ScreenFrame>
  );
}
