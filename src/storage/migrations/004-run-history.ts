export const runHistoryMigration = `
CREATE INDEX IF NOT EXISTS runs_by_created ON runs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS runs_by_status_created ON runs(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS runs_by_workflow_created ON runs(workflow_id, created_at DESC, id DESC);
`;
