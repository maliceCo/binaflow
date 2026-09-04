import type { ConfigurationDiagnosis } from '../application/config-operations.js';
import { discoverWorkflows } from '../application/operations.js';
import type { ArtifactContentView } from '../application/operations.js';
import {
  SETUP_FIELDS,
  SETUP_PROFILES,
  profileReview,
  setupProfileChoices,
  setupProfileFields,
  type SetupProfileName,
  setupChoices,
  usesDiscoveredModels,
  validateSetupValue,
  validateWorkflowValue,
  validateWorkflowValues,
  workflowInputFields,
  generatedConfigurationPreview,
} from './launch.js';
import { visibleFolderEntries, type TuiEvent, type TuiState } from './model.js';
import { approvalActionItems } from './screens/approval.js';
import { detailActionItems } from './screens/detail.js';
import { diagnosisLines } from './screens/diagnosis.js';
import { moveSelection, scrollText } from './viewport.js';

export const WELCOME_ACTIONS = [
  'Use this folder',
  'Choose a different folder',
  'What is Binaflow?',
  'Quit',
];
export const FOLDER_CONFIRM_ACTIONS = ['Use this folder', 'Back'];
export const SETUP_STEP1_ACTIONS = ['Continue', 'Retry diagnosis', 'Cancel'];
export const SETUP_PROFILE_ACTIONS = ['Analyst', 'Planner', 'QA', 'Builder', 'Review and save'];
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
        folderFilter: '',
      };
    }
    case 'folder-picker-back':
      if (state.overlay !== 'folder-picker') return state;
      return {
        ...clearField(state, 'folderEntries'),
        overlay: state.folderPickerOrigin === 'welcome' ? 'welcome' : 'none',
        selection: 0,
        offset: 0,
        folderFilter: '',
      };
    case 'folder-picker-path':
      if (state.overlay !== 'folder-picker') return state;
      return { ...state, folderPickerPath: event.path, selection: 0, offset: 0, folderFilter: '' };
    case 'folder-filter-input':
      if (state.overlay !== 'folder-picker') return state;
      return {
        ...state,
        folderFilter: `${state.folderFilter}${event.value}`,
        selection: 0,
        offset: 0,
      };
    case 'folder-filter-backspace':
      if (state.overlay !== 'folder-picker') return state;
      return { ...state, folderFilter: state.folderFilter.slice(0, -1), selection: 0, offset: 0 };
    case 'folder-picker-select':
      if (state.overlay !== 'folder-picker') return state;
      return {
        ...state,
        ...(event.path ? { folderPickerPath: event.path } : {}),
        overlay: 'folder-confirm',
        selection: 0,
        offset: 0,
        folderFilter: '',
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
        folderFilter: '',
      };
    case 'folder-confirm-back':
      if (state.overlay !== 'folder-confirm') return state;
      return { ...state, overlay: 'folder-picker', selection: 0, offset: 0, folderFilter: '' };
    case 'folder-listed':
      return { ...state, folderEntries: event.entries, selection: 0, offset: 0 };
    case 'setup-next':
      if (state.overlay !== 'setup') return state;
      return nextSetupStep({ ...clearField(state, 'error'), inputValue: '' });
    case 'setup-profile-select': {
      if (state.overlay !== 'setup' || !state.setupProfileSelection) return state;
      if (state.selection === SETUP_PROFILES.length) {
        const complete = SETUP_PROFILES.every((profile) => {
          const values = state.setupProfileValues[profile];
          return (
            Boolean(values?.provider && values.model) &&
            ((profile !== 'builder' && values?.writeAccess === undefined) ||
              (profile === 'builder' && values?.writeAccess !== undefined))
          );
        });
        if (!complete) {
          return { ...state, error: 'Configure all profiles before reviewing.' };
        }
        return { ...clearField(state, 'error'), setupStep: 4, selection: 0, offset: 0 };
      }
      const profile = SETUP_PROFILES[state.selection];
      if (!profile) return state;
      return {
        ...clearField(state, 'error'),
        setupProfileSelection: false,
        setupProfile: profile,
        setupStep: 3,
        setupField: 0,
        setupEditedProfiles: state.setupEditedProfiles.includes(profile)
          ? state.setupEditedProfiles
          : [...state.setupEditedProfiles, profile],
        selection: selectedProfileChoice(state, profile, 0),
        offset: 0,
        inputValue: '',
      };
    }
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
        editingConfiguration: false,
        setupProfileSelection: false,
        setupProfile: undefined,
        setupEditedProfiles: [],
        setupValues: {},
        setupProfileValues: {},
        selection: 0,
        offset: 0,
        inputValue: '',
        showFullConfig: false,
      };
    case 'setup-submit': {
      if (state.overlay !== 'setup' || state.setupStep === 1 || state.setupStep === 4) return state;
      if (state.setupProfile && !state.setupProfileSelection) {
        const field = setupProfileFields(state.setupProfile)[state.setupField];
        if (!field) return state;
        const invalid = validateSetupProfileValue(field.key, event.value);
        if (invalid) return { ...state, error: invalid };
        const next = {
          ...clearField(state, 'error'),
          setupProfileValues: updateIndexedProfileValue(
            state.setupProfileValues,
            state.setupProfile,
            field.key,
            event.value,
          ),
          inputValue: '',
        };
        return nextProfileStep(next);
      }
      const field = SETUP_FIELDS[state.setupField] as (typeof SETUP_FIELDS)[number];
      const invalid = validateSetupValue(field, event.value);
      if (invalid) return { ...state, error: invalid };
      const nextValue = event.value.trim();
      const next = {
        ...clearField(state, 'error'),
        setupValues: { ...state.setupValues, [field.key]: nextValue },
        setupProfileValues: updateSetupProfileValue(state.setupProfileValues, field.key, nextValue),
        inputValue: '',
      };
      return nextSetupStep(next);
    }
    case 'setup-models': {
      const next = { ...clearField(state, 'effect'), setupModels: event.models };
      return {
        ...next,
        selection: selectedSetupChoice(next),
        offset: 0,
      };
    }
    case 'setup-choice': {
      if (state.overlay !== 'setup' || state.setupStep === 1 || state.setupStep === 4) return state;
      if (state.setupProfile && !state.setupProfileSelection) {
        const choice = setupProfileChoices(
          state.setupProfile,
          state.setupField,
          state.setupModels ?? [],
          state.setupProfileValues,
        )[state.selection];
        if (!choice) return state;
        return nextProfileStep({
          ...clearField(state, 'error'),
          setupProfileValues: updateIndexedProfileValue(
            state.setupProfileValues,
            state.setupProfile,
            setupProfileFields(state.setupProfile)[state.setupField]!.key,
            choice.value,
          ),
          inputValue: '',
        });
      }
      const choice = setupChoices(state.setupField, state.setupModels ?? [])[state.selection];
      if (!choice) return state;
      if (choice.model) {
        const prefix = state.setupField === 0 ? 'planner' : 'builder';
        return nextSetupStep({
          ...clearField(state, 'error'),
          setupValues: {
            ...state.setupValues,
            [`${prefix}Provider`]: choice.model.provider,
            [`${prefix}Model`]: choice.model.model,
          },
          setupProfileValues: {
            ...state.setupProfileValues,
            [prefix]: {
              ...state.setupProfileValues[prefix as SetupProfileName],
              provider: choice.model.provider,
              model: choice.model.model,
            },
          },
          inputValue: '',
        });
      }
      return reduce(state, { type: 'setup-submit', value: choice.value });
    }
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
        setupProfileSelection: false,
        setupProfile: undefined,
        setupEditedProfiles: [],
        editingConfiguration: false,
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
    case 'open-bugs':
      if (state.detail === 'live' || state.overlay !== 'none') return state;
      return {
        ...clearField(clearField(state, 'error'), 'qaDefectDetails'),
        detail: 'bugs',
        focus: 'detail',
        qaDefectSelected: 0,
        qaDefectOffset: 0,
        status: 'Loading QA history...',
      };
    case 'open-review':
      if (
        state.overlay !== 'none' ||
        (state.detail !== 'inspect' && state.detail !== 'result') ||
        state.runView?.workflow.id !== 'plan-build-qa-interactive'
      )
        return state;
      return {
        ...clearField(clearField(state, 'error'), 'review'),
        detail: 'review',
        focus: 'detail',
        status: 'Loading review...',
        selection: 0,
        offset: 0,
      };
    case 'review-set':
      return {
        ...clearField(clearField(state, 'error'), 'status'),
        review: event.review,
        detail:
          state.detail === 'review-thread' || state.detail === 'qa-review'
            ? state.detail
            : 'review',
        selection: 0,
        offset: 0,
      };
    case 'open-review-thread': {
      if (state.detail !== 'review' && state.detail !== 'qa-review') return state;
      const thread = state.review?.threads.find((entry) => entry.thread.id === event.threadId);
      if (!thread) return state;
      return {
        ...clearField(clearField(state, 'error'), 'status'),
        detail: thread.thread.phase === 'qa' ? 'qa-review' : 'review-thread',
        reviewThreadId: thread.thread.id,
        selection: 0,
        offset: 0,
        inputValue: '',
      };
    }
    case 'review-back':
      if (state.detail === 'review-thread' || state.detail === 'qa-review') {
        return {
          ...clearField(state, 'error'),
          detail: 'review',
          inputValue: '',
          selection: 0,
          offset: 0,
        };
      }
      if (state.detail === 'review') {
        return { ...clearField(state, 'error'), detail: 'inspect', selection: 0, offset: 0 };
      }
      return state;
    case 'review-message-submit':
      if (state.detail !== 'review-thread' && state.detail !== 'qa-review') return state;
      if (!event.content.trim()) return { ...state, error: 'Message must be non-empty.' };
      return { ...clearField(state, 'error'), status: 'Sending review message...' };
    case 'review-message-sent':
      return {
        ...clearField(clearField(state, 'error'), 'status'),
        review: event.review,
        inputValue: '',
      };
    case 'review-explain':
      if (state.detail !== 'review-thread' && state.detail !== 'qa-review') return state;
      return { ...clearField(state, 'error'), status: 'Requesting explanation...' };
    case 'review-explained':
      return { ...clearField(clearField(state, 'error'), 'status'), review: event.review };
    case 'review-decide':
      if (state.detail !== 'review-thread' && state.detail !== 'qa-review') return state;
      return { ...clearField(state, 'error'), status: `Applying decision: ${event.decision}...` };
    case 'review-finalize':
      if (state.detail !== 'review-thread' && state.detail !== 'qa-review') return state;
      return { ...clearField(state, 'error'), status: 'Finalizing review...' };
    case 'open-qa-defect':
      if (state.detail !== 'bugs') return state;
      return {
        ...clearField(state, 'qaDefectDetails'),
        status: `Loading QA defect ${state.qaDefects?.find((defect) => defect.id === event.id)?.id ?? event.id}...`,
      };
    case 'qa-history-loaded':
      return {
        ...clearField(clearField(state, 'error'), 'status'),
        detail: 'bugs',
        qaDefects: event.defects,
        qaHistoryStats: event.stats,
        qaDefectSelected: Math.min(state.qaDefectSelected, Math.max(0, event.defects.length - 1)),
        qaDefectOffset: 0,
      };
    case 'qa-defect-details-set':
      return { ...clearField(state, 'error'), status: undefined, qaDefectDetails: event.details };
    case 'open-agent-configuration': {
      const diagnosis = state.diagnosis;
      if (state.overlay !== 'none' || !diagnosis?.configValid) {
        return { ...state, error: 'A valid configuration is required before editing agents.' };
      }
      return {
        ...clearField(clearField(clearField(state, 'generated'), 'setupModels'), 'error'),
        overlay: 'setup',
        setupStep: 2,
        setupField: 0,
        setupProfileSelection: true,
        setupProfile: undefined,
        setupEditedProfiles: [],
        editingConfiguration: true,
        ...setupValuesFromDiagnosis(diagnosis),
        effect: 'discover-setup-models',
        selection: 0,
        offset: 0,
        inputValue: '',
        showFullConfig: false,
        setupPreviewOffset: 0,
      };
    }
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
          setupProfileSelection: false,
          setupProfile: undefined,
          setupEditedProfiles: [],
          editingConfiguration: false,
          setupValues: {},
          setupProfileValues: {},
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
        ...clearField(clearField(clearField(state, 'launchInput'), 'todoCandidates'), 'error'),
        detail: 'empty',
        focus: 'workflows',
        inputValue: '',
      };
    case 'todo-files-found':
      return {
        ...clearField(clearField(state, 'error'), 'launchInput'),
        detail: 'todo-select',
        focus: 'detail',
        todoCandidates: event.candidates,
        selection: 0,
        offset: 0,
      };
    case 'todo-select':
      if (state.detail !== 'todo-select') return state;
      return { ...clearField(state, 'error'), status: 'Loading reviewed TODO...' };
    case 'todo-selection-cancel':
      if (state.detail !== 'todo-select') return state;
      return {
        ...clearField(clearField(state, 'todoCandidates'), 'status'),
        detail: 'empty',
        focus: 'workflows',
        selection: 0,
        offset: 0,
      };
    case 'launch-set':
      return {
        ...clearField(clearField(clearField(state, 'error'), 'status'), 'todoCandidates'),
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
      if (state.runView?.status === event.status) {
        return { ...state, status: undefined, cancellationRequested: false };
      }
      return {
        ...state,
        status: undefined,
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
    case 'open-run':
      return {
        ...state,
        activeRunId: event.runId,
        detail: 'inspect',
        selection: 0,
        offset: 0,
      };
    case 'open-artifacts': {
      if (!state.runView) return state;
      if (state.detail !== 'inspect' && state.detail !== 'result') return state;
      return {
        ...clearField(state, 'artifactContent'),
        detail: 'artifacts',
        selection: 0,
        offset: 0,
        artifactSelected: state.detail === 'result' ? state.selection : 0,
        artifactOffset: 0,
        artifactContentOffset: 0,
      };
    }
    case 'open-launch': {
      if (!state.runView || !state.diagnosis) return state;
      const workflow =
        state.workflows?.find((workflow) => workflow.id === state.runView?.workflow.id) ??
        discoverWorkflows().find((workflow) => workflow.id === state.runView?.workflow.id);
      if (!workflow) return state;
      const values = { objective: state.runView.objective };
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
    case 'run-view-set': {
      const detail: TuiState['detail'] =
        event.view.pendingAction ||
        event.view.availableActions.some(
          (action) => action.kind === 'approve-research' || action.kind === 'reject-research',
        )
          ? 'approval'
          : event.view.availableActions.some(
                (action) => action.kind === 'resume' || action.kind === 'mark-interrupted',
              )
            ? 'inspect'
            : event.view.status === 'completed' ||
                event.view.status === 'failed' ||
                event.view.status === 'cancelled' ||
                event.view.status === 'interrupted'
              ? 'result'
              : 'inspect';
      const base = {
        ...state,
        status: undefined,
        runView: event.view,
        clarifications: event.clarifications,
        detail,
        selection: 0,
        offset: 0,
        artifactSelected: 0,
        artifactOffset: 0,
        artifactContentOffset: 0,
        activeRunId: state.activeRunId ?? event.view.id,
      };
      return clearField(clearField(base, 'artifactContent'), 'error');
    }
    case 'approval-set':
      return {
        ...clearField(state, 'error'),
        detail: 'approval',
        approvalPreviews: event.previews,
        approvalPreviewOffset: 0,
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
      if (
        state.detail !== 'inspect' ||
        !state.runView?.availableActions.some((action) => action.kind === 'resume')
      )
        return state;
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
      if (
        state.detail !== 'inspect' &&
        state.detail !== 'result' &&
        state.detail !== 'artifacts' &&
        state.detail !== 'bugs' &&
        state.detail !== 'review' &&
        state.detail !== 'review-thread' &&
        state.detail !== 'qa-review'
      )
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
      const count = visibleFolderEntries(state.folderEntries ?? [], state.folderFilter).length + 1;
      if (count <= 1) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'folder-confirm':
      return moveList(state, FOLDER_CONFIRM_ACTIONS.length, direction, visibleRows);
    case 'setup': {
      switch (state.setupStep) {
        case 1:
          return moveList(state, SETUP_STEP1_ACTIONS.length, direction, visibleRows);
        case 2: {
          if (state.setupProfileSelection)
            return moveList(state, SETUP_PROFILE_ACTIONS.length, direction, visibleRows);
          const count = setupChoices(state.setupField, state.setupModels ?? []).length;
          if (count === 0) return state;
          return moveList(state, count, direction, visibleRows);
        }
        case 3: {
          const count = state.setupProfile
            ? setupProfileChoices(
                state.setupProfile,
                state.setupField,
                state.setupModels ?? [],
                state.setupProfileValues,
              ).length
            : setupChoices(state.setupField, state.setupModels ?? []).length;
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
      workflowOffset: moveSelection(
        { offset: state.workflowOffset, selected: state.workflowSelected },
        direction,
        count,
        visibleRows,
      ).offset,
    };
  }
  if (state.focus === 'runs') {
    const count = state.runs?.length ?? 0;
    if (count === 0) return state;
    return {
      ...state,
      runSelected: clamp(state.runSelected + direction, count),
      runOffset: moveSelection(
        { offset: state.runOffset, selected: state.runSelected },
        direction,
        count,
        visibleRows,
      ).offset,
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
    case 'todo-select':
      return moveList(state, state.todoCandidates?.length ?? 0, direction, visibleRows);
    case 'launch': {
      const input = state.launchInput;
      if (!input || input.field < workflowInputFields(input.workflow).length) return state;
      return moveList(state, LAUNCH_CONFIRM_ACTIONS.length, direction, visibleRows);
    }
    case 'inspect': {
      if (!state.runView) return state;
      const count = detailActionItems(state.runView).length;
      if (count === 0) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'approval': {
      if (!state.runView) return state;
      const moved = moveSelection(
        { offset: state.offset, selected: state.selection },
        direction,
        approvalActionItems(state.runView).length,
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
      const count = state.runView?.artifacts.length ?? 0;
      if (count === 0) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'review': {
      const count = state.review?.threads.length ?? 0;
      if (count === 0) return state;
      return moveList(state, count, direction, visibleRows);
    }
    case 'review-thread':
    case 'qa-review':
      return state;
    case 'bugs': {
      const count = state.qaDefects?.length ?? 0;
      if (count === 0) return state;
      const moved = moveSelection(
        { offset: state.qaDefectOffset, selected: state.qaDefectSelected },
        direction,
        count,
        visibleRows,
      );
      const next = {
        ...state,
        qaDefectSelected: moved.selected,
        qaDefectOffset: moved.offset,
      };
      return state.qaDefectDetails &&
        state.qaDefects?.[moved.selected]?.id !== state.qaDefectDetails.defect.id
        ? clearField(next, 'qaDefectDetails')
        : next;
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
      const count = state.runView?.artifacts.length ?? 0;
      if (count === 0) return state;
      const moved = moveSelection(
        { offset: state.artifactOffset, selected: state.artifactSelected },
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
      editingConfiguration: false,
      setupValues: {},
      setupProfileValues: {},
      effect: 'discover-setup-models',
    };
  }
  return { ...next, overlay: 'none', detail: 'diagnosis' };
}

function setupValuesFromDiagnosis(diagnosis: ConfigurationDiagnosis): {
  setupValues: TuiState['setupValues'];
  setupProfileValues: TuiState['setupProfileValues'];
} {
  const profiles = Object.fromEntries(
    diagnosis.profiles.flatMap((profile) =>
      profile.valid && profile.settings ? [[profile.name, profile.settings]] : [],
    ),
  );
  const planner = profiles.planner ?? profiles.analyst ?? profiles.qa;
  const builder = profiles.builder;
  const setupProfileValues = Object.fromEntries(
    Object.entries(profiles).flatMap(([name, profile]) =>
      name === 'analyst' || name === 'planner' || name === 'qa' || name === 'builder'
        ? [
            [
              name,
              {
                ...(profile.provider ? { provider: profile.provider } : {}),
                model: profile.model,
                ...(profile.thinking ? { thinking: profile.thinking } : {}),
                ...(name === 'builder'
                  ? { writeAccess: profile.workspaceMode === 'read-write' }
                  : {}),
              },
            ],
          ]
        : [],
    ),
  ) as TuiState['setupProfileValues'];
  return {
    setupValues: {
      ...(planner ? { plannerProvider: planner.provider ?? '', plannerModel: planner.model } : {}),
      ...(builder
        ? {
            builderProvider: builder.provider ?? '',
            builderModel: builder.model,
            builderWriteAccess: builder.workspaceMode === 'read-write' ? 'yes' : 'no',
          }
        : {}),
    },
    setupProfileValues,
  };
}

function updateSetupProfileValue(
  values: TuiState['setupProfileValues'],
  key: string,
  value: string,
): TuiState['setupProfileValues'] {
  const profileName = key.startsWith('planner') ? 'planner' : 'builder';
  const field = key.endsWith('Provider')
    ? 'provider'
    : key.endsWith('Model')
      ? 'model'
      : 'writeAccess';
  return {
    ...values,
    [profileName]: {
      ...values[profileName],
      [field]: field === 'writeAccess' ? ['y', 'yes'].includes(value.toLowerCase()) : value,
    },
  };
}

function selectedSetupChoice(state: TuiState): number {
  const field = SETUP_FIELDS[state.setupField];
  if (field?.key === 'builderWriteAccess')
    return state.setupValues.builderWriteAccess === 'yes' ? 1 : 0;
  if (field?.key !== 'plannerProvider' && field?.key !== 'builderProvider') return 0;
  const provider = state.setupValues[field.key];
  const model =
    state.setupValues[field.key === 'plannerProvider' ? 'plannerModel' : 'builderModel'];
  const index = setupChoices(state.setupField, state.setupModels ?? []).findIndex(
    (choice) => choice.model?.provider === provider && choice.model?.model === model,
  );
  return index < 0 ? 0 : index;
}

function selectedProfileChoice(
  state: TuiState,
  profile: SetupProfileName,
  fieldIndex: number,
): number {
  const value = state.setupProfileValues[profile];
  const field = setupProfileFields(profile)[fieldIndex];
  if (!field) return 0;
  const target =
    field.key === 'writeAccess'
      ? value?.writeAccess === true
        ? 'yes'
        : 'no'
      : field.key === 'thinking'
        ? (value?.thinking ?? '')
        : value?.[field.key];
  const index = setupProfileChoices(
    profile,
    fieldIndex,
    state.setupModels ?? [],
    state.setupProfileValues,
  ).findIndex((choice) => choice.value === target);
  return index < 0 ? 0 : index;
}

function updateIndexedProfileValue(
  values: TuiState['setupProfileValues'],
  profile: SetupProfileName,
  key: 'provider' | 'model' | 'thinking' | 'writeAccess',
  value: string,
): TuiState['setupProfileValues'] {
  const current = values[profile] ?? {};
  if (key === 'thinking' && value.trim() === '') {
    const withoutThinking = { ...current };
    delete withoutThinking.thinking;
    return { ...values, [profile]: withoutThinking };
  }
  return {
    ...values,
    [profile]: {
      ...current,
      [key]:
        key === 'writeAccess' ? ['y', 'yes'].includes(value.trim().toLowerCase()) : value.trim(),
    },
  };
}

function validateSetupProfileValue(
  key: 'provider' | 'model' | 'thinking' | 'writeAccess',
  value: string,
): string | undefined {
  if (key === 'writeAccess') return validateSetupValue(SETUP_FIELDS[4]!, value);
  return value.trim() ? undefined : 'A non-empty value is required.';
}

function nextProfileStep(state: TuiState): TuiState {
  if (!state.setupProfile) return state;
  const fields = setupProfileFields(state.setupProfile);
  if (state.setupField >= fields.length - 1) {
    return {
      ...state,
      setupStep: 2,
      setupProfileSelection: true,
      setupProfile: undefined,
      selection: 0,
      offset: 0,
      inputValue: '',
    };
  }
  const setupField = state.setupField + 1;
  return {
    ...state,
    setupField,
    selection: selectedProfileChoice(state, state.setupProfile, setupField),
    offset: 0,
    inputValue: '',
  };
}

function withSetupSelection(state: TuiState): TuiState {
  return { ...state, selection: selectedSetupChoice(state), offset: 0 };
}

function nextSetupStep(state: TuiState): TuiState {
  const discovered = usesDiscoveredModels(state.setupModels ?? []);
  switch (state.setupStep) {
    case 1:
      return {
        ...state,
        setupStep: 2,
        setupField: 0,
        setupProfileSelection: true,
        setupProfile: undefined,
        selection: 0,
        offset: 0,
      };
    case 2:
      if (state.setupField === 0 && !discovered)
        return withSetupSelection({ ...state, setupField: 1 });
      return withSetupSelection({ ...state, setupStep: 3, setupField: 2 });
    case 3:
      if (state.setupField === 2)
        return withSetupSelection({ ...state, setupField: discovered ? 4 : 3 });
      if (state.setupField < 4)
        return withSetupSelection({ ...state, setupField: state.setupField + 1 });
      return { ...state, setupStep: 4, selection: 0, offset: 0 };
    case 4:
      return state;
  }
}

function previousSetupStep(state: TuiState): TuiState {
  const discovered = usesDiscoveredModels(state.setupModels ?? []);
  switch (state.setupStep) {
    case 4:
      return { ...state, setupStep: 3, setupField: 4, selection: 0, offset: 0 };
    case 3:
      if (state.setupField === 4 && discovered)
        return { ...state, setupField: 2, selection: 0, offset: 0 };
      if (state.setupField > 2)
        return { ...state, setupField: state.setupField - 1, selection: 0, offset: 0 };
      return {
        ...state,
        setupStep: 2,
        setupField: discovered ? 0 : 1,
        selection: 0,
        offset: 0,
      };
    case 2:
      if (state.setupField > 0)
        return { ...state, setupField: state.setupField - 1, selection: 0, offset: 0 };
      return { ...state, setupStep: 1, setupField: 0, selection: 0, offset: 0 };
    case 1:
      return state;
  }
}

function clamp(selected: number, count: number): number {
  return Math.max(0, Math.min(count - 1, selected));
}

function clearField<T extends object, K extends keyof T>(state: T, key: K): T {
  const next = { ...state };
  delete next[key];
  return next;
}
