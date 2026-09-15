import Database from 'better-sqlite3';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  PORTABLE_WORKSPACE_MARKER,
  PortabilityContractError,
  type PortableBackupInspection,
  validatePortablePath,
} from '../application/portability.js';
import {
  parseTaskContractBrief,
  parseTaskContractPlan,
  parseTaskContractTodo,
} from '../application/task-contract.js';

const PORTABLE_NORMALIZED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface NormalizePortableBackupOptions {
  sourceDataDir: string;
  transferId?: string;
}

export interface ActivateImportedBackupOptions {
  destinationDataDir: string;
  destinationWorkspace: string;
  transfer: {
    transferId: string;
    parentTransferId: string | null;
    datasetId: string;
    requestId: string;
    digest: string;
    gitFingerprint: string;
    state: 'imported';
    createdAt: string;
    completedAt: string | null;
  };
}

export function normalizePortableBackup(
  databasePath: string,
  options: NormalizePortableBackupOptions | string,
): PortableBackupInspection {
  const input = typeof options === 'string' ? { sourceDataDir: options } : options;
  const database = openWritableDatabase(databasePath);
  try {
    assertSchema14(database);
    withTransaction(database, () => {
      normalizeArtifacts(database, input.sourceDataDir);
      normalizeWorkspaces(database);
      if (input.transferId) {
        database
          .prepare(
            `UPDATE portability_state SET state = 'exported', last_transfer_id = ?,
             pending_request_id = NULL, pending_digest = NULL, pending_destination = NULL,
             pending_transfer_id = NULL, updated_at = ? WHERE singleton_id = 1`,
          )
          .run(input.transferId, PORTABLE_NORMALIZED_TIMESTAMP);
      } else {
        database
          .prepare(
            `UPDATE portability_state SET state = 'exported', pending_request_id = NULL,
             pending_digest = NULL, pending_destination = NULL, pending_transfer_id = NULL,
             updated_at = ? WHERE singleton_id = 1`,
          )
          .run(PORTABLE_NORMALIZED_TIMESTAMP);
      }
      return undefined;
    });
    database.exec('VACUUM');
    return inspectOpenDatabase(database);
  } finally {
    database.close();
  }
}

export function inspectPortableBackup(databasePath: string): PortableBackupInspection {
  const database = openReadonlyDatabase(databasePath);
  try {
    assertSchema14(database);
    return inspectOpenDatabase(database);
  } finally {
    database.close();
  }
}

export function activateImportedBackup(
  databasePath: string,
  input: ActivateImportedBackupOptions,
): PortableBackupInspection {
  if (!input.destinationWorkspace || !input.transfer.transferId) {
    throw portabilityError(
      'invalid-input',
      'Imported backup activation requires destination identity',
    );
  }
  const database = openWritableDatabase(databasePath);
  try {
    assertSchema14(database);
    return withTransaction(database, () => {
      const before = inspectOpenDatabase(database);
      if (before.state !== 'exported') {
        throw portabilityError('invalid-input', 'Only an exported backup can be imported');
      }
      if (input.transfer.datasetId !== before.datasetId) {
        throw portabilityError('invalid-input', 'Imported transfer dataset does not match backup');
      }
      rebaseArtifacts(database, input.destinationDataDir);
      rebaseWorkspaces(database, input.destinationWorkspace);
      recordImportedTransfer(database, input.transfer);
      database
        .prepare(
          `UPDATE portability_state SET state = 'active', last_transfer_id = ?,
           pending_request_id = NULL, pending_digest = NULL, pending_destination = NULL,
           pending_transfer_id = NULL, updated_at = ? WHERE singleton_id = 1`,
        )
        .run(input.transfer.transferId, new Date().toISOString());
      return inspectOpenDatabase(database);
    });
  } finally {
    database.close();
  }
}

function recordImportedTransfer(
  database: Database.Database,
  transfer: ActivateImportedBackupOptions['transfer'],
): void {
  const existing = database
    .prepare(
      `SELECT parent_transfer_id, dataset_id, request_id, digest, git_fingerprint,
              state, created_at, completed_at
       FROM portability_transfers WHERE transfer_id = ?`,
    )
    .get(transfer.transferId) as
    | {
        parent_transfer_id: string | null;
        dataset_id: string;
        request_id: string;
        digest: string;
        git_fingerprint: string;
        state: 'exported' | 'imported';
        created_at: string;
        completed_at: string | null;
      }
    | undefined;
  if (existing) {
    if (
      existing.parent_transfer_id !== transfer.parentTransferId ||
      existing.dataset_id !== transfer.datasetId ||
      existing.request_id !== transfer.requestId ||
      existing.digest !== transfer.digest ||
      existing.git_fingerprint !== transfer.gitFingerprint ||
      existing.created_at !== transfer.createdAt
    ) {
      throw portabilityError('invalid-input', 'Imported transfer does not match ledger record');
    }
    database
      .prepare(
        "UPDATE portability_transfers SET state = 'imported', completed_at = ? WHERE transfer_id = ?",
      )
      .run(transfer.completedAt, transfer.transferId);
    return;
  }
  database
    .prepare(
      `INSERT INTO portability_transfers
       (transfer_id, parent_transfer_id, dataset_id, request_id, digest, git_fingerprint,
        state, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'imported', ?, ?)`,
    )
    .run(
      transfer.transferId,
      transfer.parentTransferId,
      transfer.datasetId,
      transfer.requestId,
      transfer.digest,
      transfer.gitFingerprint,
      transfer.createdAt,
      transfer.completedAt,
    );
}

