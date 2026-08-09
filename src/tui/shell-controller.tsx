import {
  diagnoseConfigurationFile,
  configurationExists,
  generateConfiguration,
  writeConfigurationAtomically,
  type GeneratedConfiguration,
  type ConfigurationDiagnosis,
} from '../application/config-operations.js';
import type {
  ArtifactContentView,
  RunInspection,
  RunRecoveryExplanation,
} from '../application/operations.js';
import { discoverWorkflows } from '../application/operations.js';
import type { ApplicationService } from '../application/service.js';
import { useApp, useInput } from 'ink';
import type { RunStatus, WorkflowRun } from '../core/run.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MinimumSizeFallback } from './components.js';
import { moveSelection, scrollText } from './viewport.js';
import {
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
  type LaunchInputState,
  type SetupValues,
} from './launch.js';
import {
  applyStepSnapshot,
  createLiveActivityBuffer,
  createLiveState,
  createLiveUiPublisher,
  createSnapshotInspectionController,
  type CompletionState,
  type LiveActivityBuffer,
  type LiveState,
  type SnapshotInspectionController,
} from './execution.js';
import type { AttachedExecutionLifecycle } from './lifecycle.js';
import { HOME_ACTIONS, MINIMUM_HEIGHT, MINIMUM_WIDTH, type Screen } from './screens.js';
import { HomeScreen } from './screens/home.js';
import { DocumentationScreen, documentationLines } from './screens/documentation.js';
import { DiagnosisScreen, diagnosisLines } from './screens/diagnosis.js';
import { SetupChoiceScreen, SetupInputScreen, SetupPreviewScreen } from './screens/setup.js';
import { WorkflowsScreen, workflowItems } from './screens/workflows.js';
import { LaunchConfirmationScreen, LaunchInputScreen } from './screens/launch.js';
import { LiveScreen } from './screens/live.js';
import { CompletionScreen } from './screens/completion.js';
import { HistoryScreen } from './screens/history.js';
import { DetailScreen, detailActions } from './screens/detail.js';
import { ArtifactsScreen } from './screens/artifacts.js';
import { FeedbackScreen } from './screens/feedback.js';

interface InkShellControllerProps {
  colors: boolean;
  size: { columns: number; rows: number };
  cwd: string;
  configPath: string;
  lifecycle: AttachedExecutionLifecycle<ApplicationService & { close?(): void }>;
  openApplicationContext?:
    | ((configPath: string, cwd: string) => Promise<ApplicationService & { close?(): void }>)
    | undefined;
  registerSignalHandler: (handler: (signal: NodeJS.Signals) => boolean) => () => void;
}

