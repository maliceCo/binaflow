import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { assertRunTransition, assertStepTransition } from '../core/state-machine.js';
import type { ArtifactReference, RunStatus, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';
import { applyMigrations } from './migrations/index.js';
import {
  RunExecutionOwnedError,
  RunStatusConflictError,
  type RunListPage,
  type RunListQuery,
  type RunStore,
  type StepRunQueryOptions,
} from './run-store.js';

const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export class SqliteRunStore implements RunStore {
  private readonly database: Database.Database;
  private readonly ownerId = randomUUID();

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('foreign_keys = ON');
    applyMigrations(this.database, databasePath);
  }

  close(): void {
    this.database.close();
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
    return transaction();
  }

  async claimApproval(runId: string, approvalStep: StepRun): Promise<WorkflowRun | undefined> {
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
    return transaction();
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
    return transaction();
  }

  async releaseExecution(runId: string): Promise<void> {
    this.database
      .prepare('DELETE FROM run_execution_owners WHERE run_id = ? AND owner_id = ?')
      .run(runId, this.ownerId);
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
  }

  async saveStepRun(stepRun: StepRun): Promise<void> {
    const transaction = this.database.transaction(() => this.writeStepRun(stepRun));
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

  async replaceArtifact(artifact: ArtifactReference): Promise<void> {
    const transaction = this.database.transaction(() => {
      this.replaceArtifactInTransaction(artifact);
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
      this.replaceArtifactInTransaction(inputArtifact);
      this.writeStepRun(researchStep);
      this.writeStepRun(reviewStep);
      if (approvalStep) this.writeStepRun(approvalStep);
    });
    transaction();
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

  async completeStep(stepRun: StepRun, artifacts: ArtifactReference[]): Promise<void> {
    if (stepRun.status !== 'completed') {
      throw new Error('A completed step is required to persist artifact references');
    }

    const transaction = this.database.transaction(() => {
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

  private writeStepRun(stepRun: StepRun): void {
    const current = this.database
      .prepare('SELECT status FROM step_runs WHERE run_id = ? AND step_id = ?')
      .get(stepRun.runId, stepRun.stepId) as { status: StepRun['status'] } | undefined;

    if (current) assertStepTransition(current.status, stepRun.status);

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
    } catch {
      return false;
    }
    return owner.owner_pid !== process.pid || owner.owner_started_at === PROCESS_STARTED_AT;
  }
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

interface ExecutionOwnerRow {
  run_id: string;
  owner_id: string;
  owner_pid: number;
  owner_started_at: string;
  acquired_at: string;
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

function encodeCursor(run: RunRow): string {
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

const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 100;
