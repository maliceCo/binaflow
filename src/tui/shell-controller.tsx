import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { useApp, useInput } from 'ink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  configurationExists,
  diagnoseConfigurationFile,
  discoverSetupModels,
  generateConfiguration,
  writeConfigurationAtomically,
} from '../application/config-operations.js';
import type { NormalizedEvent } from '../core/events.js';
import { discoverWorkflows } from '../application/operations.js';
import type { RunInspection, RunRecoveryExplanation } from '../application/operations.js';
import type { WorkflowRun } from '../core/run.js';
import type { ApplicationService } from '../application/service.js';
import { explainUserError } from '../presentation/format.js';
import { MinimumSizeFallback, SafeText } from './components.js';
import {
  applyStepSnapshot,
  createLiveActivityBuffer,
  createLiveState,
  createLiveUiPublisher,
  createSnapshotInspectionController,
  type LiveActivityBuffer,
  type LiveState,
  type SnapshotInspectionController,
} from './execution.js';
import {
  SETUP_FIELDS,
  missingProfiles,
  orderedWorkflows,
  profileReview,
  sameProfileReview,
  setupChoices,
  setupValuesToGeneration,
  workflowInputFields,
  type LaunchInputState,
} from './launch.js';
import {
  AboutOverlay,
  FolderConfirmScreen,
  FolderPickerScreen,
  HelpOverlay,
  StudioLayout,
  WelcomeScreen,
} from './layout.js';
import type { AttachedExecutionLifecycle } from './lifecycle.js';
import {
  createInitialTuiState,
  visibleFolderEntries,
  type FolderEntry,
  type TuiEvent,
  type TuiState,
} from './model.js';
import { reduce } from './reduce.js';
import { ArtifactsScreen } from './screens/artifacts.js';
import { APPROVAL_ACTIONS, ApprovalScreen } from './screens/approval.js';
import { DetailScreen, detailActions } from './screens/detail.js';
import { DiagnosisScreen } from './screens/diagnosis.js';
import { RejectionFeedbackScreen, RecoveryConfirmScreen } from './screens/feedback.js';
import { LaunchConfirmationScreen, LaunchInputScreen } from './screens/launch.js';
import { LiveScreen } from './screens/live.js';
import { ResultScreen } from './screens/result.js';
import { SetupWizardScreen } from './screens/setup.js';
import { MINIMUM_HEIGHT, MINIMUM_WIDTH } from './screens.js';
import { scrollText } from './viewport.js';

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
  hasInjectedContext?: boolean;
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
  const [state, setState] = useState<TuiState>(() => createInitialTuiState({ cwd, configPath }));
  const stateRef = useRef(state);
  const [live, setLive] = useState<LiveState>();
  const [liveDetail, setLiveDetail] = useState(false);
  const [liveOffset, setLiveOffset] = useState(0);
  const [launching, setLaunching] = useState(false);
  const active = useRef(true);
  const diagnosisRequest = useRef(0);
  const runsRequest = useRef(0);
  const folderRequest = useRef(0);
  const inspectionRequest = useRef(0);
  const artifactRequest = useRef(0);
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

  const publishLive = (value: LiveState): void => {
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

  const handleLiveEvent = (event: NormalizedEvent): void => {
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

  const resolveContextFactory = async (): Promise<
    (configPath: string, cwd: string) => Promise<ApplicationService & { close?(): void }>
  > => openContext ?? (await import('../application/runtime.js')).openApplicationContext;

  const ensureContext = async (): Promise<ApplicationService & { close?(): void }> => {
    if (lifecycle.context) return lifecycle.context;
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    return lifecycle.openContext(async () => createContext(current.configPath, current.cwd));
  };

  const openExecutionContext = async (): Promise<ApplicationService & { close?(): void }> => {
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    return lifecycle.replaceOwnedContext(async () =>
      createContext(current.configPath, current.cwd),
    );
  };

  const replaceWorkspaceContext = async (): Promise<void> => {
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    await lifecycle.replaceContext(async () => createContext(current.configPath, current.cwd));
  };

  const runDiagnose = async (): Promise<void> => {
    const requestId = ++diagnosisRequest.current;
    const requestCwd = stateRef.current.cwd;
    const requestConfigPath = stateRef.current.configPath;
    const promise = diagnoseConfigurationFile(requestConfigPath, requestCwd)
      .then((result) => {
        if (
          active.current &&
          requestId === diagnosisRequest.current &&
          stateRef.current.cwd === requestCwd &&
          stateRef.current.configPath === requestConfigPath
        ) {
          dispatch({ type: 'diagnosed', diagnosis: result });
        }
      })
      .catch((reason: unknown) => {
        if (
          active.current &&
          requestId === diagnosisRequest.current &&
          stateRef.current.cwd === requestCwd &&
          stateRef.current.configPath === requestConfigPath
        ) {
          dispatch({
            type: 'error-set',
            message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
          });
        }
      });
    lifecycle.trackRequest(promise);
    await promise;
  };

  const loadRuns = async (): Promise<void> => {
    const requestId = ++runsRequest.current;
    const requestCwd = stateRef.current.cwd;
    const request = (async () => {
      try {
        const application = await ensureContext();
        const page = await application.listRuns({ limit: 50 });
        if (
          active.current &&
          requestId === runsRequest.current &&
          stateRef.current.cwd === requestCwd
        )
          dispatch({ type: 'runs-loaded', runs: page.runs });
      } catch {
        if (
          active.current &&
          requestId === runsRequest.current &&
          stateRef.current.cwd === requestCwd
        )
          dispatch({ type: 'runs-loaded', runs: [] });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const listFolder = async (path: string): Promise<void> => {
    const requestId = ++folderRequest.current;
    const request = (async () => {
      try {
        const dirents = await readdir(path, { withFileTypes: true });
        const dirs = dirents
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name));
        const entries: FolderEntry[] =
          path === '/'
            ? []
            : [{ path: dirname(path), name: '..', isParent: true, hasBinaflow: false }];
        for (const entry of dirs) {
          const full = join(path, entry.name);
          let hasBinaflow = false;
          try {
            hasBinaflow = await configurationExists('.binaflow/config.json', full);
          } catch {
            hasBinaflow = false;
          }
          entries.push({ path: full, name: entry.name, isParent: false, hasBinaflow });
        }
        if (
          active.current &&
          requestId === folderRequest.current &&
          stateRef.current.overlay === 'folder-picker' &&
          stateRef.current.folderPickerPath === path
        )
          dispatch({ type: 'folder-listed', entries });
      } catch (reason) {
        if (
          !active.current ||
          requestId !== folderRequest.current ||
          stateRef.current.overlay !== 'folder-picker' ||
          stateRef.current.folderPickerPath !== path
        )
          return;
        const message = reason instanceof Error ? reason.message : String(reason);
        dispatch({
          type: 'folder-listed',
          entries:
            path === '/'
              ? [{ path, name: path, isParent: false, hasBinaflow: false, error: message }]
              : [
                  {
                    path: dirname(path),
                    name: '..',
                    isParent: true,
                    hasBinaflow: false,
                    error: message,
                  },
                ],
        });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const prepareLaunch = async (next: TuiState): Promise<void> => {
    const workflow =
      next.workflows?.[next.workflowSelected] ??
      orderedWorkflows(discoverWorkflows())[next.workflowSelected];
    const diagnosis = next.diagnosis;
    if (!workflow || !diagnosis) {
      dispatch({
        type: 'error-set',
        message: 'The config has not been checked yet. Press d to refresh.',
      });
      dispatch({ type: 'launch-cancel' });
      return;
    }
    if (!diagnosis.configValid) {
      dispatch({
        type: 'error-set',
        message:
          'The config file is invalid. Edit .binaflow/config.json in your editor, then press d to refresh.',
      });
      dispatch({ type: 'launch-cancel' });
      return;
    }
    const missing = missingProfiles(workflow, diagnosis);
    if (missing.length > 0) {
      dispatch({
        type: 'error-set',
        message: `Missing profiles: ${missing.join(', ')}. Fix agent profiles in configuration, then refresh diagnosis.`,
      });
      dispatch({ type: 'launch-cancel' });
      return;
    }
    const input: LaunchInputState = {
      workflow,
      values: {},
      field: 0,
      reviewedProfiles: profileReview(workflow, diagnosis),
    };
    dispatch({ type: 'launch-set', input });
  };

  const buildGenerated = async (next: TuiState): Promise<void> => {
    try {
      const answers = setupValuesToGeneration(next.setupValues);
      const generated = generateConfiguration({
        configPath: next.configPath,
        cwd: next.cwd,
        ...answers,
      });
      if (active.current) dispatch({ type: 'generated-set', generated });
    } catch (reason) {
      if (active.current) {
        dispatch({
          type: 'error-set',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
  };

  const writeSetupConfig = async (next: TuiState): Promise<void> => {
    if (!next.generated) {
      dispatch({ type: 'setup-save-failed', message: 'Configuration preview is not ready yet.' });
      return;
    }
    try {
      if (await configurationExists(next.configPath, next.cwd)) {
        dispatch({
          type: 'setup-save-failed',
          message: `Configuration already exists at ${next.generated.configPath}; nothing was overwritten.`,
        });
        return;
      }
      await writeConfigurationAtomically(next.generated);
      dispatch({ type: 'setup-written' });
    } catch (reason) {
      dispatch({
        type: 'setup-save-failed',
        message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
      });
    }
  };

  const loadInspection = async (runId: string): Promise<void> => {
    const requestId = ++inspectionRequest.current;
    const request = (async () => {
      try {
        const application = await ensureContext();
        const inspection = await application.inspectRun(runId, { includeStepResults: 'usage' });
        const [recovery, clarifications] = await Promise.all([
          application.explainRunRecovery(runId),
          application.clarificationQuestions(inspection),
        ]);
        if (
          !active.current ||
          requestId !== inspectionRequest.current ||
          stateRef.current.activeRunId !== runId
        )
          return;
        const workflow = discoverWorkflows().find(
          (candidate) => candidate.id === inspection.run.workflowId,
        );
        const approvalWaiting =
          inspection.run.status === 'waiting' &&
          workflow?.approval !== undefined &&
          inspection.steps.some(
            (step) => step.stepId === workflow.approval?.id && step.status === 'waiting',
          );
        if (approvalWaiting && workflow?.approval) {
          const previews = await application.loadResearchApprovalPreviews(inspection);
          if (
            !active.current ||
            requestId !== inspectionRequest.current ||
            stateRef.current.activeRunId !== runId
          )
            return;
          dispatch({ type: 'inspection-set', inspection, recovery, clarifications });
          dispatch({ type: 'approval-set', message: workflow.approval.message, previews });
        } else {
          dispatch({ type: 'inspection-set', inspection, recovery, clarifications });
          if (stateRef.current.detail === 'approval') dispatch({ type: 'leave-waiting' });
        }
      } catch (reason) {
        if (
          active.current &&
          requestId === inspectionRequest.current &&
          stateRef.current.activeRunId === runId
        ) {
          dispatch({
            type: 'error-set',
            message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
          });
        }
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const loadArtifact = async (): Promise<void> => {
    const current = stateRef.current;
    const artifact = current.inspection?.artifacts[current.artifactSelected];
    if (!artifact || !lifecycle.context || !current.inspection) return;
    const requestId = ++artifactRequest.current;
    const runId = current.inspection.run.id;
    const artifactKey = `${artifact.stepId}.${artifact.name}`;
    const application = lifecycle.context;
    if (!application) return;
    const request = (async () => {
      try {
        const content = await application.readArtifact(runId, artifactKey);
        if (
          active.current &&
          requestId === artifactRequest.current &&
          stateRef.current.inspection?.run.id === runId &&
          stateRef.current.artifactSelected === current.artifactSelected
        )
          dispatch({ type: 'artifact-content-set', content });
      } catch (reason) {
        if (
          active.current &&
          requestId === artifactRequest.current &&
          stateRef.current.inspection?.run.id === runId &&
          stateRef.current.artifactSelected === current.artifactSelected
        ) {
          dispatch({
            type: 'artifact-content-set',
            content: {
              artifact,
              truncated: false,
              formatted: false,
              error: explainUserError(reason instanceof Error ? reason.message : String(reason)),
            },
          });
        }
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const presentApproval = async (
    run: WorkflowRun,
    inspection?: RunInspection,
  ): Promise<boolean> => {
    const workflow = discoverWorkflows().find((candidate) => candidate.id === run.workflowId);
    const application = lifecycle.context;
    if (run.status !== 'waiting' || !workflow?.approval || !application) return false;
    try {
      let detailInspection = inspection;
      if (!detailInspection) {
        const inspectionRequest = application.inspectRun(run.id, { includeStepResults: false });
        lifecycle.trackRequest(inspectionRequest);
        detailInspection = await inspectionRequest;
      }
      const waiting = detailInspection.steps.some(
        (step) => step.stepId === workflow.approval?.id && step.status === 'waiting',
      );
      if (!waiting) return false;
      const previewRequest = application.loadResearchApprovalPreviews(detailInspection);
      lifecycle.trackRequest(previewRequest);
      const previews = await previewRequest;
      if (!active.current) return true;
      dispatch({ type: 'inspection-set', inspection: detailInspection, clarifications: [] });
      dispatch({ type: 'approval-set', message: workflow.approval.message, previews });
      disposeLiveControllers();
      setLiveValue(undefined);
      return true;
    } catch {
      return false;
    }
  };

  const finishRun = async (run: WorkflowRun): Promise<void> => {
    const current = liveRef.current;
    let inspection: RunInspection | undefined;
    let recovery: RunRecoveryExplanation | undefined;
    let clarifications: string[] = [];
    const application = lifecycle.context;
    if (application) {
      try {
        const inspectionRequest = application.inspectRun(run.id, { includeStepResults: 'usage' });
        lifecycle.trackRequest(inspectionRequest);
        inspection = await inspectionRequest;
        const current = inspection;
        const metadataRequest = Promise.all([
          application.explainRunRecovery(run.id),
          application.clarificationQuestions(current),
        ]);
        lifecycle.trackRequest(metadataRequest);
        [recovery, clarifications] = await metadataRequest;
        run = current.run;
      } catch {
        if (!inspection && current) {
          inspection = {
            run,
            steps: current.steps.map((step) => ({
              runId: run.id,
              stepId: step.id,
              profile: step.profile,
              status: step.status,
              attempt: 1,
            })),
            artifacts: [],
            eventCount: 0,
          };
        }
      }
    }
    if (await presentApproval(run, inspection)) return;
    disposeLiveControllers();
    setLiveValue(undefined);
    dispatch({
      type: 'inspection-set',
      inspection: inspection ?? { run, steps: [], artifacts: [], eventCount: 0 },
      ...(recovery ? { recovery } : {}),
      clarifications,
    });
    dispatch({ type: 'run-finished', status: run.status });
  };

  const requestCancellation = (): void => {
    const request = lifecycle.requestCancellation('SIGINT');
    if (request === 'inactive') return;
    if (request === 'forced') {
      exit();
      return;
    }
    dispatch({ type: 'cancel-requested' });
  };

  const startLaunch = (): void => {
    const launchInput = stateRef.current.launchInput;
    const diagnosis = stateRef.current.diagnosis;
    if (!launchInput || !diagnosis || launching) return;
    setLaunching(true);
    const controller = lifecycle.beginOperation();
    lifecycle.trackOperation(
      (async () => {
        try {
          const refreshed = await diagnoseConfigurationFile(
            stateRef.current.configPath,
            stateRef.current.cwd,
          );
          const currentReview = profileReview(launchInput.workflow, refreshed);
          if (
            !refreshed.configValid ||
            !sameProfileReview(launchInput.reviewedProfiles, currentReview)
          ) {
            dispatch({ type: 'diagnosed', diagnosis: refreshed });
            dispatch({
              type: 'error-set',
              message: !refreshed.configValid
                ? 'Configuration changed or became invalid; review it before launching.'
                : 'Profile permissions or settings changed; confirm the workflow again before launching.',
            });
            return;
          }
          const application = await openExecutionContext();
          if (controller.signal.aborted) throw new Error('Workflow startup cancelled.');
          attachLiveControllers(application);
          lifecycle.subscribe(application.subscribeEvents((event) => handleLiveEvent(event)));
          const objective = launchInput.values.objective;
          if (!objective) throw new Error('Workflow objective must be a non-empty string');
          dispatch({ type: 'status-set', message: `Starting ${launchInput.workflow.id}...` });
          const run = await application.runWorkflow({
            workflowId: launchInput.workflow.id,
            objective,
            input: launchInput.values,
            signal: controller.signal,
            onRunStarted: (startedRun) => {
              activeRunId.current = startedRun.id;
              setLiveValue(createLiveState(startedRun, launchInput.workflow));
              setLiveDetail(false);
              setLiveOffset(0);
              dispatch({ type: 'run-started', runId: startedRun.id });
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
          } else {
            dispatch({
              type: 'error-set',
              message: `Launch failed: ${reason instanceof Error ? reason.message : String(reason)}. Retry or go back to edit the workflow.`,
            });
          }
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
    const inspection = stateRef.current.inspection;
    if (!inspection || launching) return;
    const workflow = discoverWorkflows().find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      dispatch({ type: 'error-set', message: `Workflow ${workflowId} is unavailable.` });
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
            setLiveValue(createLiveState(startedRun, workflow, inspection.steps));
            setLiveDetail(false);
            setLiveOffset(0);
            dispatch({ type: 'run-started', runId: startedRun.id });
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
          } else {
            dispatch({
              type: 'error-set',
              message: reason instanceof Error ? reason.message : String(reason),
            });
          }
        } finally {
          lifecycle.unsubscribe();
          activeRunId.current = undefined;
          setLaunching(false);
        }
      })(),
    );
  };

  const runEffects = async (previous: TuiState, next: TuiState, event: TuiEvent): Promise<void> => {
    try {
      switch (event.type) {
        case 'quit':
          exit();
          return;
        case 'diagnosed':
        case 'use-folder':
          if (next.overlay === 'none' && next.diagnosis?.configValid) await loadRuns();
          break;
        case 'open-folder-picker':
        case 'folder-picker-path':
          if (next.overlay === 'folder-picker') await listFolder(next.folderPickerPath);
          break;
        case 'folder-confirm':
          if (next !== previous && next.cwd !== previous.cwd) {
            await replaceWorkspaceContext();
          }
          break;
        case 'new-run':
          if (next.detail === 'launch') await prepareLaunch(next);
          break;
        case 'launch-confirm':
          startLaunch();
          break;
        case 'setup-next':
        case 'setup-submit':
          if (next.overlay === 'setup' && next.setupStep === 4 && previous.setupStep !== 4) {
            await buildGenerated(next);
          }
          break;
        case 'setup-save':
          if (next !== previous && next.status === 'Writing configuration...') {
            await writeSetupConfig(next);
          }
          break;
        case 'open-run':
          await loadInspection(event.runId);
          break;
        case 'resume-run': {
          if (next === previous) break;
          const runId = next.inspection?.run.id;
          if (runId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application
                  .resumeWorkflow({ runId, signal, onRunStarted })
                  .then((result) => result.run),
              next.inspection!.run.workflowId,
            );
          }
          break;
        }
        case 'approval-approve': {
          if (next === previous) break;
          const runId = next.inspection?.run.id;
          if (runId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application.decideApproval({ runId, decision: 'approved', signal, onRunStarted }),
              next.inspection!.run.workflowId,
            );
          }
          break;
        }
        case 'rejection-submitted': {
          if (next === previous) break;
          const runId = next.inspection?.run.id;
          if (runId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application.decideApproval({
                  runId,
                  decision: 'rejected',
                  feedback: event.feedback,
                  signal,
                  onRunStarted,
                }),
              next.inspection!.run.workflowId,
            );
          }
          break;
        }
        case 'recovery-confirmed': {
          if (next === previous) break;
          const runId = next.inspection?.run.id;
          const application = lifecycle.context;
          if (runId && application) {
            const request = application.markRunInterrupted(runId);
            lifecycle.trackRequest(request);
            await request;
            await loadInspection(runId);
          }
          break;
        }
        case 'run-finished':
          await loadRuns();
          break;
        case 'cancel-requested':
          if (liveRef.current) publishLive({ ...liveRef.current, cancellationRequested: true });
          dispatch({
            type: 'status-set',
            message:
              'Cancellation requested. Workflow is still running; press q again to force-cancel.',
          });
          break;
        default:
          break;
      }
      if (next.effect === 'discover-setup-models') {
        const models = await discoverSetupModels();
        if (active.current) dispatch({ type: 'setup-models', models });
      } else if (next.effect === 'diagnose-cwd') {
        await runDiagnose();
      }
    } catch (reason) {
      if (active.current) {
        dispatch({
          type: 'error-set',
          message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
        });
      }
    }
  };

  const dispatch = (event: TuiEvent): void => {
    const previous = stateRef.current;
    const next = reduce(previous, event);
    stateRef.current = next;
    setState(next);
    void runEffects(previous, next, event);
  };

  useEffect(() => {
    active.current = true;
    dispatch({ type: 'workflows-loaded', workflows: discoverWorkflows() });
    void runDiagnose();
    return () => {
      active.current = false;
      disposeLiveControllers();
    };
  }, [cwd, configPath]);

  useEffect(() => {
    return registerSignalHandler((signal) => {
      if (belowMinimumSize) return false;
      const request = lifecycle.requestCancellation(signal);
      if (request === 'inactive') return false;
      if (request === 'forced') return false;
      dispatch({ type: 'cancel-requested' });
      return false;
    });
  }, [lifecycle, registerSignalHandler, belowMinimumSize]);

  useInput((input, key) => {
    const current = stateRef.current;
    if (belowMinimumSize) {
      if (input === 'q' || key.escape || (input === 'c' && key.ctrl)) {
        exit(input === 'c' ? 130 : undefined);
      }
      return;
    }
    if (input === 'c' && key.ctrl) {
      if (liveRef.current || launching) requestCancellation();
      else exit(130);
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
          if (input === 'q' || key.escape) dispatch({ type: 'folder-picker-back' });
          else if (input === 'h') {
            dispatch({ type: 'folder-picker-path', path: dirname(current.folderPickerPath) });
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

    const direction = input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;

    if (current.detail === 'approval') {
      if (input === 'q' || key.escape) dispatch({ type: 'leave-waiting' });
      else if (direction !== 0) {
        dispatch({ type: 'move', direction, visibleRows: Math.max(1, size.rows - 16) });
      } else if (input === '\r' || key.return) {
        const action = APPROVAL_ACTIONS[current.selection];
        if (action === 'Approve research and continue') dispatch({ type: 'approval-approve' });
        else if (action === 'Reject research with feedback') dispatch({ type: 'approval-reject' });
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
        if (!current.inspection) return;
        const actions = detailActions(current.inspection, current.recovery, current.clarifications);
        const action = actions[current.selection];
        if (action === 'Resume retryable work') dispatch({ type: 'resume-run' });
        else if (action === 'Mark interrupted and review recovery') {
          dispatch({ type: 'open-recovery-confirm' });
        } else if (action === 'New run with revised objective') dispatch({ type: 'open-launch' });
        else if (action === 'Browse artifacts') dispatch({ type: 'open-artifacts' });
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
      } else if (input === '\r' || key.return) void loadArtifact();
      return;
    }

    if (input === 'n') dispatch({ type: 'new-run' });
    else if (input === 'w') dispatch({ type: 'open-folder-picker' });
    else if (input === 'd' || input === 'r') dispatch({ type: 'refresh-diagnosis' });
    else if (input === '?') dispatch({ type: 'open-help' });
    else if (key.tab) {
      dispatch({
        type: 'focus-pane',
        pane:
          current.focus === 'workflows'
            ? 'runs'
            : current.focus === 'runs'
              ? 'detail'
              : 'workflows',
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
  });

  if (belowMinimumSize) return <MinimumSizeFallback />;

  if (state.overlay !== 'none') {
    switch (state.overlay) {
      case 'about':
        return <AboutOverlay colors={colors} />;
      case 'help':
        return <HelpOverlay colors={colors} />;
      case 'folder-picker':
        return (
          <FolderPickerScreen
            colors={colors}
            entries={state.folderEntries ?? []}
            selected={state.selection}
            offset={state.offset}
            path={state.folderPickerPath}
            filter={state.folderFilter}
            visibleRows={Math.max(1, size.rows - 7)}
          />
        );
      case 'folder-confirm':
        return (
          <FolderConfirmScreen
            colors={colors}
            path={state.folderPickerPath}
            selected={state.selection}
          />
        );
      case 'setup':
        return (
          <SetupWizardScreen
            key={`${state.setupStep}-${state.setupField}`}
            colors={colors}
            step={state.setupStep}
            {...(state.diagnosis ? { diagnosis: state.diagnosis } : {})}
            {...(state.setupStep === 2 || state.setupStep === 3
              ? { field: SETUP_FIELDS[state.setupField]! }
              : {})}
            choices={setupChoices(state.setupField, state.setupModels ?? [], state.setupValues)}
            {...(state.error ? { error: state.error } : {})}
            selected={state.selection}
            setupPreviewOffset={state.setupPreviewOffset}
            value={state.inputValue}
            onChange={(value) => dispatch({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => dispatch({ type: 'setup-submit', value }), 0);
            }}
            {...(state.generated ? { generated: state.generated } : {})}
            showFullConfig={state.showFullConfig}
          />
        );
      case 'recovery-confirm':
        return (
          <RecoveryConfirmScreen
            colors={colors}
            error={state.error}
            initialValue={state.inputValue}
            onChange={(value) => dispatch({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => {
                if (value.trim().toLowerCase() === 'yes') dispatch({ type: 'recovery-confirmed' });
                else dispatch({ type: 'error-set', message: 'Type YES to confirm recovery.' });
              }, 0);
            }}
          />
        );
      case 'rejection-feedback':
        return (
          <RejectionFeedbackScreen
            colors={colors}
            error={state.error}
            initialValue={state.inputValue}
            onChange={(value) => dispatch({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => {
                const feedback = value.trim();
                if (!feedback)
                  dispatch({ type: 'error-set', message: 'Feedback must be non-empty.' });
                else dispatch({ type: 'rejection-submitted', feedback });
              }, 0);
            }}
          />
        );
      case 'welcome':
      default:
        return (
          <WelcomeScreen
            colors={colors}
            cwd={state.cwd}
            {...(state.diagnosis ? { diagnosis: state.diagnosis } : {})}
            selected={state.selection}
          />
        );
    }
  }

  let right: ReactNode;
  switch (state.detail) {
    case 'diagnosis':
      right = (
        <DiagnosisScreen
          colors={colors}
          diagnosis={state.diagnosis}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 7)}
          refreshing={false}
          error={state.error}
        />
      );
      break;
    case 'launch':
      if (
        state.launchInput &&
        state.launchInput.field >= workflowInputFields(state.launchInput.workflow).length
      ) {
        right = state.diagnosis ? (
          <LaunchConfirmationScreen
            colors={colors}
            diagnosis={state.diagnosis}
            launchInput={state.launchInput}
            error={state.error ?? state.status}
            launching={launching}
            selected={state.selection}
            offset={state.offset}
          />
        ) : null;
      } else if (state.launchInput) {
        right = (
          <LaunchInputScreen
            key={`${state.launchInput.workflow.id}-${state.launchInput.field}`}
            colors={colors}
            launchInput={state.launchInput}
            error={state.error ?? state.launchInput.error}
            value={state.inputValue}
            onChange={(value) => dispatch({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => dispatch({ type: 'launch-input', value }), 0);
            }}
          />
        );
      } else {
        right = <SafeText>Press n to start a run.</SafeText>;
      }
      break;
    case 'live':
      right = live ? (
        <LiveScreen
          colors={colors}
          live={live}
          detail={liveDetail}
          offset={liveOffset}
          visibleRows={Math.max(1, size.rows - 13)}
        />
      ) : null;
      break;
    case 'approval':
      right =
        state.inspection && state.approvalMessage ? (
          <ApprovalScreen
            colors={colors}
            run={state.inspection.run}
            message={state.approvalMessage}
            previews={state.approvalPreviews}
            previewOffset={state.approvalPreviewOffset}
            error={state.error ?? state.launchInput?.error}
            selected={state.selection}
            offset={state.offset}
            visibleRows={Math.max(1, size.rows - 16)}
          />
        ) : null;
      break;
    case 'result':
      right = state.inspection ? (
        <ResultScreen
          colors={colors}
          inspection={state.inspection}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 16)}
          {...(state.error ? { error: state.error } : {})}
        />
      ) : null;
      break;
    case 'inspect':
      right = state.inspection ? (
        <DetailScreen
          colors={colors}
          detail={state.inspection}
          recovery={state.recovery}
          clarifications={state.clarifications}
          approvalMessage={state.approvalMessage}
          previews={state.approvalPreviews}
          previewOffset={state.approvalPreviewOffset}
          error={state.error}
          selected={state.selection}
          offset={state.offset}
          visibleRows={Math.max(1, size.rows - 16)}
        />
      ) : null;
      break;
    case 'artifacts':
      right = state.inspection ? (
        <ArtifactsScreen
          colors={colors}
          detail={state.inspection}
          selected={state.artifactSelected}
          offset={state.artifactOffset}
          content={state.artifactContent}
          contentOffset={state.artifactContentOffset}
          visibleRows={Math.max(1, size.rows - 12)}
        />
      ) : null;
      break;
    default:
      right = <SafeText>Press n to start a run.</SafeText>;
      break;
  }

  return (
    <StudioLayout
      colors={colors}
      state={state}
      {...(live ? { live } : {})}
      liveDetail={liveDetail}
      size={size}
      right={right}
    />
  );
}
