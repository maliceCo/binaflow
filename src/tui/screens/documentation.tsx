import { ScreenFrame, TextViewport } from '../components.js';

export const documentationLines = [
  'Binaflow is a local workflow orchestrator for coding agents.',
  'The TUI is attached to the current terminal process.',
  'The CLI remains the stable JSON and JSONL automation interface.',
  '',
  'Setup',
  'Configuration is generated only after an explicit confirmation.',
  'Provider credentials remain outside Binaflow.',
  'Planner profiles are read-only by default.',
  'Builder write and shell permissions require a visible review.',
  '',
  'Execution',
  'Runs stay attached to this process. There is no detach or daemon path.',
  'The first cancellation request is graceful; the second is forced.',
  'Completed steps are reused during recovery and never silently rerun.',
  '',
  'Experimental workflow',
  'research-plan-build and its approval flow are experimental.',
  'Approval and loop behavior are not generic workflow primitives.',
  '',
  'Limits',
  'The first Ink foundation screen uses bounded content and explicit scrolling.',
  'NO_COLOR removes presentation colors but keeps terminal control behavior.',
  'Pi authentication and model availability are not verified by Binaflow.',
  '',
  'Press q to close this documentation.',
];

export function DocumentationScreen({
  colors,
  offset,
  visibleRows,
}: {
  colors: boolean;
  offset: number;
  visibleRows: number;
}) {
  return (
    <ScreenFrame
      title="Documentation"
      subtitle="Attached terminal studio"
      footer="j/k or arrows scroll | PageUp/PageDown page | q back"
      colors={colors}
    >
      <TextViewport lines={documentationLines} offset={offset} visibleRows={visibleRows} />
    </ScreenFrame>
  );
}
