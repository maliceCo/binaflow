import type { ReviewThreadDetails } from '../../application/review-operations.js';
import { ReviewThreadScreen } from './review-thread.js';

export function QaReviewScreen(props: {
  colors: boolean;
  entry: ReviewThreadDetails;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onBack: () => void;
  onExplain: () => void;
  onDecision: (decision: 'approve' | 'correct' | 'accept-risk' | 'postpone') => void;
  onFinalize: () => void;
}) {
  return <ReviewThreadScreen {...props} />;
}
