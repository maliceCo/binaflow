import type { ReactNode } from 'react';
import type { TuiEvent, TuiState } from './model.js';
import type { LiveState } from './execution.js';
import { workflowInputFields } from './launch.js';
import { IdleDetail, StudioLayout } from './layout.js';
import { ArtifactsScreen } from './screens/artifacts.js';
import { BugsScreen } from './screens/bugs.js';
import { ApprovalScreen } from './screens/approval.js';
import { DetailScreen } from './screens/detail.js';
import { QaReviewScreen } from './screens/qa-review.js';
import { ReviewScreen } from './screens/review.js';
import { ReviewThreadScreen } from './screens/review-thread.js';
import { DiagnosisScreen } from './screens/diagnosis.js';
import { LaunchConfirmationScreen, LaunchInputScreen } from './screens/launch.js';
import { LiveScreen } from './screens/live.js';
import { ResultScreen } from './screens/result.js';
import { TodoSelectionScreen } from './screens/todo-select.js';
import { PreparationScreen } from './screens/preparation.js';
import { ProposalScreen } from './screens/proposal.js';
import { QaReportScreen } from './screens/qa-report.js';

export interface ShellDetailViewProps {
  colors: boolean;
  state: TuiState;
  live?: LiveState;
  liveDetail: boolean;
  liveOffset: number;
  size: { columns: number; rows: number };
  launching: boolean;
  operationActive?: boolean;
  onEvent: (event: TuiEvent) => void;
}

