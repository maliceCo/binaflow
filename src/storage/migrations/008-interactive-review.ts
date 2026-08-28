export const interactiveReviewMigration = `
CREATE TABLE IF NOT EXISTS review_threads (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('scope', 'changes', 'qa')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('scope', 'task', 'change', 'finding')),
  target_id TEXT NOT NULL,
  artifact_revision INTEGER NOT NULL CHECK (artifact_revision > 0),
  state TEXT NOT NULL CHECK (state IN ('waiting', 'decided', 'finalized')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, phase, target_kind, target_id, artifact_revision)
);

CREATE INDEX IF NOT EXISTS review_threads_by_run ON review_threads(run_id, phase, updated_at);

CREATE TABLE IF NOT EXISTS review_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES review_threads(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  content_artifact_id TEXT REFERENCES artifacts(id) ON DELETE RESTRICT,
  generation_status TEXT NOT NULL CHECK (generation_status IN ('pending', 'sent', 'failed', 'interrupted')),
  profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (content IS NOT NULL OR content_artifact_id IS NOT NULL),
  UNIQUE (thread_id, sequence)
);

CREATE INDEX IF NOT EXISTS review_messages_by_thread ON review_messages(thread_id, sequence);

CREATE TABLE IF NOT EXISTS review_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES review_threads(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('scope', 'task', 'change', 'finding')),
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'correct', 'withdraw', 'withdrawn', 'accept-risk', 'postpone', 'confirmed', 'reclassified', 'needs-human-decision')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS review_decisions_by_thread ON review_decisions(thread_id, id);
`;
