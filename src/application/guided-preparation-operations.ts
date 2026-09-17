import { createHash, randomUUID } from 'node:crypto';
import type { AgentDriver } from '../core/agent.js';
import type { AgentProfile } from '../core/agent-profile.js';
import type {
  GuidedPreparationBeginRequest,
  GuidedPreparationMessage,
  GuidedPreparationOperationRequest,
  GuidedPreparationRequestRecord,
  GuidedPreparationState,
  GuidedPreparationSource,
  PublicSourceResult,
} from './guided-preparation.js';
import {
  GUIDED_PREPARATION_LIMITS,
  buildGuidedPreparationPrompt,
  GuidedPreparationError,
  parseGuidedPreparationOperation,
  parseGuidedPlanOutput,
  parseGuidedReplyOutput,
  parseGuidedTodoOutput,
  validateGuidedPlannerProfile,
} from './guided-preparation.js';
import type {
  ApplicationTaskContractStore,
  GuidedPreparationStore,
  PublicSourceReader,
} from './ports.js';

export interface GuidedPreparationOperationsContext {
  readonly store: GuidedPreparationStore;
  readonly taskContracts: ApplicationTaskContractStore;
  readonly sourceReader: PublicSourceReader;
  readonly driver: AgentDriver;
  readonly plannerProfile: AgentProfile;
  readonly workspace: string;
}

export interface GuidedPreparationService {
  create?(contractId: string): Promise<GuidedPreparationState>;
  execute(
    request: GuidedPreparationOperationRequest,
    options?: { signal?: AbortSignal; ownerToken?: string },
  ): Promise<GuidedPreparationRequestRecord>;
  recover?(contractId: string, requestId: string): Promise<GuidedPreparationRequestRecord>;
  confirmBrief(request: GuidedPreparationOperationRequest): Promise<GuidedPreparationState>;
  getState?(contractId: string): Promise<GuidedPreparationState | undefined>;
  listMessages?(
    contractId: string,
    afterSequence?: number,
    limit?: number,
  ): Promise<{ items: GuidedPreparationMessage[]; nextCursor?: number }>;
  listSources?(
    contractId: string,
    afterSequence?: number,
    limit?: number,
  ): Promise<{ items: GuidedPreparationSource[]; nextCursor?: number }>;
}

export function createGuidedPreparationService(
  context: GuidedPreparationOperationsContext,
): GuidedPreparationService {
  return {
    create: (contractId) =>
      context.store.createGuidedPreparation({ workspace: context.workspace, contractId }),
    execute: (request, options) => executeRequest(context, request, options),
    recover: (contractId, requestId) =>
      context.store.recoverGuidedPreparationRequest({
        workspace: context.workspace,
        contractId,
        requestId,
        recoveryOwnerToken: randomUUID(),
      }),
    confirmBrief: async (request) => {
      const operation = parseGuidedPreparationOperation(request);
      if (operation.kind !== 'confirm-brief') {
        throw new Error('Expected a confirm-brief operation');
      }
      return context.store.confirmGuidedBrief({
        workspace: context.workspace,
        contractId: operation.contractId,
        expectedPreparationRevision: operation.expectedPreparationRevision,
        brief: operation.brief,
        throughSequence: operation.throughSequence,
        sourceIds: operation.sourceIds,
      });
    },
    getState: (contractId) => context.store.getGuidedPreparation(context.workspace, contractId),
    listMessages: (contractId, afterSequence, limit) =>
      context.store.listGuidedPreparationMessages({
        workspace: context.workspace,
        contractId,
        ...(afterSequence === undefined ? {} : { afterSequence }),
        ...(limit === undefined ? {} : { limit }),
      }),
    listSources: (contractId, afterSequence, limit) =>
      context.store.listGuidedPreparationSources({
        workspace: context.workspace,
        contractId,
        ...(afterSequence === undefined ? {} : { afterSequence }),
        ...(limit === undefined ? {} : { limit }),
      }),
  };
}

