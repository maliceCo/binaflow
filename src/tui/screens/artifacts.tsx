import type { ArtifactContentView, RunInspection } from '../../application/operations.js';
import { formatBytes } from '../../presentation/format.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList, TextViewport } from '../components.js';

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
  const empty = detail.artifacts.length === 0;
  return (
    <ScreenFrame
      title="Artifacts"
      subtitle="Select an artifact to load a bounded preview."
      footer={empty ? 'q back' : 'j/k move | Enter preview | q back'}
      colors={colors}
      border={false}
    >
      {empty ? (
        <>
          <SafeText>No artifacts were recorded for this run.</SafeText>
          <SafeText dimColor>
            Artifacts appear after steps finish and write outputs. Press q to return to run detail.
          </SafeText>
        </>
      ) : (
        <>
          <PaneSection title="Artifact list" colors={colors} first>
            <SelectionList
              items={detail.artifacts.map(
                (artifact) =>
                  `${artifact.stepId}.${artifact.name}  ${formatBytes(artifact.sizeBytes)}`,
              )}
              selected={selected}
              offset={offset}
              visibleRows={visibleRows}
            />
          </PaneSection>
          <PaneSection title="Preview" colors={colors}>
            {content ? (
              <TextViewport
                lines={
                  content.error
                    ? [
                        `Could not load this artifact: ${content.error}`,
                        'Try another artifact, or press q to return to run detail.',
                      ]
                    : (content.content ?? 'No readable content.').split('\n')
                }
                offset={contentOffset}
                visibleRows={visibleRows}
              />
            ) : (
              <SafeText dimColor>Press Enter to load the selected artifact.</SafeText>
            )}
          </PaneSection>
        </>
      )}
    </ScreenFrame>
  );
}
