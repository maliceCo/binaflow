import {
  diagnoseConfigurationFile,
  configurationExists,
  generateConfiguration,
  writeConfigurationAtomically,
  type GeneratedConfiguration,
  type ConfigurationDiagnosis,
} from '../application/config-operations.js';
import {
  clarificationQuestions,
  decideApproval,
  discoverWorkflows,
  explainRunRecovery,
  inspectRun,
  listRuns,
  markRunInterrupted,
  readArtifact,
  resumeWorkflow,
  runWorkflow,
  type ApplicationContext,
  type ArtifactContentView,
  type RunInspection,
  type RunRecoveryExplanation,
} from '../application/operations.js';
import { Text, useApp, useInput } from 'ink';
import { formatDurationMs, humanRunStatus, humanStepStatus } from '../core/presentation.js';
import type { RunStatus, WorkflowRun } from '../core/run.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  runInkApplication,
  type InkApplicationContext,
  type InkApplicationOptions,
} from './bootstrap.js';
import {
  MinimumSizeFallback,
  ScreenFrame,
  SelectionList,
  StatusMessage,
  TextPrompt,
  TextViewport,
} from './components.js';
import { moveSelection, scrollText } from './viewport.js';
import {
  configuredProfiles,
  generatedConfigurationPreview,
  isWriteCapable,
  missingProfiles,
  orderedWorkflows,
  profileReview,
  sameProfileReview,
  SETUP_FIELDS,
  setupValuesToGeneration,
  validateSetupValue,
  validateWorkflowValue,
  validateWorkflowValues,
  workflowInputFields,
  workflowPermissionSummary,
  type LaunchInputState,
  type SetupValues,
} from './launch.js';
import {
  appendLiveActivity,
  applyStepSnapshot,
  createLiveState,
  type CompletionState,
  type LiveState,
} from './execution.js';

const HOME_ACTIONS = [
  'New workflow',
  'Read documentation',
  'Refresh diagnosis',
  'Run history',
  'Exit',
];
const MINIMUM_WIDTH = 56;
const MINIMUM_HEIGHT = 12;
type Screen =
  | 'home'
  | 'documentation'
  | 'diagnosis'
  | 'setup-choice'
  | 'setup-input'
  | 'setup-preview'
  | 'workflows'
  | 'launch-input'
  | 'launch-confirmation'
  | 'live'
  | 'completion'
  | 'history'
  | 'detail'
  | 'artifacts'
  | 'approval-feedback';

export interface InkShellOptions extends InkApplicationOptions {
  cwd?: string;
  configPath?: string;
  applicationContext?: (ApplicationContext & { close?(): void }) | undefined;
  openApplicationContext?:
    | ((configPath: string, cwd: string) => Promise<ApplicationContext & { close?(): void }>)
    | undefined;
  forceExit?: (signal: NodeJS.Signals) => void;
}

export async function runInkShell(options: InkShellOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? '.binaflow/config.json';
  let signalHandler: ((signal: NodeJS.Signals) => boolean) | undefined;
  await runInkApplication(
    {
      ...options,
      onSignal: (signal) => signalHandler?.(signal) ?? false,
    },
    (context) => (
      <InkShell
        cwd={cwd}
        configPath={configPath}
        applicationContext={options.applicationContext}
        openApplicationContext={options.openApplicationContext}
        forceExit={options.forceExit}
        registerSignalHandler={(handler) => {
          signalHandler = handler;
          return () => {
            if (signalHandler === handler) signalHandler = undefined;
          };
        }}
        {...context}
      />
    ),
  );
}

interface InkShellProps extends InkApplicationContext {
  cwd: string;
  configPath: string;
  applicationContext?: (ApplicationContext & { close?(): void }) | undefined;
  openApplicationContext?: InkShellOptions['openApplicationContext'] | undefined;
  forceExit?: InkShellOptions['forceExit'];
  registerSignalHandler: (handler: (signal: NodeJS.Signals) => boolean) => () => void;
}

