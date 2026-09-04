import type { TodoFileCandidate } from '../../application/config-operations.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList } from '../components.js';

export function TodoSelectionScreen({
  colors,
  candidates,
  selected,
  offset,
  visibleRows,
  status,
}: {
  colors: boolean;
  candidates: TodoFileCandidate[];
  selected: number;
  offset: number;
  visibleRows: number;
  status?: string;
}) {
  return (
    <ScreenFrame
      title="Choose reviewed TODO"
      subtitle="Files found in the selected workspace"
      status={status}
      footer="j/k move | Enter select | q cancel"
      colors={colors}
      border={false}
    >
      <PaneSection title="TODO files" colors={colors} first>
        {candidates.length > 0 ? (
          <SelectionList
            items={candidates.map(
              (candidate) => `${candidate.relativePath}  (${candidate.sizeBytes} bytes)`,
            )}
            selected={selected}
            offset={offset}
            visibleRows={Math.max(1, Math.min(visibleRows, candidates.length))}
          />
        ) : (
          <SafeText>No TODO.md or TODO-*.md files were found.</SafeText>
        )}
      </PaneSection>
    </ScreenFrame>
  );
}
