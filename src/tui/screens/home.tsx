import type { ConfigurationDiagnosis } from '../../application/config-operations.js';
import { ScreenFrame, SelectionList, TextViewport } from '../components.js';
import { HOME_ACTIONS } from '../screens.js';

export function HomeScreen({
  colors,
  diagnosis,
  status,
  selected,
  offset,
}: {
  colors: boolean;
  diagnosis?: ConfigurationDiagnosis | undefined;
  status?: string | undefined;
  selected: number;
  offset: number;
}) {
  const readiness = diagnosis?.ready ? 'ready' : diagnosis ? 'attention required' : 'loading';
  return (
    <ScreenFrame
      title="Binaflow"
      subtitle="Attached Ink shell"
      status={status ?? (diagnosis ? readiness : 'loading diagnosis...')}
      footer="j/k or arrows move | Enter select | r refresh | q quit"
      colors={colors}
    >
      <TextViewport
        lines={[
          `Workspace: ${diagnosis?.workspacePath ?? 'loading...'}`,
          `Config: ${diagnosis?.configPath ?? 'loading...'}`,
          `Ready: ${readiness}`,
        ]}
        offset={0}
        visibleRows={3}
      />
      <SelectionList items={HOME_ACTIONS} selected={selected} offset={offset} visibleRows={5} />
    </ScreenFrame>
  );
}
