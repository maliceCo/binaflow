import {
  configurationExists,
  diagnoseConfigurationFile,
  generateConfiguration,
  writeConfigurationAtomically,
  type ConfigurationDiagnosis,
  type GeneratedConfiguration,
} from '../application/config-operations.js';
import { openApplicationContext, type ApplicationRuntimeContext } from '../application/runtime.js';
import {
  clarificationQuestions,
  decideApproval,
  explainRunRecovery,
  discoverWorkflows,
  inspectRun,
  listRuns,
  loadResearchApprovalPreviews,
  markRunInterrupted,
  readArtifact,
  resumeWorkflow,
  runWorkflow,
  type ApplicationContext,
  type ArtifactContentView,
  type RunInspection,
  type RunRecoveryExplanation,
} from '../application/operations.js';
import { StringDecoder } from 'node:string_decoder';
import type { NormalizedEvent } from '../core/events.js';
import type { RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { AgentProfile } from '../config.js';
import type { WorkflowContract } from '../workflows/catalog.js';
import {
  HOME_ACTIONS,
  completionActions,
  moveSelection,
  renderDocumentation,
  renderExistingConfiguration,
  renderCompletion,
  renderArtifacts,
  renderHistory,
  renderLive,
  renderRunDetail,
  renderTextPrompt,
  renderHome,
  renderSetupChoice,
  renderSetupPreview,
  renderSetupPrompt,
  renderWorkflowConfirmation,
  renderWorkflows,
  sanitizeTerminalText,
  type HomeViewModel,
  type LiveActivityViewModel,
  type LiveStepViewModel,
} from './render.js';
import { createTerminalSession } from './terminal-session.js';

export interface TuiInput {
  isTTY?: boolean;
  on(event: 'data' | 'end', listener: (chunk?: Buffer) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'data' | 'end', listener: (chunk?: Buffer) => void): this;
  off(event: 'error', listener: (error: unknown) => void): this;
  pause?(): this;
  resume(): this;
  setRawMode?(enabled: boolean): this;
}

export interface TuiOutput {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  on(event: 'resize', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'resize', listener: () => void): this;
  off(event: 'error', listener: (error: unknown) => void): this;
  write(chunk: string): boolean;
}

export interface TuiOptions {
  cwd?: string;
  configPath?: string;
  input?: TuiInput;
  output?: TuiOutput;
  env?: NodeJS.ProcessEnv;
  initialInput?: Record<string, unknown>;
  applicationContext?: ApplicationContext & { close?(): void };
  openApplicationContext?: (configPath: string, cwd: string) => Promise<ApplicationRuntimeContext>;
  forceExit?: (signal: NodeJS.Signals) => void;
}

const MAX_DISPLAYED_ACTIVITY = 200;
const MAX_ACTIVITY_BYTES = 64_000;
const MAX_ACTIVITY_MESSAGE_BYTES = 4_000;
const REDRAW_DELAY_MS = 50;

type Screen =
  | 'home'
  | 'setup-choice'
  | 'setup-prompt'
  | 'setup-preview'
  | 'documentation'
  | 'existing-configuration'
  | 'workflows'
  | 'confirmation'
  | 'live'
  | 'completion'
  | 'history'
  | 'detail'
  | 'artifacts'
  | 'prompt';

interface SetupState {
  field: number;
  values: Partial<SetupAnswers>;
  error?: string;
  generated?: GeneratedConfiguration;
  selected: number;
}

interface SetupAnswers {
  plannerProvider: string;
  plannerModel: string;
  builderProvider: string;
  builderModel: string;
  builderWriteAccess: boolean;
}

interface LaunchState {
  workflow: WorkflowContract;
  values: Record<string, unknown>;
  field: number;
  fields: string[];
  prompting: boolean;
  error?: string;
  selected: number;
  reviewedProfiles: Record<string, string>;
}

interface LiveState {
  run: WorkflowRun;
  workflow: WorkflowContract;
  steps: LiveStepViewModel[];
  activity: LiveActivityViewModel[];
  startedAt: string;
  detail: boolean;
  cancellationRequested: boolean;
  notice?: string;
  tokens?: number;
  costUsd?: number;
}

interface CompletionState {
  run: WorkflowRun;
  steps: StepRun[];
  artifacts: Awaited<ReturnType<typeof inspectRun>>['artifacts'];
  startedAt: string;
  finishedAt: string;
  selected: number;
  returnTo?: 'detail';
  returnLabel?: string;
}

interface HistoryState {
  runs: WorkflowRun[];
  attentionRuns: WorkflowRun[];
  selected: number;
  statusFilter?: RunStatus;
  workflowFilter?: string;
  attentionOnly: boolean;
  cursor?: string;
  nextCursor?: string;
  attentionCursor?: string;
  attentionNextCursor?: string;
  loading: boolean;
  error?: string;
}

interface DetailState {
  inspection: RunInspection;
  recovery: RunRecoveryExplanation;
  clarificationQuestions: string[];
  approvalMessage?: string;
  approvalPreviews?: ArtifactContentView[];
  selected: number;
  notice?: string;
}

interface ArtifactState {
  runId: string;
  artifacts: Awaited<ReturnType<typeof inspectRun>>['artifacts'];
  selected: number;
  returnTo: 'detail' | 'completion';
  content?: ArtifactContentView;
}

interface PromptState {
  kind: 'rejection' | 'clarification' | 'recovery';
  title: string;
  explanation: string;
  prompt: string;
  value: string;
  error?: string;
}

interface TuiModel {
  screen: Screen;
  diagnosis: ConfigurationDiagnosis;
  home: HomeViewModel;
  selectedSetup: number;
  setup?: SetupState;
  workflows: WorkflowContract[];
  selectedWorkflow: number;
  launch?: LaunchState;
  live?: LiveState;
  completion?: CompletionState;
  history?: HistoryState;
  detail?: DetailState;
  artifacts?: ArtifactState;
  prompt?: PromptState;
  width: number;
  height: number;
  colors: boolean;
}

export async function runTui(options: TuiOptions = {}): Promise<void> {
  const input: TuiInput = options.input ?? process.stdin;
  const output: TuiOutput = options.output ?? process.stdout;
  if (input.isTTY !== true || output.isTTY !== true) {
    throw new Error('The TUI requires an interactive terminal');
  }

  const configPath = options.configPath ?? '.binaflow/config.json';
  const cwd = options.cwd ?? process.cwd();
  const diagnosis = await diagnoseConfigurationFile(configPath, cwd);
  const colors = (options.env ?? process.env).NO_COLOR === undefined;
  const model = createModel(diagnosis, colors, output);
  let settled = false;
  let starting = false;
  let activeRunController: AbortController | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let applicationContext: (ApplicationContext & { close?(): void }) | undefined =
    options.applicationContext;
  let ownsApplicationContext = false;
  let activeOperation: Promise<void> | undefined;
  let redrawTimer: NodeJS.Timeout | undefined;
  let elapsedTimer: NodeJS.Timeout | undefined;
  let startupCancellationRequested = false;
  let historyLoadGeneration = 0;
  let terminalSession: ReturnType<typeof createTerminalSession> | undefined;

  return new Promise<void>((resolve, reject) => {
    const redraw = (): void => {
      if (settled) return;
      output.write('\x1b[2J\x1b[H');
      output.write(renderModel(model));
    };

    const requestLiveRedraw = (): void => {
      if (settled || redrawTimer || model.screen !== 'live') return;
      redrawTimer = setTimeout(() => {
        redrawTimer = undefined;
        redraw();
      }, REDRAW_DELAY_MS);
    };

    const stopLiveClock = (): void => {
      if (elapsedTimer) clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    };

    const startLiveClock = (): void => {
      stopLiveClock();
      elapsedTimer = setInterval(requestLiveRedraw, 250);
    };

    const applyDiagnosis = (refreshed: ConfigurationDiagnosis, status?: string): void => {
      model.diagnosis = refreshed;
      model.home = createHomeModel(refreshed, model.colors, output, model.home.selectedAction);
      if (status) model.home.statusMessage = status;
    };

    let refreshPromise: Promise<void> | undefined;
    const requestRefresh = (): void => {
      if (settled || refreshPromise) return;
      refreshPromise = (async (): Promise<void> => {
        try {
          const refreshed = await diagnoseConfigurationFile(configPath, cwd);
          if (settled) return;
          applyDiagnosis(refreshed, 'Readiness refreshed.');
          redraw();
        } catch (error) {
          if (!settled) finish(error);
        } finally {
          refreshPromise = undefined;
        }
      })();
    };

    const goHome = (status?: string): void => {
      stopLiveClock();
      model.screen = 'home';
      delete model.setup;
      delete model.launch;
      delete model.live;
      delete model.completion;
      delete model.history;
      delete model.detail;
      delete model.artifacts;
      delete model.prompt;
      if (status) model.home.statusMessage = status;
      redraw();
    };

    const goToHistory = (): void => {
      model.screen = 'history';
      delete model.detail;
      delete model.artifacts;
      delete model.prompt;
      redraw();
    };

    const ensureContext = async (): Promise<ApplicationContext & { close?(): void }> => {
      if (applicationContext) return applicationContext;
      applicationContext = await (options.openApplicationContext ?? openApplicationContext)(
        configPath,
        cwd,
      );
      ownsApplicationContext = true;
      return applicationContext;
    };

    const loadHistory = async (history: HistoryState): Promise<void> => {
      const requestId = ++historyLoadGeneration;
      history.loading = true;
      delete history.error;
      try {
        const context = await ensureContext();
        const commonQuery = {
          limit: 20,
          ...(history.workflowFilter ? { workflowId: history.workflowFilter } : {}),
        };
        const filteredAttention =
          history.statusFilter !== undefined && !ATTENTION_STATUSES.has(history.statusFilter);
        const page = history.attentionOnly
          ? undefined
          : await listRuns(context, {
              ...commonQuery,
              ...(history.statusFilter ? { status: history.statusFilter } : {}),
              ...(history.cursor ? { cursor: history.cursor } : {}),
            });
        if (page && !settled && requestId === historyLoadGeneration && model.history === history) {
          history.runs = page.runs.filter((run) => !ATTENTION_STATUSES.has(run.status));
          history.selected = Math.min(
            history.selected,
            Math.max(0, historySelectionCount(history) - 1),
          );
          redraw();
        }
        const attentionPage = filteredAttention
          ? { runs: [] }
          : await listRuns(context, {
              ...commonQuery,
              ...(history.statusFilter && ATTENTION_STATUSES.has(history.statusFilter)
                ? { status: history.statusFilter }
                : { statuses: [...ATTENTION_STATUSES] }),
              ...(history.attentionCursor ? { cursor: history.attentionCursor } : {}),
            });
        if (settled || requestId !== historyLoadGeneration || model.history !== history) return;
        history.runs = history.attentionOnly
          ? []
          : page!.runs.filter((run) => !ATTENTION_STATUSES.has(run.status));
        history.attentionRuns = uniqueRuns(
          attentionPage.runs.filter((run) => ATTENTION_STATUSES.has(run.status)),
        ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        if (page?.nextCursor && !history.attentionOnly) history.nextCursor = page.nextCursor;
        else delete history.nextCursor;
        if (attentionPage.nextCursor) history.attentionNextCursor = attentionPage.nextCursor;
        else delete history.attentionNextCursor;
        history.selected = Math.min(
          history.selected,
          Math.max(0, historySelectionCount(history) - 1),
        );
      } catch (error) {
        if (requestId === historyLoadGeneration && model.history === history) {
          history.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (requestId === historyLoadGeneration && model.history === history) {
          history.loading = false;
        }
      }
      if (!settled && requestId === historyLoadGeneration && model.history === history) redraw();
    };

    const openHistory = (attentionOnly: boolean): void => {
      model.history = {
        runs: [],
        attentionRuns: [],
        selected: 0,
        attentionOnly,
        loading: false,
      };
      model.screen = 'history';
      void loadHistory(model.history);
      redraw();
    };

    const openDetail = async (run: WorkflowRun): Promise<void> => {
      try {
        const context = await ensureContext();
        const inspection = await inspectRun(context, run.id, { includeStepResults: true });
        const recovery = await explainRunRecovery(context, run.id);
        const questions = await clarificationQuestions(context, inspection);
        const workflow = discoverWorkflows().find((candidate) => candidate.id === run.workflowId);
        const approvalWaiting = inspection.steps.some(
          (step) => step.stepId === workflow?.approval?.id && step.status === 'waiting',
        );
        const approvalPreviews = approvalWaiting
          ? await loadResearchApprovalPreviews(context, inspection)
          : [];
        model.detail = {
          inspection,
          recovery,
          clarificationQuestions: questions,
          ...(approvalWaiting && workflow?.approval
            ? { approvalMessage: workflow.approval.message }
            : {}),
          ...(approvalPreviews.length > 0 ? { approvalPreviews } : {}),
          selected: 0,
        };
        model.screen = 'detail';
        redraw();
      } catch (error) {
        if (model.history)
          model.history.error = error instanceof Error ? error.message : String(error);
        model.screen = 'history';
        redraw();
      }
    };

    const appendLiveActivity = (live: LiveState, activity: LiveActivityViewModel): void => {
      const previous = live.activity[live.activity.length - 1];
      if (
        activity.type === 'text' &&
        previous?.type === 'text' &&
        previous.stepId === activity.stepId
      ) {
        previous.message = truncateUtf8(
          `${previous.message}${activity.message}`,
          MAX_ACTIVITY_MESSAGE_BYTES,
        );
      } else {
        live.activity.push({
          ...activity,
          message: truncateUtf8(activity.message, MAX_ACTIVITY_MESSAGE_BYTES),
        });
      }
      while (
        live.activity.length > MAX_DISPLAYED_ACTIVITY ||
        activityBytes(live.activity) > MAX_ACTIVITY_BYTES
      ) {
        live.activity.shift();
      }
    };

    const applyLiveEvent = (event: NormalizedEvent): void => {
      const live = model.live;
      if (!live || event.runId !== live.run.id) return;
      const activity: LiveActivityViewModel = {
        stepId: event.stepId,
        type: event.type,
        message: sanitizeTerminalText(event.message),
        occurredAt: event.occurredAt,
      };
      appendLiveActivity(live, activity);
      const step = live.steps.find((candidate) => candidate.id === event.stepId);
      if (step) {
        if (event.type === 'error') step.status = 'failed';
        else if (event.message.includes(' started')) step.status = 'running';
        else if (event.message.includes(' completed')) step.status = 'completed';
        else if (event.message.includes(' skipped')) step.status = 'skipped';
      }
      requestLiveRedraw();
    };

    const startSetup = (): void => {
      model.screen = 'setup-prompt';
      model.setup = { field: 0, values: {}, selected: 0 };
      redraw();
    };

    const startWorkflows = (): void => {
      model.workflows = discoverWorkflows();
      model.selectedWorkflow = 0;
      model.screen = 'workflows';
      delete model.home.statusMessage;
      redraw();
    };

    const selectHomeAction = (): void => {
      const action = HOME_ACTIONS[model.home.selectedAction]?.id;
      if (action === 'new-workflow') {
        if (!model.diagnosis.configExists) model.screen = 'setup-choice';
        else if (!model.diagnosis.configValid) {
          model.home.statusMessage = 'Fix the invalid configuration before starting a workflow.';
        } else startWorkflows();
      } else if (action === 'configuration') {
        model.screen = model.diagnosis.configExists ? 'existing-configuration' : 'setup-choice';
      } else if (action === 'diagnosis') {
        requestRefresh();
        return;
      } else if (action === 'history') {
        openHistory(false);
        return;
      } else if (action === 'attention') {
        openHistory(true);
        return;
      } else {
        model.home.statusMessage = `${action ?? 'Action'} is unavailable.`;
      }
      redraw();
    };

    const selectSetupChoice = (): void => {
      if (model.selectedSetup === 0) startSetup();
      else if (model.selectedSetup === 1) {
        model.screen = 'documentation';
        redraw();
      } else finish();
    };

    const submitSetupPrompt = (value: string): void => {
      const setup = model.setup!;
      const field = setupField(setup.field);
      if (field.kind === 'boolean') {
        const normalized = value.trim().toLowerCase();
        if (
          normalized !== 'y' &&
          normalized !== 'yes' &&
          normalized !== 'n' &&
          normalized !== 'no'
        ) {
          setup.error = 'Answer yes or no.';
          redraw();
          return;
        }
        setup.values.builderWriteAccess = normalized === 'y' || normalized === 'yes';
      } else if (!value.trim()) {
        setup.error = 'A non-empty value is required.';
        redraw();
        return;
      } else {
        setup.values[field.key] = value.trim();
      }
      delete setup.error;
      if (setup.field < SETUP_FIELDS.length - 1) {
        setup.field += 1;
        redraw();
        return;
      }

      try {
        setup.generated = generateConfiguration({
          configPath,
          cwd,
          ...(setup.values as SetupAnswers),
        });
        model.screen = 'setup-preview';
        setup.selected = 0;
      } catch (error) {
        setup.error = error instanceof Error ? error.message : String(error);
      }
      redraw();
    };

    const writeSetup = async (): Promise<void> => {
      const generated = model.setup?.generated;
      if (!generated) return;
      try {
        if (await configurationExists(configPath, cwd)) {
          goHome(
            `Configuration already exists at ${generated.configPath}; nothing was overwritten.`,
          );
          return;
        }
        await writeConfigurationAtomically(generated);
        const refreshed = await diagnoseConfigurationFile(configPath, cwd);
        applyDiagnosis(
          refreshed,
          refreshed.ready
            ? 'Configuration is ready.'
            : 'Configuration written; readiness requires attention.',
        );
        model.screen = 'home';
        delete model.setup;
        redraw();
      } catch (error) {
        model.home.statusMessage = error instanceof Error ? error.message : String(error);
        model.screen = 'home';
        delete model.setup;
        redraw();
      }
    };

    const selectSetupPreview = (): void => {
      if (model.setup?.selected === 0) void writeSetup();
      else goHome('Configuration creation cancelled.');
    };

    const selectWorkflow = (): void => {
      const workflow = orderedWorkflows(model)[model.selectedWorkflow];
      if (!workflow) return;
      const missing = workflow.requiredProfiles.filter(
        (profile) => !configuredProfiles(model.diagnosis)[profile],
      );
      if (!model.diagnosis.configValid || missing.length > 0) {
        model.home.statusMessage = !model.diagnosis.configValid
          ? 'Configuration is invalid; diagnose it before launching.'
          : `Missing profiles: ${missing.join(', ')}`;
        model.screen = 'workflows';
        redraw();
        return;
      }
      const fields = Object.keys(workflow.input.properties);
      const values = { ...(options.initialInput ?? {}) };
      model.launch = {
        workflow,
        values,
        fields,
        field: 0,
        prompting: true,
        selected: 0,
        reviewedProfiles: profileReview(workflow, model.diagnosis),
      };
      model.screen = 'confirmation';
      promptLaunchField(model, options.initialInput);
      redraw();
    };

    const submitLaunchPrompt = (value: string): void => {
      const launch = model.launch!;
      const fieldName = launch.fields[launch.field];
      if (!fieldName) return;
      const property = launch.workflow.input.properties[fieldName];
      const validation = validateInputValue(
        fieldName,
        property,
        value,
        launch.workflow.input.required,
      );
      if (validation) {
        launch.error = validation;
        redraw();
        return;
      }
      if (value.trim()) launch.values[fieldName] = value.trim();
      else delete launch.values[fieldName];
      delete launch.error;
      if (launch.field < launch.fields.length - 1) {
        launch.field += 1;
        redraw();
        return;
      }
      const finalError = validateLaunchInput(launch.workflow, launch.values);
      if (finalError) {
        launch.error = finalError;
        redraw();
        return;
      }
      launch.prompting = false;
      launch.selected = 0;
      redraw();
    };

    const beginLiveRun = (
      startedRun: WorkflowRun,
      workflow: WorkflowContract,
      notice: string,
      previousSteps: StepRun[] = [],
    ): void => {
      model.live = {
        run: startedRun,
        workflow,
        steps: workflow.steps.map((step) => ({
          id: step.id,
          status:
            previousSteps.find((previous) => previous.stepId === step.id)?.status ?? 'pending',
        })),
        activity: [],
        startedAt: startedRun.createdAt,
        detail: false,
        cancellationRequested: false,
        notice,
      };
      model.screen = 'live';
      startLiveClock();
      redraw();
    };

    const startRun = async (): Promise<void> => {
      if (starting || !model.launch) return;
      starting = true;
      startupCancellationRequested = false;
      activeRunController = new AbortController();
      const launch = model.launch;
      let returnedForReview = false;
      let context: (ApplicationContext & { close?(): void }) | undefined;
      try {
        const refreshed = await diagnoseConfigurationFile(configPath, cwd);
        const currentProfiles = profileReview(launch.workflow, refreshed);
        if (
          !refreshed.configValid ||
          !sameProfileReview(launch.reviewedProfiles, currentProfiles)
        ) {
          applyDiagnosis(refreshed);
          launch.error = !refreshed.configValid
            ? 'Configuration changed or became invalid; review it before launching.'
            : 'Profile permissions or settings changed; confirm the workflow again before launching.';
          launch.reviewedProfiles = currentProfiles;
          model.screen = 'confirmation';
          returnedForReview = true;
          redraw();
          return;
        }
        applyDiagnosis(refreshed);
        if (activeRunController.signal.aborted) throw new Error('Workflow startup cancelled.');
        model.home.statusMessage = `Starting ${launch.workflow.id}...`;
        model.screen = 'home';
        redraw();
        context = await ensureContext();
        unsubscribeEvents = context.subscribeEvents?.((event) => {
          applyLiveEvent(event);
          if (event.type === 'status' && event.message.endsWith(' completed')) {
            void refreshLiveUsage(context!, event.runId, () => model.live);
          }
        });
        const objective = launch.values.objective;
        if (typeof objective !== 'string')
          throw new Error('Workflow objective must be a non-empty string');
        const run = await runWorkflow(context, {
          workflowId: launch.workflow.id,
          objective,
          input: { ...launch.values, objective },
          signal: activeRunController.signal,
          onRunStarted: (startedRun) => {
            beginLiveRun(startedRun, launch.workflow, `Starting ${launch.workflow.id}...`);
            delete model.launch;
          },
        });
        model.home.statusMessage = `Run ${run.id} finished with status ${run.status}.`;
        redraw();
        await showCompletion(run, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (model.live) {
          appendLiveActivity(model.live, {
            type: 'error',
            stepId: 'run',
            message: sanitizeTerminalText(message),
            occurredAt: new Date().toISOString(),
          });
          let terminalRun: WorkflowRun = {
            ...model.live.run,
            status: model.live.cancellationRequested ? 'cancelled' : 'failed',
          };
          if (context) {
            try {
              terminalRun = (
                await inspectRun(context, model.live.run.id, { includeStepResults: true })
              ).run;
            } catch {
              // Preserve the in-memory terminal fallback when inspection is unavailable.
            }
          }
          await showCompletion(terminalRun, context);
        } else {
          model.home.statusMessage = message;
        }
      } finally {
        unsubscribeEvents?.();
        unsubscribeEvents = undefined;
        activeRunController = undefined;
        startupCancellationRequested = false;
        if (!returnedForReview) delete model.launch;
        starting = false;
        redraw();
      }
    };

    const showCompletion = async (
      run: WorkflowRun,
      context: (ApplicationContext & { close?(): void }) | undefined,
      returnTo?: 'detail',
    ): Promise<void> => {
      const live = model.live;
      stopLiveClock();
      let persistedUpdatedAt = run.updatedAt;
      let steps: StepRun[] = [];
      let artifacts: CompletionState['artifacts'] = [];
      if (context) {
        try {
          const inspection = await inspectRun(context, run.id, { includeStepResults: true });
          persistedUpdatedAt = inspection.run.updatedAt;
          steps = inspection.steps;
          artifacts = inspection.artifacts;
        } catch {
          // A test or embedders may provide only the execution operation.
        }
      }
      if (steps.length === 0 && live) {
        steps = live.steps.map((step) => ({
          runId: run.id,
          stepId: step.id,
          profile:
            live.workflow.steps.find((candidate) => candidate.id === step.id)?.profile ?? '-',
          status: step.status,
          attempt: 1,
        }));
      }
      model.completion = {
        run,
        steps,
        artifacts,
        startedAt: live?.startedAt ?? run.createdAt,
        finishedAt: persistedUpdatedAt,
        selected: 3,
        ...(returnTo ? { returnTo } : {}),
        ...(returnTo ? { returnLabel: 'Return to run detail' } : {}),
      };
      model.screen = 'completion';
      delete model.live;
      redraw();
    };

    const refreshDetail = async (notice?: string): Promise<void> => {
      const detail = model.detail;
      if (!detail) return;
      try {
        const context = await ensureContext();
        const inspection = await inspectRun(context, detail.inspection.run.id, {
          includeStepResults: true,
        });
        const recovery = await explainRunRecovery(context, inspection.run.id);
        detail.inspection = inspection;
        detail.recovery = recovery;
        detail.clarificationQuestions = await clarificationQuestions(context, inspection);
        const workflow = discoverWorkflows().find(
          (candidate) => candidate.id === inspection.run.workflowId,
        );
        const approvalWaiting = inspection.steps.some(
          (step) => step.stepId === workflow?.approval?.id && step.status === 'waiting',
        );
        if (approvalWaiting && workflow?.approval) {
          detail.approvalMessage = workflow.approval.message;
          detail.approvalPreviews = await loadResearchApprovalPreviews(context, inspection);
        } else {
          delete detail.approvalMessage;
          delete detail.approvalPreviews;
        }
        if (notice) detail.notice = notice;
        else delete detail.notice;
        redraw();
      } catch (error) {
        detail.notice = error instanceof Error ? error.message : String(error);
        redraw();
      }
    };

    const startAttachedContinuation = async (
      operation: (
        context: ApplicationContext,
        signal: AbortSignal,
        onRunStarted: (run: WorkflowRun) => void,
      ) => Promise<WorkflowRun>,
      notice: string,
    ): Promise<void> => {
      const detail = model.detail;
      if (!detail || starting) return;
      starting = true;
      activeRunController = new AbortController();
      let context: (ApplicationContext & { close?(): void }) | undefined;
      try {
        context = await ensureContext();
        const workflow = discoverWorkflows().find(
          (candidate) => candidate.id === detail.inspection.run.workflowId,
        );
        if (!workflow)
          throw new Error(`Workflow ${detail.inspection.run.workflowId} is unavailable.`);
        unsubscribeEvents = context.subscribeEvents?.((event) => {
          applyLiveEvent(event);
          if (event.type === 'status' && event.message.endsWith(' completed')) {
            void refreshLiveUsage(context!, event.runId, () => model.live);
          }
        });
        delete model.prompt;
        const run = await operation(context, activeRunController.signal, (startedRun) => {
          beginLiveRun(startedRun, workflow, notice, detail.inspection.steps);
        });
        await showCompletion(run, context, 'detail');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (model.live) {
          appendLiveActivity(model.live, {
            type: 'error',
            stepId: 'run',
            message: sanitizeTerminalText(message),
            occurredAt: new Date().toISOString(),
          });
          let terminalRun: WorkflowRun = {
            ...model.live.run,
            status: model.live.cancellationRequested ? 'cancelled' : 'failed',
          };
          if (context) {
            try {
              terminalRun = (
                await inspectRun(context, model.live.run.id, { includeStepResults: true })
              ).run;
            } catch {
              // Preserve the in-memory terminal fallback when inspection is unavailable.
            }
          }
          await showCompletion(terminalRun, context, 'detail');
        } else {
          detail.notice = message;
          model.screen = 'detail';
          redraw();
        }
      } finally {
        unsubscribeEvents?.();
        unsubscribeEvents = undefined;
        activeRunController = undefined;
        starting = false;
        redraw();
      }
    };

    const startClarificationRun = (): void => {
      const detail = model.detail;
      if (!detail) return;
      const workflow = discoverWorkflows().find(
        (candidate) => candidate.id === detail.inspection.run.workflowId,
      );
      if (!workflow) {
        detail.notice = `Workflow ${detail.inspection.run.workflowId} is unavailable.`;
        redraw();
        return;
      }
      model.launch = {
        workflow,
        values: { objective: detail.inspection.run.objective },
        fields: Object.keys(workflow.input.properties),
        field: 0,
        prompting: true,
        selected: 0,
        reviewedProfiles: profileReview(workflow, model.diagnosis),
      };
      promptLaunchField(model, { objective: detail.inspection.run.objective });
      model.screen = 'confirmation';
      delete model.detail;
      redraw();
    };

    const selectDetail = async (): Promise<void> => {
      const detail = model.detail;
      if (!detail || !detailActionLabels(detail)[detail.selected]) return;
      const action = detailActionLabels(detail)[detail.selected];
      if (action === 'Back to history') {
        goToHistory();
        return;
      }
      if (action === 'Leave waiting') {
        goToHistory();
        return;
      }
      if (action === 'Mark interrupted and review recovery') {
        model.prompt = {
          kind: 'recovery',
          title: 'Recover interrupted run',
          explanation:
            'Only confirm this if the original attached process has terminated. Running steps will be marked interrupted; completed steps are preserved.',
          prompt: 'Type YES to confirm: ',
          value: '',
        };
        model.screen = 'prompt';
        redraw();
        return;
      }
      if (action === 'Browse artifacts') {
        model.artifacts = {
          runId: detail.inspection.run.id,
          artifacts: detail.inspection.artifacts,
          selected: 0,
          returnTo: 'detail',
        };
        model.screen = 'artifacts';
        redraw();
        return;
      }
      if (action === 'New run with revised objective') {
        startClarificationRun();
        return;
      }
      if (action === 'Resume retryable work') {
        trackActiveOperation(
          startAttachedContinuation(
            async (context, signal, onRunStarted) =>
              (
                await resumeWorkflow(context, {
                  runId: detail.inspection.run.id,
                  signal,
                  onRunStarted,
                })
              ).run,
            'Resuming persisted workflow work...',
          ),
        );
      } else if (action === 'Approve research and continue') {
        trackActiveOperation(
          startAttachedContinuation(
            (context, signal, onRunStarted) =>
              decideApproval(context, {
                runId: detail.inspection.run.id,
                decision: 'approved',
                signal,
                onRunStarted,
              }),
            'Continuing after research approval...',
          ),
        );
      } else if (action === 'Reject research with feedback') {
        model.prompt = {
          kind: 'rejection',
          title: 'Reject research',
          explanation: 'Rejection feedback is persisted and starts another research iteration.',
          prompt: 'Feedback: ',
          value: '',
        };
        model.screen = 'prompt';
        redraw();
      }
    };

    const selectArtifact = async (full: boolean): Promise<void> => {
      const artifacts = model.artifacts;
      if (!artifacts || !artifacts.artifacts[artifacts.selected]) return;
      const selectedArtifact = artifacts.artifacts[artifacts.selected]!;
      const selectedKey = `${selectedArtifact.stepId}.${selectedArtifact.name}`;
      try {
        const context = await ensureContext();
        const content = await readArtifact(context, artifacts.runId, selectedKey, {
          mode: full ? 'full' : 'preview',
        });
        if (
          model.artifacts !== artifacts ||
          `${artifacts.artifacts[artifacts.selected]?.stepId}.${artifacts.artifacts[artifacts.selected]?.name}` !==
            selectedKey
        )
          return;
        artifacts.content = content;
        redraw();
      } catch (error) {
        if (
          model.artifacts !== artifacts ||
          `${artifacts.artifacts[artifacts.selected]?.stepId}.${artifacts.artifacts[artifacts.selected]?.name}` !==
            selectedKey
        )
          return;
        artifacts.content = {
          artifact: selectedArtifact,
          truncated: false,
          formatted: false,
          error: error instanceof Error ? error.message : String(error),
        };
        redraw();
      }
    };

    const submitPrompt = async (value: string): Promise<void> => {
      const prompt = model.prompt;
      const detail = model.detail;
      if (!prompt || !detail) return;
      if (prompt.kind === 'recovery' && value.trim().toLowerCase() !== 'yes') {
        prompt.error = 'Type YES to confirm recovery.';
        redraw();
        return;
      }
      if (prompt.kind !== 'recovery' && !value.trim()) {
        prompt.error =
          prompt.kind === 'rejection'
            ? 'Feedback must be non-empty.'
            : 'Objective must be non-empty.';
        redraw();
        return;
      }
      if (prompt.kind === 'recovery') {
        try {
          const context = await ensureContext();
          await markRunInterrupted(context, detail.inspection.run.id);
          delete model.prompt;
          model.screen = 'detail';
          await refreshDetail('Run marked interrupted. Review recovery before resuming.');
        } catch (error) {
          prompt.error = error instanceof Error ? error.message : String(error);
          redraw();
        }
      } else if (prompt.kind === 'rejection') {
        trackActiveOperation(
          startAttachedContinuation(
            (context, signal, onRunStarted) =>
              decideApproval(context, {
                runId: detail.inspection.run.id,
                decision: 'rejected',
                feedback: value.trim(),
                signal,
                onRunStarted,
              }),
            'Continuing after rejection feedback...',
          ),
        );
      }
    };

    const cancelTextPrompt = (): void => {
      if (model.screen === 'prompt') {
        delete model.prompt;
        model.screen = 'detail';
        redraw();
        return;
      }
      goHome('Cancelled.');
    };

    const selectConfirmation = (): void => {
      const launch = model.launch;
      if (!launch) return;
      if (launch.selected === 0) trackActiveOperation(startRun());
      else if (launch.selected === 1) {
        launch.field = launch.fields.indexOf('objective');
        launch.prompting = true;
        delete launch.error;
        model.screen = 'confirmation';
        redraw();
      } else goHome('Workflow launch cancelled.');
    };

    const trackActiveOperation = (operation: Promise<void>): void => {
      activeOperation = operation;
      void operation.then(
        () => {
          if (activeOperation === operation) activeOperation = undefined;
        },
        () => {
          if (activeOperation === operation) activeOperation = undefined;
        },
      );
    };

    const forceCancel = (signal: NodeJS.Signals): void => {
      process.exitCode = signal === 'SIGTERM' ? 143 : 130;
      const cleanupError = cleanup();
      if (options.forceExit) {
        options.forceExit(signal);
        finish(cleanupError, false);
      } else {
        process.kill(process.pid, signal);
        finish(cleanupError, false);
      }
    };

    const requestCancellation = (signal?: NodeJS.Signals): void => {
      const live = model.live;
      if (live?.cancellationRequested || (starting && startupCancellationRequested)) {
        forceCancel(signal ?? 'SIGINT');
        return;
      }
      if (live) {
        live.cancellationRequested = true;
        live.notice =
          'Cancellation requested. Workflow is still running; waiting for the active agent to stop. Press q or Ctrl-C again to force-cancel.';
      } else if (starting) {
        startupCancellationRequested = true;
        model.home.statusMessage =
          'Workflow is still running; cancellation requested and waiting for the active agent to stop.';
      } else {
        return;
      }
      if (signal) process.exitCode = signal === 'SIGTERM' ? 143 : 130;
      activeRunController?.abort();
      redraw();
    };

    const selectCompletion = (): void => {
      const completion = model.completion;
      if (!completion) return;
      const actions = completionActions(completion);
      const action = actions[Math.min(completion.selected, actions.length - 1)];
      if (action === (completion.returnLabel ?? 'Return home')) {
        if (completion.returnTo === 'detail' && model.detail) {
          delete model.completion;
          model.screen = 'detail';
          void refreshDetail(
            `Run ${completion.run.id} finished with status ${completion.run.status}.`,
          );
        } else {
          goHome(`Run ${completion.run.id} finished with status ${completion.run.status}.`);
        }
        return;
      }
      const semanticNames = new Map([
        ['Plan', { stepId: 'plan', name: 'plan' }],
        ['Builder result', { stepId: 'build', name: 'result' }],
        ['Changes', { stepId: 'build', name: 'changes' }],
      ]);
      const semanticArtifacts = completion.artifacts.filter(
        (artifact) => artifact.stepId !== 'run',
      );
      if (semanticArtifacts.length > 0) {
        const target = action ? semanticNames.get(action) : undefined;
        const selected = target
          ? semanticArtifacts.find(
              (artifact) => artifact.stepId === target.stepId && artifact.name === target.name,
            )
          : undefined;
        model.artifacts = {
          runId: completion.run.id,
          artifacts: completion.artifacts,
          selected: Math.max(0, completion.artifacts.indexOf(selected ?? semanticArtifacts[0]!)),
          returnTo: 'completion',
        };
        model.screen = 'artifacts';
      } else {
        model.home.statusMessage = 'This run has no semantic artifacts to browse.';
      }
      redraw();
    };

    const handleQuit = (): void => {
      if (model.screen === 'live') requestCancellation();
      else if (model.screen === 'completion') {
        const returnTo = model.completion?.returnTo;
        if (returnTo === 'detail' && model.detail) {
          delete model.completion;
          model.screen = 'detail';
          void refreshDetail();
        } else {
          goHome();
        }
      } else if (starting) {
        requestCancellation();
      } else if (model.screen === 'prompt') {
        delete model.prompt;
        model.screen = 'detail';
        redraw();
      } else if (model.screen === 'detail') {
        goToHistory();
      } else if (model.screen === 'artifacts') {
        model.screen = model.artifacts?.returnTo ?? 'detail';
        delete model.artifacts;
        redraw();
      } else if (model.screen === 'history') {
        goHome();
      } else if (model.screen === 'home') finish();
      else goHome('Cancelled.');
    };

    const onData = (chunk?: Buffer): void => {
      try {
        if (model.width < 56 || model.height < 18) {
          for (const key of parseKeys(chunk, keyParser)) {
            if (key === 'interrupt') onSigint();
            else if (key === 'quit') handleQuit();
          }
          return;
        }
        if (isTextPrompt(model.screen) || isLaunchPrompt(model)) {
          handleTextInput(
            chunk,
            model,
            submitSetupPrompt,
            submitLaunchPrompt,
            submitPrompt,
            cancelTextPrompt,
            onSigint,
            redraw,
            textInputState,
          );
          return;
        }
        for (const key of parseKeys(chunk, keyParser)) {
          if (key === 'interrupt') {
            onSigint();
            return;
          }
          if (key === 'quit') {
            handleQuit();
            return;
          }
          if (key === 'detail' && model.screen === 'live') {
            model.live!.detail = !model.live!.detail;
          }
          if (key === 'up' || key === 'down') {
            const delta = key === 'up' ? -1 : 1;
            if (model.screen === 'home')
              model.home.selectedAction = moveSelection(model.home.selectedAction, delta);
            else if (model.screen === 'setup-choice')
              model.selectedSetup = moveBounded(model.selectedSetup, 3, delta);
            else if (model.screen === 'setup-preview')
              model.setup!.selected = moveBounded(model.setup!.selected, 2, delta);
            else if (model.screen === 'workflows') {
              model.selectedWorkflow = moveBounded(
                model.selectedWorkflow,
                orderedWorkflows(model).length,
                delta,
              );
            } else if (model.screen === 'confirmation')
              model.launch!.selected = moveBounded(model.launch!.selected, 3, delta);
            else if (model.screen === 'completion')
              model.completion!.selected = moveBounded(
                model.completion!.selected,
                completionActions(model.completion!).length,
                delta,
              );
            else if (model.screen === 'history')
              model.history!.selected = moveBounded(
                model.history!.selected,
                historySelectionCount(model.history!),
                delta,
              );
            else if (model.screen === 'detail')
              model.detail!.selected = moveBounded(
                model.detail!.selected,
                detailActionLabels(model.detail!).length,
                delta,
              );
            else if (model.screen === 'artifacts') {
              model.artifacts!.selected = moveBounded(
                model.artifacts!.selected,
                model.artifacts!.artifacts.length,
                delta,
              );
              delete model.artifacts!.content;
            }
          } else if (key === 'refresh' && model.screen === 'home') requestRefresh();
          else if (key === 'status-filter' && model.screen === 'history')
            void cycleHistoryStatus(model.history!, loadHistory);
          else if (key === 'workflow-filter' && model.screen === 'history')
            void cycleHistoryWorkflow(model.history!, loadHistory);
          else if (key === 'next-page' && model.screen === 'history') {
            const history = model.history!;
            const attentionSelected =
              history.attentionOnly || history.selected < history.attentionRuns.length;
            const nextCursor = attentionSelected ? history.attentionNextCursor : history.nextCursor;
            if (nextCursor) {
              if (attentionSelected) history.attentionCursor = nextCursor;
              else history.cursor = nextCursor;
              history.selected = 0;
              void loadHistory(history);
            }
          } else if (key === 'full-artifact' && model.screen === 'artifacts')
            void selectArtifact(true);
          else if (key === 'select') {
            if (model.screen === 'home') selectHomeAction();
            else if (model.screen === 'setup-choice') selectSetupChoice();
            else if (model.screen === 'setup-preview') selectSetupPreview();
            else if (model.screen === 'documentation' || model.screen === 'existing-configuration')
              goHome();
            else if (model.screen === 'workflows') selectWorkflow();
            else if (model.screen === 'confirmation' && !isLaunchPrompt(model))
              selectConfirmation();
            else if (model.screen === 'completion') selectCompletion();
            else if (model.screen === 'history') {
              const history = model.history!;
              const openSelected = (attempt = 0): void => {
                const run = selectedHistoryRun(history);
                if (run) void openDetail(run);
                else if (history.loading && attempt < 40)
                  setTimeout(() => openSelected(attempt + 1), 5);
              };
              openSelected();
            } else if (model.screen === 'detail') void selectDetail();
            else if (model.screen === 'artifacts') void selectArtifact(false);
          }
        }
        if (!settled) redraw();
      } catch (error) {
        finish(error);
      }
    };
    const onEnd = (): void => finish();
    const onInputError = (error: unknown): void => finish(error);
    const onOutputError = (error: unknown): void => finish(error);
    const onResize = (): void => {
      model.width = output.columns ?? 80;
      model.height = output.rows ?? 24;
      model.home.width = model.width;
      model.home.height = model.height;
      redraw();
    };
    const onSigint = (): void => {
      process.exitCode = 130;
      if (model.screen === 'live') requestCancellation('SIGINT');
      else if (starting) requestCancellation('SIGINT');
      else finish();
    };
    const onSigterm = (): void => {
      process.exitCode = 143;
      if (model.screen === 'live') requestCancellation('SIGTERM');
      else if (starting) requestCancellation('SIGTERM');
      else finish();
    };

    let cleaned = false;
    const cleanup = (): unknown => {
      if (cleaned) return;
      cleaned = true;
      let cleanupError: unknown;
      const safely = (action: () => void): void => {
        try {
          action();
        } catch (error) {
          cleanupError ??= error;
        }
      };
      if (redrawTimer) clearTimeout(redrawTimer);
      stopLiveClock();
      safely(() => unsubscribeEvents?.());
      unsubscribeEvents = undefined;
      safely(() => {
        if (ownsApplicationContext) applicationContext?.close?.();
        applicationContext = undefined;
      });
      safely(() => {
        cleanupError ??= terminalSession?.cleanup();
        terminalSession = undefined;
      });
      if (textInputState.escapeTimer) clearTimeout(textInputState.escapeTimer);
      return cleanupError;
    };

    let finishing = false;
    const finish = (error?: unknown, waitForActive = true): void => {
      if (settled || finishing) return;
      finishing = true;
      void (async (): Promise<void> => {
        let finalError = error;
        if (waitForActive && activeOperation) {
          activeRunController?.abort();
          try {
            await activeOperation;
          } catch (operationError) {
            finalError ??= operationError;
          }
        }
        settled = true;
        const cleanupError = cleanup();
        if (finalError !== undefined) reject(finalError);
        else if (cleanupError !== undefined) reject(cleanupError);
        else resolve();
      })();
    };

    const keyParser: KeyParserState = { pending: '' };
    const textInputState: TextInputState = {
      decoder: new StringDecoder('utf8'),
      pendingEscape: '',
    };
    try {
      terminalSession = createTerminalSession(input, output, {
        onData,
        onEnd,
        onInputError,
        onOutputError,
        onResize,
        onSigint,
        onSigterm,
      });
      terminalSession.start();
      redraw();
    } catch (error) {
      finish(error);
    }
  });
}

async function refreshLiveUsage(
  context: ApplicationContext,
  runId: string,
  getLive: () => LiveState | undefined,
): Promise<void> {
  try {
    const inspection = await inspectRun(context, runId, { includeStepResults: true });
    const tokens = sumStepTokens(inspection.steps);
    const costUsd = sumStepCosts(inspection.steps);
    // The run may have moved to completion while the inspection was in flight.
    const live = getLive();
    if (!live || live.run.id !== runId) return;
    if (tokens !== undefined) live.tokens = tokens;
    if (costUsd !== undefined) live.costUsd = costUsd;
  } catch {
    // Usage is supplemental; event delivery and run completion remain authoritative.
  }
}

function sumStepTokens(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.usage?.totalTokens)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

function sumStepCosts(steps: StepRun[]): number | undefined {
  const values = steps
    .map((step) => step.result?.costUsd)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

function createModel(
  diagnosis: ConfigurationDiagnosis,
  colors: boolean,
  output: TuiOutput,
): TuiModel {
  const width = output.columns ?? 80;
  const height = output.rows ?? 24;
  return {
    screen: 'home',
    diagnosis,
    home: createHomeModel(diagnosis, colors, output),
    selectedSetup: 0,
    workflows: [],
    selectedWorkflow: 0,
    width,
    height,
    colors,
  };
}

function createHomeModel(
  diagnosis: ConfigurationDiagnosis,
  colors: boolean,
  output: TuiOutput,
  selectedAction = 0,
): HomeViewModel {
  return {
    workspacePath: diagnosis.workspacePath,
    configPath: diagnosis.configPath,
    configExists: diagnosis.configExists,
    configValid: diagnosis.configValid,
    ready: diagnosis.ready,
    ...(diagnosis.piCommand ? { piCommand: diagnosis.piCommand } : {}),
    ...(diagnosis.piCommandLaunchable !== undefined
      ? { piCommandLaunchable: diagnosis.piCommandLaunchable }
      : {}),
    selectedAction,
    width: output.columns ?? 80,
    height: output.rows ?? 24,
    colors,
  };
}

function renderModel(model: TuiModel): string {
  if (model.screen === 'home') return renderHome(model.home);
  if (model.screen === 'setup-choice') {
    return renderSetupChoice({
      configPath: model.diagnosis.configPath,
      selected: model.selectedSetup,
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'documentation') return renderDocumentation(model.width, model.colors);
  if (model.screen === 'existing-configuration') {
    return renderExistingConfiguration(model.diagnosis.configPath, model.width, model.colors);
  }
  if (model.screen === 'setup-prompt') {
    const setup = model.setup!;
    const field = setupField(setup.field);
    return renderSetupPrompt({
      title: field.title,
      explanation: field.explanation,
      prompt: field.prompt,
      value: String(setup.values[field.key] ?? ''),
      ...(setup.error ? { error: setup.error } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'setup-preview') {
    const setup = model.setup!;
    return renderSetupPreview({
      configPath: setup.generated!.configPath,
      configText: JSON.stringify(setup.generated!.config, null, 2),
      selected: setup.selected,
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'workflows') {
    return renderWorkflows({
      workflows: model.workflows,
      selected: model.selectedWorkflow,
      configuredProfiles: configuredProfiles(model.diagnosis),
      ...(model.home.statusMessage ? { statusMessage: model.home.statusMessage } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'live') {
    const live = model.live!;
    return renderLive({
      run: live.run,
      workflow: live.workflow,
      steps: live.steps,
      activity: live.activity,
      startedAt: live.startedAt,
      now: new Date().toISOString(),
      detail: live.detail,
      cancellationRequested: live.cancellationRequested,
      ...(live.notice ? { notice: live.notice } : {}),
      ...(live.tokens !== undefined ? { tokens: live.tokens } : {}),
      ...(live.costUsd !== undefined ? { costUsd: live.costUsd } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'completion') {
    const completion = model.completion!;
    return renderCompletion({
      run: completion.run,
      steps: completion.steps,
      artifacts: completion.artifacts,
      startedAt: completion.startedAt,
      finishedAt: completion.finishedAt,
      selected: completion.selected,
      ...(completion.returnTo ? { returnLabel: 'Return to run detail' } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'history') {
    const history = model.history!;
    return renderHistory({
      runs: history.runs,
      attentionRuns: history.attentionRuns,
      selected: history.selected,
      ...(history.statusFilter ? { statusFilter: history.statusFilter } : {}),
      ...(history.workflowFilter ? { workflowFilter: history.workflowFilter } : {}),
      attentionOnly: history.attentionOnly,
      hasNextPage: history.attentionOnly
        ? history.attentionNextCursor !== undefined
        : history.nextCursor !== undefined || history.attentionNextCursor !== undefined,
      ...(history.error ? { error: history.error } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'detail') {
    const detail = model.detail!;
    return renderRunDetail({
      inspection: detail.inspection,
      recovery: detail.recovery,
      clarificationQuestions: detail.clarificationQuestions,
      ...(detail.approvalMessage ? { approvalMessage: detail.approvalMessage } : {}),
      ...(detail.approvalPreviews ? { approvalPreviews: detail.approvalPreviews } : {}),
      actions: detailActionLabels(detail),
      selected: detail.selected,
      ...(detail.notice ? { notice: detail.notice } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'artifacts') {
    const artifacts = model.artifacts!;
    return renderArtifacts({
      artifacts: artifacts.artifacts,
      selected: artifacts.selected,
      ...(artifacts.content ? { content: artifacts.content } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  if (model.screen === 'prompt') {
    const prompt = model.prompt!;
    return renderTextPrompt({
      title: prompt.title,
      explanation: prompt.explanation,
      prompt: prompt.prompt,
      value: prompt.value,
      ...(prompt.error ? { error: prompt.error } : {}),
      width: model.width,
      height: model.height,
      colors: model.colors,
    });
  }
  const launch = model.launch!;
  const profiles = configuredProfiles(model.diagnosis);
  return isLaunchPrompt(model)
    ? renderSetupPrompt({
        title: `${launch.workflow.id} input`,
        explanation: `Enter the ${launch.workflow.input.required.includes(launch.fields[launch.field] ?? '') ? 'required' : 'optional'} workflow input.`,
        prompt: `${launch.fields[launch.field] ?? 'input'}: `,
        value: String(launch.values[launch.fields[launch.field] ?? ''] ?? ''),
        ...(launch.error ? { error: launch.error } : {}),
        width: model.width,
        height: model.height,
        colors: model.colors,
      })
    : renderWorkflowConfirmation({
        workflow: launch.workflow,
        objective: String(launch.values.objective ?? ''),
        input: launch.values,
        profiles,
        writeCapable: launch.workflow.requiredProfiles.some((name) => {
          const profile = profiles[name];
          return profile ? isWriteCapable(profile) : false;
        }),
        selected: launch.selected,
        ...(launch.error ? { error: launch.error } : {}),
        width: model.width,
        height: model.height,
        colors: model.colors,
      });
}

function isTextPrompt(screen: Screen): boolean {
  return screen === 'setup-prompt' || screen === 'prompt';
}

function isLaunchPrompt(model: TuiModel): boolean {
  return model.screen === 'confirmation' && model.launch?.prompting === true;
}

function handleTextInput(
  chunk: Buffer | undefined,
  model: TuiModel,
  submitSetupPrompt: (value: string) => void,
  submitLaunchPrompt: (value: string) => void,
  submitPrompt: (value: string) => void,
  cancelTextPrompt: () => void,
  onInterrupt: () => void,
  redraw: () => void,
  state: TextInputState,
): void {
  if (state.escapeTimer) clearTimeout(state.escapeTimer);
  state.escapeTimer = undefined;
  const value = state.decoder.write(chunk ?? Buffer.alloc(0));
  const key =
    model.screen === 'setup-prompt'
      ? setupField(model.setup!.field).key
      : model.screen === 'prompt'
        ? 'prompt'
        : model.launch!.fields[model.launch!.field];
  const values =
    model.screen === 'setup-prompt'
      ? (model.setup!.values as Record<string, unknown>)
      : model.screen === 'prompt'
        ? { prompt: model.prompt!.value }
        : model.launch!.values;
  let current = textValue(key === undefined ? undefined : values[key]);
  const acceptCharacter = (character: string): boolean => {
    if (character === '\u0003') {
      onInterrupt();
      return false;
    }
    if (character === '\r' || character === '\n') {
      if (model.screen === 'setup-prompt') submitSetupPrompt(current);
      else if (model.screen === 'prompt') submitPrompt(current);
      else submitLaunchPrompt(current);
      return false;
    }
    if (character === '\u007f' || character === '\b') current = current.slice(0, -1);
    else if (character >= ' ') current += character;
    return true;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (state.pendingEscape) {
      if (state.pendingEscape === '\u001b') {
        if (character === '[' || character === 'O') {
          state.pendingEscape += character;
          continue;
        }
        state.pendingEscape = '';
        cancelTextPrompt();
        return;
      } else {
        if (character >= '@' && character <= '~') state.pendingEscape = '';
        continue;
      }
    }
    if (character === '\u001b') {
      state.pendingEscape = character;
      continue;
    }
    if (model.screen === 'prompt' && character === 'q' && current.length === 0) {
      cancelTextPrompt();
      return;
    }
    if (!acceptCharacter(character)) return;
  }
  if (state.pendingEscape === '\u001b') {
    state.escapeTimer = setTimeout(() => {
      state.escapeTimer = undefined;
      if (state.pendingEscape === '\u001b') {
        state.pendingEscape = '';
        cancelTextPrompt();
      }
    }, 0);
  }
  if (model.screen === 'setup-prompt') {
    const key = setupField(model.setup!.field).key;
    (model.setup!.values as Record<string, unknown>)[key] = current;
    delete model.setup!.error;
  } else if (model.screen === 'prompt') {
    model.prompt!.value = current;
    delete model.prompt!.error;
  } else {
    const field = model.launch!.fields[model.launch!.field];
    if (field) model.launch!.values[field] = current;
    delete model.launch!.error;
  }
  redraw();
}

interface TextInputState {
  decoder: StringDecoder;
  pendingEscape: string;
  escapeTimer?: NodeJS.Timeout | undefined;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function activityBytes(activity: LiveActivityViewModel[]): number {
  return activity.reduce((total, item) => total + Buffer.byteLength(item.message, 'utf8'), 0);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString('utf8');
}

function profileReview(
  workflow: WorkflowContract,
  diagnosis: ConfigurationDiagnosis,
): Record<string, string> {
  const profiles = configuredProfiles(diagnosis);
  return Object.fromEntries(
    workflow.requiredProfiles.map((name) => [name, JSON.stringify(profiles[name] ?? null)]),
  );
}

function sameProfileReview(left: Record<string, string>, right: Record<string, string>): boolean {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].every((name) => left[name] === right[name]);
}

const SETUP_FIELDS = [
  {
    key: 'plannerProvider' as const,
    kind: 'string' as const,
    title: 'Planner provider',
    prompt: 'Provider: ',
    explanation:
      'Enter the provider name manually. Binaflow does not request or store credentials.',
  },
  {
    key: 'plannerModel' as const,
    kind: 'string' as const,
    title: 'Planner model',
    prompt: 'Model: ',
    explanation: 'The planner inspects the repository and is always configured read-only.',
  },
  {
    key: 'builderProvider' as const,
    kind: 'string' as const,
    title: 'Builder provider',
    prompt: 'Provider: ',
    explanation: 'Enter the provider name manually. Authentication remains outside Binaflow.',
  },
  {
    key: 'builderModel' as const,
    kind: 'string' as const,
    title: 'Builder model',
    prompt: 'Model: ',
    explanation:
      'The builder receives the validated plan and can be kept read-only or granted write access.',
  },
  {
    key: 'builderWriteAccess' as const,
    kind: 'boolean' as const,
    title: 'Builder permissions',
    prompt: 'Enable write, edit, shell, and project-trust access? (y/N): ',
    explanation:
      'Read-write access lets the builder modify workspace files and execute shell commands. Choose no for read-only mode.',
  },
] as const;

function setupField(index: number): (typeof SETUP_FIELDS)[number] {
  return SETUP_FIELDS[index] ?? SETUP_FIELDS[0];
}

function orderedWorkflows(model: TuiModel): WorkflowContract[] {
  return [
    ...model.workflows.filter((workflow) => !workflow.experimental),
    ...model.workflows.filter((workflow) => workflow.experimental),
  ];
}

const ATTENTION_STATUSES = new Set<RunStatus>(['running', 'failed', 'interrupted', 'waiting']);
const HISTORY_STATUS_FILTERS: Array<RunStatus | undefined> = [
  undefined,
  'failed',
  'interrupted',
  'waiting',
  'completed',
  'pending',
  'running',
  'cancelled',
];

function detailActionLabels(detail: DetailState): string[] {
  const actions: string[] = [];
  if (detail.recovery.actions?.some((action) => action.kind === 'mark-interrupted')) {
    actions.push('Mark interrupted and review recovery');
  }
  if (detail.recovery.eligible) actions.push('Resume retryable work');
  if (detail.approvalMessage) {
    actions.push('Approve research and continue');
    actions.push('Reject research with feedback');
    actions.push('Leave waiting');
  }
  if (detail.clarificationQuestions.length > 0) actions.push('New run with revised objective');
  actions.push('Browse artifacts', 'Back to history');
  return actions;
}

async function cycleHistoryStatus(
  history: HistoryState,
  load: (state: HistoryState) => Promise<void>,
): Promise<void> {
  const index = HISTORY_STATUS_FILTERS.indexOf(history.statusFilter);
  const next = HISTORY_STATUS_FILTERS[(index + 1) % HISTORY_STATUS_FILTERS.length];
  if (next === undefined) delete history.statusFilter;
  else history.statusFilter = next;
  delete history.cursor;
  delete history.nextCursor;
  delete history.attentionCursor;
  delete history.attentionNextCursor;
  history.selected = 0;
  await load(history);
}

async function cycleHistoryWorkflow(
  history: HistoryState,
  load: (state: HistoryState) => Promise<void>,
): Promise<void> {
  const workflows = [undefined, ...discoverWorkflows().map((workflow) => workflow.id)];
  const index = workflows.indexOf(history.workflowFilter);
  const next = workflows[(index + 1) % workflows.length];
  if (next === undefined) delete history.workflowFilter;
  else history.workflowFilter = next;
  delete history.cursor;
  delete history.nextCursor;
  delete history.attentionCursor;
  delete history.attentionNextCursor;
  history.selected = 0;
  await load(history);
}

function uniqueRuns(runs: WorkflowRun[]): WorkflowRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
}

function historySelectionCount(history: HistoryState): number {
  return history.attentionRuns.length + history.runs.length;
}

function selectedHistoryRun(history: HistoryState): WorkflowRun | undefined {
  if (history.selected < history.attentionRuns.length) {
    return history.attentionRuns[history.selected];
  }
  return history.runs[history.selected - history.attentionRuns.length];
}

function configuredProfiles(diagnosis: ConfigurationDiagnosis): Record<string, AgentProfile> {
  return Object.fromEntries(
    diagnosis.profiles.flatMap((profile) =>
      profile.valid && profile.settings ? [[profile.name, profile.settings]] : [],
    ),
  );
}

function promptLaunchField(model: TuiModel, initialInput?: Record<string, unknown>): void {
  const launch = model.launch!;
  const firstInvalid = launch.fields.findIndex((field) => {
    const property = launch.workflow.input.properties[field];
    const value = initialInput?.[field];
    return validateInputValue(field, property, value, launch.workflow.input.required) !== undefined;
  });
  launch.field = firstInvalid < 0 ? 0 : firstInvalid;
}

function validateLaunchInput(
  workflow: WorkflowContract,
  input: Record<string, unknown>,
): string | undefined {
  for (const name of workflow.input.required) {
    const error = validateInputValue(
      name,
      workflow.input.properties[name],
      input[name],
      workflow.input.required,
    );
    if (error) return error;
  }
  for (const [name, property] of Object.entries(workflow.input.properties)) {
    const error = validateInputValue(name, property, input[name], workflow.input.required);
    if (error) return error;
  }
  return undefined;
}

function validateInputValue(
  name: string,
  property: WorkflowContract['input']['properties'][string] | undefined,
  value: unknown,
  required: string[],
): string | undefined {
  if (value === undefined || (typeof value === 'string' && !value.trim())) {
    return required.includes(name) ? `${name} is required.` : undefined;
  }
  if (!property || property.type !== 'string' || typeof value !== 'string') {
    return `Workflow input ${name} must be a string.`;
  }
  if (property.minLength !== undefined && value.trim().length < property.minLength) {
    return `${name} must be at least ${property.minLength} characters.`;
  }
  return undefined;
}

function isWriteCapable(profile: AgentProfile): boolean {
  return (
    profile.workspaceMode === 'read-write' ||
    profile.tools.some((tool) => tool === 'write' || tool === 'edit' || tool === 'bash')
  );
}

function moveBounded(selected: number, count: number, delta: number): number {
  if (count <= 1) return 0;
  return (selected + delta + count) % count;
}

export interface KeyParserState {
  pending: string;
}

export function parseKeys(
  chunk?: Buffer,
  state: KeyParserState = { pending: '' },
): Array<
  | 'up'
  | 'down'
  | 'select'
  | 'refresh'
  | 'quit'
  | 'interrupt'
  | 'detail'
  | 'status-filter'
  | 'workflow-filter'
  | 'next-page'
  | 'full-artifact'
> {
  const value = state.pending + (chunk?.toString('utf8') ?? '');
  state.pending = '';
  const keys: Array<
    | 'up'
    | 'down'
    | 'select'
    | 'refresh'
    | 'quit'
    | 'interrupt'
    | 'detail'
    | 'status-filter'
    | 'workflow-filter'
    | 'next-page'
    | 'full-artifact'
  > = [];
  for (let index = 0; index < value.length; index += 1) {
    const remaining = value.slice(index);
    if (remaining.startsWith('\x1b[A')) {
      keys.push('up');
      index += 2;
    } else if (remaining.startsWith('\x1b[B')) {
      keys.push('down');
      index += 2;
    } else if (remaining.startsWith('\x1bOA')) {
      keys.push('up');
      index += 2;
    } else if (remaining.startsWith('\x1bOB')) {
      keys.push('down');
      index += 2;
    } else if (remaining === '\x1b' || remaining === '\x1b[' || remaining === '\x1bO') {
      state.pending = remaining;
      break;
    } else if (value[index] === 'k') {
      keys.push('up');
    } else if (value[index] === 'j') {
      keys.push('down');
    } else if (value[index] === 'r') {
      keys.push('refresh');
    } else if (value[index] === 'd') {
      keys.push('detail');
    } else if (value[index] === 's') {
      keys.push('status-filter');
    } else if (value[index] === 'w') {
      keys.push('workflow-filter');
    } else if (value[index] === 'n') {
      keys.push('next-page');
    } else if (value[index] === 'f') {
      keys.push('full-artifact');
    } else if (value[index] === 'q') {
      keys.push('quit');
    } else if (value[index] === '\u0003') {
      keys.push('interrupt');
    } else if (value[index] === '\r' || value[index] === '\n') {
      keys.push('select');
    }
  }
  return keys;
}