export function InkShellController({
  colors,
  size,
  cwd,
  configPath,
  lifecycle,
  openApplicationContext: openContext,
  registerSignalHandler,
}: InkShellControllerProps): ReactNode {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('home');
  const [diagnosis, setDiagnosis] = useState<ConfigurationDiagnosis>();
  const [homeSelected, setHomeSelected] = useState(1);
  const [homeOffset, setHomeOffset] = useState(0);
  const [documentOffset, setDocumentOffset] = useState(0);
  const [diagnosisOffset, setDiagnosisOffset] = useState(0);
  const [selection, setSelection] = useState(0);
  const [listOffset, setListOffset] = useState(0);
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
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyStatus, setHistoryStatus] = useState<RunStatus | undefined>(undefined);
  const [historyWorkflow, setHistoryWorkflow] = useState<string | undefined>(undefined);
  const [historyCursor, setHistoryCursor] = useState<string | undefined>(undefined);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detail, setDetail] = useState<RunInspection>();
  const [recovery, setRecovery] = useState<RunRecoveryExplanation>();
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [approvalMessage, setApprovalMessage] = useState<string>();
  const [approvalPreviews, setApprovalPreviews] = useState<ArtifactContentView[]>([]);
  const [approvalPreviewOffset, setApprovalPreviewOffset] = useState(0);
  const [artifactSelected, setArtifactSelected] = useState(0);
  const [artifactOffset, setArtifactOffset] = useState(0);
  const [artifactContent, setArtifactContent] = useState<ArtifactContentView>();
  const [artifactContentOffset, setArtifactContentOffset] = useState(0);
  const [detailPrompt, setDetailPrompt] = useState<'recovery' | 'rejection'>();
  const inputValueRef = useRef('');
  const active = useRef(true);
  const refreshPromise = useRef<Promise<void> | undefined>(undefined);
  const activeRunId = useRef<string | undefined>(undefined);
  const liveRef = useRef<LiveState | undefined>(undefined);
  const activityBufferRef = useRef<LiveActivityBuffer | undefined>(undefined);
  const uiPublisherRef = useRef<ReturnType<typeof createLiveUiPublisher> | undefined>(undefined);
  const snapshotControllerRef = useRef<SnapshotInspectionController | undefined>(undefined);
  const appliedSnapshotGeneration = useRef(0);
  const belowMinimumSize = size.columns < MINIMUM_WIDTH || size.rows < MINIMUM_HEIGHT;

  const setLiveValue = (value: LiveState | undefined): void => {
    liveRef.current = value;
    setLive(value);
  };

  const disposeLiveControllers = (): void => {
    uiPublisherRef.current?.dispose();
    uiPublisherRef.current = undefined;
    snapshotControllerRef.current?.dispose();
    snapshotControllerRef.current = undefined;
    activityBufferRef.current?.clear();
    activityBufferRef.current = undefined;
    appliedSnapshotGeneration.current = 0;
  };

  const publishLive = (value: LiveState): void => {
    liveRef.current = value;
    setLive(value);
  };

  const attachLiveControllers = (application: ApplicationService): void => {
    disposeLiveControllers();
    const buffer = createLiveActivityBuffer();
    activityBufferRef.current = buffer;
    uiPublisherRef.current = createLiveUiPublisher({
      getState: () => liveRef.current,
      publish: publishLive,
      buffer,
    });
    snapshotControllerRef.current = createSnapshotInspectionController({
      inspect: async (runId) => {
        const inspection = await application.inspectRun(runId, { includeStepResults: 'usage' });
        return inspection.steps;
      },
      getRunId: () => activeRunId.current,
      apply: (steps, generation) => {
        const current = liveRef.current;
        if (!current || current.run.id !== activeRunId.current) return;
        const next = applyStepSnapshot(
          current,
          steps,
          generation,
          appliedSnapshotGeneration.current,
        );
        if (!next) return;
        appliedSnapshotGeneration.current = generation;
        publishLive({ ...next, activity: buffer.snapshot() });
      },
    });
  };

  const handleLiveEvent = (event: import('../core/events.js').NormalizedEvent): void => {
    if (event.runId !== activeRunId.current) return;
    if (!liveRef.current) return;
    const buffer = activityBufferRef.current;
    if (!buffer) return;
    buffer.append(event);
    if (event.type === 'status' || event.type === 'error') {
      snapshotControllerRef.current?.request(event.type);
    }
    uiPublisherRef.current?.markDirty();
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
      disposeLiveControllers();
    };
  }, [configPath, cwd]);

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

  const resolveContextFactory = async (): Promise<
    (configPath: string, cwd: string) => Promise<ApplicationService & { close?(): void }>
  > => openContext ?? (await import('../application/runtime.js')).openApplicationContext;

  const ensureContext = async (): Promise<ApplicationService & { close?(): void }> => {
    if (lifecycle.context) return lifecycle.context;
    const createContext = await resolveContextFactory();
    return lifecycle.openContext(async () => createContext(configPath, cwd));
  };

  const openExecutionContext = async (): Promise<ApplicationService & { close?(): void }> => {
    const createContext = await resolveContextFactory();
    return lifecycle.replaceOwnedContext(async () => createContext(configPath, cwd));
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
      const page = await application.listRuns({
        limit: 50,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextWorkflow ? { workflowId: nextWorkflow } : {}),
        ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      setHistoryRuns(page.runs);
      setHistorySelected(0);
      setHistoryOffset(0);
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
      const inspection = await application.inspectRun(run.id, { includeStepResults: false });
      const explanation = await application.explainRunRecovery(run.id);
      const questions = await application.clarificationQuestions(inspection);
      const workflow = discoverWorkflows().find(
        (candidate) => candidate.id === inspection.run.workflowId,
      );
      const approvalWaiting =
        inspection.run.status === 'waiting' &&
        workflow?.approval !== undefined &&
        inspection.steps.some(
          (step) => step.stepId === workflow.approval?.id && step.status === 'waiting',
        );
      setDetail(inspection);
      setRecovery(explanation);
      setClarifications(questions);
      if (approvalWaiting && workflow?.approval) {
        setApprovalMessage(workflow.approval.message);
        setApprovalPreviews(await application.loadResearchApprovalPreviews(inspection));
      } else {
        setApprovalMessage(undefined);
        setApprovalPreviews([]);
      }
      setApprovalPreviewOffset(0);
      setArtifactContent(undefined);
      setArtifactSelected(0);
      setArtifactOffset(0);
      setSelection(0);
      setListOffset(0);
      setScreen('detail');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const loadArtifact = async (): Promise<void> => {
    const artifact = detail?.artifacts[artifactSelected];
    if (!artifact || !lifecycle.context || !detail) return;
    try {
      setArtifactContent(
        await lifecycle.context.readArtifact(detail.run.id, `${artifact.stepId}.${artifact.name}`),
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
        setListOffset(0);
      } else if (!diagnosis.configValid)
        setError('Fix the invalid configuration before starting a workflow.');
      else {
        setWorkflows(orderedWorkflows(discoverWorkflows()));
        setSelection(0);
        setListOffset(0);
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
        setListOffset(0);
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
    setPromptValue('');
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
    setListOffset(0);
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
    if (lifecycle.context) {
      try {
        const inspection = await lifecycle.context.inspectRun(run.id, {
          includeStepResults: 'usage',
        });
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
    disposeLiveControllers();
    setLiveValue(undefined);
    setStatus(undefined);
    setSelection(0);
    setListOffset(0);
    setScreen('completion');
  };

  const requestCancellation = (signal?: NodeJS.Signals): void => {
    const current = liveRef.current;
    const request = lifecycle.requestCancellation(signal ?? 'SIGINT');
    if (request === 'inactive') return;
    if (request === 'forced') {
      exit();
      return;
    }
    if (current) setLiveValue({ ...current, cancellationRequested: true });
    setStatus('Cancellation requested. Workflow is still running; press q again to force-cancel.');
  };

  useEffect(() => {
    return registerSignalHandler((signal) => {
      const request = lifecycle.requestCancellation(signal);
      if (request === 'inactive') return false;
      if (liveRef.current) setLiveValue({ ...liveRef.current, cancellationRequested: true });
      setStatus(
        'Cancellation requested. Workflow is still running; press q again to force-cancel.',
      );
      exit();
      return true;
    });
  }, [lifecycle, registerSignalHandler]);

  const startLaunch = (): void => {
    if (!launchInput || !diagnosis || launching) return;
    setLaunching(true);
    const controller = lifecycle.beginOperation();
    lifecycle.trackOperation(
      (async () => {
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
          const application = await openExecutionContext();
          if (controller.signal.aborted) throw new Error('Workflow startup cancelled.');
          attachLiveControllers(application);
          lifecycle.subscribe(application.subscribeEvents((event) => handleLiveEvent(event)));
          const objective = launchInput.values.objective;
          if (!objective) throw new Error('Workflow objective must be a non-empty string');
          setStatus(`Starting ${launchInput.workflow.id}...`);
          const run = await application.runWorkflow({
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
          uiPublisherRef.current?.flush();
          await snapshotControllerRef.current?.flush();
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
          lifecycle.unsubscribe();
          activeRunId.current = undefined;
          setLaunching(false);
        }
      })(),
    );
  };

  const startContinuation = (
    operation: (
      application: ApplicationService,
      signal: AbortSignal,
      onRunStarted: (run: WorkflowRun) => void,
    ) => Promise<WorkflowRun>,
    workflowId: string,
  ): void => {
    if (!detail || launching) return;
    const workflow = discoverWorkflows().find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      setError(`Workflow ${workflowId} is unavailable.`);
      return;
    }
    setLaunching(true);
    const controller = lifecycle.beginOperation();
    lifecycle.trackOperation(
      (async () => {
        try {
          const application = await openExecutionContext();
          if (controller.signal.aborted) throw new Error('Workflow startup cancelled.');
          attachLiveControllers(application);
          lifecycle.subscribe(application.subscribeEvents((event) => handleLiveEvent(event)));
          const run = await operation(application, controller.signal, (startedRun) => {
            activeRunId.current = startedRun.id;
            setLiveValue(createLiveState(startedRun, workflow, detail.steps));
            setLiveDetail(false);
            setLiveOffset(0);
            setScreen('live');
          });
          uiPublisherRef.current?.flush();
          await snapshotControllerRef.current?.flush();
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
          lifecycle.unsubscribe();
          activeRunId.current = undefined;
          setLaunching(false);
        }
      })(),
    );
  };

  const submitDetailPrompt = async (value: string): Promise<void> => {
    if (!detail || !detailPrompt || !lifecycle.context) return;
    const normalized = value.trim();
    if (detailPrompt === 'recovery') {
      if (normalized.toLowerCase() !== 'yes') {
        setError('Type YES to confirm recovery.');
        return;
      }
      try {
        await lifecycle.context.markRunInterrupted(detail.run.id);
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
        application.decideApproval({
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
    if (belowMinimumSize) {
      if (input === 'q' || key.escape || (input === 'c' && key.ctrl)) {
        exit(input === 'c' ? 130 : undefined);
      }
      return;
    }

    if (input === 'c' && key.ctrl) {
      if (liveRef.current) requestCancellation();
      else exit(130);
      return;
    }

    if (screen === 'live') {
      if (input === 'q' || key.escape) requestCancellation();
      else if (input === 'd') setLiveDetail((detail) => !detail);
      else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const lines = liveDetail
          ? (live?.activity.length ?? 0)
          : Math.min(8, live?.activity.length ?? 0);
        const visibleRows = Math.max(1, size.rows - 13);
        setLiveOffset((offset) =>
          scrollText(
            offset,
            input === 'j' || key.downArrow ? 1 : -1,
            Math.max(1, lines),
            visibleRows,
          ),
        );
      }
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
      }
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
      else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const visibleRows = Math.max(1, size.rows - 8);
        const next = moveSelection(
          { offset: historyOffset, selected: historySelected },
          input === 'j' || key.downArrow ? 1 : -1,
          historyRuns.length,
          visibleRows,
        );
        setHistorySelected(next.selected);
        setHistoryOffset(next.offset);
      } else if ((input === '\r' || key.return) && historyRuns[historySelected])
        void openDetail(historyRuns[historySelected]!);
      return;
    }

    if (screen === 'detail' && detail) {
      const actions = detailActions(detail, recovery, clarifications);
      if (input === 'q' || key.escape) setScreen('history');
      else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const visibleRows = Math.max(1, size.rows - 16);
        const next = moveSelection(
          { offset: listOffset, selected: selection },
          input === 'j' || key.downArrow ? 1 : -1,
          actions.length,
          visibleRows,
        );
        setSelection(next.selected);
        setListOffset(next.offset);
      } else if (input === '\r' || key.return) {
        const action = actions[selection];
        if (action === 'Resume retryable work') {
          void startContinuation(
            (application, signal, onRunStarted) =>
              application
                .resumeWorkflow({ runId: detail.run.id, signal, onRunStarted })
                .then((result) => result.run),
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
              application.decideApproval({
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
      else if (
        artifactContent &&
        (input === 'j' || key.downArrow || input === 'k' || key.upArrow)
      ) {
        const lines = artifactContent.error
          ? [`ERROR: ${artifactContent.error}`]
          : (artifactContent.content ?? 'No readable content.').split('\n');
        const visibleRows = Math.max(1, size.rows - 12);
        setArtifactContentOffset((offset) =>
          scrollText(offset, input === 'j' || key.downArrow ? 1 : -1, lines.length, visibleRows),
        );
      } else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const visibleRows = Math.max(1, size.rows - 12);
        const next = moveSelection(
          { offset: artifactOffset, selected: artifactSelected },
          input === 'j' || key.downArrow ? 1 : -1,
          detail.artifacts.length,
          visibleRows,
        );
        setArtifactSelected(next.selected);
        setArtifactOffset(next.offset);
      } else if (input === '\r' || key.return) {
        setArtifactContentOffset(0);
        void loadArtifact();
      }
      return;
    }

    if (screen === 'setup-input' || screen === 'launch-input') {
      if (input === 'q' || key.escape) {
        returnHome('Cancelled.');
      }
      return;
    }

    if (screen === 'home') {
      if (input === 'q' || key.escape) {
        exit();
      } else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const next = moveSelection(
          { offset: homeOffset, selected: homeSelected },
          input === 'j' || key.downArrow ? 1 : -1,
          HOME_ACTIONS.length,
          5,
        );
        setHomeSelected(next.selected);
        setHomeOffset(next.offset);
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
      const items =
        screen === 'setup-choice'
          ? ['Create configuration', 'Read documentation', 'Exit']
          : screen === 'setup-preview'
            ? ['Write configuration', 'Cancel']
            : screen === 'workflows'
              ? workflowItems(workflows)
              : ['Confirm and launch', 'Edit objective', 'Cancel'];
      if (input === 'q' || key.escape) returnHome('Cancelled.');
      else if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
        const next = moveSelection(
          { offset: listOffset, selected: selection },
          input === 'j' || key.downArrow ? 1 : -1,
          items.length,
          Math.max(1, Math.min(5, items.length)),
        );
        setSelection(next.selected);
        setListOffset(next.offset);
      } else if (input === '\r' || key.return) {
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

  if (screen === 'documentation')
    return (
      <DocumentationScreen
        colors={colors}
        offset={documentOffset}
        visibleRows={Math.max(1, size.rows - 7)}
      />
    );
  if (screen === 'setup-choice') return <SetupChoiceScreen colors={colors} selected={selection} />;
  if (screen === 'setup-input')
    return (
      <SetupInputScreen
        key={`${SETUP_FIELDS[setupField]!.key}-${inputValue}`}
        colors={colors}
        field={SETUP_FIELDS[setupField]!}
        error={error}
        value={inputValue}
        onChange={setPromptValue}
        onSubmit={submitSetup}
      />
    );
  if (screen === 'setup-preview' && generated)
    return (
      <SetupPreviewScreen
        colors={colors}
        generated={generated}
        error={error}
        selected={selection}
        offset={listOffset}
        visibleRows={Math.max(1, size.rows - 10)}
      />
    );
  if (screen === 'workflows')
    return (
      <WorkflowsScreen
        colors={colors}
        workflows={workflows}
        diagnosis={diagnosis}
        error={error}
        selected={selection}
        offset={listOffset}
        visibleRows={Math.max(1, size.rows - 10)}
      />
    );
  if (screen === 'launch-input' && launchInput)
    return (
      <LaunchInputScreen
        key={`${launchInput.workflow.id}-${launchInput.field}-${inputValue}`}
        colors={colors}
        launchInput={launchInput}
        error={error}
        value={inputValue}
        onChange={setPromptValue}
        onSubmit={submitLaunchInput}
      />
    );
  if (screen === 'launch-confirmation' && launchInput && diagnosis)
    return (
      <LaunchConfirmationScreen
        colors={colors}
        diagnosis={diagnosis}
        launchInput={launchInput}
        error={error ?? status}
        launching={launching}
        selected={selection}
        offset={listOffset}
      />
    );
  if (screen === 'live' && live)
    return (
      <LiveScreen
        colors={colors}
        live={live}
        detail={liveDetail}
        offset={liveOffset}
        visibleRows={Math.max(1, size.rows - 13)}
      />
    );
  if (screen === 'completion' && completion)
    return (
      <CompletionScreen
        colors={colors}
        completion={completion}
        visibleRows={Math.max(1, size.rows - 15)}
      />
    );
  if (screen === 'history')
    return (
      <HistoryScreen
        colors={colors}
        runs={historyRuns}
        selected={historySelected}
        offset={historyOffset}
        visibleRows={Math.max(1, size.rows - 8)}
        status={historyStatus}
        workflow={historyWorkflow}
        hasNext={historyHasNext}
        loading={historyLoading}
        error={error}
      />
    );
  if (screen === 'detail' && detail)
    return (
      <DetailScreen
        colors={colors}
        detail={detail}
        recovery={recovery}
        clarifications={clarifications}
        approvalMessage={approvalMessage}
        previews={approvalPreviews}
        previewOffset={approvalPreviewOffset}
        error={error}
        selected={selection}
        offset={listOffset}
        visibleRows={Math.max(1, size.rows - 16)}
      />
    );
  if (screen === 'artifacts' && detail)
    return (
      <ArtifactsScreen
        colors={colors}
        detail={detail}
        selected={artifactSelected}
        offset={artifactOffset}
        content={artifactContent}
        contentOffset={artifactContentOffset}
        visibleRows={Math.max(1, size.rows - 12)}
      />
    );
  if (screen === 'approval-feedback' && detailPrompt)
    return (
      <FeedbackScreen
        colors={colors}
        prompt={detailPrompt}
        error={error}
        initialValue={inputValue}
        onChange={setPromptValue}
        onSubmit={() => {
          setTimeout(() => void submitDetailPrompt(inputValueRef.current), 0);
        }}
      />
    );
  if (screen === 'diagnosis')
    return (
      <DiagnosisScreen
        colors={colors}
        diagnosis={diagnosis}
        offset={diagnosisOffset}
        visibleRows={Math.max(1, size.rows - 7)}
        refreshing={refreshing}
        error={error}
      />
    );
  return (
    <HomeScreen
      colors={colors}
      diagnosis={diagnosis}
      status={status ?? error ?? (refreshing ? 'loading diagnosis...' : undefined)}
      selected={homeSelected}
      offset={homeOffset}
    />
  );
}
