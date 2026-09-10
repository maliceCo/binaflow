import type {
  ConfigurationDiagnosis,
  GeneratedConfiguration,
  TodoFileCandidate,
} from '../application/config-operations.js';
import type { ArtifactContentView } from '../application/operations.js';
import type { RunView } from '../application/run-view.js';
import type { TaskOutcome, TaskQaRound } from '../application/task-outcome.js';
import type { QaDefectDetails, QaHistoryStats } from '../application/qa-history-operations.js';
import type { ReviewView } from '../application/review-operations.js';
import type {
  DocumentPage,
  PreparationConversation,
  PreparationDraft,
  PreparationModel,
  PreparationSelection,
  PreparationSynthesis,
  PreparationStoredView,
} from '../application/preparation.js';
import type { AgentModel } from '../core/agent.js';
import type { QaDefect } from '../core/qa-history.js';
import type { QaFindingSeverity } from '../workflows/plan-build-qa.js';
import type { RunStatus, WorkflowRun } from '../core/run.js';
import type { WorkflowContract } from '../application/operations.js';
import type {
  LaunchInputState,
  SetupProfileName,
  SetupProfileValuesByName,
  SetupStep,
  SetupValues,
} from './launch.js';

export interface FolderEntry {
  path: string;
  name: string;
  isParent: boolean;
  hasBinaflow: boolean;
  error?: string;
}

export function visibleFolderEntries(entries: FolderEntry[], filter: string): FolderEntry[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return entries;
  return entries.filter((entry) => entry.isParent || entry.name.toLowerCase().includes(normalized));
}

export function preparationActionLabels(
  preparation: PreparationConversation | undefined,
  overview: PreparationStoredView | undefined,
  drafts: PreparationDraft[],
): string[] {
  const actions = preparation?.proposal
    ? [
        'Open proposal',
        'Review proposal',
        ...(overview?.review && !overview.review.acknowledged ? ['Acknowledge review'] : []),
        ...(overview?.draft.validProposalId === preparation.proposal.id
          ? ['Approve plan and execute']
          : ['Proposal is stale']),
        'Edit synthesis',
        'Configure agents',
        'Back',
      ]
    : [
        ...(overview?.suggestion ? ['Accept synthesis suggestion'] : []),
        ...(overview?.operation?.recoverable && overview.operation.userMessageId
          ? ['Retry last response']
          : []),
        'Generate proposal',
        'Edit synthesis',
        'Configure agents',
        'Back',
      ];
  return [
    ...actions,
    ...drafts.map((draft) => `Reopen ${draft.id.slice(0, 8)} (${draft.workflowId})`),
  ];
}

export type PreparationSettingRole = 'producer' | 'reviewer' | 'reviewMode';

export function preparationSettingChoices(
  role: PreparationSettingRole,
  models: PreparationModel[],
): string[] {
  if (role === 'reviewMode') return ['human', 'optional-auto', 'required-auto'];
  return models.map((model) => `${model.model} (${model.provider})`);
}

export function preparationSelectionForModel(model: PreparationModel): PreparationSelection {
  return { provider: model.provider, model: model.model };
}

export function serializePreparationSynthesis(synthesis: PreparationSynthesis): string {
  return [
    `objective: ${synthesis.objective}`,
    'agreements:',
    ...synthesis.agreements.map((value) => `- ${value}`),
    'constraints:',
    ...synthesis.constraints.map((value) => `- ${value}`),
    'assumptions:',
    ...synthesis.assumptions.map((value) => `- ${value}`),
    'questions:',
    ...synthesis.questions.map((value) => `- ${value}`),
  ].join('\n');
}

export function parsePreparationSynthesis(value: string): PreparationSynthesis | string {
  const sections = new Map<string, string[]>();
  let section = '';
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const header = /^(objective|agreements|constraints|assumptions|questions):(?:\s*(.*))?$/i.exec(
      trimmed,
    );
    if (header) {
      section = header[1]!.toLowerCase();
      sections.set(section, header[2] ? [header[2].trim()] : []);
      continue;
    }
    if (!section) return 'Synthesis must start with objective:';
    sections.get(section)!.push(trimmed.replace(/^-\s*/, '').trim());
  }
  const objective = sections.get('objective')?.join(' ').trim();
  if (!objective) return 'Synthesis objective must be non-empty.';
  const list = (name: string): string[] => (sections.get(name) ?? []).filter(Boolean);
  return {
    objective,
    agreements: list('agreements'),
    constraints: list('constraints'),
    assumptions: list('assumptions'),
    questions: list('questions'),
  };
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
  | 'empty'
  | 'diagnosis'
  | 'todo-select'
  | 'launch'
  | 'live'
  | 'approval'
  | 'result'
  | 'inspect'
  | 'artifacts'
  | 'bugs'
  | 'review'
  | 'review-thread'
  | 'qa-review'
  | 'preparation'
  | 'proposal'
  | 'qa-report';

