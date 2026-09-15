import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { assertRunTransition, assertStepTransition } from '../core/state-machine.js';
import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { QaDefect, QaDefectEvent, QaOccurrence, QaSearchResult } from '../core/qa-history.js';
import type {
  ReviewDecision,
  ReviewMessage,
  ReviewPhase,
  ReviewTargetKind,
  ReviewThread,
  ReviewThreadState,
} from '../core/interactive-review.js';
import type {
  BeginPreparationReviewRequest,
  BeginPreparationReviewResult,
  BeginPreparationTurnRequest,
  BeginPreparationTurnResult,
  DocumentPage,
  FinishPreparationReviewRequest,
  FinishPreparationTurnRequest,
  PreparationConversation,
  PreparationDraftItem,
  PreparationDraftPage,
  PreparationDraft,
  PreparationExecutionSeed,
  PreparationMessage,
  PreparationMessageItem,
  PreparationMessagePage,
  PreparationOperationView,
  PreparationProposalPage,
  PreparationProposal,
  PreparationProposalSummary,
  PreparationRevision,
  PreparationReviewMode,
  PreparationReviewSummary,
  PreparationSelection,
  PreparationSynthesis,
  PreparationSynthesisSuggestion,
  PreparationSynthesisVersion,
  PreparationStoredView,
  TaskRunPage,
  TaskRunItem,
  UpdatePreparationRequest,
  UpdatePreparationSynthesisRequest,
} from '../application/preparation.js';
import {
  PortabilityContractError,
  type PortabilityBlocker,
  type PortabilityState,
  type PortabilityTransfer,
  validateUuidV4,
} from '../application/portability.js';
import {
  assertTaskContractTodoMatchesPlan,
  parseTaskContractBrief,
  parseTaskContractPlan,
  parseTaskContractTodo,
  validateTaskContractTodoScope,
  TaskContractError,
  type TaskContract,
  type TaskContractAction,
  type TaskContractBrief,
  type TaskContractActionPage,
  type TaskContractDocument,
  type TaskContractDocumentHeader,
  type TaskContractDocumentKind,
  type TaskContractDocumentPage,
  type TaskContractDocumentRequest,
  type TaskContractListActionsRequest,
  type TaskContractListDocumentsRequest,
  type TaskContractPage,
  type TaskContractPlan,
  type TaskContractStoredApprovalRequest,
  type TaskContractStoredBlockRequest,
  type TaskContractStoredCommentRequest,
  type TaskContractStoredCreateRequest,
  type TaskContractStoredPlanRequest,
  type TaskContractStoredResolveBlockRequest,
  type TaskContractStoredState,
  type TaskContractStoredTodoRequest,
  type TaskContractTodo,
} from '../application/task-contract.js';
import {
  reviewBlocksApproval,
  reviewFindingCounts,
  type PreparationReviewReport,
} from '../application/preparation-review.js';
import type {
  ApplicationPortabilityStore,
  ApplicationPreparationStore,
  ApplicationTaskContractStore,
  GuidedExecutionStore,
  GuidedPreparationStore,
} from '../application/ports.js';
import {
  GUIDED_PREPARATION_LIMITS,
  GuidedPreparationError,
  parseGuidedPreparationOperation,
  parseGuidedReplyOutput,
  parseGuidedPlanOutput,
  parseGuidedTodoOutput,
  validateGuidedPreparationSource,
  type GuidedBriefConfirmationRequest,
  type GuidedPreparationBeginRequest,
  type GuidedPreparationCreateRequest,
  type GuidedPreparationFinishRequest,
  type GuidedPreparationMessage,
  type GuidedPreparationRequestRecord,
  type GuidedPreparationSource,
  type GuidedPreparationState,
} from '../application/guided-preparation.js';
import {
  canonicalizeJson,
  type GuidedExecutionCheckpoint,
  type GuidedExecutionClaim,
  type GuidedExecutionCommitIntent,
  type GuidedExecutionCreateRequest,
  type GuidedExecutionDecisionRecord,
  type GuidedExecutionProgress,
} from '../application/guided-execution.js';
import type { ExecutionClaim } from '../core/ports.js';
import type { NormalizedEvent } from '../core/events.js';
import { applyMigrations } from './migrations/index.js';
import {
  RunExecutionOwnedError,
  RunStatusConflictError,
  type RunListPage,
  type RunListQuery,
  type RunEventPage,
  type RunEventPageQuery,
  type PersistedRunEvent,
  DEFAULT_RUN_EVENT_LIMIT,
  MAX_RUN_EVENT_LIMIT,
  type RunStore,
  type StepRunQueryOptions,
} from './run-store.js';

