import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import type { WorkflowRun } from '../../core/run.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
import { HOME_ACTIONS } from '../screens.js';

export function HomeScreen({
  colors,
  diagnosis,
  status,
  selected,
  offset,
  recentRuns,
}: {
  colors: boolean;
  diagnosis?: ConfigurationDiagnosis | undefined;
  status?: string | undefined;
  selected: number;
  offset: number;
  recentRuns: WorkflowRun[];
}) {
  const readiness = diagnosis?.ready ? 'Ready' : diagnosis ? 'Attention' : 'Checking';
  const cause = diagnosis?.ready
    ? 'Configuration and Pi are ready.'
    : (diagnosis?.errors[0] ?? diagnosis?.piCommandMessage ?? 'Diagnosis is still running.');
  const suggestedFix = diagnosis?.ready
    ? 'Choose New workflow to start.'
    : !diagnosis
      ? 'Wait for diagnosis to finish.'
      : !diagnosis.configExists
        ? 'Choose New workflow to create configuration.'
        : !diagnosis.configValid
          ? 'Fix configuration errors, then press r to refresh.'
          : diagnosis.piCommandLaunchable === false
            ? 'Install or fix the Pi command, then press r to refresh.'
            : 'Open Diagnosis for details, or press r to refresh.';
  return (
    <ScreenFrame
      title="Binaflow"
      subtitle="Attached Ink shell"
      status={status}
      footer="j/k or arrows move | Enter select | r refresh | q quit"
      colors={colors}
    >
      <TextViewport
        lines={[
          `Workspace: ${diagnosis?.workspacePath ?? 'loading...'}`,
          `Config: ${diagnosis?.configPath ?? 'loading...'}`,
          `Status: ${readiness}`,
          `Cause: ${cause}`,
          `Suggested fix: ${suggestedFix}`,
        ]}
        offset={0}
        visibleRows={4}
      />
      <SafeText>Recent runs:</SafeText>
      {recentRuns.length > 0 ? (
        recentRuns.map((run) => (
          <SafeText key={run.id}>{`${run.workflowId}  ${run.status}  ${run.objective}`}</SafeText>
        ))
      ) : (
        <SafeText>No recent runs.</SafeText>
      )}
      <SelectionList items={HOME_ACTIONS} selected={selected} offset={offset} visibleRows={5} />
    </ScreenFrame>
  );
}
