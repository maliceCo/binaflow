import type { ArtifactContentView, RunInspection } from '../../application/operations.js';
import { ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';
export function ArtifactsScreen({
  colors,
  detail,
  selected,
  offset,
  content,
  contentOffset,
  visibleRows,
}: {
  colors: boolean;
  detail: RunInspection;
  selected: number;
  offset: number;
  content?: ArtifactContentView | undefined;
  contentOffset: number;
  visibleRows: number;
}) {
  return (
    <ScreenFrame
      title="Artifacts"
      subtitle="Select an artifact to load a bounded preview."
      footer="j/k move | Enter preview | q back"
      colors={colors}
    >
      <SelectionList
        items={detail.artifacts.map(
          (artifact) => `${artifact.stepId}.${artifact.name}  ${artifact.sizeBytes} bytes`,
        )}
        selected={selected}
        offset={offset}
        visibleRows={visibleRows}
      />
      {content ? (
        <TextViewport
          lines={
            content.error
              ? [`ERROR: ${content.error}`]
              : (content.content ?? 'No readable content.').split('\n')
          }
          offset={contentOffset}
          visibleRows={visibleRows}
        />
      ) : (
        <SafeText>Press Enter to load the selected artifact.</SafeText>
      )}
    </ScreenFrame>
  );
}