export type QaReportFocus = 'rounds' | 'findings' | 'detail';
export type QaSeverityFilter = 'all' | QaFindingSeverity;

export type PreparationFocus = 'editor' | 'actions' | 'synthesis' | 'settings';
export type ReviewFocus = 'editor' | 'actions';

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
  setupProfileSelection: boolean;
  setupProfile: SetupProfileName | undefined;
  setupEditedProfiles: SetupProfileName[];
  editingConfiguration: boolean;
  folderPickerPath: string;
  folderPickerOrigin: 'welcome' | 'studio';
  setupValues: SetupValues;
  setupProfileValues: SetupProfileValuesByName;
  workflowSelected: number;
  workflowOffset: number;
  runSelected: number;
  runOffset: number;
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
  status?: string | undefined;
  folderEntries?: FolderEntry[];
  folderFilter: string;
  selection: number;
  offset: number;
  inputValue: string;
  launchInput?: LaunchInputState;
  todoCandidates?: TodoFileCandidate[];
  runView?: RunView;
  taskOutcome?: TaskOutcome;
  qaRound?: TaskQaRound;
  qaReportOrigin: 'inspect' | 'result';
  qaRoundId?: string;
  qaFindingId?: string;
  qaReportFocus: QaReportFocus;
  qaSeverityFilter: QaSeverityFilter;
  qaDetailOffset: number;
  clarifications: string[];
  approvalPreviews: ArtifactContentView[];
  approvalPreviewOffset: number;
  artifactSelected: number;
  artifactOffset: number;
  artifactContent?: ArtifactContentView;
  artifactPage?: DocumentPage;
  artifactContentOffset: number;
  artifactOrigin: 'inspect' | 'result';
  generated?: GeneratedConfiguration;
  showFullConfig: boolean;
  setupPreviewOffset: number;
  qaDefectSelected: number;
  qaDefectOffset: number;
  qaDefects?: QaDefect[];
  qaHistoryStats?: QaHistoryStats;
  qaDefectDetails?: QaDefectDetails;
  review?: ReviewView;
  reviewThreadId?: string;
  reviewFocus: ReviewFocus;
  reviewSelected: number;
  preparation?: PreparationConversation;
  preparationOverview?: PreparationStoredView;
  preparationDrafts?: PreparationDraft[];
  preparationModels?: PreparationModel[];
  preparationSettingRole?: PreparationSettingRole;
  preparationSynthesisDraft?: PreparationSynthesis;
  preparationWorkflowId?: 'plan-build' | 'plan-build-qa' | 'plan-build-qa-interactive';
  preparationFocus: PreparationFocus;
  preparationSelected: number;
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
    setupProfileSelection: false,
    setupProfile: undefined,
    setupEditedProfiles: [],
    editingConfiguration: false,
    folderPickerPath: cwd,
    folderPickerOrigin: 'welcome',
    setupValues: {},
    setupProfileValues: {},
    workflowSelected: 0,
    workflowOffset: 0,
    runSelected: 0,
    runOffset: 0,
    cancellationRequested: false,
    pendingFolderDiagnosis: false,
    quitRequested: false,
    selection: 0,
    offset: 0,
    inputValue: '',
    folderFilter: '',
    clarifications: [],
    approvalPreviews: [],
    approvalPreviewOffset: 0,
    artifactSelected: 0,
    artifactOffset: 0,
    artifactContentOffset: 0,
    artifactOrigin: 'inspect',
    showFullConfig: false,
    setupPreviewOffset: 0,
    qaDefectSelected: 0,
    qaDefectOffset: 0,
    qaReportOrigin: 'result',
    qaReportFocus: 'findings',
    qaSeverityFilter: 'all',
    qaDetailOffset: 0,
    preparationFocus: 'editor',
    preparationSelected: 0,
    reviewFocus: 'editor',
    reviewSelected: 0,
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
  | { type: 'folder-filter-input'; value: string }
  | { type: 'folder-filter-backspace' }
  | { type: 'folder-picker-select'; path?: string }
  | { type: 'folder-confirm' }
  | { type: 'folder-confirm-back' }
  | { type: 'setup-next' }
  | { type: 'setup-profile-select' }
  | { type: 'open-agent-configuration' }
  | { type: 'setup-back' }
  | { type: 'setup-cancel' }
  | { type: 'setup-models'; models: AgentModel[] }
  | { type: 'setup-save' }
  | { type: 'setup-written' }
  | { type: 'setup-save-failed'; message: string }
  | { type: 'refresh-diagnosis' }
  | { type: 'focus-pane'; pane: FocusPane }
  | { type: 'move'; direction: -1 | 1; visibleRows: number }
  | { type: 'new-run' }
  | { type: 'open-bugs' }
  | { type: 'open-qa-defect'; id: string }
  | { type: 'qa-history-loaded'; defects: QaDefect[]; stats: QaHistoryStats }
  | { type: 'qa-defect-details-set'; details: QaDefectDetails }
  | { type: 'open-review' }
  | { type: 'review-set'; review: ReviewView }
  | { type: 'open-review-thread'; threadId: string }
  | { type: 'review-back' }
  | { type: 'review-message-submit'; content: string }
  | { type: 'review-message-sent'; review: ReviewView }
  | { type: 'review-explain' }
  | { type: 'review-explained'; review: ReviewView }
  | { type: 'review-decide'; decision: 'approve' | 'correct' | 'accept-risk' | 'postpone' }
  | { type: 'review-finalize' }
  | { type: 'review-focus' }
  | {
      type: 'open-preparation';
      workflowId?: 'plan-build' | 'plan-build-qa' | 'plan-build-qa-interactive';
    }
  | { type: 'preparations-loaded'; drafts: PreparationDraft[] }
  | { type: 'preparation-set'; preparation: PreparationConversation }
  | { type: 'preparation-overview-set'; overview: PreparationStoredView }
  | { type: 'preparation-models-set'; models: PreparationModel[] }
  | { type: 'preparation-back' }
  | { type: 'preparation-proposal-open' }
  | { type: 'preparation-proposal-back' }
  | { type: 'preparation-focus' }
  | { type: 'preparation-message-submit'; content: string }
  | {
      type: 'preparation-replied';
      result: import('../application/preparation-operations.js').PreparationReplyResult;
    }
  | { type: 'preparation-approve' }
  | { type: 'preparation-generate-proposal' }
  | { type: 'preparation-accept-synthesis' }
  | { type: 'preparation-retry' }
  | { type: 'preparation-synthesis-edit' }
  | { type: 'preparation-synthesis-save'; synthesis: PreparationSynthesis }
  | { type: 'preparation-settings-open' }
  | { type: 'preparation-setting-select'; index: number }
  | { type: 'preparation-settings-advance' }
  | { type: 'preparation-review-proposal' }
  | { type: 'preparation-ack-review' }
  | { type: 'preparation-open-draft'; draftId: string }
  | { type: 'launch-cancel' }
  | { type: 'todo-files-found'; candidates: TodoFileCandidate[] }
  | { type: 'todo-select' }
  | { type: 'todo-selection-cancel' }
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
  | { type: 'run-view-set'; view: RunView; clarifications: string[] }
  | { type: 'task-outcome-set'; outcome: TaskOutcome }
  | { type: 'open-qa-report' }
  | { type: 'qa-round-select'; roundId: string }
  | { type: 'qa-round-set'; round: TaskQaRound }
  | { type: 'qa-report-focus' }
  | { type: 'qa-filter-cycle' }
  | { type: 'approval-set'; previews: ArtifactContentView[] }
  | { type: 'artifact-content-set'; content: ArtifactContentView }
  | { type: 'artifact-page-set'; page: DocumentPage }
  | { type: 'generated-set'; generated: GeneratedConfiguration }
  | { type: 'setup-toggle-config' }
  | { type: 'setup-retry' }
  | { type: 'setup-choice' }
  | { type: 'setup-submit'; value: string }
  | { type: 'input-change'; value: string }
  | { type: 'error-set'; message: string }
  | { type: 'status-set'; message: string };