const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export class SqliteRunStore
  implements
    RunStore,
    ApplicationPortabilityStore,
    ApplicationPreparationStore,
    ApplicationTaskContractStore,
    GuidedExecutionStore,
    GuidedPreparationStore
{
  private readonly database: Database.Database;
  private readonly ownerId = randomUUID();
  private readonly executionClaims = new Map<string, string>();
  private readonly preparationClaims = new Map<string, string>();

  constructor(databasePath: string) {
    const database = new Database(databasePath);
    try {
      database.pragma('foreign_keys = ON');
      applyMigrations(database, databasePath);
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    this.executionClaims.clear();
    this.preparationClaims.clear();
    this.database.close();
  }

  async getPortabilityState(): Promise<PortabilityState> {
    return this.requirePortabilityState();
  }

  async inspectPortabilityBlockers(): Promise<PortabilityBlocker[]> {
    const blockers: PortabilityBlocker[] = [];
    const ownerCount =
      this.scalarCount('SELECT COUNT(*) AS count FROM run_execution_owners') +
      this.scalarCount('SELECT COUNT(*) AS count FROM preparation_owners');
    if (ownerCount > 0) {
      blockers.push({
        code: 'active-execution',
        detail: `${ownerCount} active execution owner(s)`,
      });
    }
    const pendingRequests = this.scalarCount(
      "SELECT COUNT(*) AS count FROM preparation_requests WHERE status = 'pending'",
    );
    const pendingMessages = this.scalarCount(
      "SELECT COUNT(*) AS count FROM preparation_messages WHERE generation_status = 'pending'",
    );
    const guidedPendingRequests = this.scalarCount(
      "SELECT COUNT(*) AS count FROM guided_preparation_requests WHERE status IN ('pending', 'running')",
    );
    if (pendingRequests + pendingMessages + guidedPendingRequests > 0) {
      blockers.push({
        code: 'active-execution',
        detail: `${pendingRequests + pendingMessages + guidedPendingRequests} pending preparation operation(s)`,
      });
    }
    const reusableRuns = this.scalarCount(
      `SELECT COUNT(*) AS count FROM runs
       WHERE status IN ('pending', 'running', 'failed', 'interrupted')
          OR (status = 'waiting' AND NOT (
            workflow_id = 'guided-task-build'
            AND EXISTS (
              SELECT 1 FROM guided_executions ge
              WHERE ge.run_id = runs.id AND ge.stage = 'changes-review'
            )
            AND NOT EXISTS (
              SELECT 1 FROM guided_execution_phases gp
              WHERE gp.run_id = runs.id AND gp.status <> 'completed'
            )
            AND NOT EXISTS (
              SELECT 1 FROM guided_execution_phases gp
              WHERE gp.run_id = runs.id AND gp.commit_intent_json IS NOT NULL
            )
          ))`,
    );
    if (reusableRuns > 0) {
      blockers.push({ code: 'reusable-run', detail: `${reusableRuns} run(s) can be resumed` });
    }
    return blockers;
  }

  async beginExportIntent(request: {
    requestId: string;
    digest: string;
    destination: string;
    transferId: string;
  }): Promise<PortabilityState> {
    validateUuidV4(request.requestId, 'requestId');
    validateUuidV4(request.transferId, 'transferId');
    return this.withImmediateTransaction(() => {
      const state = this.requirePortabilityState();
      if (state.state === 'exporting') {
        if (
          state.pendingExport?.requestId === request.requestId &&
          state.pendingExport.digest === request.digest &&
          state.pendingExport.destination === request.destination &&
          state.pendingExport.transferId === request.transferId
        )
          return state;
        throw new PortabilityContractError(
          'invalid-input',
          'Another export intent is already active',
        );
      }
      if (state.state === 'exported') {
        throw new PortabilityContractError(
          'invalid-input',
          'Exported dataset cannot start another export',
        );
      }
      this.database
        .prepare(
          `UPDATE portability_state SET state = 'exporting', pending_request_id = ?,
           pending_digest = ?, pending_destination = ?, pending_transfer_id = ?, updated_at = ?
           WHERE singleton_id = 1 AND state = 'active'`,
        )
        .run(
          request.requestId,
          request.digest,
          request.destination,
          request.transferId,
          new Date().toISOString(),
        );
      return this.requirePortabilityState();
    });
  }

  async finalizeExport(request: {
    requestId: string;
    transfer: PortabilityTransfer;
  }): Promise<PortabilityState> {
    validateUuidV4(request.requestId, 'requestId');
    validateUuidV4(request.transfer.transferId, 'transferId');
    return this.withImmediateTransaction(() => {
      const state = this.requirePortabilityState();
      if (state.state === 'exported' && state.lastTransferId === request.transfer.transferId) {
        return state;
      }
      if (
        state.state !== 'exporting' ||
        !state.pendingExport ||
        state.pendingExport.requestId !== request.requestId ||
        state.pendingExport.transferId !== request.transfer.transferId
      ) {
        throw new PortabilityContractError(
          'invalid-input',
          'Export intent does not match current state',
        );
      }
      if (
        request.transfer.datasetId !== state.datasetId ||
        request.transfer.requestId !== state.pendingExport.requestId ||
        request.transfer.digest !== state.pendingExport.digest
      ) {
        throw new PortabilityContractError(
          'invalid-input',
          'Transfer does not match current dataset',
        );
      }
      this.database
        .prepare(
          `INSERT INTO portability_transfers
           (transfer_id, parent_transfer_id, dataset_id, request_id, digest, git_fingerprint,
            state, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.transfer.transferId,
          request.transfer.parentTransferId,
          request.transfer.datasetId,
          request.transfer.requestId,
          request.transfer.digest,
          request.transfer.gitFingerprint,
          request.transfer.state,
          request.transfer.createdAt,
          request.transfer.completedAt,
        );
      this.database
        .prepare(
          `UPDATE portability_state SET state = 'exported', last_transfer_id = ?,
           pending_request_id = NULL, pending_digest = NULL, pending_destination = NULL,
           pending_transfer_id = NULL, updated_at = ? WHERE singleton_id = 1 AND state = 'exporting'`,
        )
        .run(request.transfer.transferId, new Date().toISOString());
      return this.requirePortabilityState();
    });
  }

  async cancelExportIntent(request: {
    requestId: string;
    digest: string;
  }): Promise<PortabilityState> {
    validateUuidV4(request.requestId, 'requestId');
    return this.withImmediateTransaction(() => {
      const state = this.requirePortabilityState();
      if (
        state.state !== 'exporting' ||
        !state.pendingExport ||
        state.pendingExport.requestId !== request.requestId ||
        state.pendingExport.digest !== request.digest
      ) {
        throw new PortabilityContractError(
          'invalid-input',
          'Export intent does not match current state',
        );
      }
      this.database
        .prepare(
          `UPDATE portability_state SET state = 'active', pending_request_id = NULL,
           pending_digest = NULL, pending_destination = NULL, pending_transfer_id = NULL,
           updated_at = ? WHERE singleton_id = 1 AND state = 'exporting'`,
        )
        .run(new Date().toISOString());
      return this.requirePortabilityState();
    });
  }

  async backupDatabaseTo(destination: string): Promise<void> {
    if (!destination)
      throw new PortabilityContractError('invalid-input', 'Backup destination is required');
    await this.database.backup(destination);
  }

  async createGuidedExecution(
    request: GuidedExecutionCreateRequest,
  ): Promise<GuidedExecutionProgress> {
    const snapshot = request.snapshot;
    const existingByRequest = this.database
      .prepare(
        'SELECT run_id, contract_id, authorization_digest FROM guided_executions WHERE request_id = ?',
      )
      .get(request.requestId) as
      { run_id: string; contract_id: string; authorization_digest: string } | undefined;
    const digest =
      request.authorizationDigest ??
      createHash('sha256').update(canonicalizeJson(snapshot)).digest('hex');
    if (existingByRequest) {
      if (
        existingByRequest.contract_id !== snapshot.contractId ||
        existingByRequest.authorization_digest !== digest
      ) {
        throw new TaskContractError(
          'invalid-input',
          'Guided execution request is already used with different content',
        );
      }
      return this.requireGuidedProgress(existingByRequest.run_id);
    }
    const existingByContract = this.database
      .prepare('SELECT run_id FROM guided_executions WHERE contract_id = ?')
      .get(snapshot.contractId) as { run_id: string } | undefined;
    if (existingByContract) {
      throw new TaskContractError(
        'blocked',
        'Task contract has already been handed off for execution',
      );
    }

    const runId = `guided-${request.requestId}`;
    return this.withImmediateTransaction(() => {
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO runs (id, workflow_id, workflow_version, objective, status, created_at, updated_at)
           VALUES (?, 'guided-task-build', ?, ?, 'pending', ?, ?)`,
        )
        .run(runId, snapshot.workflowVersion, snapshot.objective, now, now);
      const phases = snapshot.todo.body.phases.map((phase, phaseIndex) => ({
        id: phase.id,
        ordinal: phaseIndex + 1,
        title: phase.title,
        status: 'pending' as const,
        tasks: phase.tasks.map((task, taskIndex) => ({
          id: task.id,
          phaseId: phase.id,
          ordinal: taskIndex + 1,
          status: 'pending' as const,
          attempt: 1,
        })),
      }));
      const progress: GuidedExecutionProgress = {
        runId,
        contractId: snapshot.contractId,
        revision: 1,
        stage: 'execution',
        status: 'pending',
        phases,
        activeBlock: null,
        nextAction: 'execute',
      };
      for (const artifact of [
        request.snapshotArtifact,
        request.todoArtifact,
        request.inputArtifact,
      ]) {
        if (artifact.runId !== runId) {
          throw new TaskContractError(
            'invalid-input',
            `Guided execution artifact is not linked to run ${runId}`,
          );
        }
        const stored = this.database
          .prepare('SELECT run_id FROM artifacts WHERE id = ?')
          .get(artifact.id) as { run_id: string } | undefined;
        if (stored && stored.run_id !== runId) {
          throw new TaskContractError(
            'invalid-input',
            `Guided execution artifact is not linked to run ${runId}`,
          );
        }
        if (!stored) this.insertArtifact(artifact);
      }
      this.database
        .prepare(
          `INSERT INTO guided_executions
           (run_id, contract_id, request_id, workspace, coordinator_version, revision,
            brief_id, brief_version, plan_id, plan_version, todo_id, todo_version, approval_id,
            authorization_digest, authorization_json, profile_json, snapshot_artifact_id,
            todo_artifact_id, input_artifact_id, initial_git_json, stage, progress_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'execution', ?, ?, ?)`,
        )
        .run(
          runId,
          snapshot.contractId,
          request.requestId,
          snapshot.workspace,
          snapshot.coordinatorVersion,
          1,
          snapshot.brief.id,
          snapshot.brief.version,
          snapshot.plan.id,
          snapshot.plan.version,
          snapshot.todo.id,
          snapshot.todo.version,
          snapshot.approval.id,
          digest,
          canonicalizeJson(snapshot),
          canonicalizeJson(snapshot.profile),
          request.snapshotArtifact.id,
          request.todoArtifact.id,
          request.inputArtifact.id,
          canonicalizeJson(snapshot.git),
          canonicalizeJson(progress),
          now,
          now,
        );
      for (const phase of phases) {
        this.database
          .prepare(
            `INSERT INTO guided_execution_phases (run_id, phase_id, ordinal, title, status)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(runId, phase.id, phase.ordinal, phase.title, phase.status);
        for (const task of phase.tasks) {
          this.database
            .prepare(
              `INSERT INTO guided_execution_tasks (run_id, task_id, phase_id, ordinal, title, status, attempt)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              runId,
              task.id,
              task.phaseId,
              task.ordinal,
              snapshot.todo.body.phases[phase.ordinal - 1]!.tasks[task.ordinal - 1]!.id,
              task.status,
              task.attempt,
            );
        }
      }
      return progress;
    });
  }

  async getGuidedExecutionRequest(
    requestId: string,
  ): Promise<{ contractId: string; authorizationDigest: string } | undefined> {
    const row = this.database
      .prepare(
        'SELECT contract_id, authorization_digest FROM guided_executions WHERE request_id = ?',
      )
      .get(requestId) as { contract_id: string; authorization_digest: string } | undefined;
    return row
      ? { contractId: row.contract_id, authorizationDigest: row.authorization_digest }
      : undefined;
  }

  async getGuidedExecutionByRequest(
    requestId: string,
  ): Promise<GuidedExecutionProgress | undefined> {
    const row = this.database
      .prepare('SELECT progress_json FROM guided_executions WHERE request_id = ?')
      .get(requestId) as { progress_json: string } | undefined;
    return row ? (JSON.parse(row.progress_json) as GuidedExecutionProgress) : undefined;
  }

  async getGuidedExecution(runId: string): Promise<GuidedExecutionProgress | undefined> {
    const row = this.database
      .prepare('SELECT progress_json FROM guided_executions WHERE run_id = ?')
      .get(runId) as { progress_json: string } | undefined;
    return row ? (JSON.parse(row.progress_json) as GuidedExecutionProgress) : undefined;
  }

  async listGuidedExecutions(
    query: { contractId?: string; workspace?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: GuidedExecutionProgress[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = this.database
      .prepare(
        `SELECT progress_json, run_id FROM guided_executions
         WHERE (? IS NULL OR contract_id = ?) AND (? IS NULL OR workspace = ?) AND (? IS NULL OR run_id > ?)
         ORDER BY run_id LIMIT ?`,
      )
      .all(
        query.contractId ?? null,
        query.contractId ?? null,
        query.workspace ?? null,
        query.workspace ?? null,
        query.cursor ?? null,
        query.cursor ?? null,
        limit + 1,
      ) as Array<{ progress_json: string; run_id: string }>;
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => JSON.parse(row.progress_json) as GuidedExecutionProgress),
      ...(rows.length > limit ? { nextCursor: page[page.length - 1]!.run_id } : {}),
    };
  }

  async claimGuidedExecution(
    runId: string,
    eligibleStatuses: readonly RunStatus[],
  ): Promise<GuidedExecutionClaim | undefined> {
    return this.withImmediateTransaction(() => {
      const run = this.database.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        { status: RunStatus } | undefined;
      if (!run || !eligibleStatuses.includes(run.status)) return undefined;
      this.acquireExecutionOwner(runId);
      this.database
        .prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run('running', new Date().toISOString(), runId, run.status);
      const progress = this.requireGuidedProgress(runId);
      const claim = this.createExecutionClaim(runId);
      return { ...claim, revision: progress.revision };
    });
  }

  async assertGuidedExecutionClaim(claim: GuidedExecutionClaim): Promise<void> {
    this.assertCurrentExecutionOwner(claim.runId);
    if (this.executionClaims.get(claim.runId) !== claim.token) {
      throw new RunExecutionOwnedError(claim.runId);
    }
  }

  async saveGuidedCheckpoint(
    checkpoint: GuidedExecutionCheckpoint,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    return this.withImmediateTransaction(() => {
      this.assertGuidedClaimInTransaction(claim);
      const progress = this.requireGuidedProgress(checkpoint.runId);
      const next = { ...progress, revision: progress.revision + 1 };
      this.database
        .prepare(
          'UPDATE guided_executions SET revision = ?, last_checkpoint_json = ?, progress_json = ?, updated_at = ? WHERE run_id = ? AND revision = ?',
        )
        .run(
          next.revision,
          canonicalizeJson(checkpoint),
          canonicalizeJson(next),
          new Date().toISOString(),
          checkpoint.runId,
          progress.revision,
        );
      this.updateCheckpointRows(checkpoint);
      return next;
    });
  }

  async saveGuidedDecision(
    decision: GuidedExecutionDecisionRecord,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    return this.withImmediateTransaction(() => {
      this.assertGuidedClaimInTransaction(claim);
      const progress = this.requireGuidedProgress(decision.runId);
      const next = { ...progress, revision: progress.revision + 1 };
      this.database
        .prepare(
          'INSERT INTO guided_execution_decisions (id, run_id, sequence, revision, decision, reason, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          decision.id,
          decision.runId,
          decision.sequence,
          decision.revision,
          decision.decision,
          decision.reason,
          decision.fingerprint,
          decision.createdAt,
        );
      this.updateGuidedProgress(next, progress.revision);
      return next;
    });
  }

  async saveGuidedCommitIntent(
    intent: GuidedExecutionCommitIntent,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    return this.withImmediateTransaction(() => {
      this.assertGuidedClaimInTransaction(claim);
      const progress = this.requireGuidedProgress(intent.runId);
      const next = { ...progress, revision: progress.revision + 1 };
      this.database
        .prepare(
          'UPDATE guided_execution_phases SET commit_intent_json = ?, status = ? WHERE run_id = ? AND phase_id = ?',
        )
        .run(canonicalizeJson(intent), 'running', intent.runId, intent.phaseId);
      this.updateGuidedProgress(next, progress.revision);
      return next;
    });
  }

  async completeGuidedPhase(
    runId: string,
    phaseId: string,
    commitSha: string | null,
    claim: GuidedExecutionClaim,
  ): Promise<GuidedExecutionProgress> {
    return this.withImmediateTransaction(() => {
      this.assertGuidedClaimInTransaction(claim);
      const progress = this.requireGuidedProgress(runId);
      const phases = progress.phases.map((phase) =>
        phase.id === phaseId
          ? {
              ...phase,
              status: 'completed' as const,
              ...(commitSha ? { commitSha } : { noChanges: true }),
            }
          : phase,
      );
      const next = { ...progress, phases, revision: progress.revision + 1 };
      this.database
        .prepare(
          'UPDATE guided_execution_phases SET status = ?, commit_sha = ?, no_changes = ? WHERE run_id = ? AND phase_id = ?',
        )
        .run('completed', commitSha, commitSha ? 0 : 1, runId, phaseId);
      this.updateGuidedProgress(next, progress.revision);
      return next;
    });
  }

  async saveGuidedProgress(
    progress: GuidedExecutionProgress,
    expectedRevision: number,
    claim: GuidedExecutionClaim,
  ): Promise<void> {
    this.withImmediateTransaction(() => {
      this.assertGuidedClaimInTransaction(claim);
      this.updateGuidedProgress(progress, expectedRevision);
    });
  }

  async releaseGuidedExecution(runId: string, claim: GuidedExecutionClaim): Promise<void> {
    await this.assertGuidedExecutionClaim(claim);
    await this.releaseExecution(runId);
  }

  async createGuidedPreparation(
    request: GuidedPreparationCreateRequest,
  ): Promise<GuidedPreparationState> {
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      this.assertGuidedPreparationNotConsumed(request.contractId);
      const existing = this.getGuidedPreparationRow(request.contractId);
      if (existing) return this.toGuidedPreparationState(existing);
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO guided_preparations
             (contract_id, revision, last_sequence, brief_confirmed_through_sequence,
              confirmed_source_ids_json, active_request_id, created_at, updated_at)
           VALUES (?, 1, 0, 0, '[]', NULL, ?, ?)`,
        )
        .run(contract.id, now, now);
      return this.requireGuidedPreparationState(request.workspace, request.contractId);
    });
  }

  async getGuidedPreparation(
    workspace: string,
    contractId: string,
  ): Promise<GuidedPreparationState | undefined> {
    const contract = this.assertTaskContractWorkspace(workspace, contractId);
    if (!contract) return undefined;
    const row = this.getGuidedPreparationRow(contractId);
    return row ? this.toGuidedPreparationState(row) : undefined;
  }

  async saveGuidedPreparationSources(request: {
    workspace: string;
    contractId: string;
    sources: readonly GuidedPreparationSource[];
  }): Promise<GuidedPreparationState> {
    return this.withImmediateTransaction(() => {
      this.requireTaskContractForWrite(request.workspace, request.contractId);
      this.assertGuidedPreparationNotConsumed(request.contractId);
      const preparation = this.requireGuidedPreparationRow(request.contractId);
      const sourceCount = this.database
        .prepare('SELECT COUNT(*) AS count FROM guided_preparation_sources WHERE contract_id = ?')
        .get(request.contractId) as { count: number };
      if (
        sourceCount.count + request.sources.length >
        GUIDED_PREPARATION_LIMITS.maxSourcesPerContract
      ) {
        throw new GuidedPreparationError('invalid-input', 'Too many sources for one task');
      }
      const now = new Date().toISOString();
      let lastSequence = preparation.last_sequence;
      for (const source of request.sources) {
        validateGuidedPreparationSource(source);
        if (source.contractId !== request.contractId) {
          throw new GuidedPreparationError('source-invalid', 'Source belongs to another task');
        }
        lastSequence = Math.max(lastSequence, source.sequence);
        this.database
          .prepare(
            `INSERT INTO guided_preparation_sources
               (id, contract_id, sequence, kind, url, title, excerpt, query,
                retrieved_at, content_hash, truncated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            source.id,
            source.contractId,
            source.sequence,
            source.kind,
            source.url,
            source.title,
            source.excerpt,
            source.query ?? null,
            source.retrievedAt,
            source.contentHash,
            source.truncated ? 1 : 0,
          );
      }
      if (request.sources.length > 0) {
        this.database
          .prepare(
            `UPDATE guided_preparations
                SET revision = revision + 1, last_sequence = ?, updated_at = ?
              WHERE contract_id = ? AND revision = ?`,
          )
          .run(lastSequence, now, request.contractId, preparation.revision);
      }
      return this.requireGuidedPreparationState(request.workspace, request.contractId);
    });
  }

  async appendGuidedPreparationMessage(request: {
    workspace: string;
    contractId: string;
    role: GuidedPreparationMessage['role'];
    content: string;
    requestId: string;
  }): Promise<GuidedPreparationState> {
    if (
      new TextEncoder().encode(request.content).byteLength >
      GUIDED_PREPARATION_LIMITS.assistantMessageBytes
    ) {
      throw new GuidedPreparationError(
        'invalid-input',
        'Preparation message exceeds its size limit',
      );
    }
    return this.withImmediateTransaction(() => {
      this.requireTaskContractForWrite(request.workspace, request.contractId);
      this.assertGuidedPreparationNotConsumed(request.contractId);
      const preparation = this.requireGuidedPreparationRow(request.contractId);
      const now = new Date().toISOString();
      const sequence = preparation.last_sequence + 1;
      this.database
        .prepare(
          `INSERT INTO guided_preparation_messages
             (id, contract_id, sequence, role, content, request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          request.contractId,
          sequence,
          request.role,
          request.content,
          request.requestId,
          now,
        );
      this.database
        .prepare(
          `UPDATE guided_preparations
              SET revision = revision + 1, last_sequence = ?, updated_at = ?
            WHERE contract_id = ? AND revision = ?`,
        )
        .run(sequence, now, request.contractId, preparation.revision);
      return this.requireGuidedPreparationState(request.workspace, request.contractId);
    });
  }

  async listGuidedPreparationMessages(request: {
    workspace: string;
    contractId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<{ items: GuidedPreparationMessage[]; nextCursor?: number }> {
    this.requireGuidedPreparationState(request.workspace, request.contractId);
    const limit = validateGuidedPreparationLimit(request.limit);
    const rows = this.database
      .prepare(
        `SELECT * FROM guided_preparation_messages
          WHERE contract_id = ? ${request.afterSequence === undefined ? '' : 'AND sequence > ?'}
          ORDER BY sequence ASC LIMIT ?`,
      )
      .all(
        request.contractId,
        ...(request.afterSequence === undefined ? [] : [request.afterSequence]),
        limit + 1,
      ) as GuidedPreparationMessageRow[];
    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map(fromGuidedPreparationMessageRow);
    return {
      items,
      ...(hasNext ? { nextCursor: items[items.length - 1]!.sequence } : {}),
    };
  }

  async listGuidedPreparationSources(request: {
    workspace: string;
    contractId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<{ items: GuidedPreparationSource[]; nextCursor?: number }> {
    this.requireGuidedPreparationState(request.workspace, request.contractId);
    const limit = validateGuidedPreparationLimit(request.limit);
    const rows = this.database
      .prepare(
        `SELECT * FROM guided_preparation_sources
          WHERE contract_id = ? ${request.afterSequence === undefined ? '' : 'AND sequence > ?'}
          ORDER BY sequence ASC LIMIT ?`,
      )
      .all(
        request.contractId,
        ...(request.afterSequence === undefined ? [] : [request.afterSequence]),
        limit + 1,
      ) as GuidedPreparationSourceRow[];
    const hasNext = rows.length > limit;
    const items = (hasNext ? rows.slice(0, limit) : rows).map(fromGuidedPreparationSourceRow);
    return {
      items,
      ...(hasNext ? { nextCursor: items[items.length - 1]!.sequence } : {}),
    };
  }

  async getGuidedPreparationRequest(request: {
    workspace: string;
    contractId: string;
    requestId: string;
  }): Promise<GuidedPreparationRequestRecord | undefined> {
    this.assertTaskContractWorkspace(request.workspace, request.contractId);
    const row = this.database
      .prepare('SELECT * FROM guided_preparation_requests WHERE contract_id = ? AND request_id = ?')
      .get(request.contractId, request.requestId) as GuidedPreparationRequestRow | undefined;
    return row ? fromGuidedPreparationRequestRow(row) : undefined;
  }

  async beginGuidedPreparationRequest(
    request: GuidedPreparationBeginRequest,
  ): Promise<GuidedPreparationRequestRecord> {
    const operation = parseGuidedPreparationOperation(request.operation);
    if (!request.operationId || !request.requestHash || !request.ownerToken) {
      throw new GuidedPreparationError(
        'invalid-input',
        'Request admission identifiers are required',
      );
    }
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, operation.contractId);
      this.assertGuidedPreparationNotConsumed(operation.contractId);
      const preparation = this.requireGuidedPreparationRow(operation.contractId);
      const existing = this.database
        .prepare(
          'SELECT * FROM guided_preparation_requests WHERE contract_id = ? AND request_id = ?',
        )
        .get(operation.contractId, operation.requestId) as GuidedPreparationRequestRow | undefined;
      if (existing) {
        if (existing.request_hash !== request.requestHash) {
          throw new GuidedPreparationError(
            'invalid-input',
            'Request ID was reused with a different body',
          );
        }
        return fromGuidedPreparationRequestRow(existing);
      }
      if (preparation.active_request_id) {
        throw new GuidedPreparationError('busy', 'Another guided preparation request is active');
      }
      if (operation.expectedPreparationRevision !== preparation.revision) {
        throw new GuidedPreparationError('stale-revision', 'Guided preparation revision is stale');
      }
      if ('sourceIds' in operation)
        this.assertGuidedSourceIds(operation.contractId, operation.sourceIds);
      const now = new Date().toISOString();
      const nextSequence =
        operation.kind === 'reply' ? preparation.last_sequence + 1 : preparation.last_sequence;
      if (operation.kind === 'reply') {
        this.database
          .prepare(
            `INSERT INTO guided_preparation_messages
               (id, contract_id, sequence, role, content, request_id, created_at)
             VALUES (?, ?, ?, 'user', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            operation.contractId,
            nextSequence,
            operation.message,
            operation.requestId,
            now,
          );
      }
      this.database
        .prepare(
          `INSERT INTO guided_preparation_requests
             (contract_id, request_id, operation_id, kind, request_json, request_hash,
              preparation_revision, contract_revision, status, owner_token,
              profile_snapshot_json, result_json, error_code, published_document_id,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          operation.contractId,
          operation.requestId,
          request.operationId,
          operation.kind,
          canonicalizeJson(operation),
          request.requestHash,
          preparation.revision,
          contract.revision,
          request.ownerToken,
          request.profileSnapshot ? canonicalizeJson(request.profileSnapshot) : null,
          now,
          now,
        );
      this.database
        .prepare(
          `UPDATE guided_preparations
              SET revision = revision + 1, last_sequence = ?, active_request_id = ?, updated_at = ?
            WHERE contract_id = ? AND revision = ? AND active_request_id IS NULL`,
        )
        .run(nextSequence, operation.requestId, now, operation.contractId, preparation.revision);
      return this.requireGuidedPreparationRequest(operation.contractId, operation.requestId);
    });
  }

  async finishGuidedPreparationRequest(
    request: GuidedPreparationFinishRequest,
  ): Promise<GuidedPreparationRequestRecord> {
    const operation = parseGuidedPreparationOperation(request.operation);
    return this.withImmediateTransaction(() => {
      this.requireTaskContractForWrite(request.workspace, operation.contractId);
      const current = this.requireGuidedPreparationRequest(
        operation.contractId,
        operation.requestId,
      );
      if (current.status !== 'pending' && current.status !== 'running') {
        return current;
      }
      const preparation = this.requireGuidedPreparationRow(operation.contractId);
      if (preparation.active_request_id !== operation.requestId) {
        throw new GuidedPreparationError(
          'invalid-target',
          'Guided preparation request is not active',
        );
      }
      if (current.ownerToken !== request.ownerToken) {
        throw new GuidedPreparationError('invalid-target', 'Guided preparation owner is invalid');
      }
      if (request.result !== undefined) {
        if (operation.kind === 'reply') parseGuidedReplyOutput(request.result);
        if (operation.kind === 'generate-plan') parseGuidedPlanOutput(request.result);
        if (operation.kind === 'generate-todo') parseGuidedTodoOutput(request.result);
      }
      const now = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE guided_preparation_requests
              SET status = ?, result_json = ?, error_code = ?, published_document_id = ?, updated_at = ?
            WHERE contract_id = ? AND request_id = ?`,
        )
        .run(
          request.status,
          request.result === undefined ? null : canonicalizeJson(request.result),
          request.errorCode ?? null,
          request.publishedDocumentId ?? null,
          now,
          operation.contractId,
          operation.requestId,
        );
      this.database
        .prepare(
          `UPDATE guided_preparations
              SET revision = revision + 1, active_request_id = NULL, updated_at = ?
            WHERE contract_id = ? AND revision = ? AND active_request_id = ?`,
        )
        .run(now, operation.contractId, preparation.revision, operation.requestId);
      return this.requireGuidedPreparationRequest(operation.contractId, operation.requestId);
    });
  }

  async confirmGuidedBrief(
    request: GuidedBriefConfirmationRequest,
  ): Promise<GuidedPreparationState> {
    const brief = parseTaskContractBrief(request.brief);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      this.assertGuidedPreparationNotConsumed(request.contractId);
      const preparation = this.requireGuidedPreparationRow(request.contractId);
      if (preparation.revision !== request.expectedPreparationRevision) {
        throw new GuidedPreparationError('stale-revision', 'Guided preparation revision is stale');
      }
      if (preparation.active_request_id) {
        throw new GuidedPreparationError(
          'busy',
          'Cannot confirm a brief while a request is active',
        );
      }
      if (request.throughSequence > preparation.last_sequence) {
        throw new GuidedPreparationError('stale-revision', 'Brief sequence is not available');
      }
      this.assertGuidedSourceIds(request.contractId, request.sourceIds);
      const now = new Date().toISOString();
      const briefId = randomUUID();
      this.insertTaskContractDocument({
        id: briefId,
        contractId: request.contractId,
        kind: 'brief',
        version: this.latestTaskContractVersion(request.contractId, 'brief') + 1,
        sourceDocumentId: null,
        body: brief,
        createdAt: now,
      });
      this.database
        .prepare(
          `UPDATE task_contracts
              SET revision = revision + 1, current_brief_id = ?, current_plan_id = NULL,
                  approved_plan_id = NULL, current_todo_id = NULL, current_block_id = NULL,
                  phase = 'exploration', updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(briefId, now, request.contractId, contract.revision);
      this.database
        .prepare(
          `UPDATE guided_preparations
              SET revision = revision + 1, brief_confirmed_through_sequence = ?,
                  confirmed_source_ids_json = ?, updated_at = ?
            WHERE contract_id = ? AND revision = ? AND active_request_id IS NULL`,
        )
        .run(
          request.throughSequence,
          JSON.stringify(request.sourceIds),
          now,
          request.contractId,
          preparation.revision,
        );
      return this.requireGuidedPreparationState(request.workspace, request.contractId);
    });
  }

  async createTaskContract(
    request: TaskContractStoredCreateRequest,
  ): Promise<TaskContractStoredState> {
    const brief = parseTaskContractBrief(request.brief);
    return this.withImmediateTransaction(() => {
      const existing = this.getTaskContractRow(request.contractId);
      if (existing) {
        const currentBrief = this.getTaskContractDocumentRow(
          request.contractId,
          existing.current_brief_id,
        );
        if (
          existing.workspace !== request.workspace ||
          !currentBrief ||
          currentBrief.kind !== 'brief' ||
          currentBrief.version !== 1 ||
          currentBrief.body_json !== JSON.stringify(brief)
        ) {
          throw new TaskContractError(
            'invalid-input',
            `Task contract ${request.contractId} already exists with different initial data`,
          );
        }
        return this.requireTaskContractState(request.workspace, request.contractId);
      }

      assertContractId(request.contractId);
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO task_contracts
            (id, workspace, contract_version, revision, phase, current_brief_id,
             current_plan_id, approved_plan_id, current_todo_id, current_block_id, created_at, updated_at)
           VALUES (?, ?, 1, 1, 'exploration', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(request.contractId, request.workspace, now, now);
      const briefId = randomUUID();
      this.insertTaskContractDocument({
        id: briefId,
        contractId: request.contractId,
        kind: 'brief',
        version: 1,
        sourceDocumentId: null,
        body: brief,
        createdAt: now,
      });
      this.database
        .prepare(
          'UPDATE task_contracts SET current_brief_id = ?, updated_at = ? WHERE id = ? AND revision = 1',
        )
        .run(briefId, now, request.contractId);
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async getTaskContract(
    workspace: string,
    contractId: string,
  ): Promise<TaskContractStoredState | undefined> {
    const row = this.getTaskContractRow(contractId);
    if (!row) return undefined;
    if (row.workspace !== workspace) throw taskContractTargetError(contractId);
    return this.requireTaskContractState(workspace, contractId);
  }

  async listTaskContracts(
    workspace: string,
    afterId?: string,
    limit = 20,
  ): Promise<TaskContractPage> {
    const pageLimit = validateTaskContractLimit(limit);
    if (afterId !== undefined && afterId.length === 0) {
      throw new TaskContractError('invalid-input', 'Task contract cursor must not be empty');
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM task_contracts
          WHERE workspace = ? ${afterId === undefined ? '' : 'AND id > ?'}
          ORDER BY id ASC LIMIT ?`,
      )
      .all(
        workspace,
        ...(afterId === undefined ? [] : [afterId]),
        pageLimit + 1,
      ) as TaskContractRow[];
    const hasNext = rows.length > pageLimit;
    const pageRows = hasNext ? rows.slice(0, pageLimit) : rows;
    return {
      items: pageRows.map(fromTaskContractRow),
      ...(hasNext ? { nextCursor: pageRows[pageRows.length - 1]!.id } : {}),
    };
  }

  async getTaskContractDocument(
    request: TaskContractDocumentRequest,
  ): Promise<TaskContractDocument | undefined> {
    this.assertTaskContractWorkspace(request.workspace, request.contractId);
    const row = this.database
      .prepare(
        `SELECT * FROM task_contract_documents
          WHERE contract_id = ? AND kind = ? AND version = ?`,
      )
      .get(request.contractId, request.kind, request.version) as
      TaskContractDocumentRow | undefined;
    return row ? fromTaskContractDocumentRow(row) : undefined;
  }

  async listTaskContractDocuments(
    request: TaskContractListDocumentsRequest,
  ): Promise<TaskContractDocumentPage> {
    this.assertTaskContractWorkspace(request.workspace, request.contractId);
    const limit = validateTaskContractLimit(request.limit);
    if (request.afterVersion !== undefined && request.afterVersion < 0) {
      throw new TaskContractError('invalid-input', 'Document cursor must not be negative');
    }
    const rows = this.database
      .prepare(
        `SELECT id, contract_id, kind, version, source_document_id, created_at
           FROM task_contract_documents
          WHERE contract_id = ? AND kind = ? ${request.afterVersion === undefined ? '' : 'AND version > ?'}
          ORDER BY version ASC LIMIT ?`,
      )
      .all(
        request.contractId,
        request.kind,
        ...(request.afterVersion === undefined ? [] : [request.afterVersion]),
        limit + 1,
      ) as TaskContractDocumentHeaderRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(fromTaskContractDocumentHeaderRow),
      ...(hasNext ? { nextCursor: pageRows[pageRows.length - 1]!.version } : {}),
    };
  }

  async listTaskContractActions(
    request: TaskContractListActionsRequest,
  ): Promise<TaskContractActionPage> {
    this.assertTaskContractWorkspace(request.workspace, request.contractId);
    const limit = validateTaskContractLimit(request.limit);
    if (request.afterSequence !== undefined && request.afterSequence < 0) {
      throw new TaskContractError('invalid-input', 'Action cursor must not be negative');
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM task_contract_actions
          WHERE contract_id = ? ${request.afterSequence === undefined ? '' : 'AND sequence > ?'}
          ORDER BY sequence ASC LIMIT ?`,
      )
      .all(
        request.contractId,
        ...(request.afterSequence === undefined ? [] : [request.afterSequence]),
        limit + 1,
      ) as TaskContractActionRow[];
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: pageRows.map(fromTaskContractActionRow),
      ...(hasNext ? { nextCursor: pageRows[pageRows.length - 1]!.sequence } : {}),
    };
  }

  async reviseTaskContractBrief(
    request: TaskContractStoredCreateRequest & { expectedRevision: number },
  ): Promise<TaskContractStoredState> {
    const brief = parseTaskContractBrief(request.brief);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      const currentVersion = this.latestTaskContractVersion(request.contractId, 'brief');
      const now = new Date().toISOString();
      const briefId = randomUUID();
      this.insertTaskContractDocument({
        id: briefId,
        contractId: request.contractId,
        kind: 'brief',
        version: currentVersion + 1,
        sourceDocumentId: null,
        body: brief,
        createdAt: now,
      });
      this.updateTaskContract(
        request,
        `current_brief_id = ?, current_plan_id = NULL, approved_plan_id = NULL,
         current_todo_id = NULL, current_block_id = NULL, phase = 'exploration'`,
        [briefId],
      );
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async publishTaskContractPlan(
    request: TaskContractStoredPlanRequest,
  ): Promise<TaskContractStoredState> {
    const plan = parseTaskContractPlan(request.plan);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      const brief = this.requireTaskContractDocument(
        request.contractId,
        contract.current_brief_id,
        'brief',
      ) as TaskContractDocument<TaskContractBrief>;
      if (plan.briefVersion !== brief.version) {
        throw new TaskContractError('incompatible-version', 'Plan must refer to the current brief');
      }
      const now = new Date().toISOString();
      const planId = randomUUID();
      this.insertTaskContractDocument({
        id: planId,
        contractId: request.contractId,
        kind: 'plan',
        version: this.latestTaskContractVersion(request.contractId, 'plan') + 1,
        sourceDocumentId: brief.id,
        body: plan,
        createdAt: now,
      });
      this.updateTaskContract(
        request,
        `current_plan_id = ?, approved_plan_id = NULL, current_todo_id = NULL,
         current_block_id = NULL, phase = 'planning'`,
        [planId],
      );
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async commentTaskContractPlan(
    request: TaskContractStoredCommentRequest,
  ): Promise<TaskContractStoredState> {
    assertTaskContractText(request.content, 'Plan comment', 4 * 1024);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      const plan = this.requireTaskContractDocument(
        request.contractId,
        contract.current_plan_id,
        'plan',
      );
      if (plan.version !== request.planVersion)
        throw taskContractInvalidTarget('Plan comment target is stale');
      this.assertNoActiveTaskContractBlock(contract);
      const now = new Date().toISOString();
      this.insertTaskContractAction({
        id: randomUUID(),
        contractId: request.contractId,
        sequence: this.nextTaskContractActionSequence(request.contractId),
        kind: 'comment',
        targetDocumentId: plan.id,
        relatedActionId: null,
        details: { content: request.content, planVersion: request.planVersion },
        createdAt: now,
      });
      this.updateTaskContract(
        request,
        `approved_plan_id = NULL, current_todo_id = NULL, phase = 'planning'`,
        [],
      );
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async approveTaskContractPlan(
    request: TaskContractStoredApprovalRequest,
  ): Promise<TaskContractStoredState> {
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      const brief = this.requireTaskContractDocument(
        request.contractId,
        contract.current_brief_id,
        'brief',
      ) as TaskContractDocument<TaskContractBrief>;
      const plan = this.requireTaskContractDocument(
        request.contractId,
        contract.current_plan_id,
        'plan',
      ) as TaskContractDocument<TaskContractPlan>;
      if (plan.body.briefVersion !== brief.version || plan.version !== request.planVersion) {
        throw taskContractInvalidTarget(
          'Only the current plan for the current brief can be approved',
        );
      }
      this.assertNoActiveTaskContractBlock(contract);
      const now = new Date().toISOString();
      this.insertTaskContractAction({
        id: randomUUID(),
        contractId: request.contractId,
        sequence: this.nextTaskContractActionSequence(request.contractId),
        kind: 'approve-plan',
        targetDocumentId: plan.id,
        relatedActionId: null,
        details: { decision: 'approve', planVersion: request.planVersion },
        createdAt: now,
      });
      this.updateTaskContract(
        request,
        `approved_plan_id = ?, current_todo_id = NULL, phase = 'todo'`,
        [plan.id],
      );
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async publishTaskContractTodo(
    request: TaskContractStoredTodoRequest,
  ): Promise<TaskContractStoredState> {
    const todo = parseTaskContractTodo(request.todo);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      const plan = this.requireTaskContractDocument(
        request.contractId,
        contract.current_plan_id,
        'plan',
      ) as TaskContractDocument<TaskContractPlan>;
      if (!contract.approved_plan_id || contract.approved_plan_id !== plan.id) {
        throw new TaskContractError(
          'blocked',
          'An approved current plan is required before publishing TODO',
        );
      }
      assertTaskContractTodoMatchesPlan(todo, plan.version);
      this.assertNoActiveTaskContractBlock(contract);
      const scope = validateTaskContractTodoScope(todo, plan.body);
      const now = new Date().toISOString();
      const todoId = randomUUID();
      this.insertTaskContractDocument({
        id: todoId,
        contractId: request.contractId,
        kind: 'todo',
        version: this.latestTaskContractVersion(request.contractId, 'todo') + 1,
        sourceDocumentId: plan.id,
        body: todo,
        createdAt: now,
      });
      if (scope.compatible) {
        this.updateTaskContract(request, `current_todo_id = ?, phase = 'todo'`, [todoId]);
      } else {
        const blockId = this.insertTaskContractAction({
          id: randomUUID(),
          contractId: request.contractId,
          sequence: this.nextTaskContractActionSequence(request.contractId),
          kind: 'block',
          targetDocumentId: todoId,
          relatedActionId: null,
          details: {
            reason: 'TODO scope requires review',
            reasonCode: 'scope-review-required',
            differences: scope.differences,
          },
          createdAt: now,
        });
        this.updateTaskContract(
          request,
          `current_todo_id = ?, approved_plan_id = NULL, current_block_id = ?, phase = 'planning'`,
          [todoId, blockId],
        );
      }
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async blockTaskContract(
    request: TaskContractStoredBlockRequest,
  ): Promise<TaskContractStoredState> {
    assertTaskContractText(request.reason, 'Task contract block reason', 4 * 1024);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      this.assertNoActiveTaskContractBlock(contract);
      const target = this.requireTaskContractDocumentByVersion(
        request.contractId,
        request.documentKind,
        request.documentVersion,
      );
      this.assertCurrentTaskContractDocument(contract, target);
      const now = new Date().toISOString();
      const blockId = this.insertTaskContractAction({
        id: randomUUID(),
        contractId: request.contractId,
        sequence: this.nextTaskContractActionSequence(request.contractId),
        kind: 'block',
        targetDocumentId: target.id,
        relatedActionId: null,
        details: {
          reason: request.reason,
          reasonCode: 'manual',
          documentKind: request.documentKind,
          documentVersion: request.documentVersion,
          ...(request.differences ? { differences: request.differences } : {}),
        },
        createdAt: now,
      });
      this.updateTaskContract(
        request,
        `approved_plan_id = NULL, current_todo_id = NULL, current_block_id = ?, phase = ?`,
        [blockId, contract.current_plan_id ? 'planning' : 'exploration'],
      );
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  async resolveTaskContractBlock(
    request: TaskContractStoredResolveBlockRequest,
  ): Promise<TaskContractStoredState> {
    assertTaskContractText(request.reason, 'Task contract block resolution reason', 4 * 1024);
    return this.withImmediateTransaction(() => {
      const contract = this.requireTaskContractForWrite(request.workspace, request.contractId);
      assertExpectedTaskContractRevision(contract, request.expectedRevision);
      if (!contract.current_block_id || contract.current_block_id !== request.blockId) {
        throw taskContractInvalidTarget('The active task contract block is stale');
      }
      const block = this.database
        .prepare(
          "SELECT * FROM task_contract_actions WHERE contract_id = ? AND id = ? AND kind = 'block'",
        )
        .get(request.contractId, request.blockId) as TaskContractActionRow | undefined;
      if (!block) throw taskContractInvalidTarget('The active task contract block does not exist');
      const blockAction = fromTaskContractActionRow(block);
      if (blockAction.details.reasonCode === 'scope-review-required') {
        throw new TaskContractError(
          'blocked',
          'Scope review requires publishing a new brief or plan before resolution',
        );
      }
      const now = new Date().toISOString();
      this.insertTaskContractAction({
        id: randomUUID(),
        contractId: request.contractId,
        sequence: this.nextTaskContractActionSequence(request.contractId),
        kind: 'resolve-block',
        targetDocumentId: block.target_document_id,
        relatedActionId: block.id,
        details: { reason: request.reason },
        createdAt: now,
      });
      this.updateTaskContract(request, 'current_block_id = ?', [null]);
      return this.requireTaskContractState(request.workspace, request.contractId);
    });
  }

  private requirePortabilityState(): PortabilityState {
    const row = this.database
      .prepare('SELECT * FROM portability_state WHERE singleton_id = 1')
      .get() as PortabilityStateRow | undefined;
    if (!row) throw new PortabilityContractError('invalid-input', 'Portability state is missing');
    return {
      datasetId: row.dataset_id,
      state: row.state,
      lastTransferId: row.last_transfer_id,
      pendingExport:
        row.pending_request_id &&
        row.pending_digest &&
        row.pending_destination &&
        row.pending_transfer_id
          ? {
              requestId: row.pending_request_id,
              digest: row.pending_digest,
              destination: row.pending_destination,
              transferId: row.pending_transfer_id,
            }
          : null,
    };
  }

  private scalarCount(sql: string): number {
    const row = this.database.prepare(sql).get() as { count: number };
    return row.count;
  }

  private getGuidedPreparationRow(contractId: string): GuidedPreparationRow | undefined {
    return this.database
      .prepare('SELECT * FROM guided_preparations WHERE contract_id = ?')
      .get(contractId) as GuidedPreparationRow | undefined;
  }

  private requireGuidedPreparationRow(contractId: string): GuidedPreparationRow {
    const row = this.getGuidedPreparationRow(contractId);
    if (!row) {
      throw new GuidedPreparationError('invalid-target', 'Guided preparation does not exist');
    }
    return row;
  }

  private requireGuidedPreparationState(
    workspace: string,
    contractId: string,
  ): GuidedPreparationState {
    this.requireTaskContractForWrite(workspace, contractId);
    const row = this.requireGuidedPreparationRow(contractId);
    return this.toGuidedPreparationState(row);
  }

  private toGuidedPreparationState(row: GuidedPreparationRow): GuidedPreparationState {
    const contract = this.getTaskContractRow(row.contract_id);
    const planVersion = contract?.current_plan_id
      ? ((
          this.database
            .prepare('SELECT version FROM task_contract_documents WHERE id = ? AND contract_id = ?')
            .get(contract.current_plan_id, row.contract_id) as { version: number } | undefined
        )?.version ?? null)
      : null;
    const todoVersion = contract?.current_todo_id
      ? ((
          this.database
            .prepare('SELECT version FROM task_contract_documents WHERE id = ? AND contract_id = ?')
            .get(contract.current_todo_id, row.contract_id) as { version: number } | undefined
        )?.version ?? null)
      : null;
    return {
      contractId: row.contract_id,
      revision: row.revision,
      lastSequence: row.last_sequence,
      briefConfirmedThroughSequence: row.brief_confirmed_through_sequence,
      confirmedSourceIds: parseStringArray(row.confirmed_source_ids_json),
      activeRequestId: row.active_request_id,
      planVersion,
      todoVersion,
    };
  }

  private requireGuidedPreparationRequest(
    contractId: string,
    requestId: string,
  ): GuidedPreparationRequestRecord {
    const row = this.database
      .prepare('SELECT * FROM guided_preparation_requests WHERE contract_id = ? AND request_id = ?')
      .get(contractId, requestId) as GuidedPreparationRequestRow | undefined;
    if (!row)
      throw new GuidedPreparationError('invalid-target', 'Guided preparation request is missing');
    return fromGuidedPreparationRequestRow(row);
  }

  private assertGuidedPreparationNotConsumed(contractId: string): void {
    const consumed = this.database
      .prepare('SELECT 1 AS present FROM guided_executions WHERE contract_id = ? LIMIT 1')
      .get(contractId) as { present: number } | undefined;
    if (consumed?.present === 1) {
      throw new GuidedPreparationError('invalid-target', 'The task contract has been consumed');
    }
  }

  private assertGuidedSourceIds(contractId: string, sourceIds: readonly string[]): void {
    if (sourceIds.length > GUIDED_PREPARATION_LIMITS.maxSelectedSources) {
      throw new GuidedPreparationError('invalid-input', 'At most five sources may be selected');
    }
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new GuidedPreparationError('invalid-input', 'Source IDs must be unique');
    }
    if (sourceIds.length === 0) return;
    const placeholders = sourceIds.map(() => '?').join(', ');
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM guided_preparation_sources
          WHERE contract_id = ? AND id IN (${placeholders})`,
      )
      .get(contractId, ...sourceIds) as { count: number };
    if (row.count !== sourceIds.length) {
      throw new GuidedPreparationError(
        'invalid-input',
        'A selected source does not belong to the task',
      );
    }
  }

  private withImmediateTransaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the mutation error if rollback itself fails.
      }
      throw error;
    }
  }

  private getTaskContractRow(contractId: string): TaskContractRow | undefined {
    return this.database.prepare('SELECT * FROM task_contracts WHERE id = ?').get(contractId) as
      TaskContractRow | undefined;
  }

  private assertTaskContractWorkspace(
    workspace: string,
    contractId: string,
  ): TaskContractRow | undefined {
    const row = this.getTaskContractRow(contractId);
    if (row && row.workspace !== workspace) throw taskContractTargetError(contractId);
    return row;
  }

  private requireTaskContractForWrite(workspace: string, contractId: string): TaskContractRow {
    const row = this.assertTaskContractWorkspace(workspace, contractId);
    if (!row) throw taskContractInvalidTarget(`Unknown task contract: ${contractId}`);
    return row;
  }

  private requireTaskContractState(workspace: string, contractId: string): TaskContractStoredState {
    const row = this.requireTaskContractForWrite(workspace, contractId);
    const currentBrief = this.requireTaskContractDocument(
      contractId,
      row.current_brief_id,
      'brief',
    );
    const currentPlan = row.current_plan_id
      ? this.requireTaskContractDocument(contractId, row.current_plan_id, 'plan')
      : null;
    const approvedPlan = row.approved_plan_id
      ? this.requireTaskContractDocument(contractId, row.approved_plan_id, 'plan')
      : null;
    const currentTodo = row.current_todo_id
      ? this.requireTaskContractDocument(contractId, row.current_todo_id, 'todo')
      : null;
    const activeBlock = row.current_block_id
      ? this.getTaskContractAction(contractId, row.current_block_id)
      : null;
    if (row.current_block_id && !activeBlock) {
      throw new TaskContractError('invalid-input', 'Task contract has a missing active block');
    }
    const approval = approvedPlan
      ? (this.database
          .prepare(
            `SELECT * FROM task_contract_actions
              WHERE contract_id = ? AND kind = 'approve-plan' AND target_document_id = ?
              ORDER BY sequence DESC LIMIT 1`,
          )
          .get(contractId, approvedPlan.id) as TaskContractActionRow | undefined)
      : undefined;
    const execution = this.database
      .prepare('SELECT run_id FROM guided_executions WHERE contract_id = ?')
      .get(contractId) as { run_id: string } | undefined;
    return {
      contract: fromTaskContractRow(row),
      ...(execution ? { execution: { runId: execution.run_id } } : {}),
      currentBrief: currentBrief as TaskContractDocument<
        import('../application/task-contract.js').TaskContractBrief
      >,
      currentPlan: currentPlan as TaskContractDocument<TaskContractPlan> | null,
      approvedPlan: approvedPlan as TaskContractDocument<TaskContractPlan> | null,
      currentTodo: currentTodo as TaskContractDocument<TaskContractTodo> | null,
      activeBlock: activeBlock ? fromTaskContractActionRow(activeBlock) : null,
      approval: approval ? fromTaskContractActionRow(approval) : null,
    };
  }

  private getTaskContractDocumentRow(
    contractId: string,
    documentId: string | null,
  ): TaskContractDocumentRow | undefined {
    if (!documentId) return undefined;
    return this.database
      .prepare('SELECT * FROM task_contract_documents WHERE contract_id = ? AND id = ?')
      .get(contractId, documentId) as TaskContractDocumentRow | undefined;
  }

  private requireTaskContractDocument(
    contractId: string,
    documentId: string | null,
    kind: TaskContractDocumentKind,
  ): TaskContractDocument {
    const row = this.getTaskContractDocumentRow(contractId, documentId);
    if (!row || row.kind !== kind) {
      throw new TaskContractError('invalid-input', `Task contract pointer for ${kind} is invalid`);
    }
    return fromTaskContractDocumentRow(row);
  }

  private requireTaskContractDocumentByVersion(
    contractId: string,
    kind: TaskContractDocumentKind,
    version: number,
  ): TaskContractDocument {
    const row = this.database
      .prepare(
        'SELECT * FROM task_contract_documents WHERE contract_id = ? AND kind = ? AND version = ?',
      )
      .get(contractId, kind, version) as TaskContractDocumentRow | undefined;
    if (!row) throw taskContractInvalidTarget(`Unknown ${kind} document version ${version}`);
    return fromTaskContractDocumentRow(row);
  }

  private getTaskContractAction(
    contractId: string,
    actionId: string,
  ): TaskContractActionRow | undefined {
    return this.database
      .prepare('SELECT * FROM task_contract_actions WHERE contract_id = ? AND id = ?')
      .get(contractId, actionId) as TaskContractActionRow | undefined;
  }

  private assertCurrentTaskContractDocument(
    contract: TaskContractRow,
    document: TaskContractDocument,
  ): void {
    const pointer =
      document.kind === 'brief'
        ? contract.current_brief_id
        : document.kind === 'plan'
          ? contract.current_plan_id
          : contract.current_todo_id;
    if (pointer !== document.id)
      throw taskContractInvalidTarget('The target document is not current');
  }

  private assertNoActiveTaskContractBlock(contract: TaskContractRow): void {
    if (contract.current_block_id) {
      throw new TaskContractError('blocked', 'The task contract has an active block');
    }
  }

  private latestTaskContractVersion(contractId: string, kind: TaskContractDocumentKind): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM task_contract_documents WHERE contract_id = ? AND kind = ?',
      )
      .get(contractId, kind) as { version: number };
    return row.version;
  }

  private nextTaskContractActionSequence(contractId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM task_contract_actions WHERE contract_id = ?',
      )
      .get(contractId) as { sequence: number };
    return row.sequence + 1;
  }

  private insertTaskContractDocument(document: TaskContractDocument): void {
    this.database
      .prepare(
        `INSERT INTO task_contract_documents
          (id, contract_id, kind, version, source_document_id, body_json, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        document.id,
        document.contractId,
        document.kind,
        document.version,
        document.sourceDocumentId,
        JSON.stringify(document.body),
        taskContractSummary(document),
        document.createdAt,
      );
  }

  private insertTaskContractAction(action: TaskContractAction): string {
    this.database
      .prepare(
        `INSERT INTO task_contract_actions
          (id, contract_id, sequence, kind, target_document_id, related_action_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.contractId,
        action.sequence,
        action.kind,
        action.targetDocumentId,
        action.relatedActionId,
        JSON.stringify(action.details),
        action.createdAt,
      );
    return action.id;
  }

  private updateTaskContract(
    request: { contractId: string; workspace: string; expectedRevision: number },
    assignments: string,
    values: unknown[],
  ): void {
    const execution = this.database
      .prepare('SELECT run_id FROM guided_executions WHERE contract_id = ?')
      .get(request.contractId) as { run_id: string } | undefined;
    if (execution) {
      throw new TaskContractError(
        'blocked',
        `Task contract is already linked to guided execution ${execution.run_id}`,
      );
    }
    const result = this.database
      .prepare(
        `UPDATE task_contracts
            SET ${assignments}, revision = revision + 1, updated_at = ?
          WHERE id = ? AND workspace = ? AND revision = ?`,
      )
      .run(
        ...values,
        new Date().toISOString(),
        request.contractId,
        request.workspace,
        request.expectedRevision,
      );
    if (result.changes !== 1) throw taskContractStale(request.contractId);
  }

  async createRun(run: WorkflowRun, artifacts: ArtifactReference[] = []): Promise<void> {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs (id, workflow_id, workflow_version, objective, status, created_at, updated_at)
           VALUES (@id, @workflowId, @workflowVersion, @objective, @status, @createdAt, @updatedAt)`,
        )
        .run(toRunParams(run));
      for (const artifact of artifacts) this.insertArtifact(artifact);
      if (run.status === 'running') this.acquireExecutionOwner(run.id);
    });
    transaction();
  }

  async getRun(runId: string): Promise<WorkflowRun | undefined> {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      RunRow | undefined;
    return row ? fromRunRow(row) : undefined;
  }

  async claimRun(
    runId: string,
    eligibleStatuses: readonly RunStatus[],
  ): Promise<WorkflowRun | undefined> {
    return (await this.claimRunForExecution(runId, eligibleStatuses))?.run;
  }

  async claimRunForExecution(
    runId: string,
    eligibleStatuses: readonly RunStatus[],
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined> {
    const statuses = [...new Set(eligibleStatuses)];
    if (statuses.length === 0) return undefined;
    for (const status of statuses) {
      if (status === 'running') throw new Error('A running run cannot be claimed');
      assertRunTransition(status, 'running');
    }

    const placeholders = statuses.map(() => '?').join(', ');
    const transaction = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE runs
           SET status = 'running', updated_at = ?
           WHERE id = ? AND status IN (${placeholders})`,
        )
        .run(new Date().toISOString(), runId, ...statuses);
      if (result.changes !== 1) return undefined;
      this.acquireExecutionOwner(runId);
      const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
        RunRow | undefined;
      return row ? fromRunRow(row) : undefined;
    });
    const run = transaction();
    return run ? { run, claim: this.createExecutionClaim(runId) } : undefined;
  }

  async claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined> {
    return (await this.claimApprovalForExecution(runId, approvalStep))?.run;
  }

  async claimApprovalForExecution(
    runId: string,
    approvalStep: StepRun,
  ): Promise<{ run: WorkflowRun; claim: ExecutionClaim } | undefined> {
    if (approvalStep.runId !== runId || approvalStep.status !== 'pending') {
      throw new Error('A pending approval step for the same run is required');
    }

    const transaction = this.database.transaction(() => {
      const run = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
        RunRow | undefined;
      if (!run || run.status !== 'waiting') return undefined;

      const step = this.database
        .prepare('SELECT status FROM step_runs WHERE run_id = ? AND step_id = ?')
        .get(runId, approvalStep.stepId) as { status: StepRun['status'] } | undefined;
      if (!step || step.status !== 'waiting') return undefined;

      const updatedAt = new Date().toISOString();
      const result = this.database
        .prepare(
          "UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'waiting'",
        )
        .run(updatedAt, runId);
      if (result.changes !== 1) return undefined;
      this.acquireExecutionOwner(runId);
      this.writeStepRun(approvalStep);
      return fromRunRow({ ...run, status: 'running', updated_at: updatedAt });
    });
    const run = transaction();
    return run ? { run, claim: this.createExecutionClaim(runId) } : undefined;
  }

  async assertExecutionOwner(runId: string): Promise<void> {
    this.assertCurrentExecutionOwner(runId);
  }

  async assertExecutionClaim(claim: ExecutionClaim): Promise<void> {
    if (this.executionClaims.get(claim.runId) !== claim.token) {
      throw new RunExecutionOwnedError(claim.runId);
    }
    this.assertCurrentExecutionOwner(claim.runId);
  }

  async markRunInterrupted(runId: string): Promise<WorkflowRun | undefined> {
    const transaction = this.database.transaction(() => {
      const run = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
        RunRow | undefined;
      if (!run || run.status !== 'running') return undefined;
      const owner = this.getExecutionOwner(runId);
      if (owner && this.isLiveOwner(owner)) throw new RunExecutionOwnedError(runId);
      this.database.prepare('DELETE FROM run_execution_owners WHERE run_id = ?').run(runId);

      const interruptedAt = new Date().toISOString();
      this.database
        .prepare(
          `UPDATE step_runs
           SET status = 'interrupted', finished_at = ?
           WHERE run_id = ? AND status = 'running'`,
        )
        .run(interruptedAt, runId);
      this.database
        .prepare(
          `UPDATE step_attempts
           SET status = 'interrupted', finished_at = ?
           WHERE run_id = ? AND status = 'running'`,
        )
        .run(interruptedAt, runId);

      const result = this.database
        .prepare(
          `UPDATE runs
           SET status = 'interrupted', updated_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(interruptedAt, runId);
      if (result.changes !== 1) return undefined;
      return fromRunRow({ ...run, status: 'interrupted', updated_at: interruptedAt });
    });
    const interrupted = transaction();
    if (interrupted) this.executionClaims.delete(runId);
    return interrupted;
  }

  async releaseExecution(runId: string): Promise<void> {
    this.database
      .prepare('DELETE FROM run_execution_owners WHERE run_id = ? AND owner_id = ?')
      .run(runId, this.ownerId);
    this.executionClaims.delete(runId);
  }

  async listRunsPage(query: RunListQuery = {}): Promise<RunListPage> {
    const limit = validateLimit(query.limit);
    const conditions: string[] = [];
    const parameters: Record<string, string | number> = { limit: limit + 1 };

    if (query.status !== undefined) {
      if (!RUN_STATUSES.has(query.status)) throw new Error(`Invalid run status: ${query.status}`);
      conditions.push('status = @status');
      parameters.status = query.status;
    }
    if (query.statuses !== undefined) {
      if (query.status !== undefined) throw new Error('Use status or statuses, not both');
      if (query.statuses.length === 0) return { runs: [] };
      const placeholders = query.statuses.map((status, index) => {
        if (!RUN_STATUSES.has(status)) throw new Error(`Invalid run status: ${status}`);
        const parameter = `status${index}`;
        parameters[parameter] = status;
        return `@${parameter}`;
      });
      conditions.push(`status IN (${placeholders.join(', ')})`);
    }
    if (query.workflowId !== undefined) {
      if (!query.workflowId.trim()) throw new Error('Workflow filter must be non-empty');
      conditions.push('workflow_id = @workflowId');
      parameters.workflowId = query.workflowId;
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      conditions.push(
        '(created_at < @cursorCreatedAt OR (created_at = @cursorCreatedAt AND id < @cursorId))',
      );
      parameters.cursorCreatedAt = cursor.createdAt;
      parameters.cursorId = cursor.id;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT * FROM runs ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT @limit`,
      )
      .all(parameters) as RunRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      runs: pageRows.map(fromRunRow),
      ...(hasNextPage ? { nextCursor: encodeCursor(pageRows[pageRows.length - 1]!) } : {}),
    };
  }

  async listTaskRunsPage(query: { limit?: number; cursor?: string } = {}): Promise<TaskRunPage> {
    const limit = validatePreparationLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = this.database
      .prepare(
        `SELECT id, workflow_id, status, substr(objective, 1, 256) AS objective_preview,
                length(objective) > 256 AS objective_truncated, created_at, updated_at
           FROM runs
          ${cursor ? 'WHERE (created_at < ? OR (created_at = ? AND id < ?))' : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(
        ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
        limit + 1,
      ) as TaskRunRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const items: TaskRunItem[] = pageRows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      objectivePreview: row.objective_preview,
      previewTruncated: row.objective_truncated === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return {
      items,
      ...(pageRows.length > 0 && hasNextPage
        ? { nextCursor: encodeTaskCursor(pageRows[pageRows.length - 1]!) }
        : {}),
    };
  }

  async saveRun(run: WorkflowRun, expectedStatus: RunStatus): Promise<void> {
    const transaction = this.database.transaction(() => {
      const current = this.database.prepare('SELECT status FROM runs WHERE id = ?').get(run.id) as
        { status: WorkflowRun['status'] } | undefined;
      if (!current) throw new Error(`Cannot update unknown run: ${run.id}`);
      if (current.status !== expectedStatus) {
        throw new RunStatusConflictError(run.id, expectedStatus, current.status);
      }
      assertRunTransition(expectedStatus, run.status);
      if (expectedStatus === 'running') this.assertCurrentExecutionOwner(run.id);
      if (run.status === 'running') this.acquireExecutionOwner(run.id);

      const result = this.database
        .prepare(
          `UPDATE runs
            SET workflow_id = @workflowId,
                workflow_version = @workflowVersion,
                objective = @objective,
                status = @status,
                created_at = @createdAt,
                updated_at = @updatedAt
            WHERE id = @id AND status = @expectedStatus`,
        )
        .run({ ...toRunParams(run), expectedStatus });
      if (result.changes !== 1) {
        throw new RunStatusConflictError(run.id, expectedStatus, run.status);
      }
      if (run.status !== 'running') {
        this.database.prepare('DELETE FROM run_execution_owners WHERE run_id = ?').run(run.id);
      }
    });
    transaction();
    if (run.status !== 'running') this.executionClaims.delete(run.id);
  }

  async saveStepRun(stepRun: StepRun): Promise<void> {
    const transaction = this.database.transaction(() => {
      const run = this.database
        .prepare('SELECT status FROM runs WHERE id = ?')
        .get(stepRun.runId) as { status: RunStatus } | undefined;
      if (!run) throw new Error(`Cannot update step for unknown run: ${stepRun.runId}`);
      if (run.status !== 'running') throw new RunExecutionOwnedError(stepRun.runId);
      this.assertCurrentExecutionOwner(stepRun.runId);
      this.writeStepRun(stepRun);
    });
    transaction();
  }

  async getStepRuns(runId: string, options: StepRunQueryOptions = {}): Promise<StepRun[]> {
    // Default keeps full results for engine/resume paths; false omits, 'usage' projects.
    const omitResult = options.includeResult === false;
    const resultColumn = omitResult ? 'NULL AS result_json' : 'result_json';
    const rows = this.database
      .prepare(
        `SELECT run_id, step_id, profile, profile_json, status, attempt, started_at, finished_at,
                ${resultColumn}, error_json, disposition_json, skip_reason_json, approval_json
         FROM step_runs WHERE run_id = ? ORDER BY rowid`,
      )
      .all(runId) as StepRunRow[];
    return rows.map((row) =>
      fromStepRunRow(row, options.includeResult === 'usage' ? 'usage' : undefined),
    );
  }

  async getArtifacts(runId: string): Promise<ArtifactReference[]> {
    const rows = this.database
      .prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY rowid')
      .all(runId) as ArtifactRow[];
    return rows.map(fromArtifactRow);
  }

  async listPortabilityArtifacts(): Promise<ArtifactReference[]> {
    const rows = this.database
      .prepare('SELECT * FROM artifacts ORDER BY rowid')
      .all() as ArtifactRow[];
    return rows.map(fromArtifactRow);
  }

  async countPortabilityRuns(): Promise<number> {
    return (this.database.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number })
      .count;
  }

  async saveCoordinatorArtifacts(runId: string, artifacts: ArtifactReference[]): Promise<void> {
    if (artifacts.some((artifact) => artifact.runId !== runId)) {
      throw new Error('Coordinator artifact references must belong to the same run');
    }
    const keys = artifacts.map((artifact) => `${artifact.stepId}\u0000${artifact.name}`);
    if (new Set(keys).size !== keys.length) {
      throw new Error('Coordinator artifact references must have unique names per phase');
    }
    const transaction = this.database.transaction(() => {
      const run = this.database.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        { status: RunStatus } | undefined;
      if (!run) throw new Error(`Cannot save coordinator artifacts for unknown run: ${runId}`);
      if (run.status !== 'running') throw new RunExecutionOwnedError(runId);
      this.assertCurrentExecutionOwner(runId);
      for (const artifact of artifacts) this.upsertArtifactInTransaction(artifact);
    });
    transaction();
  }

  async checkpointResearchIteration(
    inputArtifact: ArtifactReference,
    researchStep: StepRun,
    reviewStep: StepRun,
    approvalStep?: StepRun,
  ): Promise<void> {
    if (
      inputArtifact.stepId !== 'run' ||
      inputArtifact.name !== 'input' ||
      researchStep.runId !== inputArtifact.runId ||
      reviewStep.runId !== inputArtifact.runId ||
      (approvalStep?.runId !== undefined && approvalStep.runId !== inputArtifact.runId)
    ) {
      throw new Error('Research checkpoint state must belong to the same run');
    }
    const transaction = this.database.transaction(() => {
      const run = this.database
        .prepare('SELECT status FROM runs WHERE id = ?')
        .get(inputArtifact.runId) as { status: RunStatus } | undefined;
      if (!run) throw new Error(`Cannot checkpoint unknown run: ${inputArtifact.runId}`);
      if (run.status !== 'running') throw new RunExecutionOwnedError(inputArtifact.runId);
      this.assertCurrentExecutionOwner(inputArtifact.runId);
      this.replaceArtifactInTransaction(inputArtifact);
      this.writeStepRun(researchStep, true);
      this.writeStepRun(reviewStep, true);
      if (approvalStep) this.writeStepRun(approvalStep, true);
    });
    transaction();
  }

  async saveQaDefect(defect: QaDefect): Promise<void> {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO qa_defects
            (id, fingerprint, title, summary, category, severity, locations_json, symbols_json, resolution, status, created_at, updated_at)
           VALUES (@id, @fingerprint, @title, @summary, @category, @severity, @locationsJson, @symbolsJson, @resolution, @status, @createdAt, @updatedAt)
           ON CONFLICT (id) DO UPDATE SET
             fingerprint = excluded.fingerprint,
             title = excluded.title,
             summary = excluded.summary,
             category = excluded.category,
             severity = excluded.severity,
             locations_json = excluded.locations_json,
             symbols_json = excluded.symbols_json,
             resolution = excluded.resolution,
             status = excluded.status,
             updated_at = excluded.updated_at`,
        )
        .run(toQaDefectParams(defect));
      this.database.prepare('DELETE FROM qa_search WHERE defect_id = ?').run(defect.id);
      this.insertQaSearch(defect);
    });
    transaction();
  }

  async saveQaOccurrence(occurrence: QaOccurrence): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO qa_occurrences
          (id, run_id, defect_id, qa_iteration, finding_id, report_artifact_id, created_at)
         VALUES (@id, @runId, @defectId, @qaIteration, @findingId, @reportArtifactId, @createdAt)`,
      )
      .run(toQaOccurrenceParams(occurrence));
  }

  async saveQaDefectEvent(event: QaDefectEvent): Promise<void> {
    const transaction = this.database.transaction(() => {
      const updated = this.database
        .prepare('UPDATE qa_defects SET status = ?, updated_at = ? WHERE id = ?')
        .run(event.status, event.createdAt, event.defectId);
      if (updated.changes !== 1) throw new Error(`Unknown QA defect: ${event.defectId}`);
      this.database
        .prepare(
          `INSERT INTO qa_defect_events
            (defect_id, occurrence_id, status, details_json, created_at)
           VALUES (@defectId, @occurrenceId, @status, @details, @createdAt)`,
        )
        .run({
          defectId: event.defectId,
          occurrenceId: event.occurrenceId ?? null,
          status: event.status,
          details: event.details ?? null,
          createdAt: event.createdAt,
        });
    });
    transaction();
  }

  async getQaDefects(): Promise<QaDefect[]> {
    const rows = this.database
      .prepare('SELECT * FROM qa_defects ORDER BY created_at, id')
      .all() as QaDefectRow[];
    return rows.map(fromQaDefectRow);
  }

  async getQaOccurrences(defectId?: string): Promise<QaOccurrence[]> {
    const rows = (
      defectId === undefined
        ? this.database.prepare('SELECT * FROM qa_occurrences ORDER BY created_at, id').all()
        : this.database
            .prepare('SELECT * FROM qa_occurrences WHERE defect_id = ? ORDER BY created_at, id')
            .all(defectId)
    ) as QaOccurrenceRow[];
    return rows.map(fromQaOccurrenceRow);
  }

  async getQaDefectEvents(defectId: string): Promise<QaDefectEvent[]> {
    const rows = this.database
      .prepare('SELECT * FROM qa_defect_events WHERE defect_id = ? ORDER BY id')
      .all(defectId) as QaDefectEventRow[];
    return rows.map(fromQaDefectEventRow);
  }

  async searchQaDefects(fingerprint: string, query: string): Promise<QaSearchResult[]> {
    const exactRow = this.database
      .prepare('SELECT * FROM qa_defects WHERE fingerprint = ?')
      .get(fingerprint) as QaDefectRow | undefined;
    const results: QaSearchResult[] = exactRow
      ? [{ defect: fromQaDefectRow(exactRow), exact: true }]
      : [];
    const normalized = query.trim();
    if (!normalized) return results;
    const ftsQuery = normalized
      .split(/\\s+/)
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
      .join(' AND ');
    const rows = this.database
      .prepare('SELECT defect_id FROM qa_search WHERE qa_search MATCH ? ORDER BY bm25(qa_search)')
      .all(ftsQuery) as Array<{ defect_id: string }>;
    const exactId = exactRow?.id;
    for (const row of rows) {
      if (
        row.defect_id === exactId ||
        results.some((result) => result.defect.id === row.defect_id)
      ) {
        continue;
      }
      const defect = this.database
        .prepare('SELECT * FROM qa_defects WHERE id = ?')
        .get(row.defect_id) as QaDefectRow | undefined;
      if (defect) results.push({ defect: fromQaDefectRow(defect), exact: false });
    }
    return results;
  }

  async reindexQaSearch(): Promise<void> {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM qa_search').run();
      const rows = this.database.prepare('SELECT * FROM qa_defects').all() as QaDefectRow[];
      for (const row of rows) this.insertQaSearch(fromQaDefectRow(row));
    });
    transaction();
  }

  async archiveQaDefects(before?: string): Promise<number> {
    const cutoff = before ?? new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE qa_defects SET status = 'archived', updated_at = ?
         WHERE created_at < ? AND status <> 'archived'`,
      )
      .run(new Date().toISOString(), cutoff);
    return result.changes;
  }

  async purgeQaHistory(): Promise<void> {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM qa_defect_events').run();
      this.database.prepare('DELETE FROM qa_occurrences').run();
      this.database.prepare('DELETE FROM qa_defects').run();
      this.database.prepare('DELETE FROM qa_search').run();
    });
    transaction();
  }

  async createReviewThread(thread: ReviewThread): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO review_threads
          (id, run_id, phase, target_kind, target_id, artifact_revision, state, revision, created_at, updated_at)
         VALUES (@id, @runId, @phase, @targetKind, @targetId, @artifactRevision, @state, @revision, @createdAt, @updatedAt)`,
      )
      .run(toReviewThreadParams(thread));
  }

  async createPreparation(draft: PreparationDraft): Promise<void> {
    const synthesis: PreparationSynthesis = {
      objective: draft.objective,
      agreements: [],
      constraints: [],
      assumptions: [],
      questions: [],
    };
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO preparation_drafts
            (id, workspace, workflow_id, workflow_version, objective, revision, content_version,
             producer_json, reviewer_json, review_mode, applied_review_mode, synthesis_version,
             valid_proposal_id, valid_review_id, blocking_review_id, status, consumed_run_id,
             created_at, updated_at)
           VALUES (@id, @workspace, @workflowId, @workflowVersion, @objective, @revision, 1,
                   NULL, NULL, 'human', 'human', 1, NULL, NULL, NULL, @status, @consumedRunId,
                   @createdAt, @updatedAt)`,
        )
        .run(toPreparationDraftParams(draft));
      this.database
        .prepare(
          `INSERT INTO preparation_syntheses
            (id, draft_id, version, value_json, covered_through_sequence, origin, confirmed, created_at)
           VALUES (?, ?, 1, ?, 0, 'initial', 0, ?)`,
        )
        .run(`${draft.id}:synthesis:1`, draft.id, JSON.stringify(synthesis), draft.createdAt);
    });
    transaction();
  }

  async listPreparations(workspace?: string): Promise<PreparationDraft[]> {
    const rows = (
      workspace === undefined
        ? this.database
            .prepare('SELECT * FROM preparation_drafts ORDER BY updated_at DESC, id')
            .all()
        : this.database
            .prepare(
              'SELECT * FROM preparation_drafts WHERE workspace = ? ORDER BY updated_at DESC, id',
            )
            .all(workspace)
    ) as PreparationDraftRow[];
    return rows.map(fromPreparationDraftRow);
  }

  async getPreparation(draftId: string): Promise<PreparationConversation | undefined> {
    await this.recoverPreparation(draftId);
    const draftRow = this.database
      .prepare('SELECT * FROM preparation_drafts WHERE id = ?')
      .get(draftId) as PreparationDraftRow | undefined;
    if (!draftRow) return undefined;
    const messageRows = this.database
      .prepare('SELECT * FROM preparation_messages WHERE draft_id = ? ORDER BY sequence')
      .all(draftId) as PreparationMessageRow[];
    const proposalRow = this.database
      .prepare(
        'SELECT * FROM preparation_proposals WHERE draft_id = ? AND id = (SELECT valid_proposal_id FROM preparation_drafts WHERE id = ?)',
      )
      .get(draftId, draftId) as PreparationProposalRow | undefined;
    return {
      draft: fromPreparationDraftRow(draftRow),
      messages: messageRows.map(fromPreparationMessageRow),
      ...(proposalRow ? { proposal: fromPreparationProposalRow(proposalRow) } : {}),
    };
  }

  async getPreparationOverview(draftId: string): Promise<PreparationStoredView | undefined> {
    return this.readPreparationStoredView(draftId);
  }

  async listPreparationDraftsPage(
    query: {
      workspace?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<PreparationDraftPage> {
    const limit = validatePreparationLimit(query.limit);
    const cursor = query.cursor ? decodePreparationCursor(query.cursor, 'drafts') : undefined;
    const conditions = query.workspace === undefined ? [] : ['workspace = @workspace'];
    const parameters: Record<string, string | number> = { limit: limit + 1 };
    if (query.workspace !== undefined) parameters.workspace = query.workspace;
    if (cursor) {
      conditions.push('(created_at < @createdAt OR (created_at = @createdAt AND id < @id))');
      parameters.createdAt = cursor.createdAt!;
      parameters.id = cursor.id!;
    }
    const rows = this.database
      .prepare(
        `SELECT id, workflow_id, status, revision, substr(objective, 1, 256) AS objective_preview,
                length(objective) > 256 AS objective_truncated, created_at, updated_at
           FROM preparation_drafts
          ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT @limit`,
      )
      .all(parameters) as PreparationDraftPageRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const items: PreparationDraftItem[] = pageRows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      objectivePreview: row.objective_preview,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return {
      items,
      ...(pageRows.length > 0 && hasNextPage
        ? { nextCursor: encodePreparationCursor('drafts', pageRows[pageRows.length - 1]!) }
        : {}),
    };
  }

  async listPreparationMessagesPage(query: {
    draftId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PreparationMessagePage> {
    const limit = validatePreparationLimit(query.limit);
    const cursor = query.cursor
      ? decodePreparationCursor(query.cursor, 'messages', query.draftId)
      : undefined;
    const rows = this.database
      .prepare(
        `SELECT id, sequence, role, generation_status, content_revision,
                substr(content, 1, 256) AS preview, length(content) > 256 AS preview_truncated,
                profile_json, created_at
           FROM preparation_messages
          WHERE draft_id = ? ${cursor ? 'AND sequence < ?' : ''}
          ORDER BY sequence DESC
          LIMIT ?`,
      )
      .all(
        query.draftId,
        ...(cursor ? [cursor.sequence] : []),
        limit + 1,
      ) as PreparationMessagePageRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = (hasNextPage ? rows.slice(0, limit) : rows).reverse();
    const items: PreparationMessageItem[] = pageRows.map(fromPreparationMessagePageRow);
    return {
      items,
      ...(pageRows.length > 0 && hasNextPage
        ? { nextCursor: encodePreparationCursor('messages', rows[rows.length - 1]!, query.draftId) }
        : {}),
    };
  }

  async listPreparationProposalsPage(query: {
    draftId: string;
    cursor?: string;
    limit?: number;
  }): Promise<PreparationProposalPage> {
    const limit = validatePreparationLimit(query.limit);
    const cursor = query.cursor
      ? decodePreparationCursor(query.cursor, 'proposals', query.draftId)
      : undefined;
    const rows = this.database
      .prepare(
        `SELECT * FROM preparation_proposals
          WHERE draft_id = ?
            ${cursor ? 'AND (revision < ? OR (revision = ? AND id < ?))' : ''}
          ORDER BY revision DESC, id DESC
          LIMIT ?`,
      )
      .all(
        query.draftId,
        ...(cursor ? [cursor.revision, cursor.revision, cursor.id] : []),
        limit + 1,
      ) as PreparationProposalRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const items: PreparationProposalSummary[] = pageRows.map((row) =>
      toPreparationProposalSummary(row, row.revision === this.currentDraftRevision(query.draftId)),
    );
    return {
      items,
      ...(pageRows.length > 0 && hasNextPage
        ? {
            nextCursor: encodePreparationCursor(
              'proposals',
              pageRows[pageRows.length - 1]!,
              query.draftId,
            ),
          }
        : {}),
    };
  }

  async readPreparationDocumentPage(query: {
    draftId: string;
    kind: import('../application/preparation.js').PreparationDocumentKind;
    documentId: string;
    view?: 'readable' | 'source';
    cursor?: string;
  }): Promise<DocumentPage> {
    const document = this.loadPreparationDocument(query.draftId, query.kind, query.documentId);
    if (!document) throw new Error(`Unknown preparation document: ${query.documentId}`);
    return paginatePreparationDocument(
      query.draftId,
      query.documentId,
      document.version,
      document.content,
      document.format,
      query.cursor,
    );
  }

  async updatePreparationSettings(
    request: UpdatePreparationRequest,
  ): Promise<PreparationStoredView> {
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(request.draftId);
      this.assertPreparationMutationAvailable(draft.id);
      if (draft.revision !== request.expectedRevision) throw preparationStale(request.draftId);
      validatePreparationSettings(request.patch);
      const nextRevision = draft.revision + 1;
      const reviewMode = hasOwn(request.patch, 'reviewMode')
        ? request.patch.reviewMode!
        : draft.review_mode;
      const producer = hasOwn(request.patch, 'producer')
        ? request.patch.producer
        : parseSelection(draft.producer_json);
      const reviewer = hasOwn(request.patch, 'reviewer')
        ? request.patch.reviewer
        : parseSelection(draft.reviewer_json);
      const reviewerChanged =
        hasOwn(request.patch, 'reviewer') &&
        JSON.stringify(reviewer) !== JSON.stringify(parseSelection(draft.reviewer_json));
      const policyChanged = hasOwn(request.patch, 'reviewMode');
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = ?, producer_json = ?, reviewer_json = ?, review_mode = ?,
                  applied_review_mode = ?,
                  valid_proposal_id = CASE WHEN ? THEN NULL ELSE valid_proposal_id END,
                  valid_review_id = CASE WHEN ? THEN NULL ELSE valid_review_id END,
                  updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(
          nextRevision,
          producer ? JSON.stringify(producer) : null,
          reviewer ? JSON.stringify(reviewer) : null,
          reviewMode,
          reviewMode,
          policyChanged ? 1 : 0,
          policyChanged || reviewerChanged ? 1 : 0,
          new Date().toISOString(),
          request.draftId,
          request.expectedRevision,
        );
    });
    transaction();
    return this.requirePreparationStoredView(request.draftId);
  }

  async updatePreparationSynthesis(
    request: UpdatePreparationSynthesisRequest,
  ): Promise<PreparationStoredView> {
    validatePreparationSynthesis(request.synthesis);
    const serialized = JSON.stringify(request.synthesis);
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(request.draftId);
      this.assertPreparationMutationAvailable(draft.id);
      if (draft.revision !== request.expectedRevision) throw preparationStale(request.draftId);
      const lastSequence = this.database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM preparation_messages WHERE draft_id = ?',
        )
        .get(request.draftId) as { sequence: number };
      if (
        !Number.isInteger(request.coveredThroughSequence) ||
        request.coveredThroughSequence < 0 ||
        request.coveredThroughSequence > lastSequence.sequence
      ) {
        throw new Error('Preparation synthesis coverage is outside the available messages');
      }
      const pending = request.suggestionId
        ? (this.database
            .prepare(
              "SELECT base_version FROM preparation_suggestions WHERE id = ? AND draft_id = ? AND status = 'pending'",
            )
            .get(request.suggestionId, request.draftId) as { base_version: number } | undefined)
        : undefined;
      if (request.suggestionId && (!pending || pending.base_version !== draft.synthesis_version)) {
        throw preparationStale(request.draftId);
      }
      const current = this.database
        .prepare('SELECT value_json FROM preparation_syntheses WHERE draft_id = ? AND version = ?')
        .get(request.draftId, draft.synthesis_version) as { value_json: string } | undefined;
      const changed = !current || current.value_json !== serialized;
      const version = draft.synthesis_version + 1;
      const now = new Date().toISOString();
      this.database
        .prepare(
          `INSERT INTO preparation_syntheses
            (id, draft_id, version, value_json, covered_through_sequence, origin, confirmed, created_at)
           VALUES (?, ?, ?, ?, ?, 'human', 1, ?)`,
        )
        .run(
          `${request.draftId}:synthesis:${version}`,
          request.draftId,
          version,
          serialized,
          request.coveredThroughSequence,
          now,
        );
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = revision + 1, content_version = content_version + ?, objective = ?,
                  synthesis_version = ?, valid_proposal_id = NULL, valid_review_id = NULL, updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(
          changed ? 1 : 0,
          request.synthesis.objective,
          version,
          now,
          request.draftId,
          request.expectedRevision,
        );
      if (request.suggestionId) {
        this.database
          .prepare("UPDATE preparation_suggestions SET status = 'accepted' WHERE id = ?")
          .run(request.suggestionId);
      } else {
        this.database
          .prepare(
            "UPDATE preparation_suggestions SET status = 'discarded' WHERE draft_id = ? AND status = 'pending'",
          )
          .run(request.draftId);
      }
    });
    transaction();
    return this.requirePreparationStoredView(request.draftId);
  }

  async beginPreparationTurn(
    request: BeginPreparationTurnRequest,
  ): Promise<BeginPreparationTurnResult> {
    const transaction = this.database.transaction(() => {
      this.assertPreparationClaim(request.draftId, request.claimToken);
      const existing = this.getPreparationRequest(request.draftId, request.requestId);
      const inputJson = canonicalPreparationInput(request.input);
      if (existing) {
        if (existing.input_json !== inputJson) {
          throw new Error('Preparation request ID was reused with different input');
        }
        return {
          turnId: existing.turn_id,
          ...(existing.user_message_id ? { userMessageId: existing.user_message_id } : {}),
          ...(existing.assistant_message_id
            ? { assistantMessageId: existing.assistant_message_id }
            : {}),
          attempt: existing.attempt,
          draftRevision: existing.revision,
          contentVersion: existing.content_version,
          duplicate: true,
        } satisfies BeginPreparationTurnResult;
      }
      const draft = this.getPreparationDraftForWrite(request.draftId);
      if (draft.revision !== request.expectedRevision) throw preparationStale(request.draftId);
      const now = new Date().toISOString();
      const turnId = randomUUID();
      const contentVersion =
        request.input.kind === 'reply' ? draft.content_version + 1 : draft.content_version;
      let userMessageId: string | undefined;
      let assistantMessageId: string | undefined;
      let attempt = 1;
      if (request.input.kind === 'retry') {
        const previous = this.database
          .prepare(
            `SELECT id, sequence, content_revision, generation_status
               FROM preparation_messages
              WHERE id = ? AND draft_id = ? AND role = 'user'`,
          )
          .get(request.input.userMessageId, request.draftId) as RetryMessageRow | undefined;
        if (!previous || previous.generation_status === 'sent') {
          throw new Error('Only a failed or interrupted preparation turn can be retried');
        }
        const later = this.database
          .prepare(
            'SELECT 1 AS present FROM preparation_messages WHERE draft_id = ? AND sequence > ? LIMIT 1',
          )
          .get(request.draftId, previous.sequence) as { present: number } | undefined;
        if (later) throw preparationStale(request.draftId);
        const assistant = this.database
          .prepare(
            `SELECT id, content_revision FROM preparation_messages
              WHERE draft_id = ? AND sequence = ? AND role = 'assistant'`,
          )
          .get(request.draftId, previous.sequence + 1) as RetryAssistantRow | undefined;
        if (!assistant) throw new Error('Preparation retry has no assistant placeholder');
        userMessageId = previous.id;
        assistantMessageId = assistant.id;
        attempt = this.nextPreparationAttempt(request.draftId, previous.id);
        this.database
          .prepare(
            `UPDATE preparation_messages
                SET generation_status = 'pending', content = 'Generating preparation response',
                    content_revision = content_revision + 1, updated_at = ?
              WHERE id = ?`,
          )
          .run(now, assistant.id);
      } else if (request.input.kind === 'reply') {
        if (!request.input.content.trim() || request.input.content.length > 16_000) {
          throw new Error('Preparation message must contain 1 to 16000 UTF-16 units');
        }
        userMessageId = randomUUID();
        assistantMessageId = randomUUID();
        const sequence = this.nextPreparationSequence(request.draftId);
        const assistantSequence = sequence + 1;
        this.insertPreparationMessage({
          id: userMessageId,
          draftId: request.draftId,
          sequence,
          role: 'user',
          content: request.input.content.trim(),
          contentRevision: 1,
          generationStatus: 'sent',
          profileSnapshot: undefined,
          createdAt: now,
          updatedAt: now,
        });
        this.insertPreparationMessage({
          id: assistantMessageId,
          draftId: request.draftId,
          sequence: assistantSequence,
          role: 'assistant',
          content: 'Generating preparation response',
          contentRevision: 1,
          generationStatus: 'pending',
          profileSnapshot: request.provenance.profileSnapshot,
          createdAt: now,
          updatedAt: now,
        });
      }
      const nextRevision = draft.revision + 1;
      this.database
        .prepare(
          `INSERT INTO preparation_requests
            (draft_id, request_id, kind, input_json, status, turn_id, attempt, user_message_id,
             assistant_message_id, proposal_id, review_id, revision, content_version, profile_json,
             review_mode, error_json, created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .run(
          request.draftId,
          request.requestId,
          request.input.kind,
          inputJson,
          turnId,
          attempt,
          userMessageId ?? null,
          assistantMessageId ?? null,
          nextRevision,
          contentVersion,
          JSON.stringify(request.provenance.profileSnapshot),
          request.provenance.reviewMode ?? null,
          now,
          now,
        );
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = ?, content_version = ?, valid_proposal_id = NULL, valid_review_id = NULL,
                  updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(nextRevision, contentVersion, now, request.draftId, request.expectedRevision);
      return {
        turnId,
        ...(userMessageId ? { userMessageId } : {}),
        ...(assistantMessageId ? { assistantMessageId } : {}),
        attempt,
        draftRevision: nextRevision,
        contentVersion,
        duplicate: false,
      } satisfies BeginPreparationTurnResult;
    });
    return transaction();
  }

  async finishPreparationTurn(
    request: FinishPreparationTurnRequest,
  ): Promise<PreparationStoredView> {
    const transaction = this.database.transaction(() => {
      this.assertPreparationClaim(request.draftId, request.claimToken);
      const stored = this.getPreparationRequestByTurn(request.draftId, request.turnId);
      if (!stored || stored.status !== 'pending')
        throw new Error('Preparation turn is not pending');
      const draft = this.getPreparationDraftForWrite(request.draftId);
      if (
        draft.revision !== request.expectedRevision ||
        stored.revision !== request.expectedRevision ||
        stored.content_version !== request.contentVersion
      ) {
        throw preparationStale(request.draftId);
      }
      const now = new Date().toISOString();
      let proposalId: string | undefined;
      if (request.outcome.kind === 'response') {
        const assistant = request.outcome.assistantMessage;
        if (assistant) {
          if (
            !stored.assistant_message_id ||
            assistant.id !== stored.assistant_message_id ||
            assistant.draftId !== request.draftId ||
            assistant.role !== 'assistant'
          ) {
            throw new Error('Preparation response does not match its claimed turn');
          }
          this.database
            .prepare(
              `UPDATE preparation_messages
                  SET content = ?, generation_status = 'sent', profile_json = ?,
                      updated_at = ?
                WHERE id = ? AND draft_id = ?`,
            )
            .run(
              assistant.content,
              assistant.profileSnapshot ? JSON.stringify(assistant.profileSnapshot) : null,
              now,
              assistant.id,
              request.draftId,
            );
        } else if (!request.outcome.proposal) {
          throw new Error('Preparation response has no assistant message or proposal');
        }
        if (request.outcome.synthesisSuggestion) {
          if (!assistant)
            throw new Error('Preparation synthesis suggestion has no assistant message');
          const suggestion = request.outcome.synthesisSuggestion;
          this.database
            .prepare(
              "UPDATE preparation_suggestions SET status = 'discarded' WHERE draft_id = ? AND status = 'pending'",
            )
            .run(request.draftId);
          this.database
            .prepare(
              `INSERT INTO preparation_suggestions
                (id, draft_id, base_version, source_message_id, value_json, covered_through_sequence, status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            )
            .run(
              randomUUID(),
              request.draftId,
              suggestion.baseVersion,
              assistant.id,
              JSON.stringify(suggestion.synthesis),
              suggestion.coveredThroughSequence,
            );
        }
        if (request.outcome.proposal) {
          const proposal = request.outcome.proposal;
          proposalId = proposal.id;
          this.database
            .prepare(
              `INSERT INTO preparation_proposals
                (id, draft_id, revision, content_version, workflow_id, workflow_version, objective,
                 outputs_json, provenance_json, experience_origin, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?)`,
            )
            .run(
              proposal.id,
              proposal.draftId,
              draft.revision + 1,
              request.contentVersion,
              proposal.workflowId,
              proposal.workflowVersion,
              proposal.objective,
              JSON.stringify(proposal.outputs),
              JSON.stringify(proposal.provenance),
              proposal.createdAt,
            );
        }
      }
      const status = request.outcome.kind === 'response' ? 'sent' : request.outcome.status;
      const errorJson =
        request.outcome.kind === 'failure' ? JSON.stringify(request.outcome.error) : null;
      this.database
        .prepare(
          `UPDATE preparation_requests
              SET status = ?, proposal_id = ?, error_json = ?, updated_at = ?, finished_at = ?
            WHERE draft_id = ? AND request_id = ? AND status = 'pending'`,
        )
        .run(status, proposalId ?? null, errorJson, now, now, request.draftId, stored.request_id);
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = revision + 1, valid_proposal_id = ?, updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(proposalId ?? null, now, request.draftId, request.expectedRevision);
    });
    transaction();
    return this.requirePreparationStoredView(request.draftId);
  }

  async beginPreparationReview(
    request: BeginPreparationReviewRequest,
  ): Promise<BeginPreparationReviewResult> {
    const transaction = this.database.transaction(() => {
      this.assertPreparationClaim(request.draftId, request.claimToken);
      const existing = this.getPreparationRequest(request.draftId, request.requestId);
      const inputJson = canonicalPreparationInput({
        kind: 'review',
        proposalId: request.proposalId,
      });
      if (existing) {
        if (existing.input_json !== inputJson)
          throw new Error('Preparation request ID was reused with different input');
        return {
          reviewRequestId: existing.request_id,
          draftRevision: existing.revision,
          contentVersion: existing.content_version,
          duplicate: true,
        } satisfies BeginPreparationReviewResult;
      }
      const draft = this.getPreparationDraftForWrite(request.draftId);
      if (draft.revision !== request.expectedRevision) throw preparationStale(request.draftId);
      const proposal = this.database
        .prepare(
          `SELECT p.id
             FROM preparation_proposals p
             JOIN preparation_drafts d ON d.id = p.draft_id
            WHERE p.id = ? AND p.draft_id = ? AND d.valid_proposal_id = p.id`,
        )
        .get(request.proposalId, request.draftId) as { id: string } | undefined;
      if (!proposal) throw new Error('Preparation proposal does not belong to the draft');
      const now = new Date().toISOString();
      const nextRevision = draft.revision + 1;
      this.database
        .prepare(
          `INSERT INTO preparation_requests
            (draft_id, request_id, kind, input_json, status, turn_id, attempt, user_message_id,
             assistant_message_id, proposal_id, review_id, revision, content_version, profile_json,
             review_mode, error_json, created_at, updated_at, finished_at)
           VALUES (?, ?, 'review', ?, 'pending', ?, 1, NULL, NULL, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .run(
          request.draftId,
          request.requestId,
          inputJson,
          randomUUID(),
          request.proposalId,
          nextRevision,
          draft.content_version,
          JSON.stringify(request.provenance.profileSnapshot),
          request.effectivePolicy,
          now,
          now,
        );
      this.database
        .prepare(
          'UPDATE preparation_drafts SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .run(nextRevision, now, request.draftId, request.expectedRevision);
      return {
        reviewRequestId: request.requestId,
        draftRevision: nextRevision,
        contentVersion: draft.content_version,
        duplicate: false,
      } satisfies BeginPreparationReviewResult;
    });
    return transaction();
  }

  async finishPreparationReview(
    request: FinishPreparationReviewRequest,
  ): Promise<PreparationStoredView> {
    const transaction = this.database.transaction(() => {
      this.assertPreparationClaim(request.draftId, request.claimToken);
      const stored = this.getPreparationRequest(request.draftId, request.reviewRequestId);
      if (!stored || stored.kind !== 'review' || stored.status !== 'pending') {
        throw new Error('Preparation review is not pending');
      }
      const draft = this.getPreparationDraftForWrite(request.draftId);
      if (
        draft.revision !== request.expectedRevision ||
        stored.revision !== request.expectedRevision ||
        stored.content_version !== request.contentVersion
      )
        throw preparationStale(request.draftId);
      const now = new Date().toISOString();
      let reviewId: string | undefined;
      if (request.outcome.kind === 'report') {
        reviewId = request.outcome.reviewId;
        this.database
          .prepare(
            `INSERT INTO preparation_reviews
              (id, draft_id, proposal_id, content_version, mode, reviewer_snapshot_json, report_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            request.outcome.reviewId,
            request.draftId,
            request.outcome.proposalId,
            request.contentVersion,
            request.outcome.mode,
            JSON.stringify(request.outcome.reviewerSnapshot),
            JSON.stringify(request.outcome.report),
            now,
          );
      }
      const status = request.outcome.kind === 'report' ? 'sent' : request.outcome.status;
      this.database
        .prepare(
          `UPDATE preparation_requests
              SET status = ?, review_id = ?, error_json = ?, updated_at = ?, finished_at = ?
            WHERE draft_id = ? AND request_id = ? AND status = 'pending'`,
        )
        .run(
          status,
          reviewId ?? null,
          request.outcome.kind === 'failure' ? JSON.stringify(request.outcome.error) : null,
          now,
          now,
          request.draftId,
          stored.request_id,
        );
      const blocking =
        request.outcome.kind === 'report' && reviewBlocksApproval(request.outcome.report);
      const clearBlocking =
        request.outcome.kind === 'report' &&
        !blocking &&
        draft.blocking_review_id !== null &&
        request.contentVersion > this.reviewContentVersion(draft.blocking_review_id);
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = revision + 1,
                  valid_review_id = CASE WHEN ? THEN ? ELSE valid_review_id END,
                  blocking_review_id = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE blocking_review_id END,
                  updated_at = ?
            WHERE id = ? AND revision = ?`,
        )
        .run(
          reviewId ? 1 : 0,
          reviewId ?? null,
          clearBlocking ? 1 : 0,
          blocking ? 1 : 0,
          reviewId ?? null,
          now,
          request.draftId,
          request.expectedRevision,
        );
    });
    transaction();
    return this.requirePreparationStoredView(request.draftId);
  }

  async acknowledgePreparationReview(request: {
    draftId: string;
    expectedRevision: number;
    reviewId: string;
  }): Promise<PreparationStoredView> {
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(request.draftId);
      this.assertPreparationMutationAvailable(draft.id);
      if (draft.revision !== request.expectedRevision) throw preparationStale(request.draftId);
      const review = this.database
        .prepare('SELECT id FROM preparation_reviews WHERE id = ? AND draft_id = ?')
        .get(request.reviewId, request.draftId) as { id: string } | undefined;
      if (!review) throw new Error('Preparation review does not belong to the draft');
      this.database
        .prepare(
          `INSERT INTO preparation_review_reads (draft_id, review_id, acknowledged_at)
           VALUES (?, ?, ?)
           ON CONFLICT (draft_id, review_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at`,
        )
        .run(request.draftId, request.reviewId, new Date().toISOString());
      this.database
        .prepare(
          'UPDATE preparation_drafts SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .run(new Date().toISOString(), request.draftId, request.expectedRevision);
    });
    transaction();
    return this.requirePreparationStoredView(request.draftId);
  }

  async recoverPreparationView(
    draftId: string,
    expectedRevision: number,
  ): Promise<PreparationStoredView> {
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(draftId);
      if (draft.revision !== expectedRevision) throw preparationStale(draftId);
      const owner = this.database
        .prepare('SELECT * FROM preparation_owners WHERE draft_id = ?')
        .get(draftId) as PreparationOwnerRow | undefined;
      if (owner && this.isLiveOwner(owner))
        throw new Error(`Preparation ${draftId} is still owned`);
      const now = new Date().toISOString();
      this.database
        .prepare(
          "UPDATE preparation_requests SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE draft_id = ? AND status = 'pending'",
        )
        .run(now, now, draftId);
      this.database
        .prepare(
          "UPDATE preparation_messages SET generation_status = 'interrupted', updated_at = ? WHERE draft_id = ? AND generation_status = 'pending'",
        )
        .run(now, draftId);
      this.database.prepare('DELETE FROM preparation_owners WHERE draft_id = ?').run(draftId);
      this.database
        .prepare(
          'UPDATE preparation_drafts SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .run(now, draftId, expectedRevision);
      this.preparationClaims.delete(draftId);
    });
    transaction();
    return this.requirePreparationStoredView(draftId);
  }

  async claimPreparation(
    draftId: string,
    revision: PreparationRevision,
  ): Promise<string | undefined> {
    if (revision.draftId !== draftId)
      throw new Error('Preparation revision belongs to another draft');
    const transaction = this.database.transaction(() => {
      const draft = this.database
        .prepare('SELECT revision, status FROM preparation_drafts WHERE id = ?')
        .get(draftId) as { revision: number; status: PreparationDraft['status'] } | undefined;
      if (!draft || draft.status !== 'active' || draft.revision !== revision.revision)
        return undefined;
      const owner = this.database
        .prepare('SELECT * FROM preparation_owners WHERE draft_id = ?')
        .get(draftId) as PreparationOwnerRow | undefined;
      if (owner) {
        if (owner.owner_id !== this.ownerId && this.isLiveOwner(owner)) return undefined;
        this.database.prepare('DELETE FROM preparation_owners WHERE draft_id = ?').run(draftId);
      }
      const token = randomUUID();
      this.database
        .prepare(
          `INSERT INTO preparation_owners
            (draft_id, owner_id, owner_pid, owner_started_at, claim_token, acquired_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          draftId,
          this.ownerId,
          process.pid,
          PROCESS_STARTED_AT,
          token,
          new Date().toISOString(),
        );
      this.preparationClaims.set(draftId, token);
      return token;
    });
    return transaction();
  }

  async releasePreparation(draftId: string, claimToken: string): Promise<void> {
    this.assertPreparationClaim(draftId, claimToken);
    this.database
      .prepare(
        'DELETE FROM preparation_owners WHERE draft_id = ? AND owner_id = ? AND claim_token = ?',
      )
      .run(draftId, this.ownerId, claimToken);
    this.preparationClaims.delete(draftId);
  }

  async savePreparationMessage(
    message: PreparationMessage,
    expectedRevision: number,
    claimToken: string,
  ): Promise<void> {
    this.assertPreparationClaim(message.draftId, claimToken);
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(message.draftId);
      if (draft.revision !== expectedRevision)
        throw new Error(`Preparation ${message.draftId} is stale`);
      const existing = this.database
        .prepare('SELECT id FROM preparation_messages WHERE id = ?')
        .get(message.id) as { id: string } | undefined;
      if (existing) {
        this.database
          .prepare(
            `UPDATE preparation_messages
             SET content = ?, generation_status = ?, profile_json = ?, updated_at = ?
             WHERE id = ? AND draft_id = ?`,
          )
          .run(
            message.content,
            message.generationStatus,
            message.profileSnapshot ? JSON.stringify(message.profileSnapshot) : null,
            message.updatedAt,
            message.id,
            message.draftId,
          );
        return;
      }
      const expectedSequence = this.database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM preparation_messages WHERE draft_id = ?',
        )
        .get(message.draftId) as { sequence: number };
      if (message.sequence !== expectedSequence.sequence) {
        throw new Error(`Preparation message sequence must be ${expectedSequence.sequence}`);
      }
      this.database
        .prepare(
          `INSERT INTO preparation_messages
            (id, draft_id, sequence, role, content, content_revision, generation_status, profile_json, created_at, updated_at)
           VALUES (@id, @draftId, @sequence, @role, @content, 1, @generationStatus, @profileJson, @createdAt, @updatedAt)`,
        )
        .run(toPreparationMessageParams(message));
      this.database
        .prepare(
          `UPDATE preparation_drafts
              SET revision = revision + 1,
                  content_version = content_version + CASE WHEN ? = 'user' THEN 1 ELSE 0 END,
                  valid_proposal_id = CASE WHEN ? = 'user' THEN NULL ELSE valid_proposal_id END,
                  valid_review_id = CASE WHEN ? = 'user' THEN NULL ELSE valid_review_id END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .run(message.role, message.role, message.role, message.updatedAt, message.draftId);
    });
    transaction();
  }

  async createRunFromPreparation(seed: PreparationExecutionSeed): Promise<{
    run: WorkflowRun;
    claim: ExecutionClaim;
  }> {
    this.assertPreparationClaim(seed.draftId, seed.claimToken);
    const transaction = this.database.transaction(() => {
      const draft = this.database
        .prepare('SELECT * FROM preparation_drafts WHERE id = ?')
        .get(seed.draftId) as PreparationDraftRow | undefined;
      const expectedDraftRevision = seed.expectedDraftRevision ?? seed.proposalRevision;
      if (!draft || draft.status !== 'active' || draft.revision !== expectedDraftRevision) {
        throw new Error(`Preparation ${seed.draftId} changed before approval`);
      }
      const proposal = this.database
        .prepare(
          'SELECT id, content_version, experience_origin FROM preparation_proposals WHERE id = ? AND draft_id = ? AND revision = ?',
        )
        .get(seed.approval.proposalId, seed.draftId, seed.proposalRevision) as
        | { id: string; content_version: number; experience_origin: 'legacy' | 'current' }
        | undefined;
      if (!proposal) throw new Error(`Preparation proposal ${seed.approval.proposalId} is stale`);
      if (seed.contentVersion !== undefined) {
        if (
          draft.valid_proposal_id !== proposal.id ||
          proposal.content_version !== seed.contentVersion ||
          draft.content_version !== seed.contentVersion
        ) {
          throw new Error(`Preparation proposal ${seed.approval.proposalId} is stale`);
        }
        if (seed.effectiveReviewMode && draft.applied_review_mode !== seed.effectiveReviewMode) {
          throw new Error('Preparation review policy changed before approval');
        }
        if (seed.reviewId && draft.valid_review_id !== seed.reviewId) {
          throw new Error('Preparation review is stale');
        }
        if (proposal.experience_origin === 'current' && draft.applied_review_mode !== 'human') {
          const review = draft.valid_review_id
            ? (this.database
                .prepare('SELECT report_json FROM preparation_reviews WHERE id = ?')
                .get(draft.valid_review_id) as { report_json: string } | undefined)
            : undefined;
          if (!review) throw new Error('Preparation review is required');
          const report = JSON.parse(review.report_json) as PreparationReviewReport;
          if (reviewBlocksApproval(report)) throw new Error('Preparation review blocks approval');
          if (
            reviewNeedsAcknowledgementForReport(report) &&
            !this.database
              .prepare(
                'SELECT 1 AS present FROM preparation_review_reads WHERE draft_id = ? AND review_id = ?',
              )
              .get(seed.draftId, draft.valid_review_id)
          ) {
            throw new Error('Preparation review must be acknowledged');
          }
        }
      }
      this.database
        .prepare(
          `INSERT INTO runs (id, workflow_id, workflow_version, objective, status, created_at, updated_at)
           VALUES (@id, @workflowId, @workflowVersion, @objective, @status, @createdAt, @updatedAt)`,
        )
        .run(toRunParams(seed.run));
      for (const artifact of seed.artifacts) this.insertArtifact(artifact);
      this.acquireExecutionOwner(seed.run.id);
      for (const step of seed.steps) this.writeStepRun(step);
      this.database
        .prepare(
          `INSERT INTO preparation_approvals
            (draft_id, proposal_id, revision, decision, approved_at, run_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          seed.draftId,
          seed.approval.proposalId,
          seed.approval.revision,
          seed.approval.decision,
          seed.approval.approvedAt,
          seed.run.id,
        );
      if (seed.reviewApproval) {
        this.database
          .prepare(
            `INSERT INTO review_threads
              (id, run_id, phase, target_kind, target_id, artifact_revision, state, revision, created_at, updated_at)
             VALUES (@id, @runId, @phase, @targetKind, @targetId, @artifactRevision, @state, @revision, @createdAt, @updatedAt)`,
          )
          .run(toReviewThreadParams(seed.reviewApproval.thread));
        this.insertReviewDecision(
          seed.reviewApproval.decision,
          seed.reviewApproval.decision.revision + 1,
        );
      }
      this.database
        .prepare(
          `UPDATE preparation_drafts
           SET status = 'consumed', consumed_run_id = ?, updated_at = ?
            WHERE id = ? AND status = 'active' AND revision = ?`,
        )
        .run(seed.run.id, seed.approval.approvedAt, seed.draftId, expectedDraftRevision);
      this.database.prepare('DELETE FROM preparation_owners WHERE draft_id = ?').run(seed.draftId);
      this.preparationClaims.delete(seed.draftId);
    });
    transaction();
    return { run: seed.run, claim: this.createExecutionClaim(seed.run.id) };
  }

  async publishPreparationProposal(
    proposal: PreparationProposal,
    expectedRevision: number,
    claimToken: string,
  ): Promise<void> {
    this.assertPreparationClaim(proposal.draftId, claimToken);
    const transaction = this.database.transaction(() => {
      const draft = this.getPreparationDraftForWrite(proposal.draftId);
      if (draft.revision !== expectedRevision || proposal.revision !== expectedRevision) {
        throw new Error(`Preparation ${proposal.draftId} is stale`);
      }
      this.database
        .prepare(
          `INSERT INTO preparation_proposals
            (id, draft_id, revision, content_version, workflow_id, workflow_version, objective,
             outputs_json, provenance_json, experience_origin, created_at)
           VALUES (@id, @draftId, @revision,
                   (SELECT content_version FROM preparation_drafts WHERE id = @draftId),
                   @workflowId, @workflowVersion, @objective, @outputsJson, @provenanceJson,
                   'current', @createdAt)`,
        )
        .run(toPreparationProposalParams(proposal));
      this.database
        .prepare(
          'UPDATE preparation_drafts SET objective = ?, valid_proposal_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(proposal.objective, proposal.id, proposal.createdAt, proposal.draftId);
    });
    transaction();
  }

  async recoverPreparation(draftId: string): Promise<void> {
    const owner = this.database
      .prepare('SELECT * FROM preparation_owners WHERE draft_id = ?')
      .get(draftId) as PreparationOwnerRow | undefined;
    if (owner && this.isLiveOwner(owner)) return;
    if (owner)
      this.database.prepare('DELETE FROM preparation_owners WHERE draft_id = ?').run(draftId);
    this.database
      .prepare(
        `UPDATE preparation_messages
         SET generation_status = 'interrupted', updated_at = ?
         WHERE draft_id = ? AND generation_status = 'pending'`,
      )
      .run(new Date().toISOString(), draftId);
    this.preparationClaims.delete(draftId);
  }

  private readPreparationStoredView(draftId: string): PreparationStoredView | undefined {
    const draft = this.database
      .prepare('SELECT * FROM preparation_drafts WHERE id = ?')
      .get(draftId) as PreparationDraftRow | undefined;
    if (!draft) return undefined;
    const synthesis = this.database
      .prepare('SELECT * FROM preparation_syntheses WHERE draft_id = ? AND version = ?')
      .get(draftId, draft.synthesis_version) as PreparationSynthesisRow | undefined;
    if (!synthesis) throw new Error(`Preparation ${draftId} has no current synthesis`);
    const suggestion = this.database
      .prepare(
        "SELECT * FROM preparation_suggestions WHERE draft_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(draftId) as PreparationSuggestionRow | undefined;
    const proposal = draft.valid_proposal_id
      ? (this.database
          .prepare('SELECT * FROM preparation_proposals WHERE id = ? AND draft_id = ?')
          .get(draft.valid_proposal_id, draftId) as PreparationProposalRow | undefined)
      : undefined;
    const request = this.database
      .prepare(
        'SELECT * FROM preparation_requests WHERE draft_id = ? ORDER BY updated_at DESC, request_id DESC LIMIT 1',
      )
      .get(draftId) as PreparationRequestRow | undefined;
    const review = draft.valid_review_id
      ? (this.database
          .prepare('SELECT * FROM preparation_reviews WHERE id = ? AND draft_id = ?')
          .get(draft.valid_review_id, draftId) as PreparationReviewRow | undefined)
      : undefined;
    const stored: PreparationStoredView = {
      draft: fromPreparationDraftViewRow(draft),
      synthesis: fromPreparationSynthesisRow(synthesis),
      suggestion: suggestion ? fromPreparationSuggestionRow(suggestion) : null,
      proposal: proposal
        ? toPreparationProposalSummary(proposal, proposal.id === draft.valid_proposal_id)
        : null,
      operation: request ? fromPreparationOperationRow(request) : null,
      review: review ? this.toPreparationReviewSummary(review, draft) : null,
    };
    return stored;
  }

  private requirePreparationStoredView(draftId: string): PreparationStoredView {
    const view = this.readPreparationStoredView(draftId);
    if (!view) throw new Error(`Unknown preparation: ${draftId}`);
    return view;
  }

  private toPreparationReviewSummary(
    row: PreparationReviewRow,
    draft: PreparationDraftRow,
  ): PreparationReviewSummary {
    const report = JSON.parse(row.report_json) as PreparationReviewReport;
    const acknowledged = Boolean(
      this.database
        .prepare(
          'SELECT 1 AS present FROM preparation_review_reads WHERE draft_id = ? AND review_id = ?',
        )
        .get(draft.id, row.id),
    );
    return {
      id: row.id,
      proposalId: row.proposal_id,
      contentVersion: row.content_version,
      mode: row.mode,
      provenance: {
        profile: 'reviewer',
        profileSnapshot: JSON.parse(row.reviewer_snapshot_json),
      },
      createdAt: row.created_at,
      counts: reviewFindingCounts(report),
      acknowledged,
      source: row.content_version === draft.content_version ? 'current' : 'historical',
    };
  }

  private getPreparationRequest(
    draftId: string,
    requestId: string,
  ): PreparationRequestRow | undefined {
    return this.database
      .prepare('SELECT * FROM preparation_requests WHERE draft_id = ? AND request_id = ?')
      .get(draftId, requestId) as PreparationRequestRow | undefined;
  }

  private getPreparationRequestByTurn(
    draftId: string,
    turnId: string,
  ): PreparationRequestRow | undefined {
    return this.database
      .prepare('SELECT * FROM preparation_requests WHERE draft_id = ? AND turn_id = ?')
      .get(draftId, turnId) as PreparationRequestRow | undefined;
  }

  private nextPreparationAttempt(draftId: string, userMessageId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM preparation_requests WHERE draft_id = ? AND user_message_id = ?',
      )
      .get(draftId, userMessageId) as { attempt: number };
    return row.attempt;
  }

  private nextPreparationSequence(draftId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM preparation_messages WHERE draft_id = ?',
      )
      .get(draftId) as { sequence: number };
    return row.sequence;
  }

  private insertPreparationMessage(message: {
    id: string;
    draftId: string;
    sequence: number;
    role: PreparationMessage['role'];
    content: string;
    contentRevision: number;
    generationStatus: PreparationMessage['generationStatus'];
    profileSnapshot?: PreparationMessage['profileSnapshot'];
    createdAt: string;
    updatedAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO preparation_messages
          (id, draft_id, sequence, role, content, content_revision, generation_status, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.draftId,
        message.sequence,
        message.role,
        message.content,
        message.contentRevision,
        message.generationStatus,
        message.profileSnapshot ? JSON.stringify(message.profileSnapshot) : null,
        message.createdAt,
        message.updatedAt,
      );
  }

  private assertPreparationMutationAvailable(draftId: string): void {
    const owner = this.database
      .prepare('SELECT * FROM preparation_owners WHERE draft_id = ?')
      .get(draftId) as PreparationOwnerRow | undefined;
    if (owner && this.isLiveOwner(owner)) throw new Error(`Preparation ${draftId} is busy`);
  }

  private currentDraftRevision(draftId: string): number {
    const row = this.database
      .prepare('SELECT revision FROM preparation_drafts WHERE id = ?')
      .get(draftId) as { revision: number } | undefined;
    if (!row) throw new Error(`Unknown preparation: ${draftId}`);
    return row.revision;
  }

  private reviewContentVersion(reviewId: string): number {
    const row = this.database
      .prepare('SELECT content_version FROM preparation_reviews WHERE id = ?')
      .get(reviewId) as { content_version: number } | undefined;
    return row?.content_version ?? 0;
  }

  private loadPreparationDocument(
    draftId: string,
    kind: import('../application/preparation.js').PreparationDocumentKind,
    documentId: string,
  ): { content: string; version: string; format: DocumentPage['format'] } | undefined {
    if (kind === 'message') {
      const row = this.database
        .prepare(
          'SELECT content, content_revision FROM preparation_messages WHERE id = ? AND draft_id = ?',
        )
        .get(documentId, draftId) as { content: string; content_revision: number } | undefined;
      return row
        ? { content: row.content, version: String(row.content_revision), format: 'text' }
        : undefined;
    }
    if (kind === 'synthesis') {
      const row = this.database
        .prepare(
          'SELECT value_json, version FROM preparation_syntheses WHERE id = ? AND draft_id = ?',
        )
        .get(documentId, draftId) as { value_json: string; version: number } | undefined;
      return row
        ? { content: row.value_json, version: String(row.version), format: 'json' }
        : undefined;
    }
    if (kind === 'review') {
      const row = this.database
        .prepare(
          'SELECT report_json, created_at FROM preparation_reviews WHERE id = ? AND draft_id = ?',
        )
        .get(documentId, draftId) as { report_json: string; created_at: string } | undefined;
      return row
        ? { content: row.report_json, version: row.created_at, format: 'json' }
        : undefined;
    }
    const proposal = this.database
      .prepare(
        'SELECT outputs_json, content_version FROM preparation_proposals WHERE id = ? AND draft_id = ?',
      )
      .get(documentId, draftId) as { outputs_json: string; content_version: number } | undefined;
    if (!proposal) return undefined;
    const outputs = JSON.parse(proposal.outputs_json) as PreparationProposal['outputs'];
    const output = outputs.find((candidate) => candidate.name === kind);
    return output
      ? {
          content: JSON.stringify(output.value),
          version: String(proposal.content_version),
          format: 'json',
        }
      : undefined;
  }

  private getPreparationDraftForWrite(draftId: string): PreparationDraftRow {
    const row = this.database
      .prepare('SELECT * FROM preparation_drafts WHERE id = ?')
      .get(draftId) as PreparationDraftRow | undefined;
    if (!row) throw new Error(`Unknown preparation: ${draftId}`);
    if (row.status !== 'active') throw new Error(`Preparation ${draftId} is no longer active`);
    return row;
  }

  private assertPreparationClaim(draftId: string, claimToken: string): void {
    if (this.preparationClaims.get(draftId) !== claimToken) {
      throw new RunExecutionOwnedError(draftId);
    }
    const owner = this.database
      .prepare('SELECT * FROM preparation_owners WHERE draft_id = ?')
      .get(draftId) as PreparationOwnerRow | undefined;
    if (!owner || owner.owner_id !== this.ownerId || owner.claim_token !== claimToken) {
      throw new RunExecutionOwnedError(draftId);
    }
  }

  async getReviewThread(threadId: string): Promise<ReviewThread | undefined> {
    const row = this.database.prepare('SELECT * FROM review_threads WHERE id = ?').get(threadId) as
      ReviewThreadRow | undefined;
    return row ? fromReviewThreadRow(row) : undefined;
  }

  async listReviewThreads(runId: string, phase?: ReviewPhase): Promise<ReviewThread[]> {
    const rows = (
      phase === undefined
        ? this.database
            .prepare('SELECT * FROM review_threads WHERE run_id = ? ORDER BY updated_at, id')
            .all(runId)
        : this.database
            .prepare(
              'SELECT * FROM review_threads WHERE run_id = ? AND phase = ? ORDER BY updated_at, id',
            )
            .all(runId, phase)
    ) as ReviewThreadRow[];
    return rows.map(fromReviewThreadRow);
  }

  async saveReviewMessage(message: ReviewMessage): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO review_messages
          (id, thread_id, sequence, role, content, content_artifact_id, generation_status, profile_json, created_at, updated_at)
         VALUES (@id, @threadId, @sequence, @role, @content, @contentArtifactId, @generationStatus, @profileJson, @createdAt, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET
           content = excluded.content,
           content_artifact_id = excluded.content_artifact_id,
           generation_status = excluded.generation_status,
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`,
      )
      .run(toReviewMessageParams(message));
  }

  async getReviewMessages(threadId: string): Promise<ReviewMessage[]> {
    const rows = this.database
      .prepare('SELECT * FROM review_messages WHERE thread_id = ? ORDER BY sequence')
      .all(threadId) as ReviewMessageRow[];
    return rows.map(fromReviewMessageRow);
  }

  async saveReviewDecision(decision: ReviewDecision, nextState: ReviewThreadState): Promise<void> {
    const transaction = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE review_threads
           SET state = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(nextState, decision.createdAt, decision.threadId, decision.revision);
      if (result.changes !== 1) {
        throw new Error(`Review thread ${decision.threadId} changed before the decision was saved`);
      }
      this.insertReviewDecision(decision, decision.revision + 1);
    });
    transaction();
  }

  private insertReviewDecision(decision: ReviewDecision, revision: number): void {
    this.database
      .prepare(
        `INSERT INTO review_decisions
          (thread_id, target_kind, target_id, decision, revision, details, created_at)
         VALUES (@threadId, @targetKind, @targetId, @decision, @revision, @details, @createdAt)`,
      )
      .run({
        threadId: decision.threadId,
        targetKind: decision.target.kind,
        targetId: decision.target.id,
        decision: decision.decision,
        revision,
        details: decision.details ?? null,
        createdAt: decision.createdAt,
      });
  }

  async saveReviewAdjudication(decision: ReviewDecision): Promise<void> {
    const transaction = this.database.transaction(() => {
      const thread = this.database
        .prepare('SELECT state, revision FROM review_threads WHERE id = ?')
        .get(decision.threadId) as { state: ReviewThreadState; revision: number } | undefined;
      if (!thread) throw new Error(`Unknown review thread: ${decision.threadId}`);
      if (thread.state !== 'waiting' || thread.revision !== decision.revision) {
        throw new Error(`Review thread ${decision.threadId} changed before adjudication was saved`);
      }
      this.insertReviewDecision(decision, decision.revision);
    });
    transaction();
  }

  async getReviewDecisions(threadId: string): Promise<ReviewDecision[]> {
    const rows = this.database
      .prepare('SELECT * FROM review_decisions WHERE thread_id = ? ORDER BY id')
      .all(threadId) as ReviewDecisionRow[];
    return rows.map(fromReviewDecisionRow);
  }

  async saveEvent(event: NormalizedEvent): Promise<void> {
    await this.saveEvents([event]);
  }

  async saveEvents(events: NormalizedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const insert = this.database.prepare(
      `INSERT INTO normalized_events (run_id, step_id, type, message, occurred_at)
       VALUES (@runId, @stepId, @type, @message, @occurredAt)`,
    );
    const transaction = this.database.transaction(() => {
      for (const event of events) {
        insert.run({
          runId: event.runId,
          stepId: event.stepId,
          type: event.type,
          message: event.message,
          occurredAt: event.occurredAt,
        });
      }
    });
    transaction();
  }

  async countEvents(runId: string): Promise<number> {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM normalized_events WHERE run_id = ?')
      .get(runId) as { count: number };
    return row.count;
  }

  async getEvents(runId: string): Promise<NormalizedEvent[]> {
    const rows = this.database
      .prepare(
        `SELECT step_id, type, message, occurred_at
         FROM normalized_events WHERE run_id = ? ORDER BY id`,
      )
      .all(runId) as EventRow[];
    return rows.map((row) => ({
      runId,
      stepId: row.step_id,
      type: row.type,
      message: row.message,
      occurredAt: row.occurred_at,
    }));
  }

  async listRunEventsPage(runId: string, query: RunEventPageQuery = {}): Promise<RunEventPage> {
    const limit = validateEventLimit(query.limit);
    const afterId = validateEventCursor(query.afterId);
    const rows = this.database
      .prepare(
        `SELECT id, run_id, step_id, type, message, occurred_at
         FROM normalized_events
         WHERE run_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(runId, afterId, limit + 1) as PersistedEventRow[];
    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    return {
      events: pageRows.map(fromPersistedEventRow),
      ...(hasNextPage ? { nextCursor: pageRows[pageRows.length - 1]!.id } : {}),
    };
  }

  async completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void> {
    if (stepRun.status !== 'completed') {
      throw new Error('A completed step is required to persist artifact references');
    }

    const transaction = this.database.transaction(() => {
      const run = this.database
        .prepare('SELECT status FROM runs WHERE id = ?')
        .get(stepRun.runId) as { status: RunStatus } | undefined;
      if (!run) throw new Error(`Cannot complete step for unknown run: ${stepRun.runId}`);
      if (run.status !== 'running') throw new RunExecutionOwnedError(stepRun.runId);
      this.assertCurrentExecutionOwner(stepRun.runId);
      this.writeStepRun(stepRun);
      const insertArtifact = this.database.prepare(
        `INSERT INTO artifacts (id, run_id, step_id, name, kind, path, media_type, size_bytes)
         VALUES (@id, @runId, @stepId, @name, @kind, @path, @mediaType, @sizeBytes)`,
      );
      for (const artifact of artifacts) {
        this.database
          .prepare('DELETE FROM artifacts WHERE run_id = ? AND step_id = ? AND name = ?')
          .run(artifact.runId, artifact.stepId, artifact.name);
        insertArtifact.run(toArtifactParams(artifact));
      }
    });
    transaction();
  }

  private insertQaSearch(defect: QaDefect): void {
    this.database
      .prepare(
        `INSERT INTO qa_search (defect_id, title, summary, category, locations, symbols, resolution)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        defect.id,
        defect.title,
        defect.summary,
        defect.category,
        (defect.locations ?? []).join(' '),
        (defect.symbols ?? []).join(' '),
        defect.resolution ?? '',
      );
  }

  private insertArtifact(artifact: ArtifactReference): void {
    this.database
      .prepare(
        `INSERT INTO artifacts (id, run_id, step_id, name, kind, path, media_type, size_bytes)
         VALUES (@id, @runId, @stepId, @name, @kind, @path, @mediaType, @sizeBytes)`,
      )
      .run(toArtifactParams(artifact));
  }

  private replaceArtifactInTransaction(artifact: ArtifactReference): void {
    this.database
      .prepare('DELETE FROM artifacts WHERE run_id = ? AND step_id = ? AND name = ?')
      .run(artifact.runId, artifact.stepId, artifact.name);
    this.insertArtifact(artifact);
  }

  private upsertArtifactInTransaction(artifact: ArtifactReference): void {
    this.database
      .prepare(
        `INSERT INTO artifacts (id, run_id, step_id, name, kind, path, media_type, size_bytes)
         VALUES (@id, @runId, @stepId, @name, @kind, @path, @mediaType, @sizeBytes)
         ON CONFLICT (run_id, step_id, name) DO UPDATE SET
           id = excluded.id,
           kind = excluded.kind,
           path = excluded.path,
           media_type = excluded.media_type,
           size_bytes = excluded.size_bytes`,
      )
      .run(toArtifactParams(artifact));
  }

  private writeStepRun(stepRun: StepRun, allowResearchReset = false): void {
    const current = this.database
      .prepare('SELECT status FROM step_runs WHERE run_id = ? AND step_id = ?')
      .get(stepRun.runId, stepRun.stepId) as { status: StepRun['status'] } | undefined;

    if (
      current &&
      !(allowResearchReset && current.status === 'completed' && stepRun.status === 'pending')
    ) {
      assertStepTransition(current.status, stepRun.status);
    }

    const row = toStepRunRow(stepRun);
    this.database
      .prepare(
        `INSERT INTO step_runs
          (run_id, step_id, profile, profile_json, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json, approval_json)
         VALUES (@runId, @stepId, @profile, @profileJson, @status, @attempt, @startedAt, @finishedAt, @resultJson, @errorJson, @dispositionJson, @skipReasonJson, @approvalJson)
         ON CONFLICT (run_id, step_id) DO UPDATE SET
           profile = excluded.profile,
           profile_json = excluded.profile_json,
           status = excluded.status,
          attempt = excluded.attempt,
          started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           result_json = excluded.result_json,
           error_json = excluded.error_json,
           disposition_json = excluded.disposition_json,
           skip_reason_json = excluded.skip_reason_json,
           approval_json = excluded.approval_json`,
      )
      .run(row);

    if (stepRun.startedAt !== undefined || stepRun.status !== 'pending') {
      this.database
        .prepare(
          `INSERT INTO step_attempts
            (run_id, step_id, attempt, status, started_at, finished_at, external_session_id, result_json, error_json)
           VALUES (@runId, @stepId, @attempt, @status, @startedAt, @finishedAt, @externalSessionId, @resultJson, @errorJson)
           ON CONFLICT (run_id, step_id, attempt) DO UPDATE SET
            status = excluded.status,
            finished_at = excluded.finished_at,
            external_session_id = excluded.external_session_id,
            result_json = excluded.result_json,
            error_json = excluded.error_json`,
        )
        .run({
          ...row,
          externalSessionId: stepRun.result?.sessionId ?? null,
          startedAt: stepRun.startedAt ?? stepRun.finishedAt ?? new Date().toISOString(),
        });
    }
  }

  private requireGuidedProgress(runId: string): GuidedExecutionProgress {
    const row = this.database
      .prepare('SELECT progress_json FROM guided_executions WHERE run_id = ?')
      .get(runId) as { progress_json: string } | undefined;
    if (!row) throw new TaskContractError('invalid-target', `Unknown guided execution: ${runId}`);
    return JSON.parse(row.progress_json) as GuidedExecutionProgress;
  }

  private assertGuidedClaimInTransaction(claim: GuidedExecutionClaim): void {
    this.assertCurrentExecutionOwner(claim.runId);
    if (this.executionClaims.get(claim.runId) !== claim.token) {
      throw new RunExecutionOwnedError(claim.runId);
    }
  }

  private updateGuidedProgress(progress: GuidedExecutionProgress, expectedRevision: number): void {
    const current = this.requireGuidedProgress(progress.runId);
    if (current.revision !== expectedRevision) {
      throw new TaskContractError(
        'stale-revision',
        `Guided execution revision is stale: ${progress.runId}`,
      );
    }
    const result = this.database
      .prepare(
        `UPDATE guided_executions
         SET revision = ?, stage = ?, active_block_json = ?, progress_json = ?, updated_at = ?
         WHERE run_id = ? AND revision = ?`,
      )
      .run(
        progress.revision,
        progress.stage,
        progress.activeBlock ? canonicalizeJson(progress.activeBlock) : null,
        canonicalizeJson(progress),
        new Date().toISOString(),
        progress.runId,
        expectedRevision,
      );
    if (result.changes !== 1)
      throw new TaskContractError('stale-revision', 'Guided execution changed concurrently');
    for (const phase of progress.phases) {
      this.database
        .prepare(
          `UPDATE guided_execution_phases
           SET status = ?, commit_sha = ?, no_changes = ?
           WHERE run_id = ? AND phase_id = ?`,
        )
        .run(
          phase.status,
          phase.commitSha ?? null,
          phase.noChanges ? 1 : 0,
          progress.runId,
          phase.id,
        );
      for (const task of phase.tasks) {
        this.database
          .prepare(
            `UPDATE guided_execution_tasks
             SET status = ?, attempt = ?, agent_step_id = ?, result_artifact_id = ?, verification_artifact_id = ?
             WHERE run_id = ? AND task_id = ?`,
          )
          .run(
            task.status,
            task.attempt,
            task.agentStepId ?? null,
            task.resultArtifact?.id ?? null,
            task.verificationArtifact?.id ?? null,
            progress.runId,
            task.id,
          );
      }
    }
    const run = this.database
      .prepare('SELECT status FROM runs WHERE id = ?')
      .get(progress.runId) as { status: RunStatus } | undefined;
    if (run && run.status !== progress.status) {
      const runUpdate = this.database
        .prepare('UPDATE runs SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(progress.status, new Date().toISOString(), progress.runId, run.status);
      if (runUpdate.changes !== 1)
        throw new RunStatusConflictError(progress.runId, run.status, progress.status);
    }
  }

  private updateCheckpointRows(checkpoint: GuidedExecutionCheckpoint): void {
    const serialized = canonicalizeJson(checkpoint);
    if (checkpoint.taskId) {
      this.database
        .prepare(
          'UPDATE guided_execution_tasks SET checkpoint_json = ? WHERE run_id = ? AND task_id = ?',
        )
        .run(serialized, checkpoint.runId, checkpoint.taskId);
    } else {
      this.database
        .prepare(
          'UPDATE guided_execution_phases SET checkpoint_json = ? WHERE run_id = ? AND phase_id = ?',
        )
        .run(serialized, checkpoint.runId, checkpoint.phaseId);
    }
  }

  private acquireExecutionOwner(runId: string): void {
    const owner = this.getExecutionOwner(runId);
    if (owner) {
      if (owner.owner_id === this.ownerId) return;
      if (this.isLiveOwner(owner)) throw new RunExecutionOwnedError(runId);
      this.database.prepare('DELETE FROM run_execution_owners WHERE run_id = ?').run(runId);
    }
    this.database
      .prepare(
        `INSERT INTO run_execution_owners
           (run_id, owner_id, owner_pid, owner_started_at, acquired_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, this.ownerId, process.pid, PROCESS_STARTED_AT, new Date().toISOString());
  }

  private createExecutionClaim(runId: string): ExecutionClaim {
    const token = randomUUID();
    this.executionClaims.set(runId, token);
    return { runId, token };
  }

  private assertCurrentExecutionOwner(runId: string): void {
    const owner = this.getExecutionOwner(runId);
    if (!owner || owner.owner_id !== this.ownerId) throw new RunExecutionOwnedError(runId);
  }

  private getExecutionOwner(runId: string): ExecutionOwnerRow | undefined {
    return this.database
      .prepare('SELECT * FROM run_execution_owners WHERE run_id = ?')
      .get(runId) as ExecutionOwnerRow | undefined;
  }

  private isLiveOwner(owner: ExecutionOwnerRow): boolean {
    try {
      process.kill(owner.owner_pid, 0);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'ESRCH') return false;
      // EPERM means the process exists but cannot be inspected; fail closed.
      return true;
    }
    // A PID can be reused after an owner exits. The process-start marker lets
    // this process distinguish its own stale owner; other processes fail closed.
    return owner.owner_pid !== process.pid || owner.owner_started_at === PROCESS_STARTED_AT;
  }
}

