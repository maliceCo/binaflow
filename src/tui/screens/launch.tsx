import { TextInput } from '@inkjs/ui';
import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { ScreenFrame, SafeText, SelectionList } from '../components.js';
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
      footer="Type a value | Enter submit | q cancel"
      colors={colors}
    >
      <SafeText>
        {field}
        {launchInput.workflow.input.required.includes(field) ? ' (required)' : ' (optional)'}
      </SafeText>
      <SafeText>&gt; </SafeText>
      <TextInput
        defaultValue={sanitizeInkText(value)}
        onChange={(next) => onChange(sanitizeInkText(next))}
        onSubmit={(next) => onSubmit(sanitizeInkText(next))}
      />
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
    >
      <SafeText>Workflow: {launchInput.workflow.id}</SafeText>
      <SafeText>Objective: {launchInput.values.objective ?? '(missing)'}</SafeText>
      {launchInput.workflow.experimental ? <SafeText>Experimental workflow</SafeText> : null}
      {Object.values(profiles).some(isWriteCapable) ? (
        <SafeText>WARNING: this workflow can modify the workspace.</SafeText>
      ) : null}
      {permissionLines.map((line) => (
        <SafeText key={line}>{line}</SafeText>
      ))}
      <SelectionList
        items={['Confirm and launch', 'Edit objective', 'Cancel']}
        selected={selected}
        offset={offset}
        visibleRows={3}
      />
    </ScreenFrame>
  );
}
