import { useApp, useInput, usePaste } from 'ink';
import { randomUUID } from 'node:crypto';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  configurationExists,
  diagnoseConfigurationFile,
  discoverTodoFiles,
  generateConfiguration,
  generateUpdatedConfiguration,
  listWorkspaceEntries,
  parentWorkspacePath,
  readTodoFile,
  replaceConfigurationAtomically,
  writeConfigurationAtomically,
} from '../application/config-operations.js';
import type { NormalizedEvent } from '../core/events.js';
import { discoverWorkflows } from '../application/operations.js';
import type { RunInspection, WorkflowContract } from '../application/operations.js';
import type { RunView } from '../application/run-view.js';
import type { WorkflowRun } from '../core/run.js';
import type { ApplicationContext } from '../application/runtime.js';
import type { ApplicationService } from '../application/service.js';
import type { PreparationSelection } from '../application/preparation.js';
import type { AgentModel } from '../core/agent.js';
import type { ApplicationContextInput } from './shell.js';
import { explainUserError } from '../presentation/format.js';
import { MinimumSizeFallback } from './components.js';
import {
  applyRunViewSnapshot,
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
  SETUP_PROFILES,
  missingProfiles,
  orderedWorkflows,
  profileReview,
  sameProfileReview,
  setupChoices,
  setupProfileChoices,
  setupProfileFields,
  type LaunchInputState,
} from './launch.js';
import {
  AboutOverlay,
  FolderConfirmScreen,
  FolderPickerScreen,
  HelpOverlay,
  WelcomeScreen,
} from './layout.js';
import type { AttachedExecutionLifecycle } from './lifecycle.js';
import {
  createInitialTuiState,
  preparationSelectionForModel,
  type FolderEntry,
  type TuiEvent,
  type TuiState,
} from './model.js';
import { reduce } from './reduce.js';
import { handleShellInput } from './shell-input.js';
import { renderShellDetail } from './shell-view.js';
import { RejectionFeedbackScreen, RecoveryConfirmScreen } from './screens/feedback.js';
import { SetupWizardScreen } from './screens/setup.js';
import { MINIMUM_HEIGHT, MINIMUM_WIDTH } from './screens.js';
import { scrollText } from './viewport.js';

interface InkShellControllerProps {
  colors: boolean;
  size: { columns: number; rows: number };
  cwd: string;
  configPath: string;
  lifecycle: AttachedExecutionLifecycle<ApplicationContext>;
  openApplicationContext?:
    ((configPath: string, cwd: string) => Promise<ApplicationContextInput>) | undefined;
  discoverModels?: (() => Promise<AgentModel[]>) | undefined;
  registerSignalHandler: (handler: (signal: NodeJS.Signals) => boolean) => () => void;
}

