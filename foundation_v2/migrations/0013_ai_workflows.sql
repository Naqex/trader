ALTER TABLE ai_conversations ADD COLUMN kind text NOT NULL DEFAULT 'chat'
    CHECK(kind IN ('chat','evidence-review'));
ALTER TABLE ai_model_calls DROP CONSTRAINT ai_model_calls_run_id_key;
ALTER TABLE ai_model_calls ADD COLUMN node text NOT NULL DEFAULT 'chat';
CREATE UNIQUE INDEX ai_model_call_node ON ai_model_calls(run_id,node);

-- Durable child observations outlive the short-lived model permits.
CREATE TABLE ai_run_steps (
    run_id uuid NOT NULL REFERENCES ai_runs ON DELETE CASCADE,
    node text NOT NULL CHECK(node IN ('facts','gaps','reviewer')),
    selection jsonb NOT NULL,
    status text NOT NULL CHECK(status IN ('waiting','sent','completed','failed','interrupted')),
    outcome text NOT NULL DEFAULT 'not_sent' CHECK(outcome IN ('not_sent','sent','completed','rejected','unknown')),
    result jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(result::text)<=300000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(run_id,node)
);
