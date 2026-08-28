import { parentWorkspacePath } from '../application/config-operations.js';
import { approvalActionItems } from './screens/approval.js';
import { detailActionItems } from './screens/detail.js';
import { setupChoices, workflowInputFields } from './launch.js';
import { visibleFolderEntries, type TuiEvent, type TuiState } from './model.js';

export interface ShellInputKey {
  backspace?: boolean;
  ctrl?: boolean;
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
  hasLiveExecution: boolean;
  size: { columns: number; rows: number };
  dispatch: (event: TuiEvent) => void;
  requestCancellation: () => void;
  exit: (code?: number) => void;
  toggleLiveDetail: () => void;
  moveLive: (direction: -1 | 1) => void;
  loadArtifact: () => void;
}

export function handleShellInput({
  input,
  key,
  current,
  belowMinimumSize,
  launching,
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
    if (hasLiveExecution || launching) requestCancellation();
    else exit(130);
    return;
  }

  const launchInputActive =
    current.detail === 'launch' &&
    current.launchInput !== undefined &&
    current.launchInput.field < workflowInputFields(current.launchInput.workflow).length;
  const setupInputActive =
    current.overlay === 'setup' &&
    (current.setupStep === 2 || current.setupStep === 3) &&
    setupChoices(current.setupField, current.setupModels ?? [], current.setupValues).length === 0;
  const textInputActive =
    launchInputActive ||
    setupInputActive ||
    current.overlay === 'recovery-confirm' ||
    current.overlay === 'rejection-feedback';
  if (textInputActive) {
    if (key.escape) {
      if (launchInputActive) dispatch({ type: 'launch-cancel' });
      else if (setupInputActive) dispatch({ type: 'setup-cancel' });
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
        const choices = setupChoices(
          current.setupField,
          current.setupModels ?? [],
          current.setupValues,
        );
        if (current.setupStep === 1) {
          if (input === 'q' || key.escape) dispatch({ type: 'setup-cancel' });
          else if (direction !== 0) dispatch({ type: 'move', direction, visibleRows: 3 });
          else if (input === '\r' || key.return) {
            if (current.selection === 0) dispatch({ type: 'setup-next' });
            else if (current.selection === 1) dispatch({ type: 'setup-retry' });
            else dispatch({ type: 'setup-cancel' });
          }
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
            const choice = choices[current.selection];
            if (choice) dispatch({ type: 'setup-submit', value: choice });
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

  if (current.detail === 'inspect') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
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
      else dispatch({ type: 'inspect-back' });
    }
    return;
  }

  if (current.detail === 'result') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 16) });
    } else if (input === '\r' || key.return) dispatch({ type: 'open-artifacts' });
    return;
  }

  if (current.detail === 'artifacts') {
    if (input === 'q' || key.escape) dispatch({ type: 'inspect-back' });
    else if (direction !== 0) {
      dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 12) });
    } else if (input === '\r' || key.return) loadArtifact();
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

  if (input === 'n') dispatch({ type: 'new-run' });
  else if (input === 'w') dispatch({ type: 'open-folder-picker' });
  else if (input === 'd' || input === 'r') dispatch({ type: 'refresh-diagnosis' });
  else if (input === 'b') dispatch({ type: 'open-bugs' });
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
