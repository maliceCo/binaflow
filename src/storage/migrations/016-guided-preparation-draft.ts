export const guidedPreparationDraftMigration = `
ALTER TABLE guided_preparations ADD COLUMN draft_brief_json TEXT;
ALTER TABLE guided_preparation_messages ADD COLUMN metadata_json TEXT;

UPDATE guided_preparations
SET draft_brief_json = (
  SELECT body_json
  FROM task_contract_documents
  WHERE task_contract_documents.contract_id = guided_preparations.contract_id
    AND task_contract_documents.id = (
      SELECT current_brief_id
      FROM task_contracts
      WHERE task_contracts.id = guided_preparations.contract_id
    )
);
`;