function InkShell({
  colors,
  size,
  cwd,
  configPath,
  applicationContext: providedContext,
  openApplicationContext: openContext,
  forceExit,
  registerSignalHandler,
}: InkShellProps): ReactNode {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('home');
  const [diagnosis, setDiagnosis] = useState<ConfigurationDiagnosis>();
  const [homeSelected, setHomeSelected] = useState(1);
  const [documentOffset, setDocumentOffset] = useState(0);
  const [diagnosisOffset, setDiagnosisOffset] = useState(0);
  const [selection, setSelection] = useState(0);
  const [setupField, setSetupField] = useState(0);
  const [setupValues, setSetupValues] = useState<SetupValues>({});
  const [generated, setGenerated] = useState<GeneratedConfiguration>();
  const [workflows, setWorkflows] = useState(() => discoverWorkflows());
  const [launchInput, setLaunchInput] = useState<LaunchInputState>();
  const [inputValue, setInputValue] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState<string>();
  const [live, setLive] = useState<LiveState>();
  const [completion, setCompletion] = useState<CompletionState>();
  const [liveDetail, setLiveDetail] = useState(false);
  const [liveOffset, setLiveOffset] = useState(0);
  const [historyRuns, setHistoryRuns] = useState<WorkflowRun[]>([]);
  const [historySelected, setHistorySelected] = useState(0);
  const [historyStatus, setHistoryStatus] = useState<RunStatus | undefined>(undefined);
  const [historyWorkflow, setHistoryWorkflow] = useState<string | undefined>(undefined);
  const [historyCursor, setHistoryCursor] = useState<string | undefined>(undefined);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detail, setDetail] = useState<RunInspection>();
  const [recovery, setRecovery] = useState<RunRecoveryExplanation>();
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [artifactSelected, setArtifactSelected] = useState(0);
  const [artifactContent, setArtifactContent] = useState<ArtifactContentView>();
  const [detailPrompt, setDetailPrompt] = useState<'recovery' | 'rejection'>();
  const inputValueRef = useRef('');
  const active = useRef(true);
  const refreshPromise = useRef<Promise<void> | undefined>(undefined);
  const context = useRef(providedContext);
  const activeController = useRef<AbortController | undefined>(undefined);
  const activeRunId = useRef<string | undefined>(undefined);
  const unsubscribeEvents = useRef<(() => void) | undefined>(undefined);
  const liveRef = useRef<LiveState | undefined>(undefined);

  const setLiveValue = (value: LiveState | undefined): void => {
    liveRef.current = value;
    setLive(value);
  };

  const refresh = (): void => {
    if (refreshPromise.current) return;
    setRefreshing(true);
    setError(undefined);
    const promise = diagnoseConfigurationFile(configPath, cwd)
      .then((result) => {
        if (!active.current) return;
        setDiagnosis(result);
        setDiagnosisOffset(0);
      })
      .catch((reason: unknown) => {
        if (active.current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        refreshPromise.current = undefined;
        if (active.current) setRefreshing(false);
      });
    refreshPromise.current = promise;
  };

  useEffect(() => {
    active.current = true;
    refresh();
    return () => {
      active.current = false;
    };
  }, [configPath, cwd]);

  useEffect(() => {
    return () => {
      if (context.current !== providedContext) context.current?.close?.();
    };
  }, [providedContext]);

  const returnHome = (message?: string): void => {
    setScreen('home');
    setSelection(0);
    setError(undefined);
    setStatus(message);
  };

  const setPromptValue = (value: string): void => {
    inputValueRef.current = value;
    setInputValue(value);
  };

  const ensureContext = async (): Promise<ApplicationContext & { close?(): void }> => {
    if (context.current) return context.current;
    const createContext =
      openContext ?? (await import('../application/runtime.js')).openApplicationContext;
    context.current = await createContext(configPath, cwd);
    return context.current;
  };

  const loadHistory = async (
    nextStatus = historyStatus,
    nextWorkflow = historyWorkflow,
    nextCursor = historyCursor,
  ): Promise<void> => {
    setHistoryLoading(true);
    setError(undefined);
    try {
      const application = await ensureContext();
      const page = await listRuns(application, {
        limit: 50,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextWorkflow ? { workflowId: nextWorkflow } : {}),
        ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      setHistoryRuns(page.runs);
      setHistorySelected(0);
      setHistoryCursor(page.nextCursor);
      setHistoryHasNext(page.nextCursor !== undefined);
      setScreen('history');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setHistoryLoading(false);
    }
  };

  const openDetail = async (run: WorkflowRun): Promise<void> => {
    try {
      const application = await ensureContext();
      const inspection = await inspectRun(application, run.id, { includeStepResults: true });
      const explanation = await explainRunRecovery(application, run.id);
      const questions = await clarificationQuestions(application, inspection);
      setDetail(inspection);
      setRecovery(explanation);
      setClarifications(questions);
      setArtifactContent(undefined);
      setArtifactSelected(0);
      setSelection(0);
      setScreen('detail');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const loadArtifact = async (): Promise<void> => {
    const artifact = detail?.artifacts[artifactSelected];
    if (!artifact || !context.current || !detail) return;
    try {
      setArtifactContent(
        await readArtifact(context.current, detail.run.id, `${artifact.stepId}.${artifact.name}`),
      );
    } catch (reason) {
      setArtifactContent({
        artifact,
        truncated: false,
        formatted: false,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

  const startSetup = (): void => {
    setScreen('setup-input');
    setSetupField(0);
    setSetupValues({});
    setPromptValue('');
    setError(undefined);
  };

  const selectHomeAction = (): void => {
    const action = HOME_ACTIONS[homeSelected];
    if (action === 'New workflow') {
      if (!diagnosis?.configExists) {
        setScreen('setup-choice');
        setSelection(0);
      } else if (!diagnosis.configValid)
        setError('Fix the invalid configuration before starting a workflow.');
      else {
        setWorkflows(orderedWorkflows(discoverWorkflows()));
        setSelection(0);
        setScreen('workflows');
      }
    } else if (action === 'Read documentation') setScreen('documentation');
    else if (action === 'Refresh diagnosis') refresh();
    else if (action === 'Run history') void loadHistory();
    else exit();
  };

  const submitSetup = (value: string): void => {
    const field = SETUP_FIELDS[setupField]!;
    const validation = validateSetupValue(field, value);
    if (validation) {
      setError(validation);
      return;
    }
    const next = { ...setupValues, [field.key]: value.trim() };
    setSetupValues(next);
    setError(undefined);
    setPromptValue('');
    if (setupField < SETUP_FIELDS.length - 1) setSetupField((fieldIndex) => fieldIndex + 1);
    else {
      try {
        const answers = setupValuesToGeneration(next);
        setGenerated(generateConfiguration({ configPath, cwd, ...answers }));
        setSelection(0);
        setScreen('setup-preview');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  };

  const writeSetup = async (): Promise<void> => {
    if (!generated) return;
    try {
      if (await configurationExists(configPath, cwd)) {
        returnHome(
          `Configuration already exists at ${generated.configPath}; nothing was overwritten.`,
        );
        return;
      }
      await writeConfigurationAtomically(generated);
      await diagnoseConfigurationFile(configPath, cwd).then((result) => {
        if (active.current) setDiagnosis(result);
      });
      returnHome('Configuration written. Review diagnosis before launching.');
    } catch (reason) {
      returnHome(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const chooseWorkflow = (): void => {
    const workflow = orderedWorkflows(workflows)[selection];
    if (!workflow || !diagnosis) return;
    if (!diagnosis.configValid) {
      setError('Configuration is invalid; diagnose it before launching.');
      return;
    }
    const missing = missingProfiles(workflow, diagnosis);
    if (missing.length > 0) {
      setError(`Missing profiles: ${missing.join(', ')}`);
      return;
    }
    const values: Record<string, string> = {};
    const fields = workflowInputFields(workflow);
    const nextLaunch: LaunchInputState = {
      workflow,
      values,
      field: 0,
      reviewedProfiles: profileReview(workflow, diagnosis),
    };
    setLaunchInput(nextLaunch);
    setPromptValue('');
    setError(undefined);
    setScreen(fields.length > 0 ? 'launch-input' : 'launch-confirmation');
  };

  const submitLaunchInput = (value: string): void => {
    if (!launchInput) return;
    const field = workflowInputFields(launchInput.workflow)[launchInput.field];
    if (!field) {
      setScreen('launch-confirmation');
      return;
    }
    const validation = validateWorkflowValue(launchInput.workflow, field, value);
    if (validation) {
      setError(validation);
      return;
    }
    const values = { ...launchInput.values };
    if (value.trim()) values[field] = value.trim();
    else delete values[field];
    const next = { ...launchInput, values, error: undefined };
    const fields = workflowInputFields(launchInput.workflow);
    setInputValue('');
    if (launchInput.field < fields.length - 1) {
      setLaunchInput({ ...next, field: launchInput.field + 1 });
      setError(undefined);
      return;
    }
    const finalError = validateWorkflowValues(launchInput.workflow, values);
    if (finalError) {
      setError(finalError);
      return;
    }
    setLaunchInput(next);
    setError(undefined);
    setSelection(0);
    setScreen('launch-confirmation');
  };

  const finishRun = async (run: WorkflowRun): Promise<void> => {
    const current = liveRef.current;
    let steps =
      current?.steps.map((step) => ({
        runId: run.id,
        stepId: step.id,
        profile: step.profile,
        status: step.status,
        attempt: 1,
      })) ?? [];
    let artifacts: string[] = [];
    let finishedAt = run.updatedAt;
    if (context.current) {
      try {
        const inspection = await inspectRun(context.current, run.id, { includeStepResults: true });
        steps = inspection.steps;
        artifacts = inspection.artifacts.map((artifact) => `${artifact.stepId}.${artifact.name}`);
        finishedAt = inspection.run.updatedAt;
        run = inspection.run;
      } catch {
        // Completion remains available when an injected context only supports execution.
      }
    }
    setCompletion({
      run,
      steps,
      artifacts,
      startedAt: current?.startedAt ?? run.createdAt,
      finishedAt,
    });
    setLiveValue(undefined);
    setStatus(undefined);
    setSelection(0);
    setScreen('completion');
  };

  const requestCancellation = (signal?: NodeJS.Signals): void => {
    const controller = activeController.current;
    const current = liveRef.current;
    if (!controller || !current) return;
    if (current.cancellationRequested) {
      process.exitCode = signal === 'SIGTERM' ? 143 : 130;
      exit();
      if (forceExit) forceExit(signal ?? 'SIGINT');
      else process.kill(process.pid, signal ?? 'SIGINT');
      return;
    }
    setLiveValue({ ...current, cancellationRequested: true });
    setStatus('Cancellation requested. Workflow is still running; press q again to force-cancel.');
    controller.abort();
  };

  useEffect(() => {
    return registerSignalHandler((signal) => {
      if (!liveRef.current) return false;
      requestCancellation(signal);
      return true;
    });
  }, [registerSignalHandler, forceExit]);

  const startLaunch = async (): Promise<void> => {
    if (!launchInput || !diagnosis || launching) return;
    setLaunching(true);
    const controller = new AbortController();
    activeController.current = controller;
    try {
      const refreshed = await diagnoseConfigurationFile(configPath, cwd);
      const currentReview = profileReview(launchInput.workflow, refreshed);
      if (
        !refreshed.configValid ||
        !sameProfileReview(launchInput.reviewedProfiles, currentReview)
      ) {
        setDiagnosis(refreshed);
        setLaunchInput({ ...launchInput, reviewedProfiles: currentReview });
        setError(
          !refreshed.configValid
            ? 'Configuration changed or became invalid; review it before launching.'
            : 'Profile permissions or settings changed; confirm the workflow again before launching.',
        );
        setScreen('launch-confirmation');
        return;
      }
      if (!context.current) {
        context.current = await ensureContext();
      }
      if (controller.signal.aborted) throw new Error('Workflow startup cancelled.');
      unsubscribeEvents.current = context.current.subscribeEvents?.((event) => {
        if (event.runId !== activeRunId.current) return;
        const current = liveRef.current;
        if (!current) return;
        setLiveValue(appendLiveActivity(current, event));
        void inspectRun(context.current!, event.runId, { includeStepResults: false })
          .then((inspection) => {
            const latest = liveRef.current;
            if (latest?.run.id === event.runId)
              setLiveValue(applyStepSnapshot(latest, inspection.steps));
          })
          .catch(() => undefined);
      });
      const objective = launchInput.values.objective;
      if (!objective) throw new Error('Workflow objective must be a non-empty string');
      setStatus(`Starting ${launchInput.workflow.id}...`);
      const run = await runWorkflow(context.current, {
        workflowId: launchInput.workflow.id,
        objective,
        input: launchInput.values,
        signal: controller.signal,
        onRunStarted: (startedRun) => {
          activeRunId.current = startedRun.id;
          setLiveValue(createLiveState(startedRun, launchInput.workflow));
          setCompletion(undefined);
          setLiveDetail(false);
          setLiveOffset(0);
          setScreen('live');
        },
      });
      await finishRun(run);
    } catch (reason) {
      const current = liveRef.current;
      if (current) {
        await finishRun({
          ...current.run,
          status: current.cancellationRequested ? 'cancelled' : 'failed',
          updatedAt: new Date().toISOString(),
        });
      } else returnHome(reason instanceof Error ? reason.message : String(reason));
    } finally {
      unsubscribeEvents.current?.();
      unsubscribeEvents.current = undefined;
      activeRunId.current = undefined;
      activeController.current = undefined;
      setLaunching(false);
    }
  };

  const startContinuation = async (
    operation: (
      application: ApplicationContext,
      signal: AbortSignal,
      onRunStarted: (run: WorkflowRun) => void,
    ) => Promise<WorkflowRun>,
    workflowId: string,
  ): Promise<void> => {
    if (!detail || launching) return;
    const workflow = discoverWorkflows().find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      setError(`Workflow ${workflowId} is unavailable.`);
      return;
    }
    setLaunching(true);
    const controller = new AbortController();
    activeController.current = controller;
    try {
      const application = await ensureContext();
      unsubscribeEvents.current = application.subscribeEvents?.((event) => {
        if (event.runId !== activeRunId.current) return;
        const current = liveRef.current;
        if (!current) return;
        setLiveValue(appendLiveActivity(current, event));
      });
      const run = await operation(application, controller.signal, (startedRun) => {
        activeRunId.current = startedRun.id;
        setLiveValue(createLiveState(startedRun, workflow, detail.steps));
        setLiveDetail(false);
        setLiveOffset(0);
        setScreen('live');
      });
      await finishRun(run);
    } catch (reason) {
      const current = liveRef.current;
      if (current) {
        await finishRun({
          ...current.run,
          status: current.cancellationRequested ? 'cancelled' : 'failed',
          updatedAt: new Date().toISOString(),
        });
      } else setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      unsubscribeEvents.current?.();
      unsubscribeEvents.current = undefined;
      activeRunId.current = undefined;
      activeController.current = undefined;
      setLaunching(false);
    }
  };

  const submitDetailPrompt = async (value: string): Promise<void> => {
    if (!detail || !detailPrompt || !context.current) return;
    const normalized = value.trim();
    if (detailPrompt === 'recovery') {
      if (normalized.toLowerCase() !== 'yes') {
        setError('Type YES to confirm recovery.');
        return;
      }
      try {
        await markRunInterrupted(context.current, detail.run.id);
        setDetailPrompt(undefined);
        setPromptValue('');
        await openDetail({ ...detail.run, status: 'interrupted' });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return;
    }
    if (!normalized) {
      setError('Feedback must be non-empty.');
      return;
    }
    setDetailPrompt(undefined);
    setPromptValue('');
    void startContinuation(
      (application, signal, onRunStarted) =>
        decideApproval(application, {
          runId: detail.run.id,
          decision: 'rejected',
          feedback: normalized,
          signal,
          onRunStarted,
        }),
      detail.run.workflowId,
    );
  };

  useInput((input, key) => {
    if (input === 'c' && key.ctrl) {
      if (liveRef.current) requestCancellation();
      else exit(130);
      return;
    }

    if (screen === 'live') {
      if (input === 'q' || key.escape) requestCancellation();
      else if (input === 'd') setLiveDetail((detail) => !detail);
      else if (input === 'j' || key.downArrow)
        setLiveOffset((offset) =>
          Math.min(offset + 1, Math.max(0, (live?.activity.length ?? 1) - 1)),
        );
      else if (input === 'k' || key.upArrow) setLiveOffset((offset) => Math.max(0, offset - 1));
      return;
    }

    if (screen === 'completion') {
      if (input === 'q' || key.escape || input === '\r' || key.return) returnHome();
      return;
    }

    if (screen === 'approval-feedback') {
      if (input === 'q' || key.escape) {
        setDetailPrompt(undefined);
        setPromptValue('');
        setScreen('detail');
      } else if (key.backspace) setPromptValue(inputValueRef.current.slice(0, -1));
      else if (input === '\r' || key.return) void submitDetailPrompt(inputValueRef.current);
      else if (input && !key.ctrl && !key.meta) setPromptValue(inputValueRef.current + input);
      return;
    }

    if (screen === 'history') {
      if (input === 'q' || key.escape) returnHome();
      else if (input === 's') {
        const statuses: Array<RunStatus | undefined> = [
          undefined,
          'failed',
          'interrupted',
          'waiting',
          'completed',
          'running',
          'cancelled',
        ];
        const index = statuses.indexOf(historyStatus);
        const nextStatus = statuses[(index + 1) % statuses.length];
        setHistoryStatus(nextStatus);
        setHistoryCursor(undefined);
        void loadHistory(nextStatus, historyWorkflow, undefined);
      } else if (input === 'w') {
        const workflows = [
          undefined,
          ...orderedWorkflows(discoverWorkflows()).map((workflow) => workflow.id),
        ];
        const index = workflows.indexOf(historyWorkflow);
        const nextWorkflow = workflows[(index + 1) % workflows.length];
        setHistoryWorkflow(nextWorkflow);
        setHistoryCursor(undefined);
        void loadHistory(historyStatus, nextWorkflow, undefined);
      } else if (input === 'n' && historyHasNext) {
        void loadHistory(historyStatus, historyWorkflow, historyCursor);
      } else if (input === 'r') void loadHistory();
      else if (input === 'j' || key.downArrow)
        setHistorySelected((selected) => Math.min(historyRuns.length - 1, selected + 1));
      else if (input === 'k' || key.upArrow)
        setHistorySelected((selected) => Math.max(0, selected - 1));
      else if ((input === '\r' || key.return) && historyRuns[historySelected])
        void openDetail(historyRuns[historySelected]!);
      return;
    }

    if (screen === 'detail' && detail) {
      const actions = detailActions(detail, recovery, clarifications);
      if (input === 'q' || key.escape) setScreen('history');
      else if (input === 'j' || key.downArrow)
        setSelection((selected) => Math.min(actions.length - 1, selected + 1));
      else if (input === 'k' || key.upArrow) setSelection((selected) => Math.max(0, selected - 1));
      else if (input === '\r' || key.return) {
        const action = actions[selection];
        if (action === 'Resume retryable work') {
          void startContinuation(
            (application, signal, onRunStarted) =>
              resumeWorkflow(application, { runId: detail.run.id, signal, onRunStarted }).then(
                (result) => result.run,
              ),
            detail.run.workflowId,
          );
        } else if (action === 'Mark interrupted and review recovery') {
          setDetailPrompt('recovery');
          setPromptValue('');
          setError(undefined);
          setScreen('approval-feedback');
        } else if (action === 'Approve research and continue') {
          void startContinuation(
            (application, signal, onRunStarted) =>
              decideApproval(application, {
                runId: detail.run.id,
                decision: 'approved',
                signal,
                onRunStarted,
              }),
            detail.run.workflowId,
          );
        } else if (action === 'Reject research with feedback') {
          setDetailPrompt('rejection');
          setPromptValue('');
          setError(undefined);
          setScreen('approval-feedback');
        } else if (action === 'New run with revised objective') {
          const workflow = discoverWorkflows().find(
            (candidate) => candidate.id === detail.run.workflowId,
          );
          if (workflow && diagnosis) {
            setLaunchInput({
              workflow,
              values: { objective: detail.run.objective },
              field: Math.max(0, workflowInputFields(workflow).indexOf('objective')),
              reviewedProfiles: profileReview(workflow, diagnosis),
            });
            setPromptValue(detail.run.objective);
            setScreen('launch-input');
          }
        } else if (action === 'Browse artifacts') {
          setArtifactSelected(0);
          setArtifactContent(undefined);
          setScreen('artifacts');
        } else setScreen('history');
      }
      return;
    }

    if (screen === 'artifacts' && detail) {
      if (input === 'q' || key.escape) setScreen('detail');
      else if (input === 'j' || key.downArrow)
        setArtifactSelected((selected) => Math.min(detail.artifacts.length - 1, selected + 1));
      else if (input === 'k' || key.upArrow)
        setArtifactSelected((selected) => Math.max(0, selected - 1));
      else if (input === '\r' || key.return) void loadArtifact();
      return;
    }

    if (screen === 'setup-input' || screen === 'launch-input') {
      if (input === 'q' || key.escape) {
        returnHome('Cancelled.');
      } else if (key.backspace) setPromptValue(inputValueRef.current.slice(0, -1));
      else if (input === '\r' || key.return) {
        if (screen === 'setup-input') submitSetup(inputValueRef.current);
        else submitLaunchInput(inputValueRef.current);
      } else if (input && !key.ctrl && !key.meta) setPromptValue(inputValueRef.current + input);
      return;
    }

    if (screen === 'home') {
      if (input === 'q' || key.escape) {
        exit();
      } else if (input === 'j' || key.downArrow) {
        setHomeSelected(
          (selected) => moveSelection({ offset: 0, selected }, 1, HOME_ACTIONS.length, 5).selected,
        );
      } else if (input === 'k' || key.upArrow) {
        setHomeSelected(
          (selected) => moveSelection({ offset: 0, selected }, -1, HOME_ACTIONS.length, 5).selected,
        );
      } else if (input === 'r') refresh();
      else if (input === '\r' || key.return) selectHomeAction();
      return;
    }

    if (
      screen === 'setup-choice' ||
      screen === 'setup-preview' ||
      screen === 'workflows' ||
      screen === 'launch-confirmation'
    ) {
      const items = selectionItems(screen, workflows, generated, launchInput);
      if (input === 'q' || key.escape) returnHome('Cancelled.');
      else if (input === 'j' || key.downArrow)
        setSelection(
          (selected) => moveSelection({ offset: 0, selected }, 1, items.length, 5).selected,
        );
      else if (input === 'k' || key.upArrow)
        setSelection(
          (selected) => moveSelection({ offset: 0, selected }, -1, items.length, 5).selected,
        );
      else if (input === '\r' || key.return) {
        if (screen === 'setup-choice') {
          if (selection === 0) startSetup();
          else if (selection === 1) setScreen('documentation');
          else returnHome('Cancelled.');
        } else if (screen === 'setup-preview') {
          if (selection === 0) void writeSetup();
          else returnHome('Configuration creation cancelled.');
        } else if (screen === 'workflows') chooseWorkflow();
        else if (selection === 0) void startLaunch();
        else if (selection === 1 && launchInput) {
          const objectiveField = workflowInputFields(launchInput.workflow).indexOf('objective');
          setLaunchInput({ ...launchInput, field: Math.max(0, objectiveField) });
          setPromptValue(launchInput.values.objective ?? '');
          setScreen('launch-input');
        } else returnHome('Workflow launch cancelled.');
      }
      return;
    }

    if (input === 'q' || key.escape) {
      setScreen('home');
      return;
    }

    const lines = screen === 'documentation' ? documentationLines : diagnosisLines(diagnosis);
    const visibleRows = Math.max(1, size.rows - 7);
    const setOffset = screen === 'documentation' ? setDocumentOffset : setDiagnosisOffset;
    if (input === 'j' || key.downArrow)
      setOffset((offset) => scrollText(offset, 1, lines.length, visibleRows));
    else if (input === 'k' || key.upArrow)
      setOffset((offset) => scrollText(offset, -1, lines.length, visibleRows));
    else if (key.pageDown)
      setOffset((offset) => scrollText(offset, visibleRows - 1, lines.length, visibleRows));
    else if (key.pageUp)
      setOffset((offset) => scrollText(offset, -(visibleRows - 1), lines.length, visibleRows));
  });

  useEffect(() => {
    if (screen !== 'documentation' && screen !== 'diagnosis') return;
    const lines = screen === 'documentation' ? documentationLines : diagnosisLines(diagnosis);
    const maximum = Math.max(0, lines.length - Math.max(1, size.rows - 7));
    if (screen === 'documentation') setDocumentOffset((offset) => Math.min(offset, maximum));
    else setDiagnosisOffset((offset) => Math.min(offset, maximum));
  }, [diagnosis, screen, size.rows]);

  if (size.columns < MINIMUM_WIDTH || size.rows < MINIMUM_HEIGHT) {
    return <MinimumSizeFallback />;
  }

  if (screen === 'documentation') {
    return (
      <ScreenFrame
        title="Documentation"
        subtitle="Attached Ink shell"
        footer="j/k or arrows scroll | PageUp/PageDown page | q back"
        colors={colors}
      >
        <TextViewport
          lines={documentationLines}
          offset={documentOffset}
          visibleRows={Math.max(1, size.rows - 7)}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'setup-choice') {
    return (
      <SelectionScreen
        title="Setup required"
        description="No configuration was found at the displayed path. Create one to configure the planner and builder."
        items={['Create configuration', 'Read documentation', 'Exit']}
        selected={selection}
        colors={colors}
        footer="j/k move | Enter select | q cancel"
      />
    );
  }

  if (screen === 'setup-input') {
    const field = SETUP_FIELDS[setupField]!;
    return (
      <ScreenFrame
        title="Create configuration"
        subtitle="No credentials are requested"
        status={error}
        footer="Type a value | Enter submit | q cancel"
        colors={colors}
      >
        <Text>{field.title}</Text>
        <TextPrompt
          prompt={
            field.key === 'builderWriteAccess'
              ? 'Enable write/edit/shell/project trust? (yes/no): '
              : '> '
          }
          value={inputValue}
        />
        {field.key === 'builderWriteAccess' ? (
          <Text>Choose no to keep the builder read-only.</Text>
        ) : null}
      </ScreenFrame>
    );
  }

  if (screen === 'setup-preview' && generated) {
    return (
      <ScreenFrame
        title="Review configuration"
        status={error}
        footer="j/k move | Enter select | q cancel"
        colors={colors}
      >
        <TextViewport
          lines={generatedConfigurationPreview(generated).split('\n')}
          offset={0}
          visibleRows={Math.max(1, size.rows - 10)}
        />
        <Text>Nothing has been written yet.</Text>
        <SelectionList
          items={['Write configuration', 'Cancel']}
          selected={selection}
          offset={0}
          visibleRows={2}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'workflows') {
    return (
      <ScreenFrame
        title="Choose workflow"
        status={error}
        footer="j/k move | Enter select | q cancel"
        colors={colors}
      >
        <Text>Stable workflows appear before experimental workflows.</Text>
        <SelectionList
          items={workflowItems(workflows, diagnosis)}
          selected={selection}
          offset={0}
          visibleRows={Math.max(1, size.rows - 10)}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'launch-input' && launchInput) {
    const field = workflowInputFields(launchInput.workflow)[launchInput.field]!;
    return (
      <ScreenFrame
        title={`${launchInput.workflow.id} input`}
        status={error}
        footer="Type a value | Enter submit | q cancel"
        colors={colors}
      >
        <Text>
          {field}
          {launchInput.workflow.input.required.includes(field) ? ' (required)' : ' (optional)'}
        </Text>
        <TextPrompt prompt="> " value={inputValue} />
      </ScreenFrame>
    );
  }

  if (screen === 'launch-confirmation' && launchInput) {
    const profiles = configuredProfiles(diagnosis!);
    const permissionLines = workflowPermissionSummary(launchInput.workflow, diagnosis!);
    const writeWarning = Object.values(profiles).some(isWriteCapable);
    return (
      <ScreenFrame
        title="Confirm workflow"
        status={error ?? (launching ? 'Launching...' : status)}
        footer="j/k move | Enter select | q cancel"
        colors={colors}
      >
        <Text>Workflow: {launchInput.workflow.id}</Text>
        <Text>Objective: {launchInput.values.objective ?? '(missing)'}</Text>
        {launchInput.workflow.experimental ? <Text>Experimental workflow</Text> : null}
        {writeWarning ? <Text>WARNING: this workflow can modify the workspace.</Text> : null}
        {permissionLines.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        <SelectionList
          items={['Confirm and launch', 'Edit objective', 'Cancel']}
          selected={selection}
          offset={0}
          visibleRows={3}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'live' && live) {
    const activityLines = live.activity.map(
      (item) => `[${item.stepId}] ${item.type}: ${item.message}`,
    );
    const visibleRows = Math.max(1, size.rows - 13);
    const displayedActivity = liveDetail ? activityLines : activityLines.slice(-8);
    return (
      <ScreenFrame
        title="Workflow running"
        subtitle="Attached execution"
        status={
          live.cancellationRequested
            ? 'Cancellation requested. Waiting for the active agent to stop.'
            : undefined
        }
        footer="q cancel | Ctrl-C cancel | d toggle activity detail | j/k scroll"
        colors={colors}
      >
        <Text>Run: {live.run.id}</Text>
        <Text>Workflow: {live.workflow.id}</Text>
        <Text>Status: {humanRunStatus(live.run.status)}</Text>
        <Text>
          Elapsed: {formatDurationMs(Math.max(0, Date.now() - Date.parse(live.startedAt)))}
        </Text>
        <Text>Usage: {live.tokens === undefined ? '-' : `${live.tokens} tokens`}</Text>
        <Text>Cost: {live.costUsd === undefined ? '-' : `$${live.costUsd.toFixed(4)}`}</Text>
        <Text>Steps:</Text>
        {live.steps.map((step) => (
          <Text
            key={step.id}
          >{`  ${step.id}  ${humanStepStatus(step.status)}  profile=${step.profile}`}</Text>
        ))}
        <Text>Activity:</Text>
        <TextViewport
          lines={
            displayedActivity.length > 0 ? displayedActivity : ['Waiting for agent activity...']
          }
          offset={liveOffset}
          visibleRows={visibleRows}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'completion' && completion) {
    const duration = Math.max(
      0,
      Date.parse(completion.finishedAt) - Date.parse(completion.startedAt),
    );
    const tokens = completion.steps
      .map((step) => step.result?.usage?.totalTokens)
      .filter((value): value is number => value !== undefined)
      .reduce((total, value) => total + value, 0);
    const costs = completion.steps
      .map((step) => step.result?.costUsd)
      .filter((value): value is number => value !== undefined)
      .reduce((total, value) => total + value, 0);
    return (
      <ScreenFrame
        title="Workflow complete"
        subtitle="Attached execution"
        footer="Enter/q return home"
        colors={colors}
      >
        <Text>Run: {completion.run.id}</Text>
        <Text>Workflow: {completion.run.workflowId}</Text>
        <Text>Status: {humanRunStatus(completion.run.status)}</Text>
        <Text>Duration: {formatDurationMs(duration)}</Text>
        <Text>Usage: {tokens > 0 ? `${tokens} tokens` : '-'}</Text>
        <Text>Cost: {costs > 0 ? `$${costs.toFixed(4)}` : '-'}</Text>
        <Text>Steps:</Text>
        {completion.steps.map((step) => (
          <Text key={`${step.runId}-${step.stepId}`}>
            {`  ${step.stepId}  ${humanStepStatus(step.status)}${step.error ? `  ${step.error.message}` : ''}`}
          </Text>
        ))}
        <Text>Artifacts:</Text>
        <TextViewport
          lines={
            completion.artifacts.length > 0 ? completion.artifacts : ['No artifacts recorded.']
          }
          offset={0}
          visibleRows={Math.max(1, size.rows - 15)}
        />
        <SelectionList items={['Return home']} selected={0} offset={0} visibleRows={1} />
      </ScreenFrame>
    );
  }

  if (screen === 'history') {
    return (
      <ScreenFrame
        title="Run history"
        subtitle="Persisted metadata only; event and artifact bodies are not loaded here."
        status={historyLoading ? 'Loading history...' : error}
        footer="j/k move | s status | w workflow | n next page | Enter open | q back"
        colors={colors}
      >
        <Text>
          Filters: status={historyStatus ?? 'all'} workflow={historyWorkflow ?? 'all'}
        </Text>
        {historyHasNext ? <Text>More runs available. Press n for next page.</Text> : null}
        <SelectionList
          items={historyRuns.map(
            (run) =>
              `${humanRunStatus(run.status)}  ${run.workflowId}  ${run.id}  ${run.objective}`,
          )}
          selected={historySelected}
          offset={0}
          visibleRows={Math.max(1, size.rows - 8)}
        />
        {historyRuns.length === 0 ? <Text>No workflow runs found.</Text> : null}
      </ScreenFrame>
    );
  }

  if (screen === 'detail' && detail) {
    const actions = detailActions(detail, recovery, clarifications);
    return (
      <ScreenFrame
        title="Run detail"
        subtitle="Historical inspection and safe recovery actions"
        status={error}
        footer="j/k move | Enter select | q back"
        colors={colors}
      >
        <Text>Status: {humanRunStatus(detail.run.status)}</Text>
        <Text>
          Workflow: {detail.run.workflowId} v{detail.run.workflowVersion}
        </Text>
        <Text>Objective: {detail.run.objective}</Text>
        <Text>Run ID: {detail.run.id}</Text>
        <Text>Events: {detail.eventCount} persisted events</Text>
        <Text>Recovery: {recovery?.reason ?? 'Loading recovery explanation...'}</Text>
        {clarifications.length > 0 ? (
          <Text>Clarification: {clarifications.join(' | ')}</Text>
        ) : null}
        <Text>Artifacts: {detail.artifacts.length} references</Text>
        <Text>Steps:</Text>
        {detail.steps.map((step) => (
          <Text key={step.stepId}>{`  ${step.stepId}  ${humanStepStatus(step.status)}`}</Text>
        ))}
        <SelectionList
          items={actions}
          selected={selection}
          offset={0}
          visibleRows={Math.max(1, size.rows - 14)}
        />
      </ScreenFrame>
    );
  }

  if (screen === 'artifacts' && detail) {
    const artifactLines = detail.artifacts.map(
      (artifact) => `${artifact.stepId}.${artifact.name}  ${artifact.sizeBytes} bytes`,
    );
    return (
      <ScreenFrame
        title="Artifacts"
        subtitle="Select an artifact to load a bounded preview."
        footer="j/k move | Enter preview | q back"
        colors={colors}
      >
        <SelectionList
          items={artifactLines}
          selected={artifactSelected}
          offset={0}
          visibleRows={Math.max(1, size.rows - 12)}
        />
        {artifactContent ? (
          <TextViewport
            lines={
              artifactContent.error
                ? [`ERROR: ${artifactContent.error}`]
                : (artifactContent.content ?? 'No readable content.').split('\n')
            }
            offset={0}
            visibleRows={Math.max(1, size.rows - 12)}
          />
        ) : (
          <Text>Press Enter to load the selected artifact.</Text>
        )}
      </ScreenFrame>
    );
  }

  if (screen === 'approval-feedback') {
    return (
      <ScreenFrame
        title={detailPrompt === 'recovery' ? 'Recover interrupted run' : 'Reject research'}
        status={error}
        footer="Type a value | Enter submit | q cancel"
        colors={colors}
      >
        <Text>{detailPrompt === 'recovery' ? 'Type YES to confirm recovery:' : 'Feedback:'}</Text>
        <TextPrompt prompt="> " value={inputValue} />
      </ScreenFrame>
    );
  }

  if (screen === 'diagnosis') {
    const lines = diagnosisLines(diagnosis);
    return (
      <ScreenFrame
        title="Diagnosis"
        subtitle="Configuration readiness"
        status={refreshing ? 'refreshing diagnosis...' : (error ?? '')}
        footer="j/k or arrows scroll | PageUp/PageDown page | r refresh | q back"
        colors={colors}
      >
        <TextViewport
          lines={lines}
          offset={diagnosisOffset}
          visibleRows={Math.max(1, size.rows - 7)}
        />
        {error ? <StatusMessage message={error} error /> : null}
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      title="Binaflow"
      subtitle="Attached Ink shell"
      status={status ?? error ?? (refreshing ? 'loading diagnosis...' : readiness(diagnosis))}
      footer="j/k or arrows move | Enter select | r refresh | q quit"
      colors={colors}
    >
      <TextViewport lines={homeLines(diagnosis)} offset={0} visibleRows={3} />
      <SelectionList items={HOME_ACTIONS} selected={homeSelected} offset={0} visibleRows={5} />
    </ScreenFrame>
  );
}

const documentationLines = [
  'Binaflow is a local workflow orchestrator for coding agents.',
  'The TUI is attached to the current terminal process.',
  'The CLI remains the stable JSON and JSONL automation interface.',
  '',
  'Setup',
  'Configuration is generated only after an explicit confirmation.',
  'Provider credentials remain outside Binaflow.',
  'Planner profiles are read-only by default.',
  'Builder write and shell permissions require a visible review.',
  '',
  'Execution',
  'Runs stay attached to this process. There is no detach or daemon path.',
  'The first cancellation request is graceful; the second is forced.',
  'Completed steps are reused during recovery and never silently rerun.',
  '',
  'Experimental workflow',
  'research-plan-build and its approval flow are experimental.',
  'Approval and loop behavior are not generic workflow primitives.',
  '',
  'Limits',
  'The first Ink foundation screen uses bounded content and explicit scrolling.',
  'NO_COLOR removes presentation colors but keeps terminal control behavior.',
  'Pi authentication and model availability are not verified by Binaflow.',
  '',
  'Press q to return home.',
];

function homeLines(diagnosis?: ConfigurationDiagnosis): string[] {
  return [
    `Workspace: ${diagnosis?.workspacePath ?? 'loading...'}`,
    `Config: ${diagnosis?.configPath ?? 'loading...'}`,
    `Ready: ${diagnosis ? readiness(diagnosis) : 'loading diagnosis...'}`,
  ];
}

function diagnosisLines(diagnosis?: ConfigurationDiagnosis): string[] {
  if (!diagnosis) return ['Loading configuration diagnosis...'];
  return [
    `Workspace: ${diagnosis.workspacePath}`,
    `Config: ${diagnosis.configPath}`,
    `Config valid: ${diagnosis.configValid ? 'yes' : 'no'}`,
    `Ready: ${readiness(diagnosis)}`,
    `Pi command: ${diagnosis.piCommand ?? 'unknown'}`,
    `Pi launchable: ${diagnosis.piCommandLaunchable === true ? 'yes' : 'no'}`,
    '',
    ...diagnosis.errors.map((message) => `Error: ${message}`),
    ...diagnosis.profiles.flatMap((profile) => [
      `Profile ${profile.name}: ${profile.valid ? 'valid' : 'invalid'}`,
      ...profile.errors.map((message) => `  ${message}`),
    ]),
    ...diagnosis.workflows.map(
      (workflow) =>
        `Workflow ${workflow.id}: ${workflow.available ? 'available' : `missing ${workflow.missingProfiles.join(', ')}`}`,
    ),
  ];
}

function readiness(diagnosis?: ConfigurationDiagnosis): string {
  if (!diagnosis) return 'loading';
  if (diagnosis.ready) return 'ready';
  return 'attention required';
}

function detailActions(
  detail: RunInspection,
  recovery?: RunRecoveryExplanation,
  clarifications: string[] = [],
): string[] {
  const actions: string[] = [];
  if (recovery?.actions?.some((action) => action.kind === 'mark-interrupted')) {
    actions.push('Mark interrupted and review recovery');
  }
  if (recovery?.eligible) actions.push('Resume retryable work');
  if (detail.run.status === 'waiting' && detail.run.workflowId === 'research-plan-build') {
    actions.push('Approve research and continue', 'Reject research with feedback', 'Leave waiting');
  }
  if (clarifications.length > 0) actions.push('New run with revised objective');
  actions.push('Browse artifacts', 'Back to history');
  return actions;
}

function SelectionScreen({
  title,
  description,
  items,
  selected,
  colors,
  footer,
}: {
  title: string;
  description?: string;
  items: string[];
  selected: number;
  colors: boolean;
  footer: string;
}): ReactNode {
  return (
    <ScreenFrame title={title} footer={footer} colors={colors}>
      {description ? <Text>{description}</Text> : null}
      <SelectionList items={items} selected={selected} offset={0} visibleRows={items.length} />
    </ScreenFrame>
  );
}

function selectionItems(
  screen: Screen,
  workflows: ReturnType<typeof discoverWorkflows>,
  generated: GeneratedConfiguration | undefined,
  launchInput: LaunchInputState | undefined,
): string[] {
  if (screen === 'setup-choice') return ['Create configuration', 'Read documentation', 'Exit'];
  if (screen === 'setup-preview' && generated) return ['Write configuration', 'Cancel'];
  if (screen === 'workflows') return workflowItems(workflows);
  if (screen === 'launch-confirmation' && launchInput) {
    return ['Confirm and launch', 'Edit objective', 'Cancel'];
  }
  return [];
}

function workflowItems(
  workflows: ReturnType<typeof discoverWorkflows>,
  diagnosis?: ConfigurationDiagnosis,
): string[] {
  return orderedWorkflows(workflows).map((workflow) => {
    const missing = diagnosis ? missingProfiles(workflow, diagnosis) : [];
    const label = workflow.experimental ? `${workflow.id} [Experimental]` : workflow.id;
    return missing.length > 0 ? `${label} (missing: ${missing.join(', ')})` : label;
  });
}
