import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { ScreenFrame, StatusMessage, TextViewport } from '../components.js';

export function diagnosisLines(diagnosis?: ConfigurationDiagnosis | undefined): string[] {
  if (!diagnosis) return ['Loading configuration diagnosis...'];
  return [
    `Workspace: ${diagnosis.workspacePath}`,
    `Config: ${diagnosis.configPath}`,
    `Config valid: ${diagnosis.configValid ? 'yes' : 'no'}`,
    `Ready: ${diagnosis.ready ? 'ready' : 'attention required'}`,
    `Pi command: ${diagnosis.piCommand ?? 'unknown'}`,
    `Pi launchable: ${diagnosis.piCommandLaunchable === true ? 'yes' : 'no'}`,
    '',
    ...diagnosis.errors.map((message) => `Error: ${message}`),
    ...diagnosis.profiles.flatMap((profile) => [
      `Profile ${profile.name}: ${profile.valid ? 'valid' : 'invalid'}`,
      ...profile.errors.map((message) => `  ${message}`),
    ]),
    ...diagnosis.workflows.map(
      (workflow) =>
        `Workflow ${workflow.id}: ${workflow.available ? 'available' : `missing ${workflow.missingProfiles.join(', ')}`}`,
    ),
  ];
}

export function DiagnosisScreen({
  colors,
  diagnosis,
  offset,
  visibleRows,
  refreshing,
  error,
}: {
  colors: boolean;
  diagnosis?: ConfigurationDiagnosis | undefined;
  offset: number;
  visibleRows: number;
  refreshing: boolean;
  error?: string | undefined;
}) {
  return (
    <ScreenFrame
      title="Diagnosis"
      subtitle="Configuration readiness"
      status={refreshing ? 'refreshing diagnosis...' : (error ?? '')}
      footer="j/k or arrows scroll | PageUp/PageDown page | r refresh | q back"
      colors={colors}
      border={false}
    >
      <TextViewport lines={diagnosisLines(diagnosis)} offset={offset} visibleRows={visibleRows} />
      {error ? <StatusMessage message={error} error /> : null}
    </ScreenFrame>
  );
}