async function executeRequest(
  context: GuidedPreparationOperationsContext,
  input: GuidedPreparationOperationRequest,
  options: { signal?: AbortSignal; ownerToken?: string } = {},
): Promise<GuidedPreparationRequestRecord> {
  const operation = parseGuidedPreparationOperation(input);
  if (requiresPlanner(operation.kind)) validateGuidedPlannerProfile(context.plannerProfile);
  const admissionRequest: GuidedPreparationBeginRequest = {
    workspace: context.workspace,
    operation,
    operationId: randomUUID(),
    requestHash: createHash('sha256').update(canonicalJson(operation)).digest('hex'),
    ownerToken: options.ownerToken ?? randomUUID(),
    ...(requiresPlanner(operation.kind) ? { profileSnapshot: context.plannerProfile } : {}),
  };
  const admitted = await context.store.beginGuidedPreparationRequest(admissionRequest);
  if (isTerminal(admitted.status)) return admitted;

  try {
    const result = await performOperation(context, operation, options.signal);
    return await context.store.finishGuidedPreparationRequest({
      workspace: context.workspace,
      operation,
      operationId: admitted.operationId,
      ownerToken: admissionRequest.ownerToken,
      status: 'completed',
      ...(result.result ? { result: result.result } : {}),
      ...(result.publishedDocumentId ? { publishedDocumentId: result.publishedDocumentId } : {}),
      ...(result.externalSessionId ? { resultExternalSessionId: result.externalSessionId } : {}),
      ...(result.sessionThroughSequence === undefined
        ? {}
        : { resultSessionThroughSequence: result.sessionThroughSequence }),
      ...(result.assistantMessage ? { assistantMessage: result.assistantMessage } : {}),
    });
  } catch (error) {
    await context.store
      .finishGuidedPreparationRequest({
        workspace: context.workspace,
        operation,
        operationId: admitted.operationId,
        ownerToken: admissionRequest.ownerToken,
        status: isAbort(error, options.signal) ? 'cancelled' : 'failed',
        errorCode:
          error instanceof Error && 'code' in error ? String(error.code) : 'operation-failed',
      })
      .catch(() => undefined);
    throw error;
  }
}

async function performOperation(
  context: GuidedPreparationOperationsContext,
  operation: GuidedPreparationOperationRequest,
  signal?: AbortSignal,
): Promise<{
  result?:
    | import('./guided-preparation.js').GuidedReplyOutput
    | import('./guided-preparation.js').GuidedPlanOutput
    | import('./guided-preparation.js').GuidedTodoOutput;
  publishedDocumentId?: string;
  externalSessionId?: string;
  sessionThroughSequence?: number;
  assistantMessage?: {
    content: string;
    metadata: import('./guided-preparation.js').GuidedPreparationMessageMetadata;
    draftBrief?: import('./task-contract.js').TaskContractBrief;
  };
}> {
  switch (operation.kind) {
    case 'search': {
      const results = await context.sourceReader.search(
        operation.query,
        signal ?? new AbortController().signal,
      );
      await saveSources(context, operation, results);
      return {};
    }
    case 'fetch-source': {
      const result = await context.sourceReader.readUrl(
        operation.url,
        signal ?? new AbortController().signal,
      );
      await saveSources(context, operation, [result]);
      return {};
    }
    case 'confirm-brief':
      await context.store.confirmGuidedBrief({
        workspace: context.workspace,
        contractId: operation.contractId,
        expectedPreparationRevision: operation.expectedPreparationRevision + 1,
        brief: operation.brief,
        throughSequence: operation.throughSequence,
        sourceIds: operation.sourceIds,
        requestId: operation.requestId,
      });
      return {};
    case 'reply': {
      const plannerResult = await runPlanner(context, operation, signal);
      const output = parseGuidedReplyOutput(plannerResult.value);
      assertCitations(output.citedSourceIds, operation.sourceIds);
      return {
        result: output,
        ...(plannerResult.sessionId ? { externalSessionId: plannerResult.sessionId } : {}),
        assistantMessage: {
          content: output.message,
          metadata: {
            questions: output.questions,
            citedSourceIds: output.citedSourceIds,
            ...(output.briefSuggestion ? { briefSuggestion: output.briefSuggestion } : {}),
          },
          ...(output.briefSuggestion ? { draftBrief: output.briefSuggestion } : {}),
        },
      };
    }
    case 'generate-plan': {
      const output = parseGuidedPlanOutput((await runPlanner(context, operation, signal)).value);
      assertCitations(output.citedSourceIds, operation.sourceIds);
      let state;
      try {
        state = await context.taskContracts.publishTaskContractPlan({
          contractId: operation.contractId,
          workspace: context.workspace,
          expectedRevision: operation.expectedRevision,
          plan: output.plan,
        });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'incompatible-version') {
          throw new GuidedPreparationError(
            'planner-output-invalid',
            'Planner plan does not refer to the current brief version',
          );
        }
        throw error;
      }
      return {
        result: output,
        ...(state.currentPlan ? { publishedDocumentId: state.currentPlan.id } : {}),
      };
    }
    case 'generate-todo': {
      const output = parseGuidedTodoOutput((await runPlanner(context, operation, signal)).value);
      assertCitations(output.citedSourceIds, []);
      const state = await context.taskContracts.publishTaskContractTodo({
        contractId: operation.contractId,
        workspace: context.workspace,
        expectedRevision: operation.expectedRevision,
        todo: output.todo,
      });
      return {
        result: output,
        ...(state.currentTodo ? { publishedDocumentId: state.currentTodo.id } : {}),
      };
    }
    case 'comment-plan':
      await context.taskContracts.commentTaskContractPlan({
        contractId: operation.contractId,
        workspace: context.workspace,
        expectedRevision: operation.expectedRevision,
        planVersion: operation.planVersion,
        content: operation.content,
      });
      return {};
    case 'approve-plan':
      await context.taskContracts.approveTaskContractPlan({
        contractId: operation.contractId,
        workspace: context.workspace,
        expectedRevision: operation.expectedRevision,
        planVersion: operation.planVersion,
      });
      return {};
    case 'recover-operation':
      throw new Error('Recovery requires an owner check and is not automatic');
  }
}

