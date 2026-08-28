import type { ReviewView } from '../../application/review-operations.js';
import { PaneSection, ScreenFrame, SafeText, SelectionList } from '../components.js';

export function ReviewScreen({
  colors,
  review,
  selected,
  offset,
  visibleRows,
  error,
}: {
  colors: boolean;
  review: ReviewView;
  selected: number;
  offset: number;
  visibleRows: number;
  error?: string | undefined;
}) {
  const items = review.threads.map(
    ({ thread }) => `${thread.phase}  ${thread.target.kind}:${thread.target.id}  ${thread.state}`,
  );
  return (
    <ScreenFrame
      title="Interactive review"
      subtitle={`Run ${review.runId}  status=${review.status}`}
      status={error}
      footer="j/k move | Enter open thread | q back"
      colors={colors}
      border={false}
    >
      <PaneSection title="Review threads" colors={colors} first>
        {items.length > 0 ? (
          <SelectionList
            items={items}
            selected={selected}
            offset={offset}
            visibleRows={visibleRows}
          />
        ) : (
          <SafeText dimColor>No review checkpoints have been persisted.</SafeText>
        )}
      </PaneSection>
      <SafeText dimColor>
        Messages and explanations do not advance a review. Only an explicit decision or finalization
        does.
      </SafeText>
    </ScreenFrame>
  );
}
