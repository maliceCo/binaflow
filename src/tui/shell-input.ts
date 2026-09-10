import { parentWorkspacePath } from '../application/config-operations.js';
import { approvalActionItems } from './screens/approval.js';
import { detailActionItems } from './screens/detail.js';
import { setupChoices, setupProfileChoices, workflowInputFields } from './launch.js';
import {
  preparationActionLabels,
  parsePreparationSynthesis,
  visibleFolderEntries,
  type TuiEvent,
  type TuiState,
} from './model.js';

export interface ShellInputKey {
  backspace?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  pageDown?: boolean;
  pageUp?: boolean;
  downArrow?: boolean;
  escape?: boolean;
  return?: boolean;
  tab?: boolean;
  upArrow?: boolean;
}

export interface ShellInputOptions {
  input: string;
  key: ShellInputKey;
  current: TuiState;
  belowMinimumSize: boolean;
  launching: boolean;
  operationActive?: boolean;
  hasLiveExecution: boolean;
  size: { columns: number; rows: number };
  dispatch: (event: TuiEvent) => void;
  requestCancellation: () => void;
  exit: (code?: number) => void;
  toggleLiveDetail: () => void;
  moveLive: (direction: -1 | 1) => void;
  loadArtifact: (cursor?: string) => void;
}

