export const qaHistoryMigration = `
CREATE TABLE IF NOT EXISTS qa_defects (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('detected', 'linked', 'fixed', 'verified', 'reopened', 'withdrawn', 'accepted-risk', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_occurrences (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  defect_id TEXT NOT NULL REFERENCES qa_defects(id) ON DELETE CASCADE,
  qa_iteration INTEGER NOT NULL CHECK (qa_iteration > 0),
  finding_id TEXT NOT NULL,
  report_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, qa_iteration, finding_id)
);

CREATE INDEX IF NOT EXISTS qa_occurrences_by_defect ON qa_occurrences(defect_id, created_at);
CREATE INDEX IF NOT EXISTS qa_occurrences_by_run ON qa_occurrences(run_id, qa_iteration);

CREATE TABLE IF NOT EXISTS qa_defect_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_id TEXT NOT NULL REFERENCES qa_defects(id) ON DELETE CASCADE,
  occurrence_id TEXT REFERENCES qa_occurrences(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('detected', 'linked', 'fixed', 'verified', 'reopened', 'withdrawn', 'accepted-risk', 'archived')),
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS qa_defect_events_by_defect ON qa_defect_events(defect_id, id);
`;
