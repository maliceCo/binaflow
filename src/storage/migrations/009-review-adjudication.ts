export const reviewAdjudicationMigration = `
ALTER TABLE review_decisions RENAME TO review_decisions_legacy;

CREATE TABLE review_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES review_threads(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('scope', 'task', 'change', 'finding')),
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'correct', 'withdraw', 'withdrawn', 'accept-risk', 'postpone', 'confirmed', 'reclassified', 'needs-human-decision')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  details TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO review_decisions
  (id, thread_id, target_kind, target_id, decision, revision, details, created_at)
SELECT id, thread_id, target_kind, target_id, decision, revision, details, created_at
FROM review_decisions_legacy;

DROP TABLE review_decisions_legacy;
CREATE INDEX IF NOT EXISTS review_decisions_by_thread ON review_decisions(thread_id, id);
`;
