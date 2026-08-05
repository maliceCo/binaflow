export const profileSnapshotMigration = `
ALTER TABLE step_runs ADD COLUMN profile_json TEXT;
`;