export function handleShellInput({
  input,
  key,
  current,
  belowMinimumSize,
  launching,
  operationActive = false,
  hasLiveExecution,
  size,
  dispatch,
  requestCancellation,
  exit,
  toggleLiveDetail,
  moveLive,
  loadArtifact,
}: ShellInputOptions): void {
  if (belowMinimumSize) {
    if (input === 'q' || key.escape || (input === 'c' && key.ctrl)) {
      exit(input === 'c' ? 130 : undefined);
    }
    return;
  }
  if (input === 'c' && key.ctrl) {
    if (hasLiveExecution || launching || operationActive) requestCancellation();
    else exit(130);
    return;
  }

  const launchInputActive =
    current.detail === 'launch' &&
    current.launchInput !== undefined &&
    current.launchInput.field < workflowInputFields(current.launchInput.workflow).length;
  const setupChoicesForInput =
    current.setupProfile && !current.setupProfileSelection
      ? setupProfileChoices(
          current.setupProfile,
          current.setupField,
          current.setupModels ?? [],
          current.setupProfileValues,
        )
      : setupChoices(current.setupField, current.setupModels ?? []);
  const setupInputActive =
    current.overlay === 'setup' &&
    !current.setupProfileSelection &&
    (current.setupStep === 2 || current.setupStep === 3) &&
    setupChoicesForInput.length === 0;
  const textInputActive =
    launchInputActive ||
    setupInputActive ||
    current.overlay === 'recovery-confirm' ||
    current.overlay === 'rejection-feedback' ||
    current.detail === 'review-thread' ||
    current.detail === 'qa-review';
  if (current.detail === 'preparation') {
    if (current.preparationFocus === 'editor' || current.preparationFocus === 'synthesis') {
      if (current.preparationFocus === 'synthesis' && key.ctrl && key.return) {
        const synthesis = parsePreparationSynthesis(current.inputValue);
        if (typeof synthesis === 'string') dispatch({ type: 'error-set', message: synthesis });
        else dispatch({ type: 'preparation-synthesis-save', synthesis });
      } else if (key.tab || key.escape) dispatch({ type: 'preparation-focus' });
      else if (key.backspace || input === '\x7f') {
        dispatch({ type: 'input-change', value: current.inputValue.slice(0, -1) });
      } else if (key.return || input === '\r' || input === '\n') {
        dispatch({ type: 'input-change', value: `${current.inputValue}\n` });
      } else if (input.length > 0 && !key.ctrl && !key.meta) {
        dispatch({ type: 'input-change', value: `${current.inputValue}${input}` });
      }
      return;
    }
    if (current.preparationFocus === 'settings') {
      if (key.escape || key.tab) dispatch({ type: 'preparation-focus' });
      else {
        const direction =
          input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;
        if (direction !== 0)
          dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
        else if (key.return || input === '\r')
          dispatch({ type: 'preparation-setting-select', index: current.preparationSelected });
      }
      return;
    }
    if (key.escape) dispatch({ type: 'preparation-back' });
    else if (key.tab) dispatch({ type: 'preparation-focus' });
    const direction = input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;
    if (current.preparationFocus === 'actions' && direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
    } else if (current.preparationFocus === 'actions' && (key.return || input === '\r')) {
      const action = preparationActionLabels(
        current.preparation,
        current.preparationOverview,
        current.preparationDrafts ?? [],
      )[current.preparationSelected];
      if (action === 'Accept synthesis suggestion')
        dispatch({ type: 'preparation-accept-synthesis' });
      else if (action === 'Retry last response') dispatch({ type: 'preparation-retry' });
      else if (action === 'Edit synthesis') dispatch({ type: 'preparation-synthesis-edit' });
      else if (action === 'Configure agents') dispatch({ type: 'preparation-settings-open' });
      else if (action === 'Generate proposal') dispatch({ type: 'preparation-generate-proposal' });
      else if (action === 'Open proposal') dispatch({ type: 'preparation-proposal-open' });
      else if (action === 'Review proposal') dispatch({ type: 'preparation-review-proposal' });
      else if (action === 'Acknowledge review') dispatch({ type: 'preparation-ack-review' });
      else if (action === 'Approve plan and execute') dispatch({ type: 'preparation-approve' });
      else if (action === 'Back') dispatch({ type: 'preparation-back' });
      else if (action?.startsWith('Reopen ')) {
        const draft = current.preparationDrafts?.find((candidate) =>
          action.startsWith(`Reopen ${candidate.id.slice(0, 8)}`),
        );
        if (draft) dispatch({ type: 'preparation-open-draft', draftId: draft.id });
      }
    }
    return;
  }
  if (current.detail === 'proposal') {
    if (key.escape || input === 'q') dispatch({ type: 'preparation-proposal-back' });
    return;
  }
  if (
    (current.detail === 'review-thread' || current.detail === 'qa-review') &&
    current.reviewFocus === 'actions'
  ) {
    const direction = input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;
    if (direction !== 0)
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
    return;
  }
  if (textInputActive) {
    if (key.escape) {
      if (launchInputActive) dispatch({ type: 'launch-cancel' });
      else if (setupInputActive) dispatch({ type: 'setup-cancel' });
      else if (current.detail === 'review-thread' || current.detail === 'qa-review')
        dispatch({ type: 'review-back' });
      else dispatch({ type: 'close-detail-prompt' });
    }
    return;
  }

  if (current.overlay !== 'none') {
    const direction = input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;
    switch (current.overlay) {
      case 'welcome':
        if (input === 'q' || key.escape) dispatch({ type: 'quit' });
        else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 4 });
        else if (input === '\r' || key.return) {
          switch (current.selection) {
            case 0:
              dispatch({ type: 'use-folder' });
              break;
            case 1:
              dispatch({ type: 'open-folder-picker' });
              break;
            case 2:
              dispatch({ type: 'open-about' });
              break;
            default:
              dispatch({ type: 'quit' });
          }
        }
        break;
      case 'about':
        if (input === 'q' || key.escape) dispatch({ type: 'close-about' });
        break;
      case 'help':
        if (input === 'q' || key.escape) dispatch({ type: 'close-help' });
        break;
      case 'folder-picker': {
        const entries = visibleFolderEntries(current.folderEntries ?? [], current.folderFilter);
        const parent = entries.find((entry) => entry.isParent);
        const directories = entries.filter((entry) => !entry.isParent);
        const useIndex = parent ? 1 : 0;
        if (key.escape || (input === 'q' && current.folderFilter.length === 0))
          dispatch({ type: 'folder-picker-back' });
        else if (input === 'h') {
          dispatch({
            type: 'folder-picker-path',
            path: parentWorkspacePath(current.folderPickerPath),
          });
        } else if (input === '/') dispatch({ type: 'folder-picker-path', path: '/' });
        else if (key.backspace || input === '\x7f') {
          dispatch({ type: 'folder-filter-backspace' });
        } else if (input.length === 1 && input >= ' ' && input <= '~' && input !== ' ') {
          dispatch({ type: 'folder-filter-input', value: input });
        } else if (input === ' ') {
          const entry =
            current.selection === 0 && parent
              ? parent
              : current.selection > useIndex
                ? directories[current.selection - useIndex - 1]
                : undefined;
          dispatch({ type: 'folder-picker-select', ...(entry ? { path: entry.path } : {}) });
        } else if (direction !== 0) {
          dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 7) });
        } else if (input === '\r' || key.return) {
          if (current.selection === useIndex) {
            dispatch({ type: 'folder-picker-select' });
          } else if (current.selection === 0 && parent) {
            dispatch({ type: 'folder-picker-path', path: parent.path });
          } else {
            const entry = directories[current.selection - useIndex - 1];
            if (entry) dispatch({ type: 'folder-picker-path', path: entry.path });
          }
        }
        break;
      }
      case 'folder-confirm':
        if (input === 'q' || key.escape) dispatch({ type: 'folder-confirm-back' });
        else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 2 });
        else if (input === '\r' || key.return || input === ' ') {
          if (current.selection === 0) dispatch({ type: 'folder-confirm' });
          else dispatch({ type: 'folder-confirm-back' });
        }
        break;
      case 'setup': {
        const choices =
          current.setupProfile && !current.setupProfileSelection
            ? setupProfileChoices(
                current.setupProfile,
                current.setupField,
                current.setupModels ?? [],
                current.setupProfileValues,
              )
            : setupChoices(current.setupField, current.setupModels ?? []);
        if (current.setupStep === 1) {
          if (input === 'q' || key.escape) dispatch({ type: 'setup-cancel' });
          else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 3 });
          else if (input === '\r' || key.return) {
            if (current.selection === 0) dispatch({ type: 'setup-next' });
            else if (current.selection === 1) dispatch({ type: 'setup-retry' });
            else dispatch({ type: 'setup-cancel' });
          }
        } else if (current.setupStep === 2 && current.setupProfileSelection) {
          if (input === 'q' || key.escape) dispatch({ type: 'setup-cancel' });
          else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 5 });
          else if (input === '\r' || key.return) dispatch({ type: 'setup-profile-select' });
        } else if (current.setupStep === 4) {
          if (input === 'q' || key.escape) dispatch({ type: 'setup-cancel' });
          else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 4 });
          else if (input === '\r' || key.return) {
            if (current.selection === 0) dispatch({ type: 'setup-save' });
            else if (current.selection === 1) dispatch({ type: 'setup-toggle-config' });
            else if (current.selection === 2) dispatch({ type: 'setup-back' });
            else dispatch({ type: 'setup-cancel' });
          }
        } else if (choices.length > 0) {
          if (input === 'q' || key.escape) dispatch({ type: 'setup-cancel' });
          else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 5 });
          else if (input === '\r' || key.return) {
            if (choices[current.selection]) dispatch({ type: 'setup-choice' });
          }
        } else if (input === 'q' || key.escape) {
          dispatch({ type: 'setup-cancel' });
        }
        break;
      }
      case 'recovery-confirm':
      case 'rejection-feedback':
        if (input === 'q' || key.escape) dispatch({ type: 'close-detail-prompt' });
        break;
      default:
        break;
    }
    return;
  }

  if (current.detail === 'live') {
    if (input === 'q' || key.escape) requestCancellation();
    else if (input === 'd') toggleLiveDetail();
    else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
      moveLive(input === 'j' || key.downArrow ? 1 : -1);
    }
    return;
  }

  const direction = input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;

  if (current.detail === 'approval') {
    if (input === 'q' || key.escape) dispatch({ type: 'leave-waiting' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 16) });
    } else if (input === '\r' || key.return) {
      const action = current.runView
        ? approvalActionItems(current.runView)[current.selection]
        : undefined;
      if (action?.kind === 'approve-research') dispatch({ type: 'approval-approve' });
      else if (action?.kind === 'reject-research') dispatch({ type: 'approval-reject' });
      else dispatch({ type: 'leave-waiting' });
    }
    return;
  }

  if (current.detail === 'todo-select') {
    if (input === 'q' || key.escape) dispatch({ type: 'todo-selection-cancel' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 8) });
    } else if ((input === '\r' || key.return) && (current.todoCandidates?.length ?? 0) > 0) {
      dispatch({ type: 'todo-select' });
    }
    return;
  }

  if (current.detail === 'launch') {
    const fields = current.launchInput ? workflowInputFields(current.launchInput.workflow) : [];
    const confirming = !!current.launchInput && current.launchInput.field >= fields.length;
    if (!confirming) {
      if (input === 'q' || key.escape) {
        if (launching) requestCancellation();
        dispatch({ type: 'launch-cancel' });
      }
      return;
    }
    if (input === 'q' || key.escape) {
      if (launching) requestCancellation();
      dispatch({ type: 'launch-cancel' });
    } else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 3 });
    else if (input === '\r' || key.return) {
      if (current.selection === 0) dispatch({ type: 'launch-confirm' });
      else if (current.selection === 1) dispatch({ type: 'launch-edit' });
      else dispatch({ type: 'launch-cancel' });
    }
    return;
  }

  if (current.detail === 'review') {
    if (input === 'q' || key.escape) dispatch({ type: 'review-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
    } else if (input === '\r' || key.return) {
      const entry = current.review?.threads[current.selection];
      if (entry) dispatch({ type: 'open-review-thread', threadId: entry.thread.id });
    }
    return;
  }

  if (current.detail === 'inspect') {
    if (input === 'r') dispatch({ type: 'open-qa-report' });
    else if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 16) });
    } else if (input === '\r' || key.return) {
      if (!current.runView) return;
      const actions = detailActionItems(current.runView);
      const action = actions[current.selection];
      if (!action) return;
      if (action.kind === 'resume') dispatch({ type: 'resume-run' });
      else if (action.kind === 'mark-interrupted') dispatch({ type: 'open-recovery-confirm' });
      else if (action.kind === 'clarification') dispatch({ type: 'open-launch' });
      else if (action.kind === 'browse-artifacts') dispatch({ type: 'open-artifacts' });
      else if (action.kind === 'review') dispatch({ type: 'open-review' });
      else dispatch({ type: 'inspect-back' });
    }
    return;
  }

  if (current.detail === 'result') {
    if (input === 'r') dispatch({ type: 'open-qa-report' });
    else if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 16) });
    } else if (input === '\r' || key.return) dispatch({ type: 'open-artifacts' });
    return;
  }

  if (current.detail === 'artifacts') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 12) });
    } else if (input === '[' || key.pageUp) loadArtifact(current.artifactPage?.previousCursor);
    else if (input === ']' || key.pageDown) loadArtifact(current.artifactPage?.nextCursor);
    else if (input === '\r' || key.return) loadArtifact();
    return;
  }

  if (current.detail === 'qa-report') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (input === 'f') dispatch({ type: 'qa-filter-cycle' });
    else if (key.tab) dispatch({ type: 'qa-report-focus' });
    else if (direction !== 0) {
      if (current.qaReportFocus === 'rounds') {
        const roundIds = current.taskOutcome?.qaRoundIds ?? [];
        const selected = Math.max(0, roundIds.indexOf(current.qaRoundId ?? ''));
        const roundId = roundIds[Math.max(0, Math.min(roundIds.length - 1, selected + direction))];
        if (roundId) dispatch({ type: 'qa-round-select', roundId });
      } else {
        dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
      }
    } else if (input === '\r' || key.return) {
      if (current.qaReportFocus === 'rounds' && current.qaRoundId)
        dispatch({ type: 'qa-round-select', roundId: current.qaRoundId });
      else if (current.qaReportFocus === 'findings') dispatch({ type: 'qa-report-focus' });
    }
    return;
  }

  if (current.detail === 'bugs') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 10) });
    } else if (input === '\r' || key.return) {
      const defect = current.qaDefects?.[current.qaDefectSelected];
      if (defect) dispatch({ type: 'open-qa-defect', id: defect.id });
    }
    return;
  }

  if (operationActive && (input === 'n' || input === 'c' || input === 'w' || input === 'p')) {
    dispatch({
      type: 'status-set',
      message: 'An operation is active; cancel it before changing context.',
    });
  } else if (operationActive && (input === '\r' || key.return) && current.focus === 'workflows') {
    dispatch({
      type: 'status-set',
      message: 'An operation is active; cancel it before starting another run.',
    });
  } else if (input === 'n') dispatch({ type: 'new-run' });
  else if (input === 'c') dispatch({ type: 'open-agent-configuration' });
  else if (input === 'w') dispatch({ type: 'open-folder-picker' });
  else if (input === 'd' || input === 'r') dispatch({ type: 'refresh-diagnosis' });
  else if (input === 'b') dispatch({ type: 'open-bugs' });
  else if (input === 'p') dispatch({ type: 'open-preparation' });
  else if (input === '?') dispatch({ type: 'open-help' });
  else if (key.tab) {
    dispatch({
      type: 'focus-pane',
      pane:
        current.focus === 'workflows' ? 'runs' : current.focus === 'runs' ? 'detail' : 'workflows',
    });
  } else if (input === 'h') dispatch({ type: 'focus-pane', pane: 'workflows' });
  else if (input === 'l') dispatch({ type: 'focus-pane', pane: 'detail' });
  else if (direction !== 0) {
    dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 9) });
  } else if (input === '\r' || key.return) {
    if (current.focus === 'workflows') {
      dispatch({ type: 'new-run' });
    } else if (current.focus === 'runs') {
      const run = current.runs?.[current.runSelected];
      if (run) dispatch({ type: 'open-run', runId: run.id, status: run.status });
    }
  } else if (input === 'q' || key.escape) dispatch({ type: 'quit' });
}
