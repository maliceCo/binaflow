export const guidedPreparationSessionMigration = `
ALTER TABLE guided_preparations ADD COLUMN external_session_driver TEXT;
ALTER TABLE guided_preparations ADD COLUMN external_session_id TEXT;
ALTER TABLE guided_preparations ADD COLUMN session_synced_through_sequence INTEGER;
ALTER TABLE guided_preparations ADD COLUMN external_session_profile_hash TEXT;
ALTER TABLE guided_preparations ADD COLUMN external_session_brief_hash TEXT;
ALTER TABLE guided_preparations ADD COLUMN messages_compacted_through_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guided_preparations ADD COLUMN session_recovered_at TEXT;

ALTER TABLE guided_preparation_requests ADD COLUMN requested_external_session_id TEXT;
ALTER TABLE guided_preparation_requests ADD COLUMN result_external_session_id TEXT;
ALTER TABLE guided_preparation_requests ADD COLUMN result_session_through_sequence INTEGER;
ALTER TABLE guided_preparation_requests ADD COLUMN compacted_at TEXT;
`;
