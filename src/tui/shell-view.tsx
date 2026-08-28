import type { ReactNode } from 'react';
import type { TuiEvent, TuiState } from './model.js';
import type { LiveState } from './execution.js';
import { workflowInputFields } from './launch.js';
import { IdleDetail, StudioLayout } from './layout.js';
import { ArtifactsScreen } from './screens/artifacts.js';
import { BugsScreen } from './screens/bugs.js';
import { ApprovalScreen } from './screens/approval.js';
import { DetailScreen } from './screens/detail.js';
import { DiagnosisScreen } from './screens/diagnosis.js';
import { LaunchConfirmationScreen, LaunchInputScreen } from './screens/launch.js';
import { LiveScreen } from './screens/live.js';
import { ResultScreen } from './screens/result.js';

export interface ShellDetailViewProps {
  colors: boolean;
  state: TuiState;
  live?: LiveState;
  liveDetail: boolean;
  liveOffset: number;
  size: { columns: number; rows: number };
  launching: boolean;
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
    case 'approval':
      right = state.runView ? (
        <ApprovalScreen
          colors={colors}
          view={state.runView}
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
      right={right}
    />
  );
}
