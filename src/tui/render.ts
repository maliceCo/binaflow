import type { AgentProfile } from '../config.js';
import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import {
  formatDurationMs,
  formatTimestamp,
  humanRunStatus,
  humanStepStatus,
} from '../presentation/format.js';
import type {
  ArtifactContentView,
  RunInspection,
  RunRecoveryExplanation,
} from '../application/operations.js';
import type { WorkflowContract } from '../workflows/catalog.js';

export const HOME_ACTIONS = [
  { id: 'new-workflow', label: 'New workflow' },
  { id: 'attention', label: 'Attention-required runs' },
  { id: 'history', label: 'History' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'diagnosis', label: 'Diagnosis' },
] as const;

export type HomeActionId = (typeof HOME_ACTIONS)[number]['id'];

export interface HomeViewModel {
  workspacePath: string;
  configPath: string;
  configExists: boolean;
  configValid: boolean;
  ready: boolean;
  piCommand?: string;
  piCommandLaunchable?: boolean;
  selectedAction: number;
  statusMessage?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface SetupChoiceViewModel {
  configPath: string;
  selected: number;
  statusMessage?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface SetupPromptViewModel {
  title: string;
  explanation: string;
  prompt: string;
  value: string;
  error?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface SetupPreviewViewModel {
  configPath: string;
  configText: string;
  selected: number;
  width: number;
  height: number;
  colors: boolean;
}

export interface WorkflowSelectionViewModel {
  workflows: WorkflowContract[];
  selected: number;
  configuredProfiles: Record<string, AgentProfile>;
  statusMessage?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface WorkflowConfirmationViewModel {
  workflow: WorkflowContract;
  objective: string;
  input: Record<string, unknown>;
  profiles: Record<string, AgentProfile>;
  writeCapable: boolean;
  selected: number;
  error?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface LiveStepViewModel {
  id: string;
  status: StepRun['status'];
}

export interface LiveActivityViewModel {
  type: 'status' | 'text' | 'error';
  stepId: string;
  message: string;
  occurredAt: string;
}

export interface LiveViewModel {
  run: WorkflowRun;
  workflow: WorkflowContract;
  steps: LiveStepViewModel[];
  activity: LiveActivityViewModel[];
  startedAt: string;
  now: string;
  detail: boolean;
  cancellationRequested: boolean;
  notice?: string;
  tokens?: number;
  costUsd?: number;
  width: number;
  height: number;
  colors: boolean;
}

export interface CompletionViewModel {
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: ArtifactReference[];
  startedAt: string;
  finishedAt: string;
  selected: number;
  returnLabel?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface HistoryViewModel {
  runs: WorkflowRun[];
  attentionRuns: WorkflowRun[];
  selected: number;
  statusFilter?: RunStatus;
  workflowFilter?: string;
  attentionOnly: boolean;
  hasNextPage: boolean;
  error?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface RunDetailViewModel {
  inspection: RunInspection;
  recovery: RunRecoveryExplanation;
  clarificationQuestions: string[];
  approvalMessage?: string;
  approvalPreviews?: ArtifactContentView[];
  actions: string[];
  selected: number;
  notice?: string;
  width: number;
  height: number;
  colors: boolean;
}

export interface ArtifactViewModel {
  artifacts: ArtifactReference[];
  selected: number;
  content?: ArtifactContentView;
  width: number;
  height: number;
  colors: boolean;
}

export interface TextPromptViewModel {
  title: string;
  explanation: string;
  prompt: string;
  value: string;
  error?: string;
  width: number;
  height: number;
  colors: boolean;
}

export function renderHome(model: HomeViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();

  const lines = [
    title('Binaflow', model.colors),
    subtitle('Attached workspace shell', model.colors),
    '',
    `${label('Workspace', model.colors)} ${displayText(model.workspacePath)}`,
    `${label('Config', model.colors)}    ${displayText(model.configPath)} ${model.configExists ? '[found]' : '[missing]'}`,
    `${label('Ready', model.colors)}     ${readiness(model)}`,
    '',
    section('Actions', model.colors),
    ...HOME_ACTIONS.map((action, index) => {
      const marker = index === model.selectedAction ? '>' : ' ';
      const suffix = action.id === 'diagnosis' ? '  (refreshes readiness)' : '';
      return `${marker} ${statusMarker(action.id, model)} ${action.label}${suffix}`;
    }),
    '',
    `${label('Status', model.colors)}    ${displayText(model.statusMessage ?? 'Select an action or press r to refresh.')}`,
    '',
    hint('Up/Down or j/k move | Enter select | r refresh | q quit', model.colors),
  ];

  return fitLines(lines, model.width).join('\n');
}

export function renderMinimumSize(): string {
  return [
    'Binaflow',
    'Terminal too small for the workspace shell.',
    'Resize to at least 56 columns x 18 rows.',
    '',
    'Press q to quit.',
  ].join('\n');
}

export function renderSetupChoice(model: SetupChoiceViewModel): string {
  const actions = ['Set up configuration', 'Read documentation', 'Exit'];
  const lines = [
    title('First-run setup', model.colors),
    subtitle('No Binaflow configuration was found.', model.colors),
    '',
    `Configuration target: ${displayText(model.configPath)}`,
    'Setup asks for provider and model names only; credentials stay with the provider.',
    '',
    section('Choose an action', model.colors),
    ...actions.map(
      (action, index) => `${index === model.selected ? '>' : ' '} ${displayText(action)}`,
    ),
    '',
    `${label('Status', model.colors)} ${displayText(model.statusMessage ?? 'Enter selects. q exits.')}`,
    '',
    hint('Up/Down or j/k move | Enter select | q exit', model.colors),
  ];
  return fitLines(lines, model.width).join('\n');
}

export function renderSetupPrompt(model: SetupPromptViewModel): string {
  const lines = [
    title('Binaflow setup', model.colors),
    subtitle(model.title, model.colors),
    '',
    displayText(model.explanation),
    '',
    `${label('Input', model.colors)} ${displayText(model.prompt)}${displayText(model.value)}`,
    ...(model.error ? [`${label('Error', model.colors)} ${displayText(model.error)}`] : []),
    '',
    hint('Enter accepts | Backspace edits | Escape cancels', model.colors),
  ];
  return fitLines(lines, model.width).join('\n');
}

export function renderSetupPreview(model: SetupPreviewViewModel): string {
  const lines = [
    title('Review configuration', model.colors),
    subtitle('Nothing has been written yet.', model.colors),
    '',
    `Target: ${displayText(model.configPath)}`,
    'The planner is read-only. The builder permissions shown below are exactly what will be saved.',
    '',
    ...model.configText.split('\n').map((line) => displayText(line)),
    '',
    `${model.selected === 0 ? '>' : ' '} Write configuration`,
    `${model.selected === 1 ? '>' : ' '} Cancel`,
    '',
    hint('Up/Down or j/k move | Enter select | q cancel', model.colors),
  ];
  return fitLines(lines, model.width).join('\n');
}

export function renderDocumentation(width: number, colors: boolean): string {
  return fitLines(
    [
      title('Binaflow documentation', colors),
      '',
      'Read README.md for the configuration and workflow guide.',
      'Provider credentials and authentication are configured outside Binaflow.',
      'The planner is read-only. A read-write builder may edit files and run shell commands.',
      '',
      hint('Press Enter or q to return home.', colors),
    ],
    width,
  ).join('\n');
}

export function renderExistingConfiguration(
  configPath: string,
  width: number,
  colors: boolean,
): string {
  return fitLines(
    [
      title('Configuration', colors),
      '',
      `Existing configuration: ${displayText(configPath)}`,
      'Binaflow will not overwrite an existing configuration from the TUI.',
      'Edit it outside Binaflow, then press r on the home screen to refresh readiness.',
      '',
      hint('Press Enter or q to return home.', colors),
    ],
    width,
  ).join('\n');
}

export function renderWorkflows(model: WorkflowSelectionViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const stable = model.workflows.filter((workflow) => !workflow.experimental);
  const experimental = model.workflows.filter((workflow) => workflow.experimental);
  const ordered = [...stable, ...experimental];
  const selectedWorkflow = ordered[model.selected];
  const lines = [
    title('New workflow', model.colors),
    subtitle('Choose a workflow, then review its inputs and permissions.', model.colors),
    '',
    section('Stable', model.colors),
    ...(stable.length > 0
      ? stable.map((workflow) => workflowLine(workflow, ordered.indexOf(workflow), model))
      : ['  None']),
    '',
    section('Experimental', model.colors),
    ...(experimental.length > 0
      ? experimental.map((workflow) =>
          workflowLine(workflow, ordered.indexOf(workflow), model, true),
        )
      : ['  None']),
    '',
    ...(selectedWorkflow ? workflowDetails(selectedWorkflow, model) : ['No workflows found.']),
    ...(model.statusMessage
      ? ['', `${label('Status', model.colors)} ${displayText(model.statusMessage)}`]
      : []),
    '',
    hint('Up/Down or j/k move | Enter select | q cancel', model.colors),
  ];
  return fitLines(lines, model.width).join('\n');
}

export function renderWorkflowConfirmation(model: WorkflowConfirmationViewModel): string {
  const profileNames = model.workflow.requiredProfiles;
  const lines = [
    title('Confirm workflow', model.colors),
    subtitle(
      model.workflow.experimental ? 'Experimental workflow' : 'Stable workflow',
      model.colors,
    ),
    '',
    `Workflow: ${displayText(model.workflow.id)}`,
    `Objective: ${displayText(model.objective)}`,
    '',
    section('Profiles', model.colors),
    ...profileNames.flatMap((name) => profileDetails(name, model.profiles[name])),
    '',
    section('Steps', model.colors),
    ...model.workflow.steps.map((step) => {
      const profile = model.profiles[step.profile];
      const capability = profile && isWriteCapable(profile) ? ' [WRITE/SHELL]' : '';
      return `  ${displayText(step.id)}  profile=${displayText(step.profile)}${capability}  outputs=${step.outputs.map((output) => displayText(output.name)).join(', ') || '-'}`;
    }),
    ...additionalInputs(model.input),
    '',
    model.writeCapable
      ? 'WARNING: this workflow can modify workspace files or execute shell commands.'
      : 'This workflow uses read-only workspace permissions.',
    ...(model.error ? ['', `${label('Error', model.colors)} ${displayText(model.error)}`] : []),
    '',
    `${model.selected === 0 ? '>' : ' '} Start workflow${model.writeCapable ? '  (explicit confirmation required)' : ''}`,
    `${model.selected === 1 ? '>' : ' '} Edit objective`,
    `${model.selected === 2 ? '>' : ' '} Cancel`,
    '',
    hint('Up/Down or j/k move | Enter select | q cancel', model.colors),
  ];
  return fitLines(lines, model.width).join('\n');
}

export function renderLive(model: LiveViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const latestAgentMessage = [...model.activity]
    .reverse()
    .find((activity) => activity.type === 'text')?.message;
  const compactActivity = model.activity
    .filter(
      (activity) =>
        activity.type === 'error' ||
        (activity.type === 'status' && /^Pi tool_execution_(?:start|end)/.test(activity.message)),
    )
    .slice(-3);
  const latestErrors = model.activity.filter((activity) => activity.type === 'error').slice(-3);
  const detailedActivity = [
    ...latestErrors,
    ...model.activity.filter((activity) => !latestErrors.includes(activity)),
  ];
  const lines = [
    title('Live workflow', model.colors),
    subtitle(model.detail ? 'Detailed activity' : 'Summary activity', model.colors),
    '',
    `${label('Run', model.colors)} ${shortId(model.run.id)} ${color(`(${model.run.id})`, 'dim', model.colors)}`,
    `${label('Workflow', model.colors)} ${workflowLabel(model.workflow)}`,
    `${label('Status', model.colors)} ${statusValue(model.run.status, model.colors)}`,
    `${label('Elapsed', model.colors)} ${formatDuration(new Date(model.startedAt), new Date(model.now))}`,
    `${label('Usage', model.colors)} ${formatUsage(model.tokens, model.costUsd)}`,
    ...(model.notice ? [`${label('Notice', model.colors)} ${displayText(model.notice)}`] : []),
    '',
    section('Steps', model.colors),
    ...model.steps.map(
      (step) =>
        `  ${stepMarker(step.status)} ${displayText(step.id).padEnd(18)} ${displayText(step.status)} (${humanStepStatus(step.status)})`,
    ),
    '',
    section('Activity', model.colors),
    ...(model.detail
      ? detailedActivity.map((activity) => formatActivity(activity, model.colors))
      : [
          ...compactActivity.map((activity) => formatActivity(activity, model.colors)),
          ...(latestAgentMessage
            ? [`  agent: ${singleLine(latestAgentMessage, Math.max(20, model.width - 10))}`]
            : []),
          ...(compactActivity.length === 0 && !latestAgentMessage
            ? ['  Waiting for agent activity.']
            : []),
        ]),
    ...(model.cancellationRequested
      ? [
          '',
          color(
            'Cancellation requested; waiting for the active agent to stop.',
            'yellow',
            model.colors,
          ),
        ]
      : []),
    '',
    hint(
      model.cancellationRequested
        ? 'q or Ctrl-C again force-cancels | d detailed activity'
        : 'q or Ctrl-C cancel gracefully | d detailed activity',
      model.colors,
    ),
  ];
  return fitViewport(lines, model.width, model.height).join('\n');
}

export function renderCompletion(model: CompletionViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const tokens = totalTokens(model.steps);
  const cost = totalCost(model.steps);
  const completed = model.steps.filter((step) => step.status === 'completed');
  const skipped = model.steps.filter((step) => step.status === 'skipped');
  const semanticArtifacts = model.artifacts
    .filter((artifact) => artifact.stepId !== 'run')
    .map((artifact) => `${displayText(artifact.stepId)}.${displayText(artifact.name)}`);
  const actions = completionActions(model);
  const selected = Math.min(model.selected, actions.length - 1);
  const statusTitle = completionTitle(model.run.status);
  const nextAction = completionNextAction(
    model.run.status,
    model.run.id,
    semanticArtifacts.length > 0,
  );
  const lines = [
    title(statusTitle, model.colors),
    subtitle('Attached execution result', model.colors),
    '',
    `${label('Run', model.colors)} ${shortId(model.run.id)} ${color(`(${model.run.id})`, 'dim', model.colors)}`,
    `Run ${shortId(model.run.id)} finished with status ${humanRunStatus(model.run.status)}.`,
    `${label('Workflow', model.colors)} ${displayText(model.run.workflowId)}${model.run.workflowId === 'research-plan-build' ? ' [Experimental]' : ''}`,
    `${label('Status', model.colors)} ${statusValue(model.run.status, model.colors)}`,
    `${label('Duration', model.colors)} ${formatDuration(new Date(model.startedAt), new Date(model.finishedAt))}`,
    `${label('Usage', model.colors)} ${formatUsage(tokens, cost)}`,
    '',
    section('Steps', model.colors),
    ...(completed.length > 0
      ? completed.map((step) => `  [ok] ${displayText(step.stepId)}`)
      : ['  None completed']),
    ...(skipped.length > 0
      ? skipped.map((step) => `  [-]  ${displayText(step.stepId)}  skipped`)
      : []),
    ...model.steps
      .filter(
        (step) =>
          step.status === 'failed' || step.status === 'cancelled' || step.status === 'interrupted',
      )
      .map(
        (step) =>
          `  [!]  ${displayText(step.stepId)}  ${displayText(step.status)}${step.error ? `: ${displayText(step.error.message)}` : ''}`,
      ),
    '',
    section('Semantic artifacts', model.colors),
    ...(semanticArtifacts.length > 0
      ? semanticArtifacts.map((artifact) => `  ${displayText(artifact)}`)
      : ['  None']),
    '',
    section('Actions', model.colors),
    ...actions.map((action, index) => `${index === selected ? '>' : ' '} ${displayText(action)}`),
    '',
    nextAction,
    '',
    hint('Up/Down or j/k move | Enter select | q return home', model.colors),
  ];
  return fitViewport(lines, model.width, model.height).join('\n');
}

export function renderHistory(model: HistoryViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const filters = `status=${displayText(model.statusFilter ?? 'all')}  workflow=${displayText(model.workflowFilter ?? 'all')}`;
  const lines = [
    title(model.attentionOnly ? 'Attention-required runs' : 'Run history', model.colors),
    subtitle(
      'Persisted metadata only; event and artifact bodies are not loaded here.',
      model.colors,
    ),
    '',
    `${label('Filters', model.colors)} ${filters}`,
    '',
    section('Attention required', model.colors),
    ...(model.attentionRuns.length > 0
      ? model.attentionRuns.map((run, index) => historyLine(run, model, index === model.selected))
      : ['  None']),
    '',
    section(model.attentionOnly ? 'Runs requiring attention' : 'Recent runs', model.colors),
    ...(model.runs.length > 0
      ? model.runs.map((run, index) =>
          historyLine(run, model, index + model.attentionRuns.length === model.selected),
        )
      : ['  No workflow runs found. Start one from New workflow.']),
    ...(model.error ? ['', `${label('Error', model.colors)} ${displayText(model.error)}`] : []),
    ...(model.hasNextPage
      ? ['', 'More runs are available. Press n for the next bounded page.']
      : []),
    '',
    hint(
      'Up/Down or j/k move | s status | w workflow | n next page | Enter open | q back',
      model.colors,
    ),
  ];
  return fitViewport(lines, model.width, model.height).join('\n');
}

export function renderRunDetail(model: RunDetailViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const { run, steps, artifacts, eventCount } = model.inspection;
  const legacy = steps.some((step) => step.status !== 'skipped' && !step.profileSnapshot);
  const completed = steps.filter((step) => step.status === 'completed').map((step) => step.stepId);
  const lines = [
    title('Run detail', model.colors),
    subtitle('Historical inspection and safe recovery actions', model.colors),
    '',
    `${label('Status', model.colors)} ${statusValue(run.status, model.colors)}`,
    `${label('Workflow', model.colors)} ${displayText(run.workflowId)} v${run.workflowVersion}${run.workflowId === 'research-plan-build' ? ' [Experimental]' : ''}`,
    `${label('Objective', model.colors)} ${singleLine(run.objective, Math.max(20, model.width - 12))}`,
    `${label('Created', model.colors)} ${formatTimestamp(run.createdAt)} (${relativeTime(run.createdAt)})`,
    `${label('Updated', model.colors)} ${formatTimestamp(run.updatedAt)}`,
    `${label('Run ID', model.colors)} ${shortId(run.id)} ${color(`(${run.id})`, 'dim', model.colors)}`,
    '',
    section('Actions', model.colors),
    ...model.actions.map(
      (action, index) => `${index === model.selected ? '>' : ' '} ${displayText(action)}`,
    ),
    `${label('Recovery', model.colors)} ${displayText(model.recovery.reason)}`,
    ...(model.notice ? [`${label('Notice', model.colors)} ${displayText(model.notice)}`] : []),
    ...(model.approvalMessage
      ? [
          '',
          section('Experimental approval', model.colors),
          `  ${displayText(model.approvalMessage)}`,
          '  Approval may lead to workspace modifications.',
          ...approvalPreviewLines(model.approvalPreviews ?? [], model.width),
        ]
      : []),
    '',
    section('Artifact references', model.colors),
    ...(artifacts.length > 0
      ? artifacts.map((artifact) => `  ${artifactLabel(artifact)}  ${artifact.sizeBytes} bytes`)
      : ['  None']),
    '',
    section('Execution metadata', model.colors),
    ...(steps.length > 0
      ? steps.flatMap((step) => profileSnapshotLines(step))
      : ['  No step metadata persisted.']),
    ...(legacy ? ['  Execution metadata is unavailable for one or more legacy steps.'] : []),
    '',
    section('Steps and results', model.colors),
    ...(steps.length > 0
      ? steps.flatMap((step) => stepDetailLines(step))
      : ['  No steps persisted.']),
    '',
    `${label('Events', model.colors)} ${eventCount} persisted events (bodies load only in explicit views)`,
    `${label('Artifacts', model.colors)} ${artifacts.length} references (content loads when selected)`,
    ...(completed.length > 0
      ? [
          '',
          `Completed steps are reused during recovery: ${completed.map(displayText).join(', ')}.`,
          'Completed steps are never silently rerun.',
        ]
      : []),
    ...(model.clarificationQuestions.length > 0
      ? [
          '',
          section('Planner clarification', model.colors),
          ...model.clarificationQuestions.map((question) => `  ? ${displayText(question)}`),
          '  Clarification starts a new run with a revised objective.',
        ]
      : []),
    '',
    hint('Up/Down or j/k move | Enter select | q back', model.colors),
  ];
  return fitViewport(lines, model.width, model.height).join('\n');
}

function approvalPreviewLines(previews: ArtifactContentView[], width: number): string[] {
  if (previews.length === 0) return ['  No research/review artifact preview is available.'];
  return previews.flatMap((preview) => {
    const name = `${preview.artifact.stepId}.${preview.artifact.name}`;
    if (preview.error)
      return [
        `  ${displayText(name)}: ERROR ${displayText(preview.error)}`,
        '    Next: return to run detail or inspect the artifact with the CLI.',
      ];
    const content = sanitizeTerminalText(preview.content ?? 'No readable content.').replace(
      /\s+/g,
      ' ',
    );
    const visible = singleLine(content, Math.max(20, width - 8));
    return [
      `  ${displayText(name)} preview: ${visible}`,
      ...(content.length > visible.length || preview.truncated
        ? ['    [bounded preview; use Browse artifacts for full viewing]']
        : []),
    ];
  });
}

export function renderArtifacts(model: ArtifactViewModel): string {
  if (model.width < 56 || model.height < 18) return renderMinimumSize();
  const selected = model.artifacts[model.selected];
  const lines = [
    title('Artifacts', model.colors),
    subtitle('Select an artifact to load a bounded preview.', model.colors),
    '',
    section('References', model.colors),
    ...(model.artifacts.length > 0
      ? model.artifacts.map(
          (artifact, index) =>
            `${index === model.selected ? '>' : ' '} ${artifactLabel(artifact)}  ${artifact.sizeBytes} bytes`,
        )
      : ['  No artifacts recorded.']),
    '',
    ...(selected ? [`Selected: ${artifactLabel(selected)} (${artifactClass(selected)})`] : []),
    ...(model.content
      ? [
          section('Content', model.colors),
          ...(model.content.error
            ? [
                `  ERROR: ${displayText(model.content.error)}`,
                '  Next: press q to return to the run detail and choose another artifact.',
              ]
            : []),
          ...(model.content.content !== undefined
            ? boundedArtifactDisplay(model.content.content)
            : ['  No readable content.']),
          ...(model.content.truncated
            ? ['  [preview truncated; press f for explicit full viewing]']
            : []),
        ]
      : [
          model.artifacts.length > 0
            ? 'Press Enter to load the selected artifact.'
            : 'No artifact content is available. Press q to return.',
        ]),
    '',
    hint('Up/Down or j/k move | Enter preview | f full view | q back', model.colors),
  ];
  return fitViewport(lines, model.width, model.height).join('\n');
}

function boundedArtifactDisplay(content: string): string[] {
  const displayLimit = 8_000;
  const display = sanitizeTerminalText(content.slice(0, displayLimit));
  const lines = display.split(/\r?\n/);
  return [
    ...lines,
    ...(content.length > displayLimit
      ? ['  [full artifact loaded; terminal display limited to 8,000 characters]']
      : []),
  ];
}

export function renderTextPrompt(model: TextPromptViewModel): string {
  return renderSetupPrompt(model);
}

export function sanitizeTerminalText(value: string): string {
  const escape = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  const controlCharacters = new RegExp(
    `[${[...Array.from({ length: 32 }, (_, index) => index), 127]
      .filter((code) => ![9, 10, 13].includes(code))
      .map((code) => String.fromCharCode(code))
      .join('')}\u0080-\u009f]`,
    'g',
  );
  return value
    .replace(new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'g'), '')
    .replace(new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g'), '')
    .replace(controlCharacters, '')
    .replace(/\r/g, '');
}

function displayText(value: unknown): string {
  return sanitizeTerminalText(String(value)).replace(/[\n\t]+/g, ' ');
}

export function relativeTime(value: string, now = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(value).getTime());
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDuration(start: Date, end: Date): string {
  return formatDurationMs(end.getTime() - start.getTime());
}

function statusValue(status: RunStatus, colors: boolean): string {
  const value = displayText(humanRunStatus(status));
  if (status === 'completed') return color(value, 'green', colors);
  if (status === 'failed' || status === 'interrupted') return color(value, 'red', colors);
  if (status === 'cancelled') return color(value, 'yellow', colors);
  return value;
}

function historyLine(run: WorkflowRun, model: HistoryViewModel, selected: boolean): string {
  const workflow = workflowLabelForId(run.workflowId);
  return `${selected ? '>' : ' '} ${statusMarkerForRun(run.status)} ${shortId(run.id).padEnd(10)} ${workflow.padEnd(34)} ${statusValue(run.status, model.colors).padEnd(20)} ${relativeTime(run.updatedAt).padEnd(8)} ${singleLine(run.objective, Math.max(16, model.width - 78))}`;
}

function statusMarkerForRun(status: RunStatus): string {
  if (status === 'completed') return '[ok]';
  if (status === 'failed' || status === 'interrupted') return '[!]';
  if (status === 'cancelled') return '[-]';
  if (status === 'waiting') return '[?]';
  return '[ ]';
}

function profileSnapshotLines(step: StepRun): string[] {
  const profile = step.profileSnapshot;
  if (!profile) return [];
  return [
    `  ${displayText(step.stepId)}: profile=${displayText(step.profile)} driver=${displayText(profile.driver)} provider=${displayText(profile.provider ?? '-')} model=${displayText(profile.model)}`,
    `    workspace=${displayText(profile.workspaceMode)} tools=${profile.tools.map(displayText).join(', ') || '-'} trust=${displayText(profile.projectTrust ?? '-')} timeout=${profile.timeoutMs}ms retry=${profile.retryLimit}`,
  ];
}

function stepDetailLines(step: StepRun): string[] {
  const result = step.result?.text ? singleLine(step.result.text, 140) : '-';
  return [
    `  ${stepMarker(step.status)} ${displayText(step.stepId)}  status=${displayText(step.status)} (${humanStepStatus(step.status)}) attempt=${step.attempt} result=${result}`,
    ...(step.error
      ? [
          `    error=${displayText(step.error.message)} retryable=${step.error.retryable}`,
          `    next=${step.error.retryable ? 'resume this run after inspection' : 'inspect the run with the CLI'}`,
        ]
      : []),
    ...(step.skipReason ? [`    skipped=${displayText(step.skipReason.message)}`] : []),
    ...(step.approval?.decision
      ? [
          `    approval=${displayText(step.approval.decision)}${step.approval.feedback ? ` feedback=${displayText(step.approval.feedback)}` : ''}`,
        ]
      : []),
  ];
}

function artifactLabel(artifact: ArtifactReference): string {
  return `${displayText(artifact.stepId)}.${displayText(artifact.name)} [${artifactClass(artifact)}]`;
}

function artifactClass(artifact: ArtifactReference): 'input' | 'intermediate' | 'final' {
  if (artifact.stepId === 'run') return 'input';
  if (artifact.stepId === 'build' || artifact.name === 'result') return 'final';
  return 'intermediate';
}

function stepMarker(status: StepRun['status']): string {
  if (status === 'completed') return '[ok]';
  if (status === 'skipped') return '[-] ';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return '[!]';
  if (status === 'running') return '[>]';
  return '[ ]';
}

function formatActivity(activity: LiveActivityViewModel, colors: boolean): string {
  const message = sanitizeTerminalText(activity.message).replace(/\s+/g, ' ').trim();
  if (activity.type === 'error')
    return color(`  ERROR [${displayText(activity.stepId)}] ${message}`, 'red', colors);
  if (activity.type === 'text') return `  agent [${displayText(activity.stepId)}]: ${message}`;
  return `  [${displayText(activity.stepId)}] ${friendlyActivity(message)}`;
}

function friendlyActivity(message: string): string {
  return message
    .replace(/^Pi tool_execution_start/, 'tool started')
    .replace(/^Pi tool_execution_end/, 'tool completed')
    .replace(/^Step \S+ /, '');
}

function formatUsage(tokens: number | undefined, costUsd: number | undefined): string {
  const tokenText = tokens === undefined ? '-' : `${tokens} tokens`;
  const costText = costUsd === undefined ? '-' : `$${costUsd.toFixed(4)}`;
  return `${tokenText}  cost=${costText}`;
}

function totalTokens(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.usage?.totalTokens)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

function totalCost(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.costUsd)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

export function moveSelection(selectedAction: number, delta: number): number {
  const count = HOME_ACTIONS.length;
  return (selectedAction + delta + count) % count;
}

function readiness(model: HomeViewModel): string {
  if (model.ready) return color('[ok] ready', 'green', model.colors);
  if (!model.configExists) return color('[!] setup required', 'yellow', model.colors);
  if (!model.configValid) return color('[!] invalid config', 'red', model.colors);
  if (model.piCommand && model.piCommandLaunchable === false) {
    return color('[!] Pi command unavailable', 'red', model.colors);
  }
  return color('[!] attention required', 'yellow', model.colors);
}

function statusMarker(action: HomeActionId, model: HomeViewModel): string {
  if (action === 'diagnosis') return model.ready ? '[ok]' : '[!]';
  if (action === 'configuration' && !model.configExists) return '[!]';
  return '[ ]';
}

function workflowLine(
  workflow: WorkflowContract,
  index: number,
  model: WorkflowSelectionViewModel,
  experimental = false,
): string {
  const missing = workflow.requiredProfiles.filter((profile) => !model.configuredProfiles[profile]);
  const marker = index === model.selected ? '>' : ' ';
  const labelText = experimental ? ' [Experimental]' : '';
  const availability =
    missing.length > 0 ? ` [missing: ${missing.map(displayText).join(', ')}]` : '';
  return `${marker} ${displayText(workflow.id)}${labelText}${availability}`;
}

export function completionActions(
  model: Pick<CompletionViewModel, 'artifacts' | 'returnLabel'>,
): string[] {
  const names = [
    ['plan', 'plan', 'Plan'],
    ['build', 'result', 'Builder result'],
    ['build', 'changes', 'Changes'],
  ] as const;
  const actions = names
    .filter(([stepId, name]) =>
      model.artifacts.some((artifact) => artifact.stepId === stepId && artifact.name === name),
    )
    .map(([, , label]) => label);
  return [...actions, model.returnLabel ?? 'Return home'];
}

function completionTitle(status: RunStatus): string {
  if (status === 'completed') return 'Workflow completed';
  return `Workflow ${humanRunStatus(status).toLowerCase()}`;
}

function completionNextAction(status: RunStatus, runId: string, hasArtifacts: boolean): string {
  if (status === 'failed')
    return `Next: inspect the run with binaflow show ${runId}; resume if retryable.`;
  if (status === 'interrupted')
    return `Next: inspect the run with binaflow show ${runId}; recover only after the process has stopped.`;
  if (status === 'cancelled')
    return `Next: inspect the persisted run with binaflow show ${runId}, or start a new run.`;
  if (status === 'waiting')
    return 'Next: return to the run detail to use the existing approval action.';
  return hasArtifacts
    ? 'Select a semantic artifact to open its bounded preview.'
    : 'No semantic artifacts were persisted. Inspect the run or start a new workflow.';
}

function workflowLabel(workflow: WorkflowContract): string {
  return `${displayText(workflow.id)}${workflow.experimental ? ' [Experimental]' : ''}`;
}

function workflowLabelForId(workflowId: string): string {
  return `${displayText(workflowId)}${workflowId === 'research-plan-build' ? ' [Experimental]' : ''}`;
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function workflowDetails(workflow: WorkflowContract, model: WorkflowSelectionViewModel): string[] {
  const missing = workflow.requiredProfiles.filter((profile) => !model.configuredProfiles[profile]);
  return [
    displayText(workflow.description),
    `Steps: ${workflow.steps.map((step) => displayText(step.id)).join(' -> ')}`,
    `Required profiles: ${workflow.requiredProfiles.map(displayText).join(', ') || '-'}`,
    `Outputs: ${workflow.steps.flatMap((step) => step.outputs.map((output) => `${displayText(step.id)}.${displayText(output.name)}`)).join(', ') || '-'}`,
    missing.length > 0
      ? `Unavailable until profiles are configured: ${missing.map(displayText).join(', ')}`
      : 'Available for launch.',
  ];
}

function profileDetails(name: string, profile: AgentProfile | undefined): string[] {
  if (!profile) return [`  ${displayText(name)}: missing`];
  return [
    `  ${displayText(name)}: provider=${displayText(profile.provider ?? '-')} model=${displayText(profile.model)}`,
    `    workspace=${displayText(profile.workspaceMode)} tools=${profile.tools.map(displayText).join(', ') || '-'} trust=${displayText(profile.projectTrust ?? '-')}`,
  ];
}

function additionalInputs(input: Record<string, unknown>): string[] {
  const entries = Object.entries(input).filter(([name]) => name !== 'objective');
  if (entries.length === 0) return [];
  return [
    '',
    'Additional inputs:',
    ...entries.map(([name, value]) => `  ${displayText(name)}: ${displayText(value)}`),
  ];
}

function isWriteCapable(profile: AgentProfile): boolean {
  return (
    profile.workspaceMode === 'read-write' ||
    profile.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')
  );
}

function title(value: string, colors: boolean): string {
  return color(value, 'cyan', colors);
}

function subtitle(value: string, colors: boolean): string {
  return color(value, 'dim', colors);
}

function section(value: string, colors: boolean): string {
  return color(value, 'blue', colors);
}

function label(value: string, colors: boolean): string {
  return color(`${value}:`.padEnd(10), 'dim', colors);
}

function hint(value: string, colors: boolean): string {
  return color(value, 'dim', colors);
}

function color(
  value: string,
  name: 'blue' | 'cyan' | 'dim' | 'green' | 'red' | 'yellow',
  enabled: boolean,
): string {
  const safeValue = displayText(value);
  if (!enabled) return safeValue;
  const codes = {
    blue: 34,
    cyan: 36,
    dim: 2,
    green: 32,
    red: 31,
    yellow: 33,
  } as const;
  return `\x1b[${codes[name]}m${safeValue}\x1b[0m`;
}

function fitLines(lines: string[], width: number): string[] {
  return lines.map((line) => {
    const plain = stripColor(line);
    if (plain.length <= width) return line;
    return `${plain.slice(0, Math.max(0, width - 3))}...`;
  });
}

function fitViewport(lines: string[], width: number, height: number): string[] {
  const fitted = fitLines(lines, width);
  if (fitted.length <= height) return fitted;
  const footer = fitted.slice(-2);
  const visible = Math.max(1, height - footer.length - 1);
  return [...fitted.slice(0, visible), '...', ...footer];
}

function singleLine(value: string, maxLength: number): string {
  const normalized = sanitizeTerminalText(value).replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
}

function stripColor(value: string): string {
  return [2, 31, 32, 33, 34, 36, 0].reduce(
    (result, code) => result.replaceAll(`\x1b[${code}m`, ''),
    value,
  );
}
