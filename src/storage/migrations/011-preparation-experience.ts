export const preparationExperienceMigration = `
CREATE TEMP TABLE preparation_drafts_011_backup AS
SELECT * FROM preparation_drafts;

CREATE TEMP TABLE preparation_messages_011_backup AS
SELECT * FROM preparation_messages;

CREATE TEMP TABLE preparation_proposals_011_backup AS
SELECT * FROM preparation_proposals;

CREATE TEMP TABLE preparation_approvals_011_backup AS
SELECT * FROM preparation_approvals;

CREATE TEMP TABLE preparation_owners_011_backup AS
SELECT * FROM preparation_owners;

CREATE TEMP TABLE preparation_approvals_011_sequence AS
SELECT seq
FROM sqlite_sequence
WHERE name = 'preparation_approvals';

ALTER TABLE preparation_messages RENAME TO preparation_messages_011_legacy;
ALTER TABLE preparation_approvals RENAME TO preparation_approvals_011_legacy;
ALTER TABLE preparation_owners RENAME TO preparation_owners_011_legacy;
ALTER TABLE preparation_proposals RENAME TO preparation_proposals_011_legacy;
ALTER TABLE preparation_drafts RENAME TO preparation_drafts_011_legacy;

DROP INDEX IF EXISTS preparation_drafts_by_workspace;
DROP INDEX IF EXISTS preparation_messages_by_draft;
DROP INDEX IF EXISTS preparation_proposals_by_draft;

DROP TABLE preparation_approvals_011_legacy;
DROP TABLE preparation_owners_011_legacy;
DROP TABLE preparation_messages_011_legacy;
DROP TABLE preparation_proposals_011_legacy;
DROP TABLE preparation_drafts_011_legacy;
DELETE FROM sqlite_sequence WHERE name = 'preparation_approvals_011_legacy';

CREATE TABLE preparation_drafts (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  workflow_id TEXT NOT NULL CHECK (workflow_id IN ('plan-build', 'plan-build-qa', 'plan-build-qa-interactive')),
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  objective TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  producer_json TEXT CHECK (producer_json IS NULL OR json_valid(producer_json)),
  reviewer_json TEXT CHECK (reviewer_json IS NULL OR json_valid(reviewer_json)),
  review_mode TEXT NOT NULL CHECK (review_mode IN ('human', 'optional-auto', 'required-auto')),
  applied_review_mode TEXT NOT NULL CHECK (applied_review_mode IN ('human', 'optional-auto', 'required-auto')),
  synthesis_version INTEGER NOT NULL CHECK (synthesis_version > 0),
  valid_proposal_id TEXT,
  valid_review_id TEXT,
  blocking_review_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed')),
  consumed_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE preparation_messages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_revision INTEGER NOT NULL CHECK (content_revision > 0),
  generation_status TEXT NOT NULL CHECK (generation_status IN ('pending', 'sent', 'failed', 'interrupted')),
  profile_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (draft_id, sequence)
);

CREATE TABLE preparation_proposals (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  workflow_id TEXT NOT NULL CHECK (workflow_id IN ('plan-build', 'plan-build-qa', 'plan-build-qa-interactive')),
  workflow_version INTEGER NOT NULL CHECK (workflow_version > 0),
  objective TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  experience_origin TEXT NOT NULL CHECK (experience_origin IN ('legacy', 'current')),
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, revision)
);

CREATE TABLE preparation_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES preparation_proposals(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  decision TEXT NOT NULL CHECK (decision = 'approve'),
  approved_at TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  UNIQUE (draft_id, proposal_id)
);

CREATE TABLE preparation_owners (
  draft_id TEXT PRIMARY KEY REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_started_at TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);

CREATE TABLE preparation_syntheses (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  covered_through_sequence INTEGER NOT NULL CHECK (covered_through_sequence >= 0),
  origin TEXT NOT NULL CHECK (origin IN ('initial', 'human', 'legacy')),
  confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, version)
);

CREATE TABLE preparation_suggestions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  base_version INTEGER NOT NULL CHECK (base_version > 0),
  source_message_id TEXT NOT NULL REFERENCES preparation_messages(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  covered_through_sequence INTEGER NOT NULL CHECK (covered_through_sequence >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'discarded'))
);

CREATE TABLE preparation_requests (
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reply', 'retry', 'proposal', 'review')),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'interrupted')),
  turn_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  user_message_id TEXT REFERENCES preparation_messages(id) ON DELETE SET NULL,
  assistant_message_id TEXT REFERENCES preparation_messages(id) ON DELETE SET NULL,
  proposal_id TEXT REFERENCES preparation_proposals(id) ON DELETE SET NULL,
  review_id TEXT REFERENCES preparation_reviews(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  profile_json TEXT CHECK (profile_json IS NULL OR json_valid(profile_json)),
  review_mode TEXT CHECK (review_mode IS NULL OR review_mode IN ('human', 'optional-auto', 'required-auto')),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (draft_id, request_id),
  UNIQUE (turn_id)
);

CREATE TABLE preparation_reviews (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES preparation_proposals(id) ON DELETE RESTRICT,
  content_version INTEGER NOT NULL CHECK (content_version > 0),
  mode TEXT NOT NULL CHECK (mode IN ('human', 'optional-auto', 'required-auto')),
  reviewer_snapshot_json TEXT NOT NULL CHECK (json_valid(reviewer_snapshot_json)),
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE preparation_review_reads (
  draft_id TEXT NOT NULL REFERENCES preparation_drafts(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES preparation_reviews(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (draft_id, review_id)
);

INSERT INTO preparation_drafts
  (id, workspace, workflow_id, workflow_version, objective, revision, content_version,
   producer_json, reviewer_json, review_mode, applied_review_mode, synthesis_version,
   valid_proposal_id, valid_review_id, blocking_review_id, status, consumed_run_id,
   created_at, updated_at)
SELECT
  d.id,
  d.workspace,
  d.workflow_id,
  d.workflow_version,
  d.objective,
  d.revision,
  d.revision,
  NULL,
  NULL,
  'human',
  'human',
  1,
  CASE WHEN p.id IS NOT NULL THEN p.id ELSE NULL END,
  NULL,
  NULL,
  d.status,
  d.consumed_run_id,
  d.created_at,
  d.updated_at
FROM preparation_drafts_011_backup AS d
LEFT JOIN preparation_proposals_011_backup AS p
  ON p.draft_id = d.id AND p.revision = d.revision;

INSERT INTO preparation_messages
  (id, draft_id, sequence, role, content, content_revision, generation_status,
   profile_json, created_at, updated_at)
SELECT
  id,
  draft_id,
  sequence,
  role,
  content,
  1,
  generation_status,
  profile_json,
  created_at,
  updated_at
FROM preparation_messages_011_backup;

INSERT INTO preparation_proposals
  (id, draft_id, revision, content_version, workflow_id, workflow_version, objective,
   outputs_json, provenance_json, experience_origin, created_at)
SELECT
  id,
  draft_id,
  revision,
  revision,
  workflow_id,
  workflow_version,
  objective,
  outputs_json,
  provenance_json,
  'legacy',
  created_at
FROM preparation_proposals_011_backup;

INSERT INTO preparation_approvals
  (id, draft_id, proposal_id, revision, decision, approved_at, run_id)
SELECT id, draft_id, proposal_id, revision, decision, approved_at, run_id
FROM preparation_approvals_011_backup;

DELETE FROM sqlite_sequence WHERE name = 'preparation_approvals';
INSERT INTO sqlite_sequence (name, seq)
SELECT 'preparation_approvals', seq
FROM preparation_approvals_011_sequence;

INSERT INTO preparation_owners
  (draft_id, owner_id, owner_pid, owner_started_at, claim_token, acquired_at)
SELECT draft_id, owner_id, owner_pid, owner_started_at, claim_token, acquired_at
FROM preparation_owners_011_backup;

INSERT INTO preparation_syntheses
  (id, draft_id, version, value_json, covered_through_sequence, origin, confirmed, created_at)
SELECT
  d.id || ':synthesis:1',
  d.id,
  1,
  json_object(
    'objective', d.objective,
    'agreements', json_array(),
    'constraints', json_array(),
    'assumptions', json_array(),
    'questions', json_array()
  ),
  0,
  'legacy',
  0,
  d.created_at
FROM preparation_drafts_011_backup AS d;

CREATE INDEX preparation_drafts_by_workspace
  ON preparation_drafts(workspace, updated_at);

CREATE INDEX preparation_messages_by_draft
  ON preparation_messages(draft_id, sequence);

CREATE INDEX preparation_proposals_by_draft
  ON preparation_proposals(draft_id, revision DESC);

CREATE INDEX preparation_syntheses_by_draft
  ON preparation_syntheses(draft_id, version DESC);

CREATE INDEX preparation_suggestions_by_draft
  ON preparation_suggestions(draft_id, status, id);

CREATE UNIQUE INDEX preparation_suggestions_one_pending
  ON preparation_suggestions(draft_id)
  WHERE status = 'pending';

CREATE INDEX preparation_requests_by_draft
  ON preparation_requests(draft_id, created_at, request_id);

CREATE INDEX preparation_requests_by_turn
  ON preparation_requests(turn_id);

CREATE INDEX preparation_reviews_by_draft
  ON preparation_reviews(draft_id, created_at, id);

CREATE INDEX preparation_reviews_by_proposal
  ON preparation_reviews(proposal_id, content_version, created_at);

CREATE INDEX preparation_review_reads_by_draft
  ON preparation_review_reads(draft_id, acknowledged_at, review_id);

CREATE TEMP TABLE preparation_011_count_check (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO preparation_011_count_check (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM preparation_drafts) = (SELECT COUNT(*) FROM preparation_drafts_011_backup)
  AND (SELECT COUNT(*) FROM preparation_messages) = (SELECT COUNT(*) FROM preparation_messages_011_backup)
  AND (SELECT COUNT(*) FROM preparation_proposals) = (SELECT COUNT(*) FROM preparation_proposals_011_backup)
  AND (SELECT COUNT(*) FROM preparation_approvals) = (SELECT COUNT(*) FROM preparation_approvals_011_backup)
  AND (SELECT COUNT(*) FROM preparation_owners) = (SELECT COUNT(*) FROM preparation_owners_011_backup)
THEN 1 ELSE 0 END;

CREATE TEMP TABLE preparation_011_fk_check AS
SELECT * FROM pragma_foreign_key_check;

CREATE TEMP TABLE preparation_011_fk_assert (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO preparation_011_fk_assert (ok)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM preparation_011_fk_check;

DROP TABLE preparation_011_count_check;
DROP TABLE preparation_011_fk_assert;
DROP TABLE preparation_011_fk_check;
DROP TABLE preparation_approvals_011_sequence;
DROP TABLE preparation_owners_011_backup;
DROP TABLE preparation_approvals_011_backup;
DROP TABLE preparation_proposals_011_backup;
DROP TABLE preparation_messages_011_backup;
DROP TABLE preparation_drafts_011_backup;
`;