interface PortabilityStateRow {
  singleton_id: number;
  dataset_id: string;
  state: PortabilityState['state'];
  last_transfer_id: string | null;
  pending_request_id: string | null;
  pending_digest: string | null;
  pending_destination: string | null;
  pending_transfer_id: string | null;
  updated_at: string;
}

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_version: number;
  objective: string;
  status: WorkflowRun['status'];
  created_at: string;
  updated_at: string;
}

interface StepRunRow {
  run_id: string;
  step_id: string;
  profile: string;
  profile_json: string | null;
  status: StepRun['status'];
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  result_json: string | null;
  error_json: string | null;
  disposition_json: string | null;
  skip_reason_json: string | null;
  approval_json: string | null;
}

interface EventRow {
  step_id: string;
  type: NormalizedEvent['type'];
  message: string;
  occurred_at: string;
}

interface PersistedEventRow extends EventRow {
  id: number;
  run_id: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  step_id: string;
  name: string;
  kind: ArtifactReference['kind'];
  path: string;
  media_type: string;
  size_bytes: number;
}

interface ReviewThreadRow {
  id: string;
  run_id: string;
  phase: ReviewPhase;
  target_kind: ReviewTargetKind;
  target_id: string;
  artifact_revision: number;
  state: ReviewThreadState;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface ReviewMessageRow {
  id: string;
  thread_id: string;
  sequence: number;
  role: ReviewMessage['role'];
  content: string | null;
  content_artifact_id: string | null;
  generation_status: ReviewMessage['generationStatus'];
  profile_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewDecisionRow {
  id: number;
  thread_id: string;
  target_kind: ReviewTargetKind;
  target_id: string;
  decision: ReviewDecision['decision'];
  revision: number;
  details: string | null;
  created_at: string;
}

interface TaskContractRow {
  id: string;
  workspace: string;
  contract_version: 1;
  revision: number;
  phase: TaskContract['phase'];
  current_brief_id: string;
  current_plan_id: string | null;
  approved_plan_id: string | null;
  current_todo_id: string | null;
  current_block_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskContractDocumentRow {
  id: string;
  contract_id: string;
  kind: TaskContractDocumentKind;
  version: number;
  source_document_id: string | null;
  body_json: string;
  summary: string;
  created_at: string;
}

type TaskContractDocumentHeaderRow = Omit<TaskContractDocumentRow, 'body_json' | 'summary'>;

interface TaskContractActionRow {
  id: string;
  contract_id: string;
  sequence: number;
  kind: TaskContractAction['kind'];
  target_document_id: string;
  related_action_id: string | null;
  details_json: string;
  created_at: string;
}

interface GuidedPreparationRow {
  contract_id: string;
  revision: number;
  last_sequence: number;
  brief_confirmed_through_sequence: number;
  confirmed_source_ids_json: string;
  active_request_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GuidedPreparationMessageRow {
  id: string;
  contract_id: string;
  sequence: number;
  role: GuidedPreparationMessage['role'];
  content: string;
  request_id: string;
  created_at: string;
}

interface GuidedPreparationSourceRow {
  id: string;
  contract_id: string;
  sequence: number;
  kind: GuidedPreparationSource['kind'];
  url: string;
  title: string;
  excerpt: string;
  query: string | null;
  retrieved_at: string;
  content_hash: string;
  truncated: number;
}

interface GuidedPreparationRequestRow {
  contract_id: string;
  request_id: string;
  operation_id: string;
  kind: GuidedPreparationRequestRecord['kind'];
  request_json: string;
  request_hash: string;
  preparation_revision: number;
  contract_revision: number;
  status: GuidedPreparationRequestRecord['status'];
  owner_token: string | null;
  profile_snapshot_json: string | null;
  result_json: string | null;
  error_code: string | null;
  published_document_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PreparationDraftRow {
  id: string;
  workspace: string;
  workflow_id: PreparationDraft['workflowId'];
  workflow_version: number;
  objective: string;
  revision: number;
  content_version: number;
  producer_json: string | null;
  reviewer_json: string | null;
  review_mode: PreparationReviewMode;
  applied_review_mode: PreparationReviewMode;
  synthesis_version: number;
  valid_proposal_id: string | null;
  valid_review_id: string | null;
  blocking_review_id: string | null;
  status: PreparationDraft['status'];
  consumed_run_id: string | null;
  created_at: string;
  updated_at: string;
}

interface PreparationMessageRow {
  id: string;
  draft_id: string;
  sequence: number;
  role: PreparationMessage['role'];
  content: string;
  content_revision: number;
  generation_status: PreparationMessage['generationStatus'];
  profile_json: string | null;
  created_at: string;
  updated_at: string;
}

interface PreparationProposalRow {
  id: string;
  draft_id: string;
  revision: number;
  content_version: number;
  workflow_id: PreparationProposal['workflowId'];
  workflow_version: number;
  objective: string;
  outputs_json: string;
  provenance_json: string;
  experience_origin: 'legacy' | 'current';
  created_at: string;
}

interface PreparationDraftPageRow {
  id: string;
  workflow_id: PreparationDraft['workflowId'];
  status: PreparationDraft['status'];
  revision: number;
  objective_preview: string;
  objective_truncated: number;
  created_at: string;
  updated_at: string;
}

interface TaskRunRow {
  id: string;
  workflow_id: WorkflowRun['workflowId'];
  status: WorkflowRun['status'];
  objective_preview: string;
  objective_truncated: number;
  created_at: string;
  updated_at: string;
}

interface PreparationMessagePageRow {
  id: string;
  sequence: number;
  role: PreparationMessage['role'];
  generation_status: PreparationMessage['generationStatus'];
  content_revision: number;
  preview: string;
  preview_truncated: number;
  profile_json: string | null;
  created_at: string;
}

interface PreparationSynthesisRow {
  id: string;
  draft_id: string;
  version: number;
  value_json: string;
  covered_through_sequence: number;
  origin: 'initial' | 'human' | 'legacy';
  confirmed: number;
  created_at: string;
}

interface PreparationSuggestionRow {
  id: string;
  draft_id: string;
  base_version: number;
  source_message_id: string;
  value_json: string;
  covered_through_sequence: number;
  status: 'pending' | 'accepted' | 'discarded';
}

interface PreparationRequestRow {
  draft_id: string;
  request_id: string;
  kind: 'reply' | 'retry' | 'proposal' | 'review';
  input_json: string;
  status: PreparationMessage['generationStatus'];
  turn_id: string;
  attempt: number;
  user_message_id: string | null;
  assistant_message_id: string | null;
  proposal_id: string | null;
  review_id: string | null;
  revision: number;
  content_version: number;
  profile_json: string | null;
  review_mode: PreparationReviewMode | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface PreparationReviewRow {
  id: string;
  draft_id: string;
  proposal_id: string;
  content_version: number;
  mode: PreparationReviewMode;
  reviewer_snapshot_json: string;
  report_json: string;
  created_at: string;
}

interface RetryMessageRow {
  id: string;
  sequence: number;
  content_revision: number;
  generation_status: PreparationMessage['generationStatus'];
}

interface RetryAssistantRow {
  id: string;
  content_revision: number;
}

interface PreparationOwnerRow extends ExecutionOwnerRow {
  draft_id: string;
  claim_token: string;
}

interface QaDefectRow {
  id: string;
  fingerprint: string;
  title: string;
  summary: string;
  category: string;
  severity: QaDefect['severity'];
  locations_json: string | null;
  symbols_json: string | null;
  resolution: string | null;
  status: QaDefect['status'];
  created_at: string;
  updated_at: string;
}

interface QaOccurrenceRow {
  id: string;
  run_id: string;
  defect_id: string;
  qa_iteration: number;
  finding_id: string;
  report_artifact_id: string;
  created_at: string;
}

interface QaDefectEventRow {
  id: number;
  defect_id: string;
  occurrence_id: string | null;
  status: QaDefectEvent['status'];
  details_json: string | null;
  created_at: string;
}

interface ExecutionOwnerRow {
  run_id: string;
  owner_id: string;
  owner_pid: number;
  owner_started_at: string;
  acquired_at: string;
}

function fromTaskContractRow(row: TaskContractRow): TaskContract {
  return {
    id: row.id,
    kind: 'guided-task',
    workspace: row.workspace,
    contractVersion: row.contract_version,
    revision: row.revision,
    phase: row.phase,
    currentBriefId: row.current_brief_id,
    currentPlanId: row.current_plan_id,
    approvedPlanId: row.approved_plan_id,
    currentTodoId: row.current_todo_id,
    currentBlockId: row.current_block_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromTaskContractDocumentHeaderRow(
  row: TaskContractDocumentHeaderRow,
): TaskContractDocumentHeader {
  return {
    id: row.id,
    contractId: row.contract_id,
    kind: row.kind,
    version: row.version,
    sourceDocumentId: row.source_document_id,
    createdAt: row.created_at,
  };
}

function fromTaskContractDocumentRow(row: TaskContractDocumentRow): TaskContractDocument {
  let body: TaskContractDocument['body'];
  try {
    const parsed: unknown = JSON.parse(row.body_json);
    body =
      row.kind === 'brief'
        ? parseTaskContractBrief(parsed)
        : row.kind === 'plan'
          ? parseTaskContractPlan(parsed)
          : parseTaskContractTodo(parsed);
  } catch (error) {
    if (error instanceof TaskContractError) throw error;
    throw new TaskContractError('invalid-input', `Stored ${row.kind} document is invalid`);
  }
  return { ...fromTaskContractDocumentHeaderRow(row), body };
}

function fromTaskContractActionRow(row: TaskContractActionRow): TaskContractAction {
  let details: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.details_json);
    if (!isRecord(parsed)) throw new Error('details must be an object');
    details = parsed;
  } catch {
    throw new TaskContractError('invalid-input', 'Stored task contract action details are invalid');
  }
  return {
    id: row.id,
    contractId: row.contract_id,
    sequence: row.sequence,
    kind: row.kind,
    targetDocumentId: row.target_document_id,
    relatedActionId: row.related_action_id,
    details,
    createdAt: row.created_at,
  };
}

function taskContractSummary(document: TaskContractDocument): string {
  if (document.kind === 'brief') {
    return (document.body as TaskContractBrief).objective.slice(0, 256);
  }
  if (document.kind === 'plan') {
    return (document.body as TaskContractPlan).summary.slice(0, 256);
  }
  return (document.body as TaskContractTodo).phases[0]?.title.slice(0, 256) ?? 'TODO';
}

function assertContractId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new TaskContractError(
      'invalid-input',
      'Task contract ID must be a canonical lowercase UUID v4',
    );
  }
}

function assertExpectedTaskContractRevision(
  contract: TaskContractRow,
  expectedRevision: number,
): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new TaskContractError('invalid-input', 'Task contract revision must be positive');
  }
  if (contract.revision !== expectedRevision) throw taskContractStale(contract.id);
}

function assertTaskContractText(value: string, label: string, maxBytes: number): void {
  if (value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new TaskContractError(
      'invalid-input',
      `${label} must be non-empty and at most ${maxBytes} bytes`,
    );
  }
}

function validateTaskContractLimit(limit: number | undefined): number {
  const value = limit ?? 20;
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new TaskContractError(
      'invalid-input',
      'Task contract page limit must be between 1 and 50',
    );
  }
  return value;
}

function taskContractStale(contractId: string): TaskContractError {
  return new TaskContractError('stale-revision', `Task contract ${contractId} revision is stale`);
}

function taskContractTargetError(contractId: string): TaskContractError {
  return new TaskContractError(
    'invalid-target',
    `Task contract ${contractId} is not in this workspace`,
  );
}

function taskContractInvalidTarget(message: string): TaskContractError {
  return new TaskContractError('invalid-target', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRunParams(run: WorkflowRun): Record<string, unknown> {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    objective: run.objective,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toPreparationDraftParams(draft: PreparationDraft): Record<string, unknown> {
  return {
    id: draft.id,
    workspace: draft.workspace,
    workflowId: draft.workflowId,
    workflowVersion: draft.workflowVersion,
    objective: draft.objective,
    revision: draft.revision,
    status: draft.status,
    consumedRunId: draft.consumedRunId ?? null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function fromPreparationDraftRow(row: PreparationDraftRow): PreparationDraft {
  return {
    id: row.id,
    workspace: row.workspace,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    objective: row.objective,
    revision: row.revision,
    status: row.status,
    ...(row.consumed_run_id ? { consumedRunId: row.consumed_run_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromPreparationDraftViewRow(row: PreparationDraftRow) {
  return {
    ...fromPreparationDraftRow(row),
    contentVersion: row.content_version,
    producer: parseSelection(row.producer_json),
    reviewer: parseSelection(row.reviewer_json),
    reviewMode: row.review_mode,
    appliedReviewMode: row.applied_review_mode,
    synthesisVersion: row.synthesis_version,
    validProposalId: row.valid_proposal_id,
    validReviewId: row.valid_review_id,
    blockingReviewId: row.blocking_review_id,
  };
}

function toPreparationMessageParams(message: PreparationMessage): Record<string, unknown> {
  return {
    id: message.id,
    draftId: message.draftId,
    sequence: message.sequence,
    role: message.role,
    content: message.content,
    generationStatus: message.generationStatus,
    profileJson: message.profileSnapshot ? JSON.stringify(message.profileSnapshot) : null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function fromPreparationMessageRow(row: PreparationMessageRow): PreparationMessage {
  return {
    id: row.id,
    draftId: row.draft_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    generationStatus: row.generation_status,
    ...(row.profile_json ? { profileSnapshot: JSON.parse(row.profile_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromPreparationMessagePageRow(row: PreparationMessagePageRow): PreparationMessageItem {
  return {
    id: row.id,
    sequence: row.sequence,
    role: row.role,
    generationStatus: row.generation_status,
    contentRevision: row.content_revision,
    preview: row.preview,
    previewTruncated: row.preview_truncated === 1,
    ...(row.profile_json ? { profileSnapshot: JSON.parse(row.profile_json) } : {}),
    createdAt: row.created_at,
  };
}

function fromPreparationSynthesisRow(row: PreparationSynthesisRow): PreparationSynthesisVersion {
  return {
    id: row.id,
    version: row.version,
    value: JSON.parse(row.value_json) as PreparationSynthesis,
    coveredThroughSequence: row.covered_through_sequence,
    origin: row.origin,
    confirmed: row.confirmed === 1,
    createdAt: row.created_at,
  };
}

function fromPreparationSuggestionRow(
  row: PreparationSuggestionRow,
): PreparationSynthesisSuggestion {
  return {
    id: row.id,
    baseVersion: row.base_version,
    synthesis: JSON.parse(row.value_json) as PreparationSynthesis,
    coveredThroughSequence: row.covered_through_sequence,
    sourceMessageId: row.source_message_id,
    status: row.status,
  };
}

function fromPreparationOperationRow(row: PreparationRequestRow): PreparationOperationView {
  return {
    requestId: row.request_id,
    kind: row.kind,
    status: row.status,
    ...(row.user_message_id ? { userMessageId: row.user_message_id } : {}),
    ...(row.assistant_message_id ? { assistantMessageId: row.assistant_message_id } : {}),
    ...(row.proposal_id ? { proposalId: row.proposal_id } : {}),
    ...(row.review_id ? { reviewId: row.review_id } : {}),
    attempt: row.attempt,
    recoverable:
      row.status === 'pending' || row.status === 'failed' || row.status === 'interrupted',
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
  };
}

function toPreparationProposalParams(proposal: PreparationProposal): Record<string, unknown> {
  return {
    id: proposal.id,
    draftId: proposal.draftId,
    revision: proposal.revision,
    workflowId: proposal.workflowId,
    workflowVersion: proposal.workflowVersion,
    objective: proposal.objective,
    outputsJson: JSON.stringify(proposal.outputs),
    provenanceJson: JSON.stringify(proposal.provenance),
    createdAt: proposal.createdAt,
  };
}

function fromPreparationProposalRow(row: PreparationProposalRow): PreparationProposal {
  return {
    id: row.id,
    draftId: row.draft_id,
    revision: row.revision,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    objective: row.objective,
    outputs: JSON.parse(row.outputs_json),
    provenance: JSON.parse(row.provenance_json),
    createdAt: row.created_at,
    contentVersion: row.content_version,
    experienceOrigin: row.experience_origin,
  };
}

function toPreparationProposalSummary(
  row: PreparationProposalRow,
  current: boolean,
): PreparationProposalSummary {
  const outputs = JSON.parse(row.outputs_json) as PreparationProposal['outputs'];
  return {
    id: row.id,
    revision: row.revision,
    contentVersion: row.content_version,
    createdAt: row.created_at,
    outputNames: outputs.map((output) => output.name),
    experienceOrigin: row.experience_origin,
    provenance: JSON.parse(row.provenance_json),
    source: current ? 'current' : 'historical',
  };
}

function fromRunRow(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    objective: row.objective,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStepRunRow(stepRun: StepRun): Record<string, unknown> {
  return {
    runId: stepRun.runId,
    stepId: stepRun.stepId,
    profile: stepRun.profile,
    profileJson: stepRun.profileSnapshot ? JSON.stringify(stepRun.profileSnapshot) : null,
    status: stepRun.status,
    attempt: stepRun.attempt,
    startedAt: stepRun.startedAt ?? null,
    finishedAt: stepRun.finishedAt ?? null,
    resultJson: stepRun.result ? JSON.stringify(stepRun.result) : null,
    errorJson: stepRun.error ? JSON.stringify(stepRun.error) : null,
    dispositionJson: stepRun.disposition ? JSON.stringify(stepRun.disposition) : null,
    skipReasonJson: stepRun.skipReason ? JSON.stringify(stepRun.skipReason) : null,
    approvalJson: stepRun.approval ? JSON.stringify(stepRun.approval) : null,
  };
}

function fromStepRunRow(row: StepRunRow, resultMode?: 'usage'): StepRun {
  let result: StepRun['result'];
  if (row.result_json) {
    const parsed = JSON.parse(row.result_json) as StepRun['result'];
    if (resultMode === 'usage' && parsed) {
      result = {
        text: '',
        ...(parsed.usage ? { usage: parsed.usage } : {}),
        ...(parsed.costUsd !== undefined ? { costUsd: parsed.costUsd } : {}),
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
      };
    } else {
      result = parsed;
    }
  }
  return {
    runId: row.run_id,
    stepId: row.step_id,
    profile: row.profile,
    status: row.status,
    attempt: row.attempt,
    ...(row.profile_json ? { profileSnapshot: JSON.parse(row.profile_json) } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(result ? { result } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
    ...(row.disposition_json ? { disposition: JSON.parse(row.disposition_json) } : {}),
    ...(row.skip_reason_json ? { skipReason: JSON.parse(row.skip_reason_json) } : {}),
    ...(row.approval_json ? { approval: JSON.parse(row.approval_json) } : {}),
  };
}

function toArtifactParams(artifact: ArtifactReference): Record<string, unknown> {
  return {
    id: artifact.id,
    runId: artifact.runId,
    stepId: artifact.stepId,
    name: artifact.name,
    kind: artifact.kind,
    path: artifact.path,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
  };
}

function toReviewThreadParams(thread: ReviewThread): Record<string, unknown> {
  return {
    id: thread.id,
    runId: thread.runId,
    phase: thread.phase,
    targetKind: thread.target.kind,
    targetId: thread.target.id,
    artifactRevision: thread.artifactRevision,
    state: thread.state,
    revision: thread.revision,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function fromReviewThreadRow(row: ReviewThreadRow): ReviewThread {
  return {
    id: row.id,
    runId: row.run_id,
    phase: row.phase,
    target: { kind: row.target_kind, id: row.target_id },
    artifactRevision: row.artifact_revision,
    state: row.state,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReviewMessageParams(message: ReviewMessage): Record<string, unknown> {
  return {
    id: message.id,
    threadId: message.threadId,
    sequence: message.sequence,
    role: message.role,
    content: message.content ?? null,
    contentArtifactId: message.contentArtifactId ?? null,
    generationStatus: message.generationStatus,
    profileJson: message.profileSnapshot ? JSON.stringify(message.profileSnapshot) : null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function fromReviewMessageRow(row: ReviewMessageRow): ReviewMessage {
  const profileSnapshot = row.profile_json
    ? (JSON.parse(row.profile_json) as ReviewMessage['profileSnapshot'])
    : undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    role: row.role,
    ...(row.content !== null ? { content: row.content } : {}),
    ...(row.content_artifact_id ? { contentArtifactId: row.content_artifact_id } : {}),
    generationStatus: row.generation_status,
    ...(profileSnapshot ? { profileSnapshot } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromReviewDecisionRow(row: ReviewDecisionRow): ReviewDecision {
  return {
    id: row.id,
    threadId: row.thread_id,
    target: { kind: row.target_kind, id: row.target_id },
    decision: row.decision,
    revision: row.revision,
    ...(row.details !== null ? { details: row.details } : {}),
    createdAt: row.created_at,
  };
}

function toQaDefectParams(defect: QaDefect): Record<string, unknown> {
  return {
    id: defect.id,
    fingerprint: defect.fingerprint,
    title: defect.title,
    summary: defect.summary,
    category: defect.category,
    severity: defect.severity,
    locationsJson: defect.locations ? JSON.stringify(defect.locations) : null,
    symbolsJson: defect.symbols ? JSON.stringify(defect.symbols) : null,
    resolution: defect.resolution ?? null,
    status: defect.status,
    createdAt: defect.createdAt,
    updatedAt: defect.updatedAt,
  };
}

function toQaOccurrenceParams(occurrence: QaOccurrence): Record<string, unknown> {
  return {
    id: occurrence.id,
    runId: occurrence.runId,
    defectId: occurrence.defectId,
    qaIteration: occurrence.qaIteration,
    findingId: occurrence.findingId,
    reportArtifactId: occurrence.reportArtifactId,
    createdAt: occurrence.createdAt,
  };
}

function fromQaDefectRow(row: QaDefectRow): QaDefect {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    title: row.title,
    summary: row.summary,
    category: row.category,
    severity: row.severity,
    ...(row.locations_json ? { locations: JSON.parse(row.locations_json) as string[] } : {}),
    ...(row.symbols_json ? { symbols: JSON.parse(row.symbols_json) as string[] } : {}),
    ...(row.resolution ? { resolution: row.resolution } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromQaOccurrenceRow(row: QaOccurrenceRow): QaOccurrence {
  return {
    id: row.id,
    runId: row.run_id,
    defectId: row.defect_id,
    qaIteration: row.qa_iteration,
    findingId: row.finding_id,
    reportArtifactId: row.report_artifact_id,
    createdAt: row.created_at,
  };
}

function fromQaDefectEventRow(row: QaDefectEventRow): QaDefectEvent {
  return {
    id: row.id,
    defectId: row.defect_id,
    ...(row.occurrence_id ? { occurrenceId: row.occurrence_id } : {}),
    status: row.status,
    ...(row.details_json ? { details: row.details_json } : {}),
    createdAt: row.created_at,
  };
}

function fromArtifactRow(row: ArtifactRow): ArtifactReference {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    name: row.name,
    kind: row.kind,
    path: row.path,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
  };
}

function fromPersistedEventRow(row: PersistedEventRow): PersistedRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    type: row.type,
    message: row.message,
    occurredAt: row.occurred_at,
  };
}

function parseSelection(value: string | null): PreparationSelection | null {
  return value ? (JSON.parse(value) as PreparationSelection) : null;
}

function validatePreparationSettings(patch: UpdatePreparationRequest['patch']): void {
  if (hasOwn(patch, 'reviewMode')) {
    if (
      patch.reviewMode !== 'human' &&
      patch.reviewMode !== 'optional-auto' &&
      patch.reviewMode !== 'required-auto'
    ) {
      throw new Error('Invalid preparation review mode');
    }
  }
  for (const selection of [patch.producer, patch.reviewer]) {
    if (selection !== undefined && selection !== null) {
      if (!selection.model.trim()) throw new Error('Preparation model must be non-empty');
      if (selection.provider !== undefined && !selection.provider.trim()) {
        throw new Error('Preparation provider must be non-empty when provided');
      }
      if (selection.thinking !== undefined && !selection.thinking.trim()) {
        throw new Error('Preparation thinking level must be non-empty when provided');
      }
    }
  }
}

function validatePreparationSynthesis(synthesis: PreparationSynthesis): void {
  if (
    typeof synthesis.objective !== 'string' ||
    !Array.isArray(synthesis.agreements) ||
    !Array.isArray(synthesis.constraints) ||
    !Array.isArray(synthesis.assumptions) ||
    !Array.isArray(synthesis.questions) ||
    JSON.stringify(synthesis).length > 8_000
  ) {
    throw new Error('Preparation synthesis must be complete and at most 8000 UTF-16 units');
  }
  for (const section of [
    synthesis.agreements,
    synthesis.constraints,
    synthesis.assumptions,
    synthesis.questions,
  ]) {
    if (section.some((item) => typeof item !== 'string')) {
      throw new Error('Preparation synthesis sections must contain strings');
    }
  }
}

function reviewNeedsAcknowledgementForReport(report: PreparationReviewReport): boolean {
  return report.findings.some(
    (finding) => finding.severity === 'medium' || finding.severity === 'low',
  );
}

function canonicalPreparationInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid preparation input');
  const value = input as Record<string, unknown>;
  if (value.kind === 'reply') {
    if (typeof value.content !== 'string' || !value.content.trim()) {
      throw new Error('Preparation reply content must be non-empty');
    }
    return JSON.stringify({ kind: 'reply', content: value.content.trim() });
  }
  if (value.kind === 'retry') {
    if (typeof value.userMessageId !== 'string' || !value.userMessageId) {
      throw new Error('Preparation retry message ID is required');
    }
    return JSON.stringify({ kind: 'retry', userMessageId: value.userMessageId });
  }
  if (value.kind === 'proposal') return JSON.stringify({ kind: 'proposal' });
  if (value.kind === 'review') {
    if (typeof value.proposalId !== 'string' || !value.proposalId) {
      throw new Error('Preparation review proposal ID is required');
    }
    return JSON.stringify({ kind: 'review', proposalId: value.proposalId });
  }
  throw new Error('Invalid preparation input kind');
}

function preparationStale(draftId: string): Error {
  const error = new Error(`Preparation ${draftId} changed before the operation was saved`);
  error.name = 'PREPARATION_STALE';
  return error;
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

type PreparationCursorSource = 'drafts' | 'messages' | 'proposals';
interface PreparationCursor {
  source: PreparationCursorSource;
  draftId?: string;
  createdAt?: string;
  id?: string;
  sequence?: number;
  revision?: number;
}

function encodePreparationCursor(
  source: PreparationCursorSource,
  row: PreparationDraftPageRow | PreparationMessagePageRow | PreparationProposalRow,
  draftId?: string,
): string {
  const value: PreparationCursor = { source, ...(draftId ? { draftId } : {}) };
  if (source === 'drafts') {
    const draft = row as PreparationDraftPageRow;
    value.createdAt = draft.created_at;
    value.id = draft.id;
  } else if (source === 'messages') {
    value.sequence = (row as PreparationMessagePageRow).sequence;
  } else {
    const proposal = row as PreparationProposalRow;
    value.revision = proposal.revision;
    value.id = proposal.id;
  }
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodePreparationCursor(
  encoded: string,
  source: PreparationCursorSource,
  draftId?: string,
): PreparationCursor {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as PreparationCursor;
    if (value.source !== source || (draftId !== undefined && value.draftId !== draftId)) {
      throw new Error('cursor belongs to another preparation query');
    }
    if (source === 'drafts' && (!value.createdAt || !value.id))
      throw new Error('invalid draft cursor');
    if (source === 'messages' && (!Number.isSafeInteger(value.sequence) || value.sequence! < 1)) {
      throw new Error('invalid message cursor');
    }
    if (source === 'proposals' && (!Number.isSafeInteger(value.revision) || !value.id)) {
      throw new Error('invalid proposal cursor');
    }
    return value;
  } catch (error) {
    throw new Error(
      `Invalid preparation cursor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validatePreparationLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Preparation page limit must be an integer between 1 and 50');
  }
  return limit;
}

function paginatePreparationDocument(
  draftId: string,
  documentId: string,
  version: string,
  content: string,
  format: DocumentPage['format'],
  encodedCursor?: string,
): DocumentPage {
  let startOffset = 0;
  if (encodedCursor) {
    const cursor = decodeDocumentCursor(encodedCursor, draftId, documentId, version);
    startOffset = cursor.offset;
  }
  const bytes = Buffer.from(content, 'utf8');
  if (startOffset < 0 || startOffset > bytes.length)
    throw new Error('Invalid document cursor offset');
  let endOffset = Math.min(startOffset + 65_536, bytes.length);
  while (
    endOffset > startOffset &&
    endOffset < bytes.length &&
    (bytes[endOffset]! & 0xc0) === 0x80
  ) {
    endOffset -= 1;
  }
  let page = bytes.subarray(startOffset, endOffset).toString('utf8');
  const newlineCount = [...page].filter((character) => character === '\n').length;
  if (newlineCount > 200) {
    let seen = 0;
    let index = 0;
    while (seen < 200) {
      index = page.indexOf('\n', index) + 1;
      seen += 1;
    }
    page = page.slice(0, index);
    endOffset = startOffset + Buffer.byteLength(page, 'utf8');
  }
  const startsMidLine = startOffset > 0 && bytes[startOffset - 1] !== 0x0a;
  const endsMidLine = endOffset < bytes.length && bytes[endOffset - 1] !== 0x0a;
  return {
    documentId,
    version,
    content: page,
    startOffset,
    endOffset,
    ...(startOffset > 0
      ? {
          previousCursor: encodeDocumentCursor(
            draftId,
            documentId,
            version,
            Math.max(0, startOffset - 65_536),
          ),
        }
      : {}),
    ...(endOffset < bytes.length
      ? { nextCursor: encodeDocumentCursor(draftId, documentId, version, endOffset) }
      : {}),
    startsMidLine,
    endsMidLine,
    format,
    limitations: [],
  };
}

function encodeDocumentCursor(
  draftId: string,
  documentId: string,
  version: string,
  offset: number,
): string {
  return Buffer.from(
    JSON.stringify({ source: 'document', draftId, documentId, version, offset }),
    'utf8',
  ).toString('base64url');
}

function decodeDocumentCursor(
  encoded: string,
  draftId: string,
  documentId: string,
  version: string,
): { offset: number } {
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      value.source !== 'document' ||
      value.draftId !== draftId ||
      value.documentId !== documentId ||
      value.version !== version ||
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 0
    ) {
      throw new Error('cursor does not match the document');
    }
    return { offset: value.offset as number };
  } catch (error) {
    throw new Error(
      `Invalid document cursor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

interface RunCursor {
  createdAt: string;
  id: string;
}

const RUN_STATUSES = new Set<WorkflowRun['status']>([
  'pending',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function validateLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_RUN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIMIT) {
    throw new Error(`Run limit must be an integer between 1 and ${MAX_RUN_LIMIT}`);
  }
  return limit;
}

function validateEventLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_RUN_EVENT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_EVENT_LIMIT) {
    throw new Error(`Event limit must be an integer between 1 and ${MAX_RUN_EVENT_LIMIT}`);
  }
  return limit;
}

function validateEventCursor(value: number | undefined): number {
  const afterId = value ?? 0;
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    throw new Error('Invalid event cursor: afterId must be a non-negative integer');
  }
  return afterId;
}

function encodeCursor(run: RunRow): string {
  return Buffer.from(JSON.stringify({ createdAt: run.created_at, id: run.id }), 'utf8').toString(
    'base64url',
  );
}

function encodeTaskCursor(run: TaskRunRow): string {
  return Buffer.from(JSON.stringify({ createdAt: run.created_at, id: run.id }), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(value: string): RunCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const record = parsed as Record<string, unknown>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof record.createdAt !== 'string' ||
      typeof record.id !== 'string' ||
      !record.createdAt ||
      !record.id
    ) {
      throw new Error('cursor must contain createdAt and id');
    }
    return { createdAt: record.createdAt, id: record.id };
  } catch (error) {
    throw new Error(
      `Invalid run cursor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateGuidedPreparationLimit(limit: number | undefined): number {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    throw new GuidedPreparationError(
      'invalid-input',
      'Guided preparation limit must be between 1 and 50',
    );
  }
  return limit ?? 20;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new GuidedPreparationError('invalid-input', 'Stored source IDs are invalid');
  }
  return parsed;
}

function fromGuidedPreparationMessageRow(
  row: GuidedPreparationMessageRow,
): GuidedPreparationMessage {
  return {
    id: row.id,
    contractId: row.contract_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

function fromGuidedPreparationSourceRow(row: GuidedPreparationSourceRow): GuidedPreparationSource {
  return {
    id: row.id,
    contractId: row.contract_id,
    sequence: row.sequence,
    kind: row.kind,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    ...(row.query === null ? {} : { query: row.query }),
    retrievedAt: row.retrieved_at,
    contentHash: row.content_hash,
    truncated: row.truncated === 1,
  };
}

function fromGuidedPreparationRequestRow(
  row: GuidedPreparationRequestRow,
): GuidedPreparationRequestRecord {
  return {
    contractId: row.contract_id,
    requestId: row.request_id,
    operationId: row.operation_id,
    kind: row.kind,
    requestHash: row.request_hash,
    preparationRevision: row.preparation_revision,
    contractRevision: row.contract_revision,
    status: row.status,
    ownerToken: row.owner_token,
    ...(row.profile_snapshot_json === null
      ? {}
      : { profileSnapshot: JSON.parse(row.profile_snapshot_json) }),
    ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.published_document_id === null
      ? {}
      : { publishedDocumentId: row.published_document_id }),
  };
}

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 100;
