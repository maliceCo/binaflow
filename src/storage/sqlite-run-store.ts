import Database from 'better-sqlite3';
import { assertRunTransition, assertStepTransition } from '../core/state-machine.js';
import type { ArtifactReference, StepRun, WorkflowRun } from '../core/run.js';
import type { NormalizedEvent } from '../core/events.js';
import { initialMigration } from './migrations/001-initial.js';
import type { RunStore } from './run-store.js';

export class SqliteRunStore implements RunStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('foreign_keys = ON');
    this.database.exec(initialMigration);
    this.ensureWaitingStatusSupport();
    this.ensureStepRunColumns();
  }

  close(): void {
    this.database.close();
  }

  async createRun(run: WorkflowRun): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO runs (id, workflow_id, workflow_version, objective, status, created_at, updated_at)
         VALUES (@id, @workflowId, @workflowVersion, @objective, @status, @createdAt, @updatedAt)`,
      )
      .run(toRunParams(run));
  }

  async getRun(runId: string): Promise<WorkflowRun | undefined> {
    const row = this.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      RunRow | undefined;
    return row ? fromRunRow(row) : undefined;
  }

  async listRuns(): Promise<WorkflowRun[]> {
    const rows = this.database
      .prepare('SELECT * FROM runs ORDER BY created_at DESC')
      .all() as RunRow[];
    return rows.map(fromRunRow);
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    const current = this.database.prepare('SELECT status FROM runs WHERE id = ?').get(run.id) as
      { status: WorkflowRun['status'] } | undefined;
    if (!current) throw new Error(`Cannot update unknown run: ${run.id}`);
    assertRunTransition(current.status, run.status);

    this.database
      .prepare(
        `UPDATE runs
         SET workflow_id = @workflowId,
             workflow_version = @workflowVersion,
             objective = @objective,
             status = @status,
             created_at = @createdAt,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run(toRunParams(run));
  }

  async saveStepRun(stepRun: StepRun): Promise<void> {
    const transaction = this.database.transaction(() => this.writeStepRun(stepRun));
    transaction();
  }

  async getStepRuns(runId: string): Promise<StepRun[]> {
    const rows = this.database
      .prepare('SELECT * FROM step_runs WHERE run_id = ? ORDER BY rowid')
      .all(runId) as StepRunRow[];
    return rows.map(fromStepRunRow);
  }

  async getArtifacts(runId: string): Promise<ArtifactReference[]> {
    const rows = this.database
      .prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY rowid')
      .all(runId) as ArtifactRow[];
    return rows.map(fromArtifactRow);
  }

  async saveEvent(event: NormalizedEvent): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO normalized_events (run_id, step_id, type, message, occurred_at)
         VALUES (@runId, @stepId, @type, @message, @occurredAt)`,
      )
      .run({
        runId: event.runId,
        stepId: event.stepId,
        type: event.type,
        message: event.message,
        occurredAt: event.occurredAt,
      });
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

  private writeStepRun(stepRun: StepRun): void {
    const current = this.database
      .prepare('SELECT status FROM step_runs WHERE run_id = ? AND step_id = ?')
      .get(stepRun.runId, stepRun.stepId) as { status: StepRun['status'] } | undefined;

    if (current) assertStepTransition(current.status, stepRun.status);

    const row = toStepRunRow(stepRun);
    this.database
      .prepare(
        `INSERT INTO step_runs
          (run_id, step_id, profile, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json, approval_json)
         VALUES (@runId, @stepId, @profile, @status, @attempt, @startedAt, @finishedAt, @resultJson, @errorJson, @dispositionJson, @skipReasonJson, @approvalJson)
         ON CONFLICT (run_id, step_id) DO UPDATE SET
          profile = excluded.profile,
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

  private ensureStepRunColumns(): void {
    const columns = this.database.pragma('table_info(step_runs)') as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('disposition_json'))
      this.database.exec('ALTER TABLE step_runs ADD COLUMN disposition_json TEXT');
    if (!names.has('skip_reason_json'))
      this.database.exec('ALTER TABLE step_runs ADD COLUMN skip_reason_json TEXT');
    if (!names.has('approval_json'))
      this.database.exec('ALTER TABLE step_runs ADD COLUMN approval_json TEXT');
  }

  private ensureWaitingStatusSupport(): void {
    const row = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'step_runs'")
      .get() as { sql?: string } | undefined;
    if (row?.sql?.includes("'waiting'")) return;

    this.database.pragma('foreign_keys = OFF');
    try {
      const migrate = this.database.transaction(() => {
        this.database.exec(`
          ALTER TABLE normalized_events RENAME TO normalized_events_legacy;
          ALTER TABLE artifacts RENAME TO artifacts_legacy;
          ALTER TABLE step_attempts RENAME TO step_attempts_legacy;
          ALTER TABLE step_runs RENAME TO step_runs_legacy;
          ALTER TABLE runs RENAME TO runs_legacy;

          CREATE TABLE runs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            workflow_version INTEGER NOT NULL,
            objective TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO runs SELECT * FROM runs_legacy;

          CREATE TABLE step_runs (
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            profile TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
            attempt INTEGER NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            result_json TEXT,
            error_json TEXT,
            disposition_json TEXT,
            skip_reason_json TEXT,
            approval_json TEXT,
            PRIMARY KEY (run_id, step_id)
          );
          INSERT INTO step_runs
            (run_id, step_id, profile, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json)
          SELECT run_id, step_id, profile, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json
          FROM step_runs_legacy;

          CREATE TABLE step_attempts (
            run_id TEXT NOT NULL,
            step_id TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
            started_at TEXT NOT NULL,
            finished_at TEXT,
            external_session_id TEXT,
            result_json TEXT,
            error_json TEXT,
            PRIMARY KEY (run_id, step_id, attempt),
            FOREIGN KEY (run_id, step_id) REFERENCES step_runs(run_id, step_id) ON DELETE CASCADE
          );
          INSERT INTO step_attempts SELECT * FROM step_attempts_legacy;

          CREATE TABLE artifacts (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('json', 'text')),
            path TEXT NOT NULL,
            media_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            UNIQUE (run_id, step_id, name)
          );
          INSERT INTO artifacts SELECT * FROM artifacts_legacy;

          CREATE TABLE normalized_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('status', 'text', 'error')),
            message TEXT NOT NULL,
            occurred_at TEXT NOT NULL
          );
          INSERT INTO normalized_events SELECT * FROM normalized_events_legacy;

          DROP TABLE normalized_events_legacy;
          DROP TABLE artifacts_legacy;
          DROP TABLE step_attempts_legacy;
          DROP TABLE step_runs_legacy;
          DROP TABLE runs_legacy;
          CREATE INDEX IF NOT EXISTS artifacts_by_run ON artifacts(run_id);
          CREATE INDEX IF NOT EXISTS events_by_run ON normalized_events(run_id, id);
        `);
      });
      migrate();
    } finally {
      this.database.pragma('foreign_keys = ON');
    }
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

function fromStepRunRow(row: StepRunRow): StepRun {
  return {
    runId: row.run_id,
    stepId: row.step_id,
    profile: row.profile,
    status: row.status,
    attempt: row.attempt,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
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