function normalizeArtifacts(database: Database.Database, sourceDataDir: string): void {
  const root = resolve(sourceDataDir);
  const rows = database.prepare('SELECT id, path FROM artifacts').all() as Array<{
    id: string;
    path: string;
  }>;
  for (const row of rows) {
    const path = portableArtifactPath(row.path, root);
    database.prepare('UPDATE artifacts SET path = ? WHERE id = ?').run(path, row.id);
  }
}

function normalizeWorkspaces(database: Database.Database): void {
  database.prepare('UPDATE preparation_drafts SET workspace = ?').run(PORTABLE_WORKSPACE_MARKER);
  database.prepare('UPDATE task_contracts SET workspace = ?').run(PORTABLE_WORKSPACE_MARKER);
  const executions = database
    .prepare('SELECT run_id, workspace, progress_json FROM guided_executions')
    .all() as Array<{ run_id: string; workspace: string; progress_json: string }>;
  for (const execution of executions) {
    database
      .prepare('UPDATE guided_executions SET workspace = ?, progress_json = ? WHERE run_id = ?')
      .run(
        PORTABLE_WORKSPACE_MARKER,
        replaceProgressWorkspace(execution.progress_json),
        execution.run_id,
      );
  }
}

function rebaseArtifacts(database: Database.Database, destinationDataDir: string): void {
  const root = resolve(destinationDataDir);
  const rows = database.prepare('SELECT id, path FROM artifacts').all() as Array<{
    id: string;
    path: string;
  }>;
  for (const row of rows) {
    validatePortableArtifactPath(row.path);
    database
      .prepare('UPDATE artifacts SET path = ? WHERE id = ?')
      .run(join(root, row.path), row.id);
  }
}

function rebaseWorkspaces(database: Database.Database, destinationWorkspace: string): void {
  for (const table of ['preparation_drafts', 'task_contracts', 'guided_executions']) {
    const rows = database.prepare(`SELECT rowid, workspace FROM ${table}`).all() as Array<{
      rowid: number;
      workspace: string;
    }>;
    for (const row of rows) {
      if (row.workspace !== PORTABLE_WORKSPACE_MARKER) {
        throw portabilityError('invalid-input', `Unknown portable workspace marker in ${table}`);
      }
      database
        .prepare(`UPDATE ${table} SET workspace = ? WHERE rowid = ?`)
        .run(destinationWorkspace, row.rowid);
    }
  }
  const executions = database
    .prepare('SELECT run_id, progress_json FROM guided_executions')
    .all() as Array<{ run_id: string; progress_json: string }>;
  for (const execution of executions) {
    database
      .prepare('UPDATE guided_executions SET progress_json = ? WHERE run_id = ?')
      .run(
        replaceProgressWorkspace(execution.progress_json, destinationWorkspace),
        execution.run_id,
      );
  }
}

function inspectOpenDatabase(database: Database.Database): PortableBackupInspection {
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok')
    throw portabilityError('invalid-input', 'Portable backup failed integrity_check');
  const foreignKeys = database.pragma('foreign_key_check') as unknown[];
  if (foreignKeys.length > 0)
    throw portabilityError('invalid-input', 'Portable backup failed foreign_key_check');
  const state = database
    .prepare(
      'SELECT dataset_id, state, last_transfer_id FROM portability_state WHERE singleton_id = 1',
    )
    .get() as
    | {
        dataset_id: string;
        state: PortableBackupInspection['state'];
        last_transfer_id: string | null;
      }
    | undefined;
  if (!state) throw portabilityError('invalid-input', 'Portable backup has no portability state');
  const workspaces = new Set<string>();
  for (const table of ['preparation_drafts', 'task_contracts', 'guided_executions']) {
    const rows = database.prepare(`SELECT workspace FROM ${table}`).all() as Array<{
      workspace: string;
    }>;
    for (const row of rows) workspaces.add(row.workspace);
  }
  const artifacts = database
    .prepare('SELECT id, path, kind, size_bytes FROM artifacts')
    .all() as Array<{
    id: string;
    path: string;
    kind: 'json' | 'text';
    size_bytes: number;
  }>;
  for (const artifact of artifacts) {
    if (isAbsolute(artifact.path)) validateRestoredArtifactPath(artifact.path);
    else validatePortableArtifactPath(artifact.path);
    if (!Number.isSafeInteger(artifact.size_bytes) || artifact.size_bytes < 0) {
      throw portabilityError('invalid-input', `Artifact size is invalid: ${artifact.id}`);
    }
  }
  validateTaskContractDocuments(database);
  validateJsonColumns(database);
  return {
    schemaVersion: 14,
    datasetId: state.dataset_id,
    state: state.state,
    lastTransferId: state.last_transfer_id,
    runs: (database.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }).count,
    artifacts: artifacts.length,
    workspaces: [...workspaces],
  };
}

