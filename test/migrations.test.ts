import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteRunStore } from '../src/storage/sqlite-run-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('SQLite migrations', () => {
  it('upgrades a pre-ledger database and creates a backup before rebuilding constraints', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'runs.db');
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL,
        objective TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE step_runs (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL,
        profile TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
        attempt INTEGER NOT NULL, started_at TEXT, finished_at TEXT, result_json TEXT, error_json TEXT,
        PRIMARY KEY (run_id, step_id)
      );
      CREATE TABLE step_attempts (
        run_id TEXT NOT NULL, step_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
        started_at TEXT NOT NULL, finished_at TEXT, external_session_id TEXT, result_json TEXT, error_json TEXT,
        PRIMARY KEY (run_id, step_id, attempt), FOREIGN KEY (run_id, step_id) REFERENCES step_runs(run_id, step_id)
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, step_id TEXT NOT NULL,
        name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('json', 'text')), path TEXT NOT NULL,
        media_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, UNIQUE (run_id, step_id, name)
      );
      CREATE TABLE normalized_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('status', 'text', 'error')),
        message TEXT NOT NULL, occurred_at TEXT NOT NULL
      );
      INSERT INTO runs VALUES ('run-1', 'plan-build', 1, 'objective', 'pending', '2026-01-01', '2026-01-01');
      INSERT INTO step_runs VALUES ('run-1', 'plan', 'planner', 'pending', 1, NULL, NULL, NULL, NULL);
    `);
    database.close();

    const store = new SqliteRunStore(databasePath);
    expect((await store.getRun('run-1'))?.objective).toBe('objective');
    expect((await store.getStepRuns('run-1'))[0]?.status).toBe('pending');
    store.close();

    const verification = new Database(databasePath);
    const versions = verification
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    const columns = verification.prepare('PRAGMA table_info(step_runs)').all() as Array<{
      name: string;
    }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    expect(columns.map((column) => column.name)).toContain('profile_json');
    const indexes = verification
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'runs_by_%'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name).sort()).toEqual([
      'runs_by_created',
      'runs_by_status_created',
      'runs_by_workflow_created',
    ]);
    verification.close();
    expect(readdirSync(directory).some((name) => name.startsWith('runs.db.backup-'))).toBe(true);
    expect(existsSync(databasePath)).toBe(true);
  });

  it('recovers when the profile column exists but migration 3 was not recorded', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'binaflow-migration-partial-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'runs.db');
    const store = new SqliteRunStore(databasePath);
    store.close();

    const database = new Database(databasePath);
    database.prepare('DELETE FROM schema_migrations WHERE version >= 3').run();
    database.close();

    const reopened = new SqliteRunStore(databasePath);
    const verification = new Database(databasePath);
    const versions = verification
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    verification.close();
    reopened.close();
  });
});
