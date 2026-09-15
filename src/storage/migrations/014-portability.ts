export const portabilityMigration = `
CREATE TABLE portability_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  dataset_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'exporting', 'exported')),
  last_transfer_id TEXT,
  pending_request_id TEXT,
  pending_digest TEXT,
  pending_destination TEXT,
  pending_transfer_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE portability_transfers (
  transfer_id TEXT PRIMARY KEY,
  parent_transfer_id TEXT,
  dataset_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  git_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('exported', 'imported')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX portability_transfers_by_dataset
  ON portability_transfers(dataset_id, created_at);
`;
