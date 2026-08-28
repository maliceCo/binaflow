export const qaSearchMigration = `
ALTER TABLE qa_defects ADD COLUMN locations_json TEXT;
ALTER TABLE qa_defects ADD COLUMN symbols_json TEXT;
ALTER TABLE qa_defects ADD COLUMN resolution TEXT;

CREATE VIRTUAL TABLE IF NOT EXISTS qa_search USING fts5(
  defect_id UNINDEXED,
  title,
  summary,
  category,
  locations,
  symbols,
  resolution
);
`;
