import type {
  ConfigurationDiagnosis,
  GeneratedConfiguration,
} from '../application/config-operations.js';
import type {
  ArtifactContentView,
  RunInspection,
  RunRecoveryExplanation,
} from '../application/operations.js';
import type { AgentModel } from '../core/agent.js';
import type { RunStatus, WorkflowRun } from '../core/run.js';
import type { WorkflowContract } from '../workflows/catalog.js';
import type { LaunchInputState, SetupStep, SetupValues } from './launch.js';

export interface FolderEntry {
  path: string;
  name: string;
  isParent: boolean;
  hasBinaflow: boolean;
  error?: string;
}

export type FocusPane = 'workflows' | 'runs' | 'detail';

export type Overlay =
  | 'none'
  | 'welcome'
  | 'about'
  | 'folder-picker'
  | 'folder-confirm'
  | 'setup'
  | 'help'
  | 'recovery-confirm'
  | 'rejection-feedback';

export type DetailMode =
  'empty' | 'diagnosis' | 'launch' | 'live' | 'approval' | 'result' | 'inspect' | 'artifacts';

/** Tags the controller must honor after `reduce` returns. The reducer cannot do I/O. */
export type TuiEffect = 'discover-setup-models' | 'diagnose-cwd';

export interface TuiState {
  cwd: string;
  configPath: string;
  focus: FocusPane;
  overlay: Overlay;
  detail: DetailMode;
  setupStep: SetupStep;
  setupField: number;
  folderPickerPath: string;
  folderPickerOrigin: 'welcome' | 'studio';
  setupValues: SetupValues;
  workflowSelected: number;
  runSelected: number;
  diagnosis?: ConfigurationDiagnosis;
  workflows?: WorkflowContract[];
  runs?: WorkflowRun[];
  setupModels?: AgentModel[];
  activeRunId?: string;
  cancellationRequested: boolean;
  pendingFolderDiagnosis: boolean;
  quitRequested: boolean;
  effect?: TuiEffect;
  error?: string;
  status?: string;
  folderEntries?: FolderEntry[];
  selection: number;
  offset: number;
  inputValue: string;
  launchInput?: LaunchInputState;
  inspection?: RunInspection;
  recovery?: RunRecoveryExplanation;
  clarifications: string[];
  approvalMessage?: string;
  approvalPreviews: ArtifactContentView[];
  approvalPreviewOffset: number;
  artifactSelected: number;
  artifactOffset: number;
  artifactContent?: ArtifactContentView;
  artifactContentOffset: number;
  generated?: GeneratedConfiguration;
  showFullConfig: boolean;
}

export interface TuiModelOptions {
  cwd?: string;
  configPath?: string;
}

export function createInitialTuiState(options: TuiModelOptions = {}): TuiState {
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    configPath: options.configPath ?? '.binaflow/config.json',
    focus: 'workflows',
    overlay: 'welcome',
    detail: 'empty',
    setupStep: 1,
    setupField: 0,
    folderPickerPath: cwd,
    folderPickerOrigin: 'welcome',
    setupValues: {},
    workflowSelected: 0,
    runSelected: 0,
    cancellationRequested: false,
    pendingFolderDiagnosis: false,
    quitRequested: false,
    selection: 0,
    offset: 0,
    inputValue: '',
    clarifications: [],
    approvalPreviews: [],
    approvalPreviewOffset: 0,
    artifactSelected: 0,
    artifactOffset: 0,
    artifactContentOffset: 0,
    showFullConfig: false,
  };
}

export type TuiEvent =
  | { type: 'diagnosed'; diagnosis: ConfigurationDiagnosis }
  | { type: 'use-folder' }
  | { type: 'open-about' }
  | { type: 'close-about' }
  | { type: 'quit' }
  | { type: 'open-folder-picker' }
  | { type: 'folder-picker-back' }
  | { type: 'folder-picker-path'; path: string }
  | { type: 'folder-picker-select' }
  | { type: 'folder-confirm' }
  | { type: 'folder-confirm-back' }
  | { type: 'setup-next' }
  | { type: 'setup-back' }
  | { type: 'setup-cancel' }
  | { type: 'setup-values'; values: SetupValues }
  | { type: 'setup-models'; models: AgentModel[] }
  | { type: 'setup-save' }
  | { type: 'refresh-diagnosis' }
  | { type: 'focus-pane'; pane: FocusPane }
  | { type: 'move'; direction: -1 | 1; visibleRows: number }
  | { type: 'new-run' }
  | { type: 'launch-cancel' }
  | { type: 'launch-set'; input: LaunchInputState }
  | { type: 'launch-input'; value: string }
  | { type: 'launch-edit' }
  | { type: 'launch-confirm' }
  | { type: 'run-started'; runId: string }
  | { type: 'run-finished'; status: RunStatus }
  | { type: 'cancel-requested' }
  | { type: 'open-run'; runId: string; status: RunStatus }
  | { type: 'open-artifacts' }
  | { type: 'open-launch' }
  | { type: 'open-recovery-confirm' }
  | { type: 'open-rejection-feedback' }
  | { type: 'close-detail-prompt' }
  | { type: 'recovery-confirmed' }
  | { type: 'rejection-submitted'; feedback: string }
  | { type: 'resume-run' }
  | { type: 'inspect-back' }
  | { type: 'approval-approve' }
  | { type: 'approval-reject' }
  | { type: 'leave-waiting' }
  | { type: 'open-help' }
  | { type: 'close-help' }
  | { type: 'workflows-loaded'; workflows: WorkflowContract[] }
  | { type: 'runs-loaded'; runs: WorkflowRun[] }
  | { type: 'folder-listed'; entries: FolderEntry[] }
  | {
      type: 'inspection-set';
      inspection: RunInspection;
      recovery?: RunRecoveryExplanation;
      clarifications: string[];
    }
  | { type: 'approval-set'; message: string; previews: ArtifactContentView[] }
  | { type: 'artifact-content-set'; content: ArtifactContentView }
  | { type: 'generated-set'; generated: GeneratedConfiguration }
  | { type: 'setup-toggle-config' }
  | { type: 'setup-retry' }
  | { type: 'setup-submit'; value: string }
  | { type: 'input-change'; value: string }
  | { type: 'error-set'; message: string }
  | { type: 'status-set'; message: string };
