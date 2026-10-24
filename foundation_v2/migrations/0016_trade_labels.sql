-- Journal labels and their trade assignments are metadata, separate from replay execution.
ALTER TABLE workspace_records DROP CONSTRAINT workspace_records_kind_check;
ALTER TABLE workspace_records ADD CONSTRAINT workspace_records_kind_check
    CHECK (kind IN ('playbook','journal','annotation','replay','trade_label','trade_label_assignment'));

CREATE INDEX idx_trade_label_assignment_session
    ON workspace_record_revisions(workspace_id, (payload_json->>'session_id'), record_id, revision)
    WHERE kind='trade_label_assignment';