export function InkShellController({
  colors,
  size,
  cwd,
  configPath,
  lifecycle,
  openApplicationContext: openContext,
  discoverModels,
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
  const artifactPageCache = useRef(
    new Map<string, import('../application/preparation.js').DocumentPage>(),
  );
  const qaHistoryRequest = useRef(0);
  const qaRoundRequest = useRef(0);
  const qaDefectRequest = useRef(0);
  const reviewRequest = useRef(0);
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

  const refreshLiveView = (application: ApplicationService, runId: string): void => {
    const request = application.getRunView(runId);
    lifecycle.trackRequest(request);
    void request
      .then((view) => {
        const current = liveRef.current;
        if (active.current && current?.run.id === runId) publishLive({ ...current, view });
      })
      .catch(() => undefined);
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
      inspect: (runId) => {
        const request = application.getRunView(runId);
        lifecycle.trackRequest(request);
        return request;
      },
      getRunId: () => activeRunId.current,
      apply: (view, generation) => {
        const current = liveRef.current;
        if (!current || current.run.id !== activeRunId.current) return;
        const next = applyRunViewSnapshot(
          current,
          view,
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
    (configPath: string, cwd: string) => Promise<ApplicationContext>
  > => {
    const factory =
      openContext ?? (await import('../application/runtime.js')).openApplicationContext;
    return async (configPath, workspaceCwd) => {
      const context = await factory(configPath, workspaceCwd);
      if ('application' in context) return context;
      return { application: context, close: () => context.close?.() };
    };
  };

  const ensureContext = async (): Promise<ApplicationService> => {
    if (lifecycle.context) return lifecycle.context.application;
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    const context = await lifecycle.openContext(async () =>
      createContext(current.configPath, current.cwd),
    );
    return context.application;
  };

  const openExecutionContext = async (): Promise<ApplicationService> => {
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    const context = await lifecycle.replaceOwnedContextForOperation(async () =>
      createContext(current.configPath, current.cwd),
    );
    return context.application;
  };

  const replaceWorkspaceContext = async (): Promise<void> => {
    const createContext = await resolveContextFactory();
    const current = stateRef.current;
    await lifecycle.replaceContext(async () => createContext(current.configPath, current.cwd));
  };

  const runDiagnose = async (probePiCommand = false): Promise<void> => {
    const requestId = ++diagnosisRequest.current;
    const requestCwd = stateRef.current.cwd;
    const requestConfigPath = stateRef.current.configPath;
    const promise = diagnoseConfigurationFile(requestConfigPath, requestCwd, { probePiCommand })
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

  const loadQaHistory = async (): Promise<void> => {
    const requestId = ++qaHistoryRequest.current;
    const request = (async () => {
      const application = await ensureContext();
      if (!application.listQaDefects || !application.qaHistoryStats) {
        throw new Error('QA history is unavailable for this workspace.');
      }
      const [defects, stats] = await Promise.all([
        application.listQaDefects(),
        application.qaHistoryStats(),
      ]);
      if (
        active.current &&
        requestId === qaHistoryRequest.current &&
        stateRef.current.detail === 'bugs'
      ) {
        dispatch({ type: 'qa-history-loaded', defects, stats });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const loadQaDefectDetails = async (id: string): Promise<void> => {
    const requestId = ++qaDefectRequest.current;
    const request = (async () => {
      const application = await ensureContext();
      if (!application.getQaDefect)
        throw new Error('QA history is unavailable for this workspace.');
      const details = await application.getQaDefect(id);
      if (
        active.current &&
        requestId === qaDefectRequest.current &&
        stateRef.current.detail === 'bugs' &&
        stateRef.current.qaDefects?.[stateRef.current.qaDefectSelected]?.id === id
      ) {
        dispatch({ type: 'qa-defect-details-set', details });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const listFolder = async (path: string): Promise<void> => {
    const requestId = ++folderRequest.current;
    const request = (async () => {
      try {
        const entries: FolderEntry[] = await listWorkspaceEntries(path);
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
                    path: parentWorkspacePath(path),
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

  const prepareTodoLaunch = async (
    workflow: WorkflowContract,
    diagnosis: NonNullable<TuiState['diagnosis']>,
    path: string,
  ): Promise<void> => {
    const todo = await readTodoFile(path, stateRef.current.cwd);
    dispatch({
      type: 'launch-set',
      input: {
        workflow,
        values: { todo: todo.content, todoPath: todo.relativePath },
        field: 0,
        reviewedProfiles: profileReview(workflow, diagnosis),
      },
    });
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
    if (workflow.id === 'todo-build-qa') {
      const candidates = await discoverTodoFiles(next.cwd);
      if (candidates.length === 0) {
        dispatch({ type: 'todo-files-found', candidates });
        return;
      }
      if (candidates.length === 1) {
        await prepareTodoLaunch(workflow, diagnosis, candidates[0]!.path);
      } else {
        dispatch({ type: 'todo-files-found', candidates });
      }
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
      const input = {
        configPath: next.configPath,
        cwd: next.cwd,
        profileSettings: Object.fromEntries(
          next.setupEditedProfiles.flatMap((name) => {
            const profile = next.setupProfileValues[name];
            if (!profile?.provider || !profile.model) return [];
            return [
              [
                name,
                {
                  provider: profile.provider,
                  model: profile.model,
                  ...(profile.thinking ? { thinking: profile.thinking } : {}),
                  ...(name === 'builder' ? { writeAccess: profile.writeAccess === true } : {}),
                },
              ],
            ];
          }),
        ),
      };
      const generated = next.editingConfiguration
        ? await generateUpdatedConfiguration(input)
        : generateConfiguration(input);
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
      if (!next.editingConfiguration && (await configurationExists(next.configPath, next.cwd))) {
        dispatch({
          type: 'setup-save-failed',
          message: `Configuration already exists at ${next.generated.configPath}; nothing was overwritten.`,
        });
        return;
      }
      if (next.editingConfiguration) await replaceConfigurationAtomically(next.generated);
      else await writeConfigurationAtomically(next.generated);
      dispatch({ type: 'setup-written' });
    } catch (reason) {
      dispatch({
        type: 'setup-save-failed',
        message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
      });
    }
  };

  const loadRunDetails = async (
    application: ApplicationService,
    runId: string,
  ): Promise<{
    view: RunView;
    inspection?: RunInspection | undefined;
    clarifications: string[];
  }> => {
    const requests = Promise.allSettled([
      application.getRunView(runId),
      application.inspectRun(runId, { includeStepResults: 'usage' }),
    ]);
    lifecycle.trackRequest(requests);
    const [viewResult, inspectionResult] = await requests;
    if (viewResult.status === 'rejected') throw viewResult.reason;
    const inspection = inspectionResult.status === 'fulfilled' ? inspectionResult.value : undefined;
    let clarifications: string[] = [];
    if (inspection) {
      try {
        clarifications = await application.clarificationQuestions(inspection);
      } catch {
        // Clarifications are supplemental to the authoritative run view.
      }
    }
    return { view: viewResult.value, inspection, clarifications };
  };

  const loadTaskOutcome = async (application: ApplicationService, runId: string): Promise<void> => {
    if (!application.getTaskOutcome) return;
    const request = application.getTaskOutcome(runId);
    lifecycle.trackRequest(request);
    try {
      const outcome = await request;
      if (active.current && stateRef.current.activeRunId === runId)
        dispatch({ type: 'task-outcome-set', outcome });
    } catch {
      // Outcome projection is supplemental to the authoritative run view.
    }
  };

  const loadQaRound = async (runId: string, roundId: string): Promise<void> => {
    const requestId = ++qaRoundRequest.current;
    const request = (async () => {
      const application = await ensureContext();
      if (!application.getTaskQaRound) throw new Error('QA reports are unavailable for this run.');
      const round = await application.getTaskQaRound(runId, roundId);
      if (
        active.current &&
        requestId === qaRoundRequest.current &&
        stateRef.current.detail === 'qa-report' &&
        stateRef.current.activeRunId === runId &&
        stateRef.current.qaRoundId === roundId
      ) {
        dispatch({ type: 'qa-round-set', round });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const loadInspection = async (runId: string): Promise<void> => {
    const requestId = ++inspectionRequest.current;
    const request = (async () => {
      try {
        const application = await ensureContext();
        const { view, inspection, clarifications } = await loadRunDetails(application, runId);
        if (
          !active.current ||
          requestId !== inspectionRequest.current ||
          stateRef.current.activeRunId !== runId
        )
          return;
        let previews: Awaited<ReturnType<ApplicationService['loadResearchApprovalPreviews']>> = [];
        if (view.pendingAction) {
          if (inspection) {
            try {
              previews = await application.loadResearchApprovalPreviews(inspection);
            } catch {
              // Approval previews are supplemental to the authoritative run view.
            }
          }
        }
        if (
          !active.current ||
          requestId !== inspectionRequest.current ||
          stateRef.current.activeRunId !== runId
        )
          return;
        dispatch({ type: 'run-view-set', view, clarifications });
        await loadTaskOutcome(application, runId);
        if (view.pendingAction) dispatch({ type: 'approval-set', previews });
        else if (stateRef.current.detail === 'approval') dispatch({ type: 'leave-waiting' });
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

  const loadReview = async (runId: string): Promise<void> => {
    const requestId = ++reviewRequest.current;
    const request = (async () => {
      const application = await ensureContext();
      if (!application.getReview)
        throw new Error('Interactive review is unavailable for this run.');
      const review = await application.getReview(runId);
      if (
        active.current &&
        requestId === reviewRequest.current &&
        stateRef.current.activeRunId === runId
      ) {
        dispatch({ type: 'review-set', review });
      }
    })();
    lifecycle.trackRequest(request);
    await request;
  };

  const openPreparation = async (): Promise<void> => {
    const current = stateRef.current;
    const workflowId = current.preparationWorkflowId;
    if (
      workflowId !== 'plan-build' &&
      workflowId !== 'plan-build-qa' &&
      workflowId !== 'plan-build-qa-interactive'
    ) {
      dispatch({
        type: 'error-set',
        message: 'Preparation is available for plan-build workflows.',
      });
      return;
    }
    const application = await ensureContext();
    if (!application.createPreparation)
      throw new Error('Preparation is unavailable in this context.');
    const preparation = await application.createPreparation({ workspace: current.cwd, workflowId });
    if (active.current) {
      dispatch({ type: 'preparation-set', preparation });
      if (application.discoverPreparationModels) {
        const models = await application.discoverPreparationModels();
        if (active.current) dispatch({ type: 'preparation-models-set', models });
      }
      if (application.getPreparationOverview) {
        const overview = await application.getPreparationOverview(preparation.draft.id);
        if (active.current) dispatch({ type: 'preparation-overview-set', overview });
      }
      if (application.listPreparations) {
        const drafts = await application.listPreparations(current.cwd);
        if (active.current) dispatch({ type: 'preparations-loaded', drafts });
      }
    }
  };

  const reopenPreparation = async (draftId: string): Promise<void> => {
    const application = await ensureContext();
    if (!application.getPreparation) throw new Error('Preparation is unavailable in this context.');
    const preparation = await application.getPreparation(draftId);
    if (active.current) {
      dispatch({ type: 'preparation-set', preparation });
      if (application.getPreparationOverview) {
        const overview = await application.getPreparationOverview(draftId);
        if (active.current) dispatch({ type: 'preparation-overview-set', overview });
      }
    }
  };

  const sendPreparationMessage = (content: string): void => {
    const draftId = stateRef.current.preparation?.draft.id;
    if (!draftId) return;
    let controller: AbortController;
    try {
      controller = lifecycle.beginOperation();
    } catch (reason) {
      dispatch({
        type: 'error-set',
        message: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    setLaunching(true);
    lifecycle.trackOperation(
      (async () => {
        try {
          const application = await ensureContext();
          if (application.replyPreparationTurn) {
            await application.replyPreparationTurn({
              draftId,
              expectedRevision: stateRef.current.preparation?.draft.revision ?? 0,
              requestId: randomUUID(),
              content,
              signal: controller.signal,
              onPersisted: (overview) => {
                if (active.current && stateRef.current.preparation?.draft.id === draftId)
                  dispatch({ type: 'preparation-overview-set', overview });
              },
            });
            if (application.getPreparation) {
              const preparation = await application.getPreparation(draftId);
              if (active.current && stateRef.current.preparation?.draft.id === draftId) {
                dispatch({ type: 'preparation-set', preparation });
                if (application.getPreparationOverview) {
                  const overview = await application.getPreparationOverview(draftId);
                  if (active.current) dispatch({ type: 'preparation-overview-set', overview });
                }
              }
            }
          } else {
            if (!application.replyPreparation)
              throw new Error('Preparation is unavailable in this context.');
            const result = await application.replyPreparation({
              draftId,
              content,
              signal: controller.signal,
            });
            if (active.current && stateRef.current.preparation?.draft.id === draftId)
              dispatch({ type: 'preparation-replied', result });
          }
        } catch (reason) {
          if (active.current)
            dispatch({
              type: 'error-set',
              message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
            });
        } finally {
          setLaunching(false);
        }
      })(),
    );
  };

  const runPreparationProposalOperation = (
    kind:
      | 'generate'
      | 'review'
      | 'acknowledge'
      | 'accept-synthesis'
      | 'save-synthesis'
      | 'settings'
      | 'retry',
  ): void => {
    const current = stateRef.current;
    const preparation = current.preparation;
    if (!preparation) return;
    let controller: AbortController;
    try {
      controller = lifecycle.beginOperation();
    } catch (reason) {
      dispatch({
        type: 'error-set',
        message: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    setLaunching(true);
    lifecycle.trackOperation(
      (async () => {
        try {
          const application = await ensureContext();
          if (kind === 'generate' && application.generatePreparationProposal) {
            await application.generatePreparationProposal({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              requestId: randomUUID(),
              signal: controller.signal,
              onPersisted: (overview) => {
                if (active.current) dispatch({ type: 'preparation-overview-set', overview });
              },
            });
          } else if (
            kind === 'review' &&
            application.reviewPreparationProposal &&
            preparation.proposal
          ) {
            await application.reviewPreparationProposal({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              proposalId: preparation.proposal.id,
              requestId: randomUUID(),
              signal: controller.signal,
              onPersisted: (overview) => {
                if (active.current) dispatch({ type: 'preparation-overview-set', overview });
              },
            });
          } else if (
            kind === 'acknowledge' &&
            application.acknowledgePreparationReview &&
            current.preparationOverview?.review
          ) {
            await application.acknowledgePreparationReview({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              reviewId: current.preparationOverview.review.id,
            });
          } else if (kind === 'accept-synthesis' && application.updatePreparationSynthesis) {
            const suggestion = current.preparationOverview?.suggestion;
            if (!suggestion) throw new Error('No synthesis suggestion is awaiting confirmation.');
            await application.updatePreparationSynthesis({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              synthesis: suggestion.synthesis,
              coveredThroughSequence: suggestion.coveredThroughSequence,
              suggestionId: suggestion.id,
            });
          } else if (kind === 'save-synthesis' && application.updatePreparationSynthesis) {
            const synthesis = current.preparationSynthesisDraft;
            if (!synthesis) throw new Error('No synthesis is ready to save.');
            await application.updatePreparationSynthesis({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              synthesis,
              coveredThroughSequence: preparation.messages.at(-1)?.sequence ?? 0,
            });
          } else if (kind === 'settings' && application.updatePreparationSettings) {
            const role = current.preparationSettingRole;
            const selectedModel = current.preparationModels?.[current.preparationSelected];
            const patch: {
              producer?: PreparationSelection | null;
              reviewer?: PreparationSelection | null;
              reviewMode?: 'human' | 'optional-auto' | 'required-auto';
            } = {};
            if (role === 'reviewMode') {
              patch.reviewMode = ['human', 'optional-auto', 'required-auto'][
                current.preparationSelected
              ] as 'human' | 'optional-auto' | 'required-auto';
            } else if (role && selectedModel) {
              patch[role] = preparationSelectionForModel(selectedModel);
            } else {
              throw new Error('Preparation setting selection is unavailable.');
            }
            await application.updatePreparationSettings({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              patch,
            });
          } else if (kind === 'retry' && application.retryPreparationReply) {
            const userMessageId = current.preparationOverview?.operation?.userMessageId;
            if (!userMessageId) throw new Error('No recoverable preparation response was found.');
            await application.retryPreparationReply({
              draftId: preparation.draft.id,
              expectedRevision: preparation.draft.revision,
              userMessageId,
              requestId: randomUUID(),
              signal: controller.signal,
              onPersisted: (overview) => {
                if (active.current) dispatch({ type: 'preparation-overview-set', overview });
              },
            });
          } else {
            throw new Error('This preparation operation is unavailable in the current context.');
          }
          if (application.getPreparation) {
            const nextPreparation = await application.getPreparation(preparation.draft.id);
            if (active.current) dispatch({ type: 'preparation-set', preparation: nextPreparation });
          }
          if (application.getPreparationOverview && active.current) {
            const overview = await application.getPreparationOverview(preparation.draft.id);
            if (active.current) dispatch({ type: 'preparation-overview-set', overview });
          }
          if (kind === 'settings' && active.current) {
            dispatch({ type: 'preparation-settings-advance' });
          }
        } catch (reason) {
          if (active.current)
            dispatch({
              type: 'error-set',
              message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
            });
        } finally {
          setLaunching(false);
        }
      })(),
    );
  };

  const approvePreparation = (): void => {
    const current = stateRef.current;
    const preparation = current.preparation;
    if (!preparation?.proposal || current.preparationFocus !== 'actions') return;
    const workflow = discoverWorkflows().find(
      (candidate) => candidate.id === preparation.draft.workflowId,
    );
    if (!workflow) {
      dispatch({ type: 'error-set', message: 'Preparation workflow is unavailable.' });
      return;
    }
    startAttachedExecution(
      workflow,
      async (application, signal, onRunStarted) => {
        if (!application.approveAndExecutePreparation)
          throw new Error('Preparation approval is unavailable.');
        return application.approveAndExecutePreparation({
          draftId: preparation.draft.id,
          revision: preparation.draft.revision,
          proposalId: preparation.proposal!.id,
          signal,
          onRunStarted,
        });
      },
      (reason) =>
        `Preparation execution failed: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  };

  const sendReviewMessage = async (content: string): Promise<void> => {
    const current = stateRef.current;
    const runId = current.activeRunId;
    const threadId = current.reviewThreadId;
    const application = lifecycle.context?.application;
    if (!runId || !threadId || (!application?.replyReview && !application?.postReviewMessage))
      return;
    let controller: AbortController;
    try {
      controller = lifecycle.beginOperation();
    } catch (reason) {
      dispatch({
        type: 'error-set',
        message: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    setLaunching(true);
    lifecycle.trackOperation(
      (async () => {
        try {
          const request = application.replyReview
            ? application.replyReview({ runId, threadId, content, signal: controller.signal })
            : application.postReviewMessage!({ runId, threadId, content });
          const review = await request;
          if (active.current) dispatch({ type: 'review-message-sent', review });
        } catch (reason) {
          if (active.current)
            dispatch({
              type: 'error-set',
              message: explainUserError(reason instanceof Error ? reason.message : String(reason)),
            });
        } finally {
          setLaunching(false);
        }
      })(),
    );
  };

  const loadArtifact = async (cursor?: string): Promise<void> => {
    const current = stateRef.current;
    const artifact = current.runView?.artifacts[current.artifactSelected];
    const context = lifecycle.context;
    if (!artifact || !context || !current.runView) return;
    const requestId = ++artifactRequest.current;
    const runId = current.runView.id;
    const artifactKey = `${artifact.stepId}.${artifact.name}`;
    const cacheKey = `${artifact.id}:${cursor ?? ''}`;
    const cached = artifactPageCache.current.get(cacheKey);
    if (cached) {
      dispatch({ type: 'artifact-page-set', page: cached });
      return;
    }
    const application = context.application;
    const request = (async () => {
      try {
        if (application.readArtifactPage) {
          const page = await application.readArtifactPage(
            runId,
            artifactKey,
            cursor ? { cursor } : {},
          );
          artifactPageCache.current.set(cacheKey, page);
          while (artifactPageCache.current.size > 3) {
            const oldest = artifactPageCache.current.keys().next().value;
            if (oldest === undefined) break;
            artifactPageCache.current.delete(oldest);
          }
          if (
            active.current &&
            requestId === artifactRequest.current &&
            stateRef.current.runView?.id === runId &&
            stateRef.current.artifactSelected === current.artifactSelected
          ) {
            dispatch({ type: 'artifact-page-set', page });
          }
          return;
        }
        const content = await application.readArtifact(runId, artifactKey);
        if (
          active.current &&
          requestId === artifactRequest.current &&
          stateRef.current.runView?.id === runId &&
          stateRef.current.artifactSelected === current.artifactSelected
        )
          dispatch({ type: 'artifact-content-set', content });
      } catch (reason) {
        if (
          active.current &&
          requestId === artifactRequest.current &&
          stateRef.current.runView?.id === runId &&
          stateRef.current.artifactSelected === current.artifactSelected
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

  const finishRun = async (run: WorkflowRun): Promise<void> => {
    let view: RunView | undefined;
    let inspection: RunInspection | undefined;
    let clarifications: string[] = [];
    const context = lifecycle.context;
    if (context) {
      const application = context.application;
      try {
        ({ view, inspection, clarifications } = await loadRunDetails(application, run.id));
      } catch {
        view = undefined;
      }
    }
    disposeLiveControllers();
    setLiveValue(undefined);
    if (!view) {
      dispatch({ type: 'error-set', message: 'Unable to refresh the authoritative run view.' });
      return;
    }
    dispatch({ type: 'run-view-set', view, clarifications });
    if (context?.application) await loadTaskOutcome(context.application, run.id);
    if (view.pendingAction) {
      let previews: Awaited<ReturnType<ApplicationService['loadResearchApprovalPreviews']>> = [];
      const application = context?.application;
      if (application && inspection) {
        try {
          previews = await application.loadResearchApprovalPreviews(inspection);
        } catch {
          // Approval previews are supplemental to the authoritative run view.
        }
      }
      dispatch({ type: 'approval-set', previews });
    }
    dispatch({ type: 'run-finished', status: view.status });
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

  type AttachedOperation = (
    application: ApplicationService,
    signal: AbortSignal,
    onRunStarted: (run: WorkflowRun) => void,
  ) => Promise<WorkflowRun | undefined>;

  const startAttachedExecution = (
    workflow: WorkflowContract,
    operation: AttachedOperation,
    formatError: (reason: unknown) => string,
  ): void => {
    let controller: AbortController;
    try {
      controller = lifecycle.beginOperation();
    } catch (reason) {
      dispatch({
        type: 'error-set',
        message: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    setLaunching(true);
    const executionContext = openExecutionContext();
    lifecycle.trackOperation(
      (async () => {
        try {
          const application = await executionContext;
          if (controller.signal.aborted) throw new Error('Workflow startup cancelled.');
          attachLiveControllers(application);
          lifecycle.subscribe(application.subscribeEvents((event) => handleLiveEvent(event)));
          const run = await operation(application, controller.signal, (startedRun) => {
            activeRunId.current = startedRun.id;
            setLiveValue(createLiveState(startedRun, workflow));
            refreshLiveView(application, startedRun.id);
            setLiveDetail(false);
            setLiveOffset(0);
            dispatch({ type: 'run-started', runId: startedRun.id });
          });
          if (run) {
            uiPublisherRef.current?.flush();
            await snapshotControllerRef.current?.flush();
            await finishRun(run);
          }
        } catch (reason) {
          const current = liveRef.current;
          if (current) {
            await finishRun({
              ...current.run,
              status: current.cancellationRequested ? 'cancelled' : 'failed',
              updatedAt: new Date().toISOString(),
            });
          } else {
            dispatch({ type: 'error-set', message: formatError(reason) });
          }
        } finally {
          lifecycle.unsubscribe();
          disposeLiveControllers();
          activeRunId.current = undefined;
          setLaunching(false);
        }
      })(),
    );
  };

  const startLaunch = (): void => {
    const launchInput = stateRef.current.launchInput;
    const diagnosis = stateRef.current.diagnosis;
    if (!launchInput || !diagnosis) return;
    startAttachedExecution(
      launchInput.workflow,
      async (application, signal, onRunStarted) => {
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
          return undefined;
        }
        const objective = launchInput.values.objective;
        if (!objective) throw new Error('Workflow objective must be a non-empty string');
        dispatch({ type: 'status-set', message: `Starting ${launchInput.workflow.id}...` });
        return application.runWorkflow({
          workflowId: launchInput.workflow.id,
          objective,
          input: launchInput.values,
          signal,
          onRunStarted,
        });
      },
      (reason) =>
        `Launch failed: ${reason instanceof Error ? reason.message : String(reason)}. Retry or go back to edit the workflow.`,
    );
  };

  const startContinuation = (operation: AttachedOperation, workflowId: string): void => {
    const view = stateRef.current.runView;
    if (!view) return;
    const workflow = discoverWorkflows().find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      dispatch({ type: 'error-set', message: `Workflow ${workflowId} is unavailable.` });
      return;
    }
    startAttachedExecution(workflow, operation, (reason) =>
      reason instanceof Error ? reason.message : String(reason),
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
        case 'setup-written':
          if (previous.editingConfiguration) await replaceWorkspaceContext();
          break;
        case 'todo-select': {
          const candidate = next.todoCandidates?.[next.selection];
          const workflow =
            next.workflows?.find((item) => item.id === 'todo-build-qa') ??
            discoverWorkflows().find((item) => item.id === 'todo-build-qa');
          if (candidate && workflow && next.diagnosis) {
            await prepareTodoLaunch(workflow, next.diagnosis, candidate.path);
          }
          break;
        }
        case 'open-bugs':
          if (next.detail === 'bugs') await loadQaHistory();
          break;
        case 'open-qa-defect':
          if (next.detail === 'bugs') await loadQaDefectDetails(event.id);
          break;
        case 'open-review':
          if (next.detail === 'review' && next.activeRunId) await loadReview(next.activeRunId);
          break;
        case 'open-qa-report':
        case 'qa-round-select':
          if (next.detail === 'qa-report' && next.activeRunId && next.qaRoundId)
            await loadQaRound(next.activeRunId, next.qaRoundId);
          break;
        case 'open-preparation':
          if (next.detail === 'preparation') await openPreparation();
          break;
        case 'preparation-message-submit':
          if (next !== previous) sendPreparationMessage(event.content);
          break;
        case 'preparation-generate-proposal':
          if (next !== previous) runPreparationProposalOperation('generate');
          break;
        case 'preparation-accept-synthesis':
          if (next !== previous) runPreparationProposalOperation('accept-synthesis');
          break;
        case 'preparation-retry':
          if (next !== previous) runPreparationProposalOperation('retry');
          break;
        case 'preparation-synthesis-save':
          if (next !== previous) runPreparationProposalOperation('save-synthesis');
          break;
        case 'preparation-setting-select':
          if (next !== previous) runPreparationProposalOperation('settings');
          break;
        case 'preparation-review-proposal':
          if (next !== previous) runPreparationProposalOperation('review');
          break;
        case 'preparation-ack-review':
          if (next !== previous) runPreparationProposalOperation('acknowledge');
          break;
        case 'preparation-approve':
          if (next !== previous) approvePreparation();
          break;
        case 'preparation-open-draft':
          if (next !== previous) await reopenPreparation(event.draftId);
          break;
        case 'review-message-submit':
          if (next !== previous) await sendReviewMessage(event.content);
          break;
        case 'review-explain': {
          if (next === previous) break;
          const review = next.review;
          const thread = review?.threads.find((entry) => entry.thread.id === next.reviewThreadId);
          const runId = next.activeRunId;
          if (!thread || !runId) break;
          const workflow = discoverWorkflows().find(
            (candidate) => candidate.id === next.runView?.workflow.id,
          );
          if (!workflow) {
            dispatch({ type: 'error-set', message: 'Interactive review workflow is unavailable.' });
            break;
          }
          startAttachedExecution(
            workflow,
            async (application, signal) => {
              const result = await application.explainReview!({
                runId,
                threadId: thread.thread.id,
                target: thread.thread.target,
                evidence: thread.messages
                  .map((message) => message.content ?? '')
                  .join('\\n')
                  .slice(0, 12_000),
                signal,
              });
              if (active.current) dispatch({ type: 'review-explained', review: result.review });
              return undefined;
            },
            (reason) =>
              `Explanation failed: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
          break;
        }
        case 'review-decide':
          if (next === previous) break;
          if (next.activeRunId && next.reviewThreadId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application.decideReview!({
                  runId: next.activeRunId!,
                  threadId: next.reviewThreadId!,
                  target: next.review!.threads.find(
                    (entry) => entry.thread.id === next.reviewThreadId,
                  )!.thread.target,
                  decision: event.decision,
                  signal,
                  onRunStarted,
                }),
              'plan-build-qa-interactive',
            );
          }
          break;
        case 'review-finalize':
          if (next === previous) break;
          if (next.activeRunId && next.reviewThreadId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application.finalizeReview!({
                  runId: next.activeRunId!,
                  threadId: next.reviewThreadId!,
                  target: next.review!.threads.find(
                    (entry) => entry.thread.id === next.reviewThreadId,
                  )!.thread.target,
                  signal,
                  onRunStarted,
                }),
              'plan-build-qa-interactive',
            );
          }
          break;
        case 'launch-confirm':
          startLaunch();
          break;
        case 'setup-next':
        case 'setup-profile-select':
        case 'setup-choice':
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
          const runId = next.runView?.id;
          if (runId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application
                  .resumeWorkflow({ runId, signal, onRunStarted })
                  .then((result) => result.run),
              next.runView!.workflow.id,
            );
          }
          break;
        }
        case 'approval-approve': {
          if (next === previous) break;
          const runId = next.runView?.id;
          if (runId) {
            startContinuation(
              (application, signal, onRunStarted) =>
                application.decideApproval({ runId, decision: 'approved', signal, onRunStarted }),
              next.runView!.workflow.id,
            );
          }
          break;
        }
        case 'rejection-submitted': {
          if (next === previous) break;
          const runId = next.runView?.id;
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
              next.runView!.workflow.id,
            );
          }
          break;
        }
        case 'recovery-confirmed': {
          if (next === previous) break;
          const runId = next.runView?.id;
          const application = lifecycle.context?.application;
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
        const request =
          discoverModels?.() ??
          lifecycle.context?.application.discoverModels() ??
          (await import('../application/runtime.js')).discoverAvailableModels();
        lifecycle.trackRequest(request);
        const models = await request;
        if (active.current) dispatch({ type: 'setup-models', models });
      } else if (next.effect === 'diagnose-cwd') {
        await runDiagnose(
          event.type === 'use-folder' ||
            event.type === 'folder-confirm' ||
            event.type === 'refresh-diagnosis',
        );
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
      return liveRef.current !== undefined;
    });
  }, [lifecycle, registerSignalHandler, belowMinimumSize]);

  useInput((input, key) => {
    handleShellInput({
      input,
      key,
      current: stateRef.current,
      belowMinimumSize,
      launching,
      hasLiveExecution: liveRef.current !== undefined,
      operationActive: lifecycle.operationActive === true,
      size,
      dispatch,
      requestCancellation,
      exit,
      toggleLiveDetail: () => setLiveDetail((detail) => !detail),
      moveLive: (direction) => {
        const lines = liveDetail
          ? (live?.activity.length ?? 0)
          : Math.min(8, live?.activity.length ?? 0);
        const visibleRows = Math.max(1, size.rows - 13);
        setLiveOffset((offset) => scrollText(offset, direction, Math.max(1, lines), visibleRows));
      },
      loadArtifact: (cursor) => void loadArtifact(cursor),
    });
  });

  usePaste(
    (text) => {
      const current = stateRef.current;
      if (current.detail !== 'preparation' || current.preparationFocus !== 'editor') return;
      dispatch({ type: 'input-change', value: `${current.inputValue}${text}` });
    },
    {
      isActive:
        stateRef.current.detail === 'preparation' && stateRef.current.preparationFocus === 'editor',
    },
  );

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
      case 'setup': {
        const profileMode = state.setupProfile !== undefined && !state.setupProfileSelection;
        const profileField = profileMode
          ? setupProfileFields(state.setupProfile!)[state.setupField]
          : undefined;
        const choices = profileMode
          ? setupProfileChoices(
              state.setupProfile!,
              state.setupField,
              state.setupModels ?? [],
              state.setupProfileValues,
            )
          : setupChoices(state.setupField, state.setupModels ?? []);
        const profileLabels = SETUP_PROFILES.map((profile) => {
          const configured = state.setupProfileValues[profile]?.model ? 'configured' : 'missing';
          return `${profile} (${configured})`;
        }).concat('Review and save');
        const profileValue = profileMode
          ? (() => {
              const value = state.setupProfileValues[state.setupProfile!];
              if (profileField?.key === 'writeAccess')
                return value?.writeAccess === true ? 'yes' : 'no';
              if (profileField?.key === 'thinking') return value?.thinking ?? '';
              return value?.[profileField?.key ?? 'model'] ?? '';
            })()
          : '';
        return (
          <SetupWizardScreen
            key={`${state.setupStep}-${state.setupField}-${state.setupProfile ?? 'profiles'}`}
            colors={colors}
            step={state.setupStep}
            {...(state.diagnosis ? { diagnosis: state.diagnosis } : {})}
            {...(state.setupStep === 2 || state.setupStep === 3
              ? { field: SETUP_FIELDS[state.setupField]! }
              : {})}
            {...(profileField ? { profileField } : {})}
            choices={choices}
            {...(state.error ? { error: state.error } : {})}
            selected={state.selection}
            offset={state.offset}
            setupProfileSelection={state.setupProfileSelection}
            profileLabels={profileLabels}
            setupPreviewOffset={state.setupPreviewOffset}
            editing={state.editingConfiguration}
            value={
              state.inputValue ||
              profileValue ||
              (state.setupStep === 2 || state.setupStep === 3
                ? (state.setupValues[SETUP_FIELDS[state.setupField]!.key] ?? '')
                : '')
            }
            onChange={(value) => dispatch({ type: 'input-change', value })}
            onSubmit={(value) => {
              setTimeout(() => dispatch({ type: 'setup-submit', value }), 0);
            }}
            {...(state.generated ? { generated: state.generated } : {})}
            showFullConfig={state.showFullConfig}
          />
        );
      }
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

  return renderShellDetail({
    colors,
    state,
    ...(live ? { live } : {}),
    liveDetail,
    liveOffset,
    size,
    launching,
    onEvent: dispatch,
  });
}
