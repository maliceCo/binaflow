export const executionOwnershipMigration = `
CREATE TABLE IF NOT EXISTS run_execution_owners (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_started_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`;
