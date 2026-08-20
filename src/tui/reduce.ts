import type { ConfigurationDiagnosis } from '../application/config-operations.js';
import { discoverWorkflows } from '../application/operations.js';
import type { ArtifactContentView } from '../application/operations.js';
import {
  SETUP_FIELDS,
  profileReview,
  setupChoices,
  validateSetupValue,
  validateWorkflowValue,
  validateWorkflowValues,
  workflowInputFields,
  generatedConfigurationPreview,
} from './launch.js';
import type { TuiEvent, TuiState } from './model.js';
import { APPROVAL_ACTIONS } from './screens/approval.js';
import { detailActions } from './screens/detail.js';
import { diagnosisLines } from './screens/diagnosis.js';
import { moveSelection, scrollText } from './viewport.js';

export const WELCOME_ACTIONS = [
  'Use this folder',
  'Choose a different folder',
  'What is Binaflow?',
  'Quit',
];
export const FOLDER_CONFIRM_ACTIONS = ['Use this folder', 'Back'];
export const SETUP_STEP1_ACTIONS = ['Continue', 'Retry diagnosis', 'Exit'];
export const REVIEW_ACTIONS = ['Save', 'Show full config', 'Go back', 'Cancel'];
export const LAUNCH_CONFIRM_ACTIONS = ['Confirm and launch', 'Edit objective', 'Cancel'];

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
      if (!state.diagnosis) {
        return {
          ...state,
          detail: 'diagnosis',
          pendingFolderDiagnosis: true,
          effect: 'diagnose-cwd',
        };
      }
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
        ...clearField(state, 'folderEntries'),
        overlay: 'folder-picker',
        folderPickerPath: state.cwd,
        folderPickerOrigin: state.overlay === 'welcome' ? 'welcome' : 'studio',
        selection: 0,
        offset: 0,
      };
    }
    case 'folder-picker-back':
      if (state.overlay !== 'folder-picker') return state;
      return {
        ...clearField(state, 'folderEntries'),
        overlay: state.folderPickerOrigin === 'welcome' ? 'welcome' : 'none',
        selection: 0,
        offset: 0,
      };
    case 'folder-picker-path':
      if (state.overlay !== 'folder-picker') return state;
      return { ...state, folderPickerPath: event.path, selection: 0, offset: 0 };
    case 'folder-picker-select':
      if (state.overlay !== 'folder-picker') return state;
      return {
        ...state,
        ...(event.path ? { folderPickerPath: event.path } : {}),
        overlay: 'folder-confirm',
        selection: 0,
        offset: 0,
      };
    case 'folder-confirm':
      if (state.overlay !== 'folder-confirm') return state;
      return {
        ...clearField(state, 'folderEntries'),
        cwd: state.folderPickerPath,
        overlay: 'none',
        detail: 'diagnosis',
        pendingFolderDiagnosis: true,
        effect: 'diagnose-cwd',
        selection: 0,
        offset: 0,
      };
    case 'folder-confirm-back':
      if (state.overlay !== 'folder-confirm') return state;
      return { ...state, overlay: 'folder-picker', selection: 0, offset: 0 };
    case 'folder-listed':
      return { ...state, folderEntries: event.entries, selection: 0, offset: 0 };
    case 'setup-next':
      if (state.overlay !== 'setup') return state;
      return nextSetupStep({ ...clearField(state, 'error'), inputValue: '' });
    case 'setup-back':
      if (state.overlay !== 'setup') return state;
      return previousSetupStep({ ...clearField(state, 'error'), inputValue: '' });
    case 'setup-cancel':
      if (state.overlay !== 'setup') return state;
      return {
        ...clearField(
          clearField(clearField(clearField(state, 'effect'), 'setupModels'), 'diagnosis'),
          'generated',
        ),
        overlay: 'welcome',
        setupStep: 1,
        setupField: 0,
        setupValues: {},
        selection: 0,
        offset: 0,
        inputValue: '',
        showFullConfig: false,
      };
    case 'setup-submit': {
      if (state.overlay !== 'setup' || state.setupStep === 1 || state.setupStep === 4) return state;
      const field = SETUP_FIELDS[state.setupField] as (typeof SETUP_FIELDS)[number];
      const invalid = validateSetupValue(field, event.value);
      if (invalid) return { ...state, error: invalid };
      const next = {
        ...clearField(state, 'error'),
        setupValues: { ...state.setupValues, [field.key]: event.value.trim() },
        inputValue: '',
      };
      return nextSetupStep(next);
    }
    case 'setup-values':
      if (state.overlay !== 'setup') return state;
      return { ...state, setupValues: event.values };
    case 'setup-models':
      return { ...clearField(state, 'effect'), setupModels: event.models };
    case 'setup-save':
      if (state.overlay !== 'setup') return state;
      if (!state.generated) return { ...state, error: 'Configuration preview is not ready yet.' };
      return {
        ...state,
        status: 'Writing configuration...',
      };
    case 'setup-written':
      if (state.overlay !== 'setup') return state;
      return {
        ...clearField(state, 'error'),
        overlay: 'none',
        detail: 'diagnosis',
        effect: 'diagnose-cwd',
        selection: 0,
        offset: 0,
        status: 'Configuration written. Review diagnosis before launching.',
      };
    case 'setup-save-failed':
      if (state.overlay !== 'setup') return state;
      return { ...clearField(state, 'status'), error: event.message };
    case 'setup-toggle-config':
      if (state.overlay !== 'setup') return state;
      return { ...state, showFullConfig: !state.showFullConfig, setupPreviewOffset: 0 };
    case 'setup-retry':
      if (state.overlay !== 'setup') return state;
      return { ...clearField(state, 'error'), effect: 'diagnose-cwd' };
    case 'refresh-diagnosis':
      if (state.overlay !== 'none') return state;
      return { ...state, detail: 'diagnosis', effect: 'diagnose-cwd' };
    case 'focus-pane':
      return { ...state, focus: event.pane };
    case 'move':
      return move(state, event.direction, event.visibleRows);
    case 'new-run': {
      const diagnosis = state.diagnosis;
      if (!diagnosis) {
        return { ...state, error: 'The config has not been checked yet. Press d to refresh.' };
      }
      if (!diagnosis.configExists) {
        return {
          ...clearField(clearField(state, 'generated'), 'launchInput'),
          overlay: 'setup',
          setupStep: 1,
          setupField: 0,
          setupValues: {},
          effect: 'discover-setup-models',
          selection: 0,
          offset: 0,
          inputValue: '',
          showFullConfig: false,
          setupPreviewOffset: 0,
        };
      }
      if (!diagnosis.configValid) {
        return {
          ...state,
          error:
            'The config file is invalid. Edit .binaflow/config.json in your editor, then press d to refresh.',
        };
      }
      return {
        ...clearField(clearField(state, 'launchInput'), 'error'),
        detail: 'launch',
      };
    }
    case 'launch-cancel':
      if (state.detail !== 'launch') return state;
      return {
        ...clearField(clearField(state, 'launchInput'), 'error'),
        detail: 'empty',
        inputValue: '',
      };
    case 'launch-set':
      return {
        ...clearField(state, 'error'),
        detail: 'launch',
        launchInput: event.input,
        selection: 0,
        offset: 0,
        inputValue: '',
      };
    case 'launch-input': {
      if (state.detail !== 'launch' || !state.launchInput) return state;
      const input = state.launchInput;
      const fields = workflowInputFields(input.workflow);
      if (input.field >= fields.length) return state;
      const name = fields[input.field] as string;
      const invalid = validateWorkflowValue(input.workflow, name, event.value);
      if (invalid) return { ...state, launchInput: { ...input, error: invalid } };
      const values = { ...input.values };
      const trimmed = event.value.trim();
      if (trimmed) values[name] = trimmed;
      else delete values[name];
      const nextField = input.field + 1;
      const withoutError = clearField(input, 'error');
      if (nextField >= fields.length) {
        const overall = validateWorkflowValues(input.workflow, values);
        if (overall) return { ...state, launchInput: { ...withoutError, values, error: overall } };
        return {
          ...state,
          launchInput: { ...withoutError, values, field: fields.length },
          inputValue: '',
        };
      }
      return {
        ...state,
        launchInput: { ...withoutError, values, field: nextField },
        inputValue: '',
      };
    }
    case 'launch-edit': {
      if (state.detail !== 'launch' || !state.launchInput) return state;
      const input = state.launchInput;
      const field = Math.max(0, workflowInputFields(input.workflow).indexOf('objective'));
      return {
        ...clearField(state, 'error'),
        launchInput: { ...clearField(input, 'error'), field },
        inputValue: input.values.objective ?? '',
      };
    }
    case 'launch-confirm':
      if (state.detail !== 'launch') return state;
      return { ...clearField(state, 'error'), status: 'Launching...' };
    case 'run-started':
      return {
        ...clearField(state, 'error'),
        detail: 'live',
        activeRunId: event.runId,
        cancellationRequested: false,
      };
    case 'run-finished':
      return {
        ...state,
        detail:
          event.status === 'waiting'
            ? 'approval'
            : event.status === 'failed' || event.status === 'interrupted'
              ? state.detail === 'inspect'
                ? 'inspect'
                : 'result'
              : 'result',
        cancellationRequested: false,
      };
    case 'cancel-requested':
      if (state.detail !== 'live') return state;
      return { ...state, cancellationRequested: true };
    case 'open-run': {
      const next = { ...state, activeRunId: event.runId, selection: 0, offset: 0 };
      if (event.status === 'waiting') return { ...next, detail: 'approval' };
      if (isTerminalStatus(event.status)) return { ...next, detail: 'result' };
      return { ...next, detail: 'inspect' };
    }
    case 'open-artifacts': {
      if (!state.inspection) return state;
      if (state.detail !== 'inspect' && state.detail !== 'result') return state;
      return {
        ...clearField(state, 'artifactContent'),
        detail: 'artifacts',
        selection: 0,
        offset: 0,
        artifactSelected: 0,
        artifactOffset: 0,
        artifactContentOffset: 0,
      };
    }
    case 'open-launch': {
      if (!state.inspection || !state.diagnosis) return state;
      const workflow =
        state.workflows?.find((workflow) => workflow.id === state.inspection?.run.workflowId) ??
        discoverWorkflows().find((workflow) => workflow.id === state.inspection?.run.workflowId);
      if (!workflow) return state;
      const values = { objective: state.inspection.run.objective };
      const field = Math.max(0, workflowInputFields(workflow).indexOf('objective'));
      return {
        ...clearField(state, 'error'),
        detail: 'launch',
        launchInput: {
          workflow,
          values,
          field,
          reviewedProfiles: profileReview(workflow, state.diagnosis),
        },
        inputValue: values.objective ?? '',
        selection: 0,
        offset: 0,
      };
    }
    case 'inspection-set': {
      const base = {
        ...state,
        inspection: event.inspection,
        clarifications: event.clarifications,
        detail:
          (event.inspection.run.status === 'failed' ||
            event.inspection.run.status === 'interrupted') &&
          event.recovery?.eligible
            ? 'inspect'
            : state.detail,
        selection: 0,
        offset: 0,
        artifactSelected: 0,
        artifactOffset: 0,
        artifactContentOffset: 0,
        activeRunId: state.activeRunId ?? event.inspection.run.id,
      };
      const withRecovery = event.recovery
        ? { ...base, recovery: event.recovery }
        : clearField(base, 'recovery');
      return clearField(clearField(withRecovery, 'artifactContent'), 'error');
    }
    case 'approval-set':
      return {
        ...clearField(state, 'error'),
        detail: 'approval',
        approvalMessage: event.message,
        approvalPreviews: event.previews,
        approvalPreviewOffset: 0,
        selection: 0,
        offset: 0,
      };
    case 'artifact-content-set':
      return { ...state, artifactContent: event.content, artifactContentOffset: 0 };
    case 'generated-set':
      return { ...clearField(state, 'error'), generated: event.generated };
    case 'open-recovery-confirm':
      if (state.detail !== 'inspect') return state;
      return {
        ...clearField(state, 'error'),
        overlay: 'recovery-confirm',
        inputValue: '',
      };
    case 'open-rejection-feedback':
      if (state.detail !== 'approval') return state;
      return {
        ...clearField(state, 'error'),
        overlay: 'rejection-feedback',
        inputValue: '',
      };
    case 'close-detail-prompt':
      if (state.overlay !== 'recovery-confirm' && state.overlay !== 'rejection-feedback')
        return state;
      return { ...clearField(state, 'error'), overlay: 'none', inputValue: '' };
    case 'recovery-confirmed':
      if (state.overlay !== 'recovery-confirm') return state;
      return { ...clearField(state, 'error'), overlay: 'none', inputValue: '' };
    case 'rejection-submitted':
      if (state.overlay !== 'rejection-feedback') return state;
      return { ...clearField(state, 'error'), overlay: 'none', inputValue: '' };
    case 'resume-run':
      if (state.detail !== 'inspect' || !state.recovery?.eligible) return state;
      return { ...clearField(state, 'error'), status: 'Resuming workflow...' };
    case 'approval-approve':
      if (state.detail !== 'approval') return state;
      return { ...clearField(state, 'error'), status: 'Approving workflow...' };
    case 'approval-reject':
      if (state.detail !== 'approval') return state;
      return {
        ...clearField(state, 'error'),
        overlay: 'rejection-feedback',
        inputValue: '',
      };
    case 'inspect-back': {
      if (state.detail !== 'inspect' && state.detail !== 'result' && state.detail !== 'artifacts')
        return state;
      return {
        ...clearField(clearField(state, 'artifactContent'), 'error'),
        detail: 'empty',
        selection: 0,
        offset: 0,
        artifactContentOffset: 0,
        inputValue: '',
      };
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
    case 'input-change':
      if (state.inputValue === event.value) return state;
      return { ...state, inputValue: event.value };
    case 'error-set':
      return { ...clearField(state, 'status'), error: event.message };
    case 'status-set':
      return { ...clearField(state, 'error'), status: event.message };
  }
}

