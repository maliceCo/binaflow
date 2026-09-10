import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentProfile } from '../core/agent-profile.js';
import type { AgentDriver } from '../core/agent.js';
import type { AgentStepResult, AgentProfileSnapshot } from '../core/run.js';
import type { ApplicationInternals } from './context.js';
import type { ApplicationPreparationStore } from './ports.js';
import {
  createPreparationProposal,
  parsePreparationAgentResponse,
  type PreparationConversation,
  type PreparationDraft,
  type PreparationMessage,
  type PreparationProposal,
  type PreparationSelection,
  type PreparationSettingsPatch,
  type PreparationWorkflowId,
  type UpdatePreparationSynthesisRequest,
} from './preparation.js';
import { validateAgentProfile } from '../config.js';
import {
  effectivePreparationReviewMode,
  parsePreparationReviewReport,
} from './preparation-review.js';
import { resolveWorkflow } from '../workflows/catalog.js';
import { validateWorkflowDefinition } from '../core/workflow.js';
import { validateWorkflowProfiles } from './workflow-operations.js';
import { createRunFromPreparation } from './execution-operations.js';

export interface CreatePreparationRequest {
  workspace: string;
  workflowId: PreparationWorkflowId;
  objective?: string;
  producer?: PreparationSelection | null;
  reviewer?: PreparationSelection | null;
  reviewMode?: import('../config.js').PreparationReviewMode;
}

export interface UpdatePreparationSettingsRequest {
  draftId: string;
  expectedRevision: number;
  patch: PreparationSettingsPatch;
}