export function renderShellDetail({
  colors,
  state,
  live,
  liveDetail,
  liveOffset,
  size,
  launching,
  operationActive = false,
  onEvent,
}: ShellDetailViewProps): ReactNode {
  let right: ReactNode;
  switch (state.detail) {
    case 'diagnosis':
      right = (
        <DiagnosisScreen
          colors={colors}
          diagnosis={state.diagnosis}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 7)}
          refreshing={false}
          error={state.error}
        />
      );
      break;
    case 'todo-select':
      right = (
        <TodoSelectionScreen
          colors={colors}
          candidates={state.todoCandidates ?? []}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 8)}
          {...(state.status ? { status: state.status } : {})}
        />
      );
      break;
    case 'launch':
      if (
        state.launchInput &&
        state.launchInput.field >= workflowInputFields(state.launchInput.workflow).length
      ) {
        right = state.diagnosis ? (
          <LaunchConfirmationScreen
            colors={colors}
            diagnosis={state.diagnosis}
            launchInput={state.launchInput}
            error={state.error ?? state.status}
            launching={launching}
            selected={state.selection}
            offset={state.offset}
          />
        ) : null;
      } else if (state.launchInput) {
        right = (
          <LaunchInputScreen
            key={`${state.launchInput.workflow.id}-${state.launchInput.field}`}
            colors={colors}
            launchInput={state.launchInput}
            error={state.error ?? state.launchInput.error}
            value={state.inputValue}
            onChange={(value) => onEvent({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => onEvent({ type: 'launch-input', value }), 0);
            }}
          />
        );
      } else {
        right = (
          <IdleDetail
            colors={colors}
            {...(state.diagnosis ? { diagnosis: state.diagnosis } : {})}
          />
        );
      }
      break;
    case 'live':
      right = live ? (
        <LiveScreen
          colors={colors}
          live={live}
          detail={liveDetail}
          offset={liveOffset}
          visibleRows={Math.max(1, size.rows - 13)}
        />
      ) : null;
      break;
    case 'bugs':
      right = (
        <BugsScreen
          colors={colors}
          defects={state.qaDefects ?? []}
          {...(state.qaHistoryStats ? { stats: state.qaHistoryStats } : {})}
          {...(state.qaDefectDetails ? { details: state.qaDefectDetails } : {})}
          selected={state.qaDefectSelected}
          offset={state.qaDefectOffset}
          visibleRows={Math.max(1, size.rows - 10)}
          {...(state.error ? { error: state.error } : {})}
        />
      );
      break;
    case 'review':
      right = state.review ? (
        <ReviewScreen
          colors={colors}
          review={state.review}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 10)}
          {...(state.error ? { error: state.error } : {})}
        />
      ) : null;
      break;
    case 'review-thread':
    case 'qa-review': {
      const entry = state.review?.threads.find(
        (candidate) => candidate.thread.id === state.reviewThreadId,
      );
      right = entry ? (
        state.detail === 'qa-review' ? (
          <QaReviewScreen
            key={entry.thread.id}
            colors={colors}
            entry={entry}
            value={state.inputValue}
            focus={state.reviewFocus}
            selected={state.reviewSelected}
            {...(state.error ? { error: state.error } : {})}
            onChange={(value) => onEvent({ type: 'input-change', value })}
            onSubmit={(value) => onEvent({ type: 'review-message-submit', content: value })}
            onBack={() => onEvent({ type: 'review-back' })}
            onExplain={() => onEvent({ type: 'review-explain' })}
            onDecision={(decision) => onEvent({ type: 'review-decide', decision })}
            onFinalize={() => onEvent({ type: 'review-finalize' })}
            onFocus={() => onEvent({ type: 'review-focus' })}
          />
        ) : (
          <ReviewThreadScreen
            key={entry.thread.id}
            colors={colors}
            entry={entry}
            value={state.inputValue}
            focus={state.reviewFocus}
            selected={state.reviewSelected}
            {...(state.error ? { error: state.error } : {})}
            onChange={(value) => onEvent({ type: 'input-change', value })}
            onSubmit={(value) => onEvent({ type: 'review-message-submit', content: value })}
            onBack={() => onEvent({ type: 'review-back' })}
            onExplain={() => onEvent({ type: 'review-explain' })}
            onDecision={(decision) => onEvent({ type: 'review-decide', decision })}
            onFinalize={() => onEvent({ type: 'review-finalize' })}
            onFocus={() => onEvent({ type: 'review-focus' })}
          />
        )
      ) : null;
      break;
    }
    case 'preparation':
      right = (
        <PreparationScreen
          colors={colors}
          {...(state.preparation ? { preparation: state.preparation } : {})}
          {...(state.preparationOverview ? { overview: state.preparationOverview } : {})}
          focus={state.preparationFocus}
          selected={state.preparationSelected}
          drafts={state.preparationDrafts ?? []}
          models={state.preparationModels ?? []}
          {...(state.preparationSettingRole ? { settingRole: state.preparationSettingRole } : {})}
          value={state.inputValue}
          {...(state.status ? { status: state.status } : {})}
          {...(state.error ? { error: state.error } : {})}
        />
      );
      break;
    case 'proposal':
      right = (
        <ProposalScreen
          colors={colors}
          {...(state.preparation ? { preparation: state.preparation } : {})}
          {...(state.preparationOverview ? { overview: state.preparationOverview } : {})}
        />
      );
      break;
    case 'qa-report':
      right = state.taskOutcome ? (
        <QaReportScreen
          colors={colors}
          outcome={state.taskOutcome}
          {...(state.qaRound ? { round: state.qaRound } : {})}
          {...(state.qaRoundId ? { roundId: state.qaRoundId } : {})}
          {...(state.qaFindingId ? { findingId: state.qaFindingId } : {})}
          focus={state.qaReportFocus}
          filter={state.qaSeverityFilter}
          detailOffset={state.qaDetailOffset}
          visibleRows={Math.max(1, size.rows - 10)}
          {...(state.error ? { error: state.error } : {})}
        />
      ) : null;
      break;
    case 'approval':
      right = state.runView ? (
        <ApprovalScreen
          colors={colors}
          view={state.runView}
          {...(state.taskOutcome ? { outcome: state.taskOutcome } : {})}
          previews={state.approvalPreviews}
          previewOffset={state.approvalPreviewOffset}
          error={state.error ?? state.launchInput?.error}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 16)}
        />
      ) : null;
      break;
    case 'result':
      right = state.runView ? (
        <ResultScreen
          colors={colors}
          view={state.runView}
          {...(state.taskOutcome ? { outcome: state.taskOutcome } : {})}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 16)}
          {...(state.error ? { error: state.error } : {})}
        />
      ) : null;
      break;
    case 'inspect':
      right = state.runView ? (
        <DetailScreen
          colors={colors}
          view={state.runView}
          clarifications={state.clarifications}
          previews={state.approvalPreviews}
          previewOffset={state.approvalPreviewOffset}
          error={state.error}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 16)}
        />
      ) : null;
      break;
    case 'artifacts':
      right = state.runView ? (
        <ArtifactsScreen
          colors={colors}
          view={state.runView}
          selected={state.artifactSelected}
          offset={state.artifactOffset}
          content={state.artifactContent}
          page={state.artifactPage}
          contentOffset={state.artifactContentOffset}
          visibleRows={Math.max(1, size.rows - 12)}
        />
      ) : null;
      break;
    default:
      right = (
        <IdleDetail colors={colors} {...(state.diagnosis ? { diagnosis: state.diagnosis } : {})} />
      );
      break;
  }

  return (
    <StudioLayout
      colors={colors}
      state={state}
      {...(live ? { live } : {})}
      liveDetail={liveDetail}
      size={size}
      operationActive={operationActive}
      right={right}
    />
  );
}
