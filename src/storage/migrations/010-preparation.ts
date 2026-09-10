export const preparationMigration = `
CREATE TABLE IF NOT EXISTS preparation_drafts (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  workflow_id TEXT NOT NULL CHECK (workflow_id IN ('plan-build', 'plan-build-qa-interactive')),
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  objective TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed')),
  consumed_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS preparation_drafts_by_workspace
  ON preparation_drafts(workspace, updated_at);

CREATE TABLE IF NOT EXISTS preparation_messages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  generation_status TEXT NOT NULL CHECK (generation_status IN ('pending', 'sent', 'failed', 'interrupted')),
  profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, sequence)
);

CREATE INDEX IF NOT EXISTS preparation_messages_by_draft
  ON preparation_messages(draft_id, sequence);

CREATE TABLE IF NOT EXISTS preparation_proposals (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  workflow_id TEXT NOT NULL CHECK (workflow_id IN ('plan-build', 'plan-build-qa-interactive')),
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  objective TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, revision)
);

CREATE INDEX IF NOT EXISTS preparation_proposals_by_draft
  ON preparation_proposals(draft_id, revision DESC);

CREATE TABLE IF NOT EXISTS preparation_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES preparation_proposals(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  decision TEXT NOT NULL CHECK (decision = 'approve'),
  approved_at TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  UNIQUE (draft_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS preparation_owners (
  draft_id TEXT PRIMARY KEY REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_started_at TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`;