function move(state: TuiState, direction: -1 | 1, visibleRows: number): TuiState {
  switch (state.overlay) {
    case 'welcome':
      return moveList(state, WELCOME_ACTIONS.length, direction, visibleRows);
    case 'folder-picker': {
      const count = (state.folderEntries?.length ?? 0) + 1;
      if (count <= 1) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'folder-confirm':
      return moveList(state, FOLDER_CONFIRM_ACTIONS.length, direction, visibleRows);
    case 'setup': {
      switch (state.setupStep) {
        case 1:
          return moveList(state, SETUP_STEP1_ACTIONS.length, direction, visibleRows);
        case 2:
        case 3: {
          const count = setupChoices(
            state.setupField,
            state.setupModels ?? [],
            state.setupValues,
          ).length;
          if (count === 0) return state;
          return moveList(state, count, direction, visibleRows);
        }
        case 4: {
          const next = moveList(state, REVIEW_ACTIONS.length, direction, visibleRows);
          if (!state.showFullConfig || !state.generated) return next;
          const lines = generatedConfigurationPreview(state.generated).split('\n');
          return {
            ...next,
            setupPreviewOffset: scrollText(
              state.setupPreviewOffset,
              direction,
              lines.length,
              Math.max(1, visibleRows),
            ),
          };
        }
      }
      return state;
    }
    case 'help':
    case 'about':
    case 'recovery-confirm':
    case 'rejection-feedback':
    case 'none':
      break;
  }

  if (state.overlay !== 'none') return state;
  if (state.focus === 'workflows') {
    const count = state.workflows?.length ?? 0;
    if (count === 0) return state;
    return {
      ...state,
      workflowSelected: clamp(state.workflowSelected + direction, count),
      workflowOffset: selectionOffset(
        state.workflowSelected,
        state.workflowOffset,
        direction,
        count,
        visibleRows,
      ),
    };
  }
  if (state.focus === 'runs') {
    const count = state.runs?.length ?? 0;
    if (count === 0) return state;
    return {
      ...state,
      runSelected: clamp(state.runSelected + direction, count),
      runOffset: selectionOffset(state.runSelected, state.runOffset, direction, count, visibleRows),
    };
  }

  switch (state.detail) {
    case 'diagnosis':
      return {
        ...state,
        offset: scrollText(
          state.offset,
          direction,
          diagnosisLines(state.diagnosis).length,
          visibleRows,
        ),
      };
    case 'launch': {
      const input = state.launchInput;
      if (!input || input.field < workflowInputFields(input.workflow).length) return state;
      return moveList(state, LAUNCH_CONFIRM_ACTIONS.length, direction, visibleRows);
    }
    case 'inspect': {
      if (!state.inspection) return state;
      const count = detailActions(state.inspection, state.recovery, state.clarifications).length;
      if (count === 0) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'approval': {
      const moved = moveSelection(
        { offset: state.offset, selected: state.selection },
        direction,
        APPROVAL_ACTIONS.length,
        visibleRows,
      );
      let next: TuiState = { ...state, selection: moved.selected, offset: moved.offset };
      if (state.approvalPreviews.length > 0) {
        const maximum = Math.max(
          0,
          approvalPreviewLineCount(state.approvalPreviews) - Math.max(1, visibleRows),
        );
        next = {
          ...next,
          approvalPreviewOffset: Math.max(
            0,
            Math.min(maximum, state.approvalPreviewOffset + direction),
          ),
        };
      }
      return next;
    }
    case 'result': {
      const count = state.inspection?.artifacts.length ?? 0;
      if (count === 0) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'artifacts': {
      if (state.artifactContent) {
        const lines = artifactContentLines(state.artifactContent);
        return {
          ...state,
          artifactContentOffset: scrollText(
            state.artifactContentOffset,
            direction,
            lines.length,
            visibleRows,
          ),
        };
      }
      const count = state.inspection?.artifacts.length ?? 0;
      if (count === 0) return state;
      const moved = moveSelection(
        { offset: state.offset, selected: state.selection },
        direction,
        count,
        visibleRows,
      );
      return {
        ...state,
        artifactSelected: moved.selected,
        artifactOffset: moved.offset,
      };
    }
    case 'empty':
    case 'live':
      return state;
  }
  return state;
}

function moveList(
  state: TuiState,
  count: number,
  direction: -1 | 1,
  visibleRows: number,
): TuiState {
  if (count === 0) return state;
  const moved = moveSelection(
    { offset: state.offset, selected: state.selection },
    direction,
    count,
    visibleRows,
  );
  return { ...state, selection: moved.selected, offset: moved.offset };
}

function approvalPreviewLineCount(previews: ArtifactContentView[]): number {
  let count = 0;
  for (const preview of previews) {
    if (preview.error) {
      count += 1;
      continue;
    }
    count += 1 + (preview.content ?? '').split('\n').slice(0, 12).length;
  }
  return count;
}

function artifactContentLines(content: ArtifactContentView): string[] {
  if (content.error) return [`ERROR: ${content.error}`];
  return (content.content ?? 'No readable content.').split('\n');
}

function enterFolder(state: TuiState, diagnosis: ConfigurationDiagnosis | undefined): TuiState {
  const base = clearField(clearField(state, 'effect'), 'diagnosis');
  const reset = {
    ...base,
    selection: 0,
    offset: 0,
    inputValue: '',
    showFullConfig: false,
  };
  if (!diagnosis) {
    return { ...clearField(reset, 'generated'), overlay: 'none', detail: 'diagnosis' };
  }
  const next = { ...reset, diagnosis, pendingFolderDiagnosis: false };
  if (!diagnosis.configExists) {
    return {
      ...clearField(next, 'generated'),
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
      return { ...state, setupStep: 2, setupField: 0, selection: 0, offset: 0 };
    case 2:
      if (state.setupField === 0) return { ...state, setupField: 1, selection: 0, offset: 0 };
      return { ...state, setupStep: 3, setupField: 2, selection: 0, offset: 0 };
    case 3:
      if (state.setupField < 4)
        return { ...state, setupField: state.setupField + 1, selection: 0, offset: 0 };
      return { ...state, setupStep: 4, selection: 0, offset: 0 };
    case 4:
      return state;
  }
}

function previousSetupStep(state: TuiState): TuiState {
  switch (state.setupStep) {
    case 4:
      return { ...state, setupStep: 3, setupField: 4, selection: 0, offset: 0 };
    case 3:
      if (state.setupField > 2)
        return { ...state, setupField: state.setupField - 1, selection: 0, offset: 0 };
      return { ...state, setupStep: 2, setupField: 1, selection: 0, offset: 0 };
    case 2:
      if (state.setupField > 0)
        return { ...state, setupField: state.setupField - 1, selection: 0, offset: 0 };
      return { ...state, setupStep: 1, setupField: 0, selection: 0, offset: 0 };
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

function selectionOffset(
  selected: number,
  offset: number,
  direction: -1 | 1,
  count: number,
  visibleRows: number,
): number {
  const next = clamp(selected + direction, count);
  const rows = Math.max(1, visibleRows);
  return Math.max(0, Math.min(Math.max(0, count - rows), Math.max(offset, next - rows + 1)));
}

function clearField<T extends object, K extends keyof T>(state: T, key: K): T {
  const next = { ...state };
  delete next[key];
  return next;
}
