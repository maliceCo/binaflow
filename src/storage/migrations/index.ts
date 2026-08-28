import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { initialMigration } from './001-initial.js';
import { currentMigration } from './002-current.js';
import { profileSnapshotMigration } from './003-profile-snapshot.js';
import { runHistoryMigration } from './004-run-history.js';
import { executionOwnershipMigration } from './005-execution-ownership.js';
import { qaHistoryMigration } from './006-qa-history.js';
import { qaSearchMigration } from './007-qa-search.js';

const currentSchemaVersion = 7;

export function applyMigrations(database: Database.Database, databasePath: string): void {
  const hadExistingSchema = tableExists(database, 'runs');
  const version = tableExists(database, 'schema_migrations')
    ? ((
        database
          .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
          .get() as { version: number } | undefined
      )?.version ?? 0)
    : 0;
  if (hadExistingSchema && version < 2 && requiresLegacyRebuild(database)) {
    backupDatabase(database, databasePath);
  }

  withWriteLock(database, () => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

    const applied = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | undefined;
    let version = applied?.version ?? 0;
    const hadExistingSchema = tableExists(database, 'runs');

    if (version === 0) {
      if (!hadExistingSchema) database.exec(initialMigration);
      recordMigration(database, 1);
      version = 1;
    }

    if (version < 2) {
      const rebuildRequired = requiresLegacyRebuild(database);
      database.pragma('foreign_keys = OFF');
      try {
        upgradeLegacySchema(database, rebuildRequired);
        recordMigration(database, 2);
      } finally {
        database.pragma('foreign_keys = ON');
      }
    }

    if (version < 3) {
      if (!columnExists(database, 'step_runs', 'profile_json')) {
        database.exec(profileSnapshotMigration);
      }
      recordMigration(database, 3);
    }

    if (version < 4) {
      database.exec(runHistoryMigration);
      recordMigration(database, 4);
    }

    if (version < 5) {
      database.exec(executionOwnershipMigration);
      recordMigration(database, 5);
    }

    if (version < 6) {
      database.exec(qaHistoryMigration);
      recordMigration(database, 6);
    }

    if (version < 7) {
      database.exec(qaSearchMigration);
      recordMigration(database, 7);
    }

    const finalVersion = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | undefined;
    if (finalVersion?.version !== currentSchemaVersion) {
      throw new Error(
        `Unsupported Binaflow database schema version: ${finalVersion?.version ?? 0}`,
      );
    }
  });
}

function withWriteLock(database: Database.Database, action: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    action();
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the migration error if rollback itself cannot run.
    }
    throw error;
  }
}

function recordMigration(database: Database.Database, version: number): void {
  database
    .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    .run(version, new Date().toISOString());
}

function tableExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { present: number } | undefined;
  return row?.present === 1;
}

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some((candidate) => candidate.name === column);
}

function requiresLegacyRebuild(database: Database.Database): boolean {
  return (
    !tableSql(database, 'runs').includes("'waiting'") ||
    !tableSql(database, 'step_runs').includes("'waiting'") ||
    !tableSql(database, 'step_attempts').includes("'waiting'") ||
    !tableExists(database, 'normalized_events')
  );
}

function tableSql(database: Database.Database, name: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { sql?: string } | undefined;
  return row?.sql ?? '';
}

function upgradeLegacySchema(database: Database.Database, rebuildRequired: boolean): void {
  if (!tableExists(database, 'runs')) {
    database.exec(currentMigration);
    return;
  }

  const columns = database.pragma('table_info(step_runs)') as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  for (const column of ['disposition_json', 'skip_reason_json', 'approval_json']) {
    if (!names.has(column)) database.exec(`ALTER TABLE step_runs ADD COLUMN ${column} TEXT`);
  }

  if (!rebuildRequired) return;

  database.exec('DROP INDEX IF EXISTS artifacts_by_run; DROP INDEX IF EXISTS events_by_run;');
  for (const table of ['normalized_events', 'artifacts', 'step_attempts', 'step_runs', 'runs']) {
    renameTableIfExists(database, table);
  }
  database.exec(currentMigration);
  database.exec(`
    INSERT INTO runs SELECT * FROM runs_legacy;
    INSERT INTO step_runs
      (run_id, step_id, profile, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json, approval_json)
    SELECT run_id, step_id, profile, status, attempt, started_at, finished_at, result_json, error_json, disposition_json, skip_reason_json, approval_json
      FROM step_runs_legacy;
    INSERT INTO step_attempts SELECT * FROM step_attempts_legacy;
    INSERT INTO artifacts SELECT * FROM artifacts_legacy;
  `);
  if (tableExists(database, 'normalized_events_legacy')) {
    database.exec('INSERT INTO normalized_events SELECT * FROM normalized_events_legacy;');
  }
  database.exec(`
    DROP TABLE IF EXISTS normalized_events_legacy;
    DROP TABLE IF EXISTS artifacts_legacy;
    DROP TABLE IF EXISTS step_attempts_legacy;
    DROP TABLE IF EXISTS step_runs_legacy;
    DROP TABLE IF EXISTS runs_legacy;
  `);
}

function renameTableIfExists(database: Database.Database, name: string): void {
  if (tableExists(database, name)) database.exec(`ALTER TABLE ${name} RENAME TO ${name}_legacy`);
}

function backupDatabase(database: Database.Database, databasePath: string): void {
  if (databasePath === ':memory:' || !existsSync(databasePath)) return;
  const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)', { simple: false }) as {
    busy?: number;
  };
  if (checkpoint.busy) throw new Error('Cannot create migration backup while the database is busy');
  let backupPath = `${databasePath}.backup-${Date.now()}`;
  let suffix = 0;
  while (existsSync(backupPath)) {
    suffix += 1;
    backupPath = `${databasePath}.backup-${Date.now()}-${suffix}`;
  }
  copyFileSync(databasePath, backupPath);
}
