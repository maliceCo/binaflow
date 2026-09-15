export const guidedPreparationMigration = `
CREATE TABLE guided_preparations (
  contract_id TEXT PRIMARY KEY REFERENCES task_contracts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  brief_confirmed_through_sequence INTEGER NOT NULL CHECK (brief_confirmed_through_sequence >= 0),
  confirmed_source_ids_json TEXT NOT NULL CHECK (json_valid(confirmed_source_ids_json)),
  active_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guided_preparation_messages (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (contract_id, sequence)
);

CREATE TABLE guided_preparation_sources (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (kind IN ('search-result', 'page')),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  query TEXT,
  retrieved_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  UNIQUE (contract_id, sequence)
);

CREATE TABLE guided_preparation_requests (
  contract_id TEXT NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'reply', 'search', 'fetch-source', 'generate-plan', 'generate-todo',
    'confirm-brief', 'comment-plan', 'approve-plan', 'recover-operation'
  )),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  request_hash TEXT NOT NULL,
  preparation_revision INTEGER NOT NULL CHECK (preparation_revision > 0),
  contract_revision INTEGER NOT NULL CHECK (contract_revision > 0),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted'
  )),
  owner_token TEXT,
  profile_snapshot_json TEXT CHECK (profile_snapshot_json IS NULL OR json_valid(profile_snapshot_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  published_document_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, request_id)
);

CREATE INDEX guided_preparation_messages_by_contract
  ON guided_preparation_messages(contract_id, sequence);
CREATE INDEX guided_preparation_sources_by_contract
  ON guided_preparation_sources(contract_id, sequence);
CREATE INDEX guided_preparation_requests_by_contract
  ON guided_preparation_requests(contract_id, created_at);
CREATE INDEX guided_preparation_requests_by_status
  ON guided_preparation_requests(status);
`;