export interface ReplyPreparationRequest {
  draftId: string;
  content: string;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ApproveAndExecutePreparationRequest {
  draftId: string;
  revision: number;
  proposalId: string;
  signal?: AbortSignal;
  onRunStarted?: (run: import('../core/run.js').WorkflowRun) => void | Promise<void>;
}

export interface PreparationReplyResult {
  conversation: PreparationConversation;
  response: PreparationMessage;
  proposal?: PreparationProposal;
}

type PreparationContext = Pick<
  ApplicationInternals,
  | 'config'
  | 'preparationStore'
  | 'preparationDriver'
  | 'preparationArtifacts'
  | 'readPreparationReviewMode'
> &
  Partial<Pick<ApplicationInternals, 'store'>>;

type PreparationExperienceStore = ApplicationPreparationStore & {
  beginPreparationTurn: NonNullable<ApplicationPreparationStore['beginPreparationTurn']>;
  finishPreparationTurn: NonNullable<ApplicationPreparationStore['finishPreparationTurn']>;
};

type PreparationReviewStore = PreparationExperienceStore & {
  beginPreparationReview: NonNullable<ApplicationPreparationStore['beginPreparationReview']>;
  finishPreparationReview: NonNullable<ApplicationPreparationStore['finishPreparationReview']>;
};

export async function createPreparation(
  context: PreparationContext,
  request: CreatePreparationRequest,
): Promise<PreparationConversation> {
  const store = requirePreparationStore(context);
  const workspace = await canonicalWorkspace(request.workspace);
  const now = new Date().toISOString();
  const draft: PreparationDraft = {
    id: randomUUID(),
    workspace,
    workflowId: request.workflowId,
    workflowVersion: 1,
    objective: request.objective?.trim() ?? '',
    revision: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  await store.createPreparation(draft);
  if (
    request.producer !== undefined ||
    request.reviewer !== undefined ||
    request.reviewMode !== undefined
  ) {
    if (!store.updatePreparationSettings) {
      throw new Error('Preparation settings are not supported by this storage adapter');
    }
    const patch: PreparationSettingsPatch = {};
    if (request.producer !== undefined) patch.producer = request.producer;
    if (request.reviewer !== undefined) patch.reviewer = request.reviewer;
    if (request.reviewMode !== undefined) patch.reviewMode = request.reviewMode;
    await updatePreparationSettings(context, {
      draftId: draft.id,
      expectedRevision: draft.revision,
      patch,
    });
    return getPreparation(context, draft.id);
  }
  return { draft, messages: [] };
}

export async function updatePreparationSettings(
  context: PreparationContext,
  request: UpdatePreparationSettingsRequest,
) {
  const store = requirePreparationStore(context);
  if (!store.updatePreparationSettings) {
    throw new Error('Preparation settings are not supported by this storage adapter');
  }
  validatePreparationSelection(context, request.patch.producer);
  validatePreparationSelection(context, request.patch.reviewer);
  return store.updatePreparationSettings(request);
}

export async function updatePreparationSynthesis(
  context: PreparationContext,
  request: UpdatePreparationSynthesisRequest,
) {
  const store = requirePreparationStore(context);
  if (!store.updatePreparationSynthesis) {
    throw new Error('Preparation synthesis is not supported by this storage adapter');
  }
  return store.updatePreparationSynthesis(request);
}

export async function listPreparations(
  context: PreparationContext,
  workspace?: string,
): Promise<PreparationDraft[]> {
  const store = requirePreparationStore(context);
  return store.listPreparations(
    workspace === undefined ? undefined : await canonicalWorkspace(workspace),
  );
}

export async function getPreparation(
  context: PreparationContext,
  draftId: string,
): Promise<PreparationConversation> {
  const preparation = await requirePreparationStore(context).getPreparation(draftId);
  if (!preparation) throw new Error(`Unknown preparation: ${draftId}`);
  return preparation;
}

export async function replyPreparation(
  context: PreparationContext,
  request: ReplyPreparationRequest,
): Promise<PreparationReplyResult> {
  const store = requirePreparationStore(context);
  const driver = requirePreparationDriver(context);
  const profile = plannerProfile(context);
  const current = await getPreparation(context, request.draftId);
  const content = request.content.trim();
  if (!content) throw new Error('Preparation message must be non-empty');
  if (current.draft.status !== 'active')
    throw new Error(`Preparation ${request.draftId} is no longer active`);

  if (store.beginPreparationTurn && store.finishPreparationTurn) {
    return replyPreparationWithExperience(
      context,
      request,
      current,
      profile,
      store as PreparationExperienceStore,
      driver,
    );
  }

  const claim = await store.claimPreparation(request.draftId, {
    draftId: request.draftId,
    revision: current.draft.revision,
  });
  if (!claim)
    throw new Error(`Preparation ${request.draftId} is already being generated or is stale`);

  const now = new Date().toISOString();
  const userMessage: PreparationMessage = {
    id: randomUUID(),
    draftId: request.draftId,
    sequence: current.messages.length + 1,
    role: 'user',
    content,
    generationStatus: 'sent',
    createdAt: now,
    updatedAt: now,
  };
  await store.savePreparationMessage(userMessage, current.draft.revision, claim);
  const afterUser = await getPreparation(context, request.draftId);
  const assistantId = randomUUID();
  const pending: PreparationMessage = {
    id: assistantId,
    draftId: request.draftId,
    sequence: afterUser.messages.length + 1,
    role: 'assistant',
    content: 'Generating preparation response',
    generationStatus: 'pending',
    profileSnapshot: snapshotProfile(profile),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.savePreparationMessage(pending, afterUser.draft.revision, claim);
  const afterPending = await getPreparation(context, request.draftId);

  try {
    const result = await driver.execute(
      {
        runId: request.draftId,
        stepId: 'preparation',
        profile,
        prompt: buildPreparationPrompt(afterPending),
      },
      async () => undefined,
      request.signal ?? new AbortController().signal,
    );
    const response = parseResponse(result);
    const responseMessage: PreparationMessage = {
      ...pending,
      content: response.content,
      generationStatus: 'sent',
      updatedAt: new Date().toISOString(),
    };
    await store.savePreparationMessage(responseMessage, afterPending.draft.revision, claim);
    let proposal: PreparationProposal | undefined;
    if (response.kind === 'proposal') {
      proposal = createPreparationProposal({
        id: randomUUID(),
        draftId: request.draftId,
        revision: afterPending.draft.revision,
        workflowId: afterPending.draft.workflowId,
        workflowVersion: afterPending.draft.workflowVersion,
        objective: response.objective,
        outputs: response.outputs,
        provenance: { profile: 'planner', profileSnapshot: snapshotProfile(profile) },
      });
      await store.publishPreparationProposal(proposal, afterPending.draft.revision, claim);
    }
    await store.releasePreparation(request.draftId, claim);
    const conversation = await getPreparation(context, request.draftId);
    return { conversation, response: responseMessage, ...(proposal ? { proposal } : {}) };
  } catch (error) {
    const interrupted = request.signal?.aborted === true;
    await store
      .savePreparationMessage(
        {
          ...pending,
          generationStatus: interrupted ? 'interrupted' : 'failed',
          updatedAt: new Date().toISOString(),
        },
        afterPending.draft.revision,
        claim,
      )
      .catch(() => undefined);
    await store.releasePreparation(request.draftId, claim).catch(() => undefined);
    throw error;
  }
}

async function replyPreparationWithExperience(
  context: PreparationContext,
  request: ReplyPreparationRequest,
  current: PreparationConversation,
  profile: AgentProfile,
  store: PreparationExperienceStore,
  driver: AgentDriver,
): Promise<PreparationReplyResult> {
  const result = await runPreparationAgentTurn(
    context,
    {
      draftId: request.draftId,
      expectedRevision: current.draft.revision,
      requestId: request.requestId ?? randomUUID(),
      input: { kind: 'reply', content: request.content },
      ...(request.signal ? { signal: request.signal } : {}),
    },
    profile,
    store,
    driver,
  );
  const conversation = await getPreparation(context, request.draftId);
  const responseMessage = result.assistantMessageId
    ? conversation.messages.find((message) => message.id === result.assistantMessageId)
    : undefined;
  if (!responseMessage) throw new Error('Persisted preparation response is missing');
  return {
    conversation,
    response: responseMessage,
    ...(result.proposalId
      ? {
          proposal: conversation.proposal,
        }
      : {}),
  };
}

export interface ReplyPreparationTurnRequest {
  draftId: string;
  expectedRevision: number;
  requestId: string;
  content: string;
  signal?: AbortSignal;
  onPersisted?: (
    overview: import('./preparation.js').PreparationStoredView,
  ) => void | Promise<void>;
}

export interface RetryPreparationReplyRequest {
  draftId: string;
  expectedRevision: number;
  userMessageId: string;
  requestId: string;
  signal?: AbortSignal;
  onPersisted?: (
    overview: import('./preparation.js').PreparationStoredView,
  ) => void | Promise<void>;
}

export interface GeneratePreparationProposalRequest {
  draftId: string;
  expectedRevision: number;
  requestId: string;
  signal?: AbortSignal;
  onPersisted?: (
    overview: import('./preparation.js').PreparationStoredView,
  ) => void | Promise<void>;
}

export interface ReviewPreparationProposalRequest {
  draftId: string;
  expectedRevision: number;
  proposalId: string;
  requestId: string;
  signal?: AbortSignal;
  onPersisted?: (
    overview: import('./preparation.js').PreparationStoredView,
  ) => void | Promise<void>;
}

export interface AcknowledgePreparationReviewRequest {
  draftId: string;
  expectedRevision: number;
  reviewId: string;
}

export async function replyPreparationTurn(
  context: PreparationContext,
  request: ReplyPreparationTurnRequest,
): Promise<import('./preparation.js').PreparationTurnResult> {
  return runPreparationAgentTurn(
    context,
    { ...request, input: { kind: 'reply', content: request.content } },
    plannerProfile(context),
    requireExperienceStore(context),
    requirePreparationDriver(context),
  );
}

export async function retryPreparationReply(
  context: PreparationContext,
  request: RetryPreparationReplyRequest,
): Promise<import('./preparation.js').PreparationTurnResult> {
  return runPreparationAgentTurn(
    context,
    {
      ...request,
      input: { kind: 'retry', userMessageId: request.userMessageId },
    },
    plannerProfile(context),
    requireExperienceStore(context),
    requirePreparationDriver(context),
  );
}

export async function generatePreparationProposal(
  context: PreparationContext,
  request: GeneratePreparationProposalRequest,
): Promise<import('./preparation.js').PreparationTurnResult> {
  return runPreparationAgentTurn(
    context,
    { ...request, input: { kind: 'proposal' } },
    plannerProfile(context),
    requireExperienceStore(context),
    requirePreparationDriver(context),
  );
}

export async function reviewPreparationProposal(
  context: PreparationContext,
  request: ReviewPreparationProposalRequest,
): Promise<import('./preparation.js').PreparationStoredView> {
  const store = requirePreparationStore(context);
  if (!store.beginPreparationReview || !store.finishPreparationReview) {
    throw new Error('Preparation review operations are not supported by this storage adapter');
  }
  const current = await getPreparation(context, request.draftId);
  if (!current.proposal || current.proposal.id !== request.proposalId) {
    throw new Error('Preparation proposal is stale');
  }
  const experienceStore = store as PreparationReviewStore;
  const globalMode = context.readPreparationReviewMode
    ? await context.readPreparationReviewMode()
    : (context.config.preparation?.reviewMode ?? 'human');
  const overview = await store.getPreparationOverview?.(request.draftId);
  if (!overview) throw new Error('Preparation overview is unavailable');
  const effectiveMode = effectivePreparationReviewMode(globalMode, overview.draft.reviewMode);
  const reviewer = plannerProfile(context, overview.draft.reviewer);
  if (request.signal?.aborted)
    throw new Error('Preparation review was cancelled before it started');
  const claim = await store.claimPreparation(request.draftId, {
    draftId: request.draftId,
    revision: request.expectedRevision,
  });
  if (!claim)
    throw new Error(`Preparation ${request.draftId} is already being reviewed or is stale`);
  let begun: Awaited<ReturnType<typeof experienceStore.beginPreparationReview>> | undefined;
  try {
    begun = await experienceStore.beginPreparationReview({
      draftId: request.draftId,
      expectedRevision: request.expectedRevision,
      claimToken: claim,
      proposalId: request.proposalId,
      requestId: request.requestId,
      effectivePolicy: effectiveMode,
      provenance: { profile: 'reviewer', profileSnapshot: snapshotProfile(reviewer) },
    });
    const persisted = await store.getPreparationOverview?.(request.draftId);
    if (persisted) await request.onPersisted?.(persisted);
    const result = await reviewerDriver(context).execute(
      {
        runId: request.draftId,
        stepId: 'preparation-review',
        profile: reviewer,
        prompt: buildPreparationReviewPrompt(current, effectiveMode),
      },
      async () => undefined,
      request.signal ?? new AbortController().signal,
    );
    const report = parsePreparationReviewReport(JSON.parse(result.text));
    const reviewId = randomUUID();
    const finished = await experienceStore.finishPreparationReview({
      draftId: request.draftId,
      reviewRequestId: begun.reviewRequestId,
      claimToken: claim,
      expectedRevision: begun.draftRevision,
      contentVersion: begun.contentVersion,
      outcome: {
        kind: 'report',
        reviewId,
        report,
        reviewerSnapshot: snapshotProfile(reviewer),
        mode: effectiveMode,
        proposalId: request.proposalId,
      },
    });
    await store.releasePreparation(request.draftId, claim);
    return finished;
  } catch (error) {
    if (begun) {
      await experienceStore
        .finishPreparationReview({
          draftId: request.draftId,
          reviewRequestId: begun.reviewRequestId,
          claimToken: claim,
          expectedRevision: begun.draftRevision,
          contentVersion: begun.contentVersion,
          outcome: {
            kind: 'failure',
            status: request.signal?.aborted ? 'interrupted' : 'failed',
            error: { code: 'PREPARATION_REVIEW_FAILED', message: errorMessage(error) },
          },
        })
        .catch(() => undefined);
    }
    await store.releasePreparation(request.draftId, claim).catch(() => undefined);
    throw error;
  }
}

export async function acknowledgePreparationReview(
  context: PreparationContext,
  request: AcknowledgePreparationReviewRequest,
): Promise<import('./preparation.js').PreparationStoredView> {
  const store = requirePreparationStore(context);
  if (!store.acknowledgePreparationReview) {
    throw new Error('Preparation review acknowledgement is not supported by this storage adapter');
  }
  return store.acknowledgePreparationReview(request);
}

async function runPreparationAgentTurn(
  context: PreparationContext,
  request: {
    draftId: string;
    expectedRevision: number;
    requestId: string;
    input: import('./preparation.js').PreparationTurnInput;
    signal?: AbortSignal;
    onPersisted?: (
      overview: import('./preparation.js').PreparationStoredView,
    ) => void | Promise<void>;
  },
  profile: AgentProfile,
  store: PreparationExperienceStore,
  driver: AgentDriver,
): Promise<import('./preparation.js').PreparationTurnResult> {
  if (request.signal?.aborted)
    throw new Error('Preparation operation was cancelled before it started');
  const claim = await store.claimPreparation(request.draftId, {
    draftId: request.draftId,
    revision: request.expectedRevision,
  });
  if (!claim)
    throw new Error(`Preparation ${request.draftId} is already being generated or is stale`);
  let begun: Awaited<ReturnType<typeof store.beginPreparationTurn>> | undefined;
  try {
    begun = await store.beginPreparationTurn({
      draftId: request.draftId,
      expectedRevision: request.expectedRevision,
      claimToken: claim,
      requestId: request.requestId,
      input: request.input,
      provenance: { profile: 'planner', profileSnapshot: snapshotProfile(profile) },
    });
    const persisted = await store.getPreparationOverview?.(request.draftId);
    if (persisted) await request.onPersisted?.(persisted);
    const pending = await getPreparation(context, request.draftId);
    const result = await driver.execute(
      {
        runId: request.draftId,
        stepId: 'preparation',
        profile,
        prompt: buildPreparationPrompt(pending, persisted?.synthesis.value),
      },
      async () => undefined,
      request.signal ?? new AbortController().signal,
    );
    const response = parseResponse(result);
    const assistant = begun.assistantMessageId
      ? pending.messages.find((message) => message.id === begun!.assistantMessageId)
      : undefined;
    const suggestion =
      response.kind === 'message' && response.synthesisSuggestion && assistant
        ? {
            id: randomUUID(),
            baseVersion: response.synthesisSuggestion.baseVersion,
            synthesis: response.synthesisSuggestion.synthesis,
            coveredThroughSequence: response.synthesisSuggestion.coveredThroughSequence,
            sourceMessageId: assistant.id,
            status: 'pending' as const,
          }
        : undefined;
    const proposal =
      response.kind === 'proposal'
        ? createPreparationProposal({
            id: randomUUID(),
            draftId: request.draftId,
            revision: begun.draftRevision + 1,
            workflowId: pending.draft.workflowId,
            workflowVersion: pending.draft.workflowVersion,
            objective: response.objective,
            outputs: response.outputs,
            provenance: { profile: 'planner', profileSnapshot: snapshotProfile(profile) },
          })
        : undefined;
    await store.finishPreparationTurn({
      draftId: request.draftId,
      turnId: begun.turnId,
      claimToken: claim,
      expectedRevision: begun.draftRevision,
      contentVersion: begun.contentVersion,
      outcome: {
        kind: 'response',
        ...(assistant
          ? {
              assistantMessage: {
                ...assistant,
                content: response.content,
                generationStatus: 'sent' as const,
                updatedAt: new Date().toISOString(),
              },
            }
          : {}),
        ...(suggestion ? { synthesisSuggestion: suggestion } : {}),
        ...(proposal ? { proposal } : {}),
      },
    });
    const overview = await store.getPreparationOverview?.(request.draftId);
    if (!overview) throw new Error('Preparation overview is unavailable after persistence');
    await store.releasePreparation(request.draftId, claim);
    const operation = overview.operation;
    if (!operation) throw new Error('Preparation operation is missing after persistence');
    return {
      overview,
      operation,
      ...(begun.userMessageId ? { userMessageId: begun.userMessageId } : {}),
      ...(begun.assistantMessageId ? { assistantMessageId: begun.assistantMessageId } : {}),
      ...(proposal ? { proposalId: proposal.id } : {}),
    };
  } catch (error) {
    if (begun) {
      await store
        .finishPreparationTurn({
          draftId: request.draftId,
          turnId: begun.turnId,
          claimToken: claim,
          expectedRevision: begun.draftRevision,
          contentVersion: begun.contentVersion,
          outcome: {
            kind: 'failure',
            status: request.signal?.aborted ? 'interrupted' : 'failed',
            error: { code: 'PREPARATION_GENERATION_FAILED', message: errorMessage(error) },
          },
        })
        .catch(() => undefined);
    }
    await store.releasePreparation(request.draftId, claim).catch(() => undefined);
    throw error;
  }
}

export async function recoverPreparation(
  context: PreparationContext,
  request: { draftId: string; expectedRevision: number },
): Promise<import('./preparation.js').PreparationStoredView> {
  const store = requirePreparationStore(context);
  if (store.recoverPreparationView) {
    return store.recoverPreparationView(request.draftId, request.expectedRevision);
  }
  await store.recoverPreparation(request.draftId);
  const overview = await store.getPreparationOverview?.(request.draftId);
  if (!overview) throw new Error('Preparation recovery is not supported by this storage adapter');
  return overview;
}

export async function approveAndExecutePreparation(
  context: PreparationContext,
  request: ApproveAndExecutePreparationRequest,
): Promise<import('../core/run.js').WorkflowRun> {
  const store = requirePreparationStore(context);
  const artifacts = context.preparationArtifacts;
  if (!artifacts) throw new Error('Preparation artifact storage is not configured');
  const current = await getPreparation(context, request.draftId);
  const stored = await store.getPreparationOverview?.(request.draftId);
  const proposal = current.proposal;
  if (
    current.draft.status !== 'active' ||
    current.draft.revision !== request.revision ||
    !proposal ||
    proposal.id !== request.proposalId
  ) {
    throw new Error(`Preparation ${request.draftId} proposal is stale`);
  }
  let effectiveReviewMode: import('../config.js').PreparationReviewMode | undefined;
  if (stored) {
    if (stored.draft.validProposalId !== proposal.id) {
      throw new Error(`Preparation ${request.draftId} proposal is stale`);
    }
    const globalMode = context.readPreparationReviewMode
      ? await context.readPreparationReviewMode()
      : (context.config.preparation?.reviewMode ?? 'human');
    effectiveReviewMode = effectivePreparationReviewMode(globalMode, stored.draft.reviewMode);
    if (stored.draft.blockingReviewId) throw new Error('Preparation review blocks approval');
    if (effectiveReviewMode === 'required-auto' && !stored.review) {
      throw new Error('Preparation review is required before approval');
    }
    if (stored.review) {
      if (stored.review.counts.critical > 0 || stored.review.counts.high > 0) {
        throw new Error('Preparation review blocks approval');
      }
      if (
        stored.review.counts.medium + stored.review.counts.low > 0 &&
        !stored.review.acknowledged
      ) {
        throw new Error('Preparation review must be acknowledged before approval');
      }
    }
  }
  const workflow = resolveWorkflow(current.draft.workflowId);
  validateWorkflowDefinition(workflow);
  validateWorkflowProfiles(workflow, context.config.profiles);
  await canonicalWorkspace(current.draft.workspace);
  const claim = await store.claimPreparation(request.draftId, {
    draftId: request.draftId,
    revision: request.revision,
  });
  if (!claim)
    throw new Error(`Preparation ${request.draftId} is already being executed or is stale`);

  const runId = randomUUID();
  const now = new Date().toISOString();
  const written = [] as import('../core/run.js').ArtifactReference[];
  let committed = false;
  try {
    written.push(
      await artifacts.write(
        runId,
        'run',
        'input',
        'json',
        JSON.stringify({ objective: proposal.objective }),
        'application/json',
      ),
    );
    const outputs = new Map(
      proposal.outputs.map((output) => [`${output.stepId}:${output.name}`, output]),
    );
    for (const output of proposal.outputs) {
      written.push(
        await artifacts.write(
          runId,
          output.stepId,
          output.name,
          'json',
          JSON.stringify(output.value),
          'application/json',
        ),
      );
    }
    const run = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      objective: proposal.objective,
      status: 'running' as const,
      createdAt: now,
      updatedAt: now,
    };
    const steps = workflow.steps
      .filter((step) => outputs.has(`${step.id}:${step.outputs[0]?.name ?? ''}`))
      .map((step) => {
        const output = proposal.outputs.find((candidate) => candidate.stepId === step.id);
        if (!output) throw new Error(`Missing approved output for step ${step.id}`);
        const profile = context.config.profiles[step.profile];
        if (!profile) throw new Error(`Missing profile ${step.profile}`);
        return {
          runId,
          stepId: step.id,
          profile: step.profile,
          profileSnapshot: proposal.provenance.profileSnapshot,
          status: 'completed' as const,
          attempt: 1,
          startedAt: now,
          finishedAt: now,
          result: { text: JSON.stringify(output.value) },
        };
      });
    const reviewApproval =
      workflow.id === 'plan-build-qa-interactive' ? createScopeApproval(runId, now) : undefined;
    const created = await createRunFromPreparation(
      { store: requireRunStore(context) },
      {
        draftId: request.draftId,
        proposalRevision: proposal.revision,
        claimToken: claim,
        ...(stored
          ? {
              expectedDraftRevision: request.revision,
              contentVersion: stored.draft.contentVersion,
              ...(effectiveReviewMode ? { effectiveReviewMode } : {}),
              ...(stored.review ? { reviewId: stored.review.id } : {}),
            }
          : {}),
        run,
        steps,
        artifacts: written,
        approval: {
          proposalId: proposal.id,
          draftId: proposal.draftId,
          revision: proposal.revision,
          approvedAt: now,
          decision: 'approve',
        },
        ...(reviewApproval ? { reviewApproval } : {}),
      },
    );
    committed = true;
    return await continueApprovedPreparation(context, workflow, created, request);
  } catch (error) {
    if (!committed) {
      await store.releasePreparation(request.draftId, claim).catch(() => undefined);
      for (const artifact of written) await artifacts.remove(artifact).catch(() => undefined);
    }
    throw error;
  }
}

function createScopeApproval(runId: string, now: string) {
  const thread = {
    id: `${runId}-scope-scope`,
    runId,
    phase: 'scope' as const,
    target: { kind: 'scope' as const, id: 'scope' as const },
    artifactRevision: 1,
    state: 'decided' as const,
    revision: 2,
    createdAt: now,
    updatedAt: now,
  };
  return {
    thread,
    decision: {
      threadId: thread.id,
      target: thread.target,
      decision: 'approve' as const,
      revision: 1,
      details: 'Approved during preparation handoff',
      createdAt: now,
    },
  };
}

async function continueApprovedPreparation(
  context: PreparationContext,
  workflow: import('../core/workflow.js').WorkflowDefinition,
  created: {
    run: import('../core/run.js').WorkflowRun;
    claim: import('../core/ports.js').ExecutionClaim;
  },
  request: ApproveAndExecutePreparationRequest,
): Promise<import('../core/run.js').WorkflowRun> {
  try {
    return await executeApprovedWorkflow(context, workflow, created, request);
  } catch (error) {
    const store = requireRunStore(context);
    await store.releaseExecution(created.run.id).catch(() => undefined);
    await store.markRunInterrupted(created.run.id).catch(() => undefined);
    throw error;
  }
}

async function executeApprovedWorkflow(
  context: PreparationContext,
  workflow: import('../core/workflow.js').WorkflowDefinition,
  created: {
    run: import('../core/run.js').WorkflowRun;
    claim: import('../core/ports.js').ExecutionClaim;
  },
  request: ApproveAndExecutePreparationRequest,
): Promise<import('../core/run.js').WorkflowRun> {
  const execution = await import('./execution-operations.js');
  return execution.executeClaimedWorkflowForPreparation(context as ApplicationInternals, workflow, {
    runId: created.run.id,
    objective: created.run.objective,
    input: { objective: created.run.objective },
    profiles: context.config.profiles,
    resume: true,
    executionClaim: created.claim,
    ...(request.signal ? { signal: request.signal } : {}),
    ...(request.onRunStarted ? { onRunStarted: request.onRunStarted } : {}),
  });
}

function parseResponse(result: AgentStepResult) {
  try {
    return parsePreparationAgentResponse(JSON.parse(result.text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      const content = result.text.trim();
      if (content) return { kind: 'message' as const, content };
    }
    throw error;
  }
}

function buildPreparationPrompt(
  conversation: PreparationConversation,
  synthesis?: import('./preparation.js').PreparationSynthesis,
): string {
  const messages = conversation.messages
    .filter((message) => message.generationStatus === 'sent')
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  const prompt = [
    `Prepare the ${conversation.draft.workflowId} workflow for this workspace: ${conversation.draft.workspace}.`,
    'The user objective may be incomplete. Ask a concise question when clarification is needed.',
    'Return exactly one JSON object with schemaVersion 1: {"schemaVersion":1,"kind":"message","content":"...","synthesisSuggestion":{...}} or {"schemaVersion":1,"kind":"proposal","content":"...","objective":"...","outputs":[...]}.',
    'A proposal for plan-build contains exactly {"stepId":"plan","name":"plan","value":<validated BuildPlan>}.',
    'A proposal for plan-build-qa contains validated scope and plan outputs.',
    'A proposal for plan-build-qa-interactive contains validated scope and plan outputs.',
    'Do not include approval, authorization, or execution fields. Do not execute work.',
    JSON.stringify({ objective: conversation.draft.objective, synthesis, messages }),
  ].join('\n');
  if (prompt.length > 32_000) {
    throw new Error('Preparation prompt exceeds the 32000 UTF-16 unit limit');
  }
  return prompt;
}

function buildPreparationReviewPrompt(
  conversation: PreparationConversation,
  mode: import('../config.js').PreparationReviewMode,
): string {
  const proposal = conversation.proposal;
  if (!proposal) throw new Error('Preparation proposal is required for review');
  const prompt = [
    'Review this preparation proposal without executing work.',
    `The effective review policy is ${mode}. Return exactly one JSON object with schemaVersion 1.`,
    'The report must contain summary and findings. Each finding needs id, severity, title, explanation, impact, evidence, suggestedCorrection, and verifications.',
    'Do not include approval, authorization, execution, or decision fields.',
    JSON.stringify({
      objective: proposal.objective,
      workflowId: proposal.workflowId,
      outputs: proposal.outputs,
    }),
  ].join('\n');
  if (prompt.length > 32_000)
    throw new Error('Preparation review prompt exceeds the 32000 UTF-16 unit limit');
  return prompt;
}

function plannerProfile(
  context: PreparationContext,
  selection?: PreparationSelection | null,
): AgentProfile {
  const profile = context.config.profiles.planner;
  const validation = validateAgentProfile('planner', profile);
  if (!profile || validation.errors.length > 0) {
    throw new Error(
      `Planner profile is not valid for preparation: ${validation.errors.join('; ')}`,
    );
  }
  if (!selection) return profile;
  const base = { ...profile };
  const inheritedProvider = base.provider;
  delete base.provider;
  delete base.thinking;
  const selected: AgentProfile = {
    ...base,
    model: selection.model,
    ...(selection.provider !== undefined
      ? { provider: selection.provider }
      : inheritedProvider !== undefined
        ? { provider: inheritedProvider }
        : {}),
    ...(selection.thinking !== undefined ? { thinking: selection.thinking } : {}),
  };
  const selectedValidation = validateAgentProfile('planner', selected);
  if (!selectedValidation.profile || selectedValidation.errors.length > 0) {
    throw new Error(
      `Selected preparation model is not valid for preparation: ${selectedValidation.errors.join('; ')}`,
    );
  }
  return selectedValidation.profile;
}

function validatePreparationSelection(
  context: PreparationContext,
  selection: PreparationSelection | null | undefined,
): void {
  if (selection !== undefined && selection !== null) plannerProfile(context, selection);
}

function snapshotProfile(profile: AgentProfile): AgentProfileSnapshot {
  return {
    driver: profile.driver,
    ...(profile.provider ? { provider: profile.provider } : {}),
    model: profile.model,
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    tools: [...profile.tools],
    workspaceMode: profile.workspaceMode,
    ...(profile.projectTrust ? { projectTrust: profile.projectTrust } : {}),
    timeoutMs: profile.timeoutMs,
    retryLimit: profile.retryLimit,
    ...(profile.skills ? { skills: structuredClone(profile.skills) } : {}),
  };
}

function requirePreparationStore(context: PreparationContext) {
  if (!context.preparationStore) throw new Error('Preparation storage is not configured');
  return context.preparationStore;
}

function requirePreparationDriver(context: PreparationContext): AgentDriver {
  if (!context.preparationDriver) throw new Error('Preparation driver is not configured');
  return context.preparationDriver;
}

function requireExperienceStore(context: PreparationContext): PreparationExperienceStore {
  const store = requirePreparationStore(context);
  if (!store.beginPreparationTurn || !store.finishPreparationTurn) {
    throw new Error('Preparation turn operations are not supported by this storage adapter');
  }
  return store as PreparationExperienceStore;
}

function reviewerDriver(context: PreparationContext): AgentDriver {
  return requirePreparationDriver(context);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRunStore(context: PreparationContext) {
  if (!context.store) throw new Error('Run storage is not configured');
  return context.store;
}

async function canonicalWorkspace(workspace: string): Promise<string> {
  const value = workspace.trim();
  if (!value) throw new Error('Preparation workspace must be non-empty');
  try {
    return await realpath(value);
  } catch {
    return resolve(value);
  }
}
