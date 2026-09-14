export const guidedExecutionMigration = `
CREATE TABLE guided_executions (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  contract_id TEXT NOT NULL UNIQUE REFERENCES task_contracts(id),
  request_id TEXT NOT NULL UNIQUE,
  workspace TEXT NOT NULL,
  coordinator_version INTEGER NOT NULL CHECK (coordinator_version > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  brief_id TEXT NOT NULL,
  brief_version INTEGER NOT NULL CHECK (brief_version > 0),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  todo_id TEXT NOT NULL,
  todo_version INTEGER NOT NULL CHECK (todo_version > 0),
  approval_id TEXT NOT NULL,
  authorization_digest TEXT NOT NULL,
  authorization_json TEXT NOT NULL CHECK (json_valid(authorization_json)),
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  snapshot_artifact_id TEXT NOT NULL,
  todo_artifact_id TEXT NOT NULL,
  input_artifact_id TEXT NOT NULL,
  initial_git_json TEXT NOT NULL CHECK (json_valid(initial_git_json)),
  stage TEXT NOT NULL CHECK (stage IN ('execution', 'changes-review')),
  active_block_json TEXT CHECK (active_block_json IS NULL OR json_valid(active_block_json)),
  last_checkpoint_json TEXT CHECK (last_checkpoint_json IS NULL OR json_valid(last_checkpoint_json)),
  progress_json TEXT NOT NULL CHECK (json_valid(progress_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (contract_id, run_id),
  FOREIGN KEY (contract_id, brief_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (contract_id, plan_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (contract_id, todo_id) REFERENCES task_contract_documents(contract_id, id),
  FOREIGN KEY (contract_id, approval_id) REFERENCES task_contract_actions(contract_id, id)
);

CREATE TABLE guided_execution_phases (
  run_id TEXT NOT NULL REFERENCES guided_executions(run_id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
  verification_artifact_id TEXT,
  commit_intent_json TEXT CHECK (commit_intent_json IS NULL OR json_valid(commit_intent_json)),
  commit_sha TEXT,
  no_changes INTEGER NOT NULL DEFAULT 0 CHECK (no_changes IN (0, 1)),
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  PRIMARY KEY (run_id, phase_id),
  UNIQUE (run_id, ordinal)
);

CREATE TABLE guided_execution_tasks (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  agent_step_id TEXT,
  result_artifact_id TEXT,
  verification_artifact_id TEXT,
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  PRIMARY KEY (run_id, task_id),
  UNIQUE (run_id, phase_id, ordinal),
  FOREIGN KEY (run_id, phase_id) REFERENCES guided_execution_phases(run_id, phase_id) ON DELETE CASCADE
);

CREATE TABLE guided_execution_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES guided_executions(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  decision TEXT NOT NULL CHECK (decision IN ('retry-task', 'retry-verification', 'continue', 'reconcile-commit', 'cancel')),
  reason TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);

CREATE INDEX guided_executions_by_workspace ON guided_executions(workspace, run_id);
CREATE INDEX guided_execution_phases_by_run ON guided_execution_phases(run_id, ordinal);
CREATE INDEX guided_execution_tasks_by_run ON guided_execution_tasks(run_id, phase_id, ordinal);
CREATE INDEX guided_execution_decisions_by_run ON guided_execution_decisions(run_id, sequence);
`;
