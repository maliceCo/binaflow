export const taskContractsMigration = `
CREATE TABLE task_contracts (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  contract_version INTEGER NOT NULL CHECK (contract_version = 1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  phase TEXT NOT NULL CHECK (phase IN ('exploration', 'planning', 'todo')),
  current_brief_id TEXT,
  current_plan_id TEXT,
  approved_plan_id TEXT,
  current_todo_id TEXT,
  current_block_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, current_brief_id),
  UNIQUE (id, current_plan_id),
  UNIQUE (id, approved_plan_id),
  UNIQUE (id, current_todo_id),
  UNIQUE (id, current_block_id),
  FOREIGN KEY (id, current_brief_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (id, current_plan_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (id, approved_plan_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (id, current_todo_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (id, current_block_id) REFERENCES task_contract_actions(contract_id, id)
);

CREATE TABLE task_contract_documents (
  id TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('brief', 'plan', 'todo')),
  version INTEGER NOT NULL CHECK (version > 0),
  source_document_id TEXT,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, id),
  UNIQUE (contract_id, kind, version),
  FOREIGN KEY (contract_id, source_document_id)
    REFERENCES task_contract_documents(contract_id, id)
);

CREATE TABLE task_contract_actions (
  id TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES task_contracts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'approve-plan', 'block', 'resolve-block')),
  target_document_id TEXT NOT NULL,
  related_action_id TEXT,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, id),
  UNIQUE (contract_id, sequence),
  FOREIGN KEY (contract_id, target_document_id)
    REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (contract_id, related_action_id)
    REFERENCES task_contract_actions(contract_id, id)
);

CREATE INDEX task_contracts_by_workspace
  ON task_contracts(workspace, id);
CREATE INDEX task_contract_documents_by_contract
  ON task_contract_documents(contract_id, kind, version DESC);
CREATE INDEX task_contract_actions_by_contract
  ON task_contract_actions(contract_id, sequence DESC);
`;