async function runPlanner(
  context: GuidedPreparationOperationsContext,
  operation: GuidedPreparationOperationRequest,
  signal?: AbortSignal,
): Promise<{ value: unknown; sessionId?: string }> {
  validateGuidedPlannerProfile(context.plannerProfile);
  const state = await context.taskContracts.getTaskContract(
    context.workspace,
    operation.contractId,
  );
  if (!state) throw new Error('Task contract does not exist');
  const preparation = await context.store.getGuidedPreparation(
    context.workspace,
    operation.contractId,
  );
  if (!preparation) throw new Error('Guided preparation does not exist');
  const messages = await context.store.listGuidedPreparationMessages({
    workspace: context.workspace,
    contractId: operation.contractId,
    limit: GUIDED_PREPARATION_LIMITS.maxMessages,
    latest: true,
  });
  const sources = await context.store.listGuidedPreparationSources({
    workspace: context.workspace,
    contractId: operation.contractId,
    limit: 50,
  });
  const selectedIds = 'sourceIds' in operation ? operation.sourceIds : [];
  const selectedSources = sources.items.filter((source) => selectedIds.includes(source.id));
  if (selectedSources.length !== selectedIds.length) {
    throw new Error('A selected source does not belong to the task');
  }
  if (
    operation.kind === 'generate-plan' &&
    preparation.briefConfirmedThroughSequence < preparation.lastSequence
  ) {
    throw new Error('The brief must be confirmed before generating a plan');
  }
  const prompt = buildGuidedPreparationPrompt({
    brief: preparation.draftBrief ?? state.currentBrief.body,
    briefVersion: state.currentBrief.version,
    messages: messages.items.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      role: message.role,
      content: message.content,
    })),
    sources: selectedSources.map((source) => ({
      id: source.id,
      kind: source.kind,
      url: source.url,
      retrievedAt: source.retrievedAt,
      excerpt: source.excerpt,
      contentHash: source.contentHash,
    })),
    instruction: plannerInstruction(operation),
    ...(operation.kind === 'generate-todo' && state.approvedPlan
      ? {
          approvedPlan: state.approvedPlan.body,
          approvedPlanVersion: state.approvedPlan.version,
        }
      : {}),
  });
  const response = await context.driver.execute(
    {
      runId: operation.requestId,
      stepId: operation.kind,
      profile: context.plannerProfile,
      prompt,
      ...(operation.kind === 'reply' && preparation.externalSessionId
        ? { sessionId: preparation.externalSessionId }
        : {}),
    },
    () => undefined,
    signal ?? new AbortController().signal,
  );
  try {
    return {
      value: JSON.parse(response.text) as unknown,
      ...(response.sessionId ? { sessionId: response.sessionId } : {}),
    };
  } catch {
    throw new GuidedPreparationError('planner-output-invalid', 'Planner returned invalid JSON');
  }
}

function plannerInstruction(operation: GuidedPreparationOperationRequest): string {
  switch (operation.kind) {
    case 'reply':
      return `Answer the user's question: ${operation.message}`;
    case 'generate-plan':
      return 'Generate a plan from the confirmed brief and selected evidence.';
    case 'generate-todo':
      return `Generate a TODO for approved plan version ${operation.planVersion}.`;
    default:
      throw new Error(`Operation ${operation.kind} does not call the planner`);
  }
}

async function saveSources(
  context: GuidedPreparationOperationsContext,
  operation: GuidedPreparationOperationRequest,
  results: readonly PublicSourceResult[],
): Promise<void> {
  const state = await context.store.getGuidedPreparation(context.workspace, operation.contractId);
  if (!state) throw new Error('Guided preparation does not exist');
  const sources: GuidedPreparationSource[] = results.slice(0, 5).map((source, index) => ({
    id: randomUUID(),
    contractId: operation.contractId,
    sequence: state.lastSequence + index + 1,
    ...source,
  }));
  if (sources.length > 0) {
    await context.store.saveGuidedPreparationSources({
      workspace: context.workspace,
      contractId: operation.contractId,
      sources,
    });
  }
}

function assertCitations(citations: readonly string[], selected: readonly string[]): void {
  const allowed = new Set(selected);
  if (citations.some((citation) => !allowed.has(citation))) {
    throw new GuidedPreparationError(
      'planner-output-invalid',
      'Planner cited a source that was not selected',
    );
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function requiresPlanner(kind: GuidedPreparationOperationRequest['kind']): boolean {
  return kind === 'reply' || kind === 'generate-plan' || kind === 'generate-todo';
}

function isTerminal(status: GuidedPreparationRequestRecord['status']): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'interrupted'
  );
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}
