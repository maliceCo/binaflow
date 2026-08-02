export const currentMigration = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS step_runs (
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

CREATE TABLE IF NOT EXISTS step_attempts (
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

CREATE TABLE IF NOT EXISTS artifacts (
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

CREATE INDEX IF NOT EXISTS artifacts_by_run ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS normalized_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('status', 'text', 'error')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_by_run ON normalized_events(run_id, id);
`;
