-- Prop consumes only canonical marks, in sequence, up to the selected immutable
-- revision. Filtering inside the index avoids scanning acknowledged history.
CREATE INDEX replay_execution_prop_marks
    ON replay_execution_events(workspace_id, record_id, dataset_id, sequence)
    WHERE event_json->>'kind' IN ('price_mark','manual_close','order_cancel');