function validateTaskContractDocuments(database: Database.Database): void {
  const rows = database
    .prepare('SELECT kind, body_json FROM task_contract_documents')
    .all() as Array<{ kind: 'brief' | 'plan' | 'todo'; body_json: string }>;
  for (const row of rows) {
    const body: unknown = JSON.parse(row.body_json);
    if (row.kind === 'brief') parseTaskContractBrief(body);
    else if (row.kind === 'plan') parseTaskContractPlan(body);
    else parseTaskContractTodo(body);
  }
}

function validateJsonColumns(database: Database.Database): void {
  const checks = [
    ['guided_executions', 'authorization_json'],
    ['guided_executions', 'profile_json'],
    ['guided_executions', 'initial_git_json'],
    ['guided_executions', 'progress_json'],
  ];
  for (const [table, column] of checks) {
    const invalid = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE json_valid(${column}) = 0`)
      .get() as { count: number };
    if (invalid.count > 0)
      throw portabilityError('invalid-input', `Invalid JSON in ${table}.${column}`);
  }
}

function replaceProgressWorkspace(progressJson: string, workspace?: string): string {
  const progress: unknown = JSON.parse(progressJson);
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    throw portabilityError('invalid-input', 'Guided execution progress must be a JSON object');
  }
  const record = progress as Record<string, unknown>;
  if ('workspace' in record) {
    if (workspace === undefined) record.workspace = PORTABLE_WORKSPACE_MARKER;
    else if (record.workspace !== PORTABLE_WORKSPACE_MARKER) {
      throw portabilityError('invalid-input', 'Unknown portable progress workspace marker');
    } else record.workspace = workspace;
  }
  return JSON.stringify(record);
}

function portableArtifactPath(path: string, dataDir: string): string {
  if (!isAbsolute(path)) {
    validatePortableArtifactPath(path);
    return path;
  }
  const relativePath = relative(dataDir, path).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('../') || relativePath === '..') {
    throw portabilityError('invalid-path', 'Artifact path is outside the data directory');
  }
  const portable = relativePath.startsWith('artifacts/')
    ? relativePath
    : `artifacts/${relativePath}`;
  validatePortableArtifactPath(portable);
  return portable;
}

function validatePortableArtifactPath(path: string): void {
  validatePortablePath(path);
  if (!path.startsWith('artifacts/')) {
    throw portabilityError('invalid-path', 'Artifact path must be relative to artifacts/');
  }
}

function validateRestoredArtifactPath(path: string): void {
  if (
    !isAbsolute(path) ||
    path.includes('\0') ||
    path.split(/[\\/]/).some((part) => part === '..')
  ) {
    throw portabilityError('invalid-path', 'Restored artifact path is invalid');
  }
}

function assertSchema14(database: Database.Database): void {
  const hasMigrations = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasMigrations)
    throw portabilityError('invalid-input', 'Portable backup must use schema version 14');
  const version = database
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null } | undefined;
  if (version?.version !== 14) {
    throw portabilityError('invalid-input', 'Portable backup must use schema version 14');
  }
}

function openReadonlyDatabase(path: string): Database.Database {
  const details = lstatSync(path);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
    throw portabilityError('invalid-input', 'Portable backup must be a regular file');
  }
  const database = new Database(path, { readonly: true, fileMustExist: true });
  database.pragma('foreign_keys = ON');
  return database;
}

function openWritableDatabase(path: string): Database.Database {
  const details = lstatSync(path);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
    throw portabilityError('invalid-input', 'Portable backup must be a regular file');
  }
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  return database;
}

function withTransaction<T>(database: Database.Database, action: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original validation or mutation error.
    }
    throw error;
  }
}

function portabilityError(
  code: ConstructorParameters<typeof PortabilityContractError>[0],
  message: string,
): PortabilityContractError {
  return new PortabilityContractError(code, message);
}
