import type { ConfigurationDiagnosis } from '../application/config-operations.js';
import type { TuiEvent, TuiState } from './model.js';

export function reduce(state: TuiState, event: TuiEvent): TuiState {
  switch (event.type) {
    case 'diagnosed': {
      const next = { ...state, diagnosis: event.diagnosis };
      if (state.pendingFolderDiagnosis) return enterFolder(next, event.diagnosis);
      const withoutError = clearField(next, 'error');
      if (state.effect === 'diagnose-cwd') return clearField(withoutError, 'effect');
      return withoutError;
    }
    case 'use-folder':
      return enterFolder(state, state.diagnosis);
    case 'open-about':
      return { ...state, overlay: 'about' };
    case 'close-about':
      return { ...state, overlay: 'welcome' };
    case 'quit':
      return { ...state, quitRequested: true };
    case 'open-folder-picker': {
      if (state.detail === 'live') return state;
      return {
        ...state,
        overlay: 'folder-picker',
        folderPickerPath: state.cwd,
        folderPickerOrigin: state.overlay === 'welcome' ? 'welcome' : 'studio',
      };
    }
    case 'folder-picker-back':
      if (state.overlay !== 'folder-picker') return state;
      return { ...state, overlay: state.folderPickerOrigin === 'welcome' ? 'welcome' : 'none' };
    case 'folder-picker-path':
      return { ...state, folderPickerPath: event.path };
    case 'folder-picker-select':
      if (state.overlay !== 'folder-picker') return state;
      return { ...state, overlay: 'folder-confirm' };
    case 'folder-confirm':
      if (state.overlay !== 'folder-confirm') return state;
      return {
        ...state,
        cwd: state.folderPickerPath,
        overlay: 'none',
        detail: 'diagnosis',
        pendingFolderDiagnosis: true,
        effect: 'diagnose-cwd',
      };
    case 'folder-confirm-back':
      if (state.overlay !== 'folder-confirm') return state;
      return { ...state, overlay: 'folder-picker' };
    case 'setup-next':
      if (state.overlay !== 'setup') return state;
      return nextSetupStep(state);
    case 'setup-back':
      if (state.overlay !== 'setup') return state;
      return previousSetupStep(state);
    case 'setup-cancel':
      if (state.overlay !== 'setup') return state;
      return {
        ...clearField(clearField(clearField(state, 'effect'), 'setupModels'), 'diagnosis'),
        overlay: 'welcome',
        setupStep: 1,
        setupField: 0,
        setupValues: {},
      };
    case 'setup-values':
      if (state.overlay !== 'setup') return state;
      return { ...state, setupValues: event.values };
    case 'setup-models':
      return { ...clearField(state, 'effect'), setupModels: event.models };
    case 'setup-save':
      if (state.overlay !== 'setup') return state;
      return { ...state, overlay: 'none', detail: 'diagnosis', effect: 'diagnose-cwd' };
    case 'refresh-diagnosis':
      if (state.overlay !== 'none') return state;
      return { ...state, detail: 'diagnosis', effect: 'diagnose-cwd' };
    case 'focus-pane':
      return { ...state, focus: event.pane };
    case 'move': {
      if (state.focus === 'runs') {
        const count = state.runs?.length ?? 0;
        if (count === 0) return state;
        return { ...state, runSelected: clamp(state.runSelected + event.direction, count) };
      }
      if (state.focus === 'workflows') {
        const count = state.workflows?.length ?? 0;
        if (count === 0) return state;
        return {
          ...state,
          workflowSelected: clamp(state.workflowSelected + event.direction, count),
        };
      }
      return state;
    }
    case 'new-run': {
      const diagnosis = state.diagnosis;
      if (!diagnosis) {
        return { ...state, error: 'The config has not been checked yet. Press d to refresh.' };
      }
      if (!diagnosis.configExists) {
        return {
          ...state,
          overlay: 'setup',
          setupStep: 1,
          setupField: 0,
          setupValues: {},
          effect: 'discover-setup-models',
        };
      }
      if (!diagnosis.configValid) {
        return {
          ...state,
          error:
            'The config file is invalid. Edit .binaflow/config.json in your editor, then press d to refresh.',
        };
      }
      return { ...state, detail: 'launch' };
    }
    case 'launch-cancel':
      if (state.detail !== 'launch') return state;
      return { ...state, detail: 'empty' };
    case 'run-started':
      return {
        ...state,
        detail: 'live',
        activeRunId: event.runId,
        cancellationRequested: false,
      };
    case 'run-finished':
      return { ...state, detail: 'result', cancellationRequested: false };
    case 'cancel-requested':
      if (state.detail !== 'live') return state;
      return { ...state, cancellationRequested: true };
    case 'open-run': {
      const next = { ...state, activeRunId: event.runId };
      if (event.status === 'waiting') return { ...next, detail: 'approval' };
      if (isTerminalStatus(event.status)) return { ...next, detail: 'result' };
      return { ...next, detail: 'inspect' };
    }
    case 'leave-waiting':
      if (state.detail !== 'approval') return state;
      return { ...state, detail: 'inspect' };
    case 'open-help':
      if (state.overlay !== 'none') return state;
      return { ...state, overlay: 'help' };
    case 'close-help':
      if (state.overlay !== 'help') return state;
      return { ...state, overlay: 'none' };
    case 'workflows-loaded':
      return { ...state, workflows: event.workflows };
    case 'runs-loaded':
      return { ...state, runs: event.runs };
  }
}

function enterFolder(state: TuiState, diagnosis: ConfigurationDiagnosis | undefined): TuiState {
  const base = clearField(clearField(state, 'effect'), 'diagnosis');
  if (!diagnosis) {
    return { ...base, overlay: 'none', detail: 'diagnosis' };
  }
  const next = { ...base, diagnosis, pendingFolderDiagnosis: false };
  if (!diagnosis.configExists) {
    return {
      ...next,
      overlay: 'setup',
      setupStep: 1,
      setupField: 0,
      setupValues: {},
      effect: 'discover-setup-models',
    };
  }
  return { ...next, overlay: 'none', detail: 'diagnosis' };
}

function nextSetupStep(state: TuiState): TuiState {
  switch (state.setupStep) {
    case 1:
      return { ...state, setupStep: 2, setupField: 0 };
    case 2:
      if (state.setupField === 0) return { ...state, setupField: 1 };
      return { ...state, setupStep: 3, setupField: 2 };
    case 3:
      if (state.setupField < 4) return { ...state, setupField: state.setupField + 1 };
      return { ...state, setupStep: 4 };
    case 4:
      return state;
  }
}

function previousSetupStep(state: TuiState): TuiState {
  switch (state.setupStep) {
    case 4:
      return { ...state, setupStep: 3, setupField: 4 };
    case 3:
      if (state.setupField > 2) return { ...state, setupField: state.setupField - 1 };
      return { ...state, setupStep: 2, setupField: 1 };
    case 2:
      if (state.setupField > 0) return { ...state, setupField: state.setupField - 1 };
      return { ...state, setupStep: 1, setupField: 0 };
    case 1:
      return state;
  }
}

function isTerminalStatus(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  );
}

function clamp(selected: number, count: number): number {
  return Math.max(0, Math.min(count - 1, selected));
}

function clearField<T extends object, K extends keyof T>(state: T, key: K): T {
  const next = { ...state };
  delete next[key];
  return next;
}
