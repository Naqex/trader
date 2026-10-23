-- Public AI state belongs to the product; provider credentials never enter these tables.
CREATE TABLE ai_profiles (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    feature text NOT NULL,
    role text NOT NULL,
    selection jsonb NOT NULL CHECK (jsonb_typeof(selection) = 'object'),
    revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (workspace_id,subject,feature,role)
);
CREATE TABLE ai_conversations (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    conversation_id uuid NOT NULL,
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 90),
    selection jsonb NOT NULL CHECK (jsonb_typeof(selection) = 'object'),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (workspace_id, subject, conversation_id)
);
CREATE INDEX ai_conversations_recent ON ai_conversations(workspace_id, subject, updated_at DESC, conversation_id);

CREATE TABLE ai_runs (
    run_id uuid PRIMARY KEY,
    workspace_id text NOT NULL,
    subject text NOT NULL,
    conversation_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    input_hash text NOT NULL,
    input jsonb NOT NULL CHECK (octet_length(input::text) <= 65536),
    config jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('queued','running','cancelling','completed','failed','cancelled','interrupted')),
    outcome text NOT NULL DEFAULT 'not_sent' CHECK (outcome IN ('not_sent','sent','completed','rejected','unknown')),
    result jsonb NOT NULL DEFAULT '{}',
    event_seq bigint NOT NULL DEFAULT 1,
    owner uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (workspace_id,subject,conversation_id) REFERENCES ai_conversations ON DELETE CASCADE,
    UNIQUE (workspace_id,subject,idempotency_key),
    CHECK (octet_length(result::text) <= 300000)
);
CREATE UNIQUE INDEX ai_conversation_active ON ai_runs(workspace_id,subject,conversation_id)
    WHERE status IN ('queued','running','cancelling');
CREATE INDEX ai_runs_queue ON ai_runs(created_at,run_id) WHERE status = 'queued';
CREATE INDEX ai_runs_lease ON ai_runs(lease_until) WHERE status IN ('running','cancelling');
CREATE INDEX ai_runs_conversation ON ai_runs(workspace_id,subject,conversation_id,created_at DESC,run_id);

CREATE TABLE ai_run_events (
    run_id uuid NOT NULL REFERENCES ai_runs ON DELETE CASCADE,
    sequence bigint NOT NULL,
    payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 300000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (run_id,sequence)
);

-- A call permit is independent of a run lease. Future graph parents release this
-- while waiting for children/tools; each child must acquire its own call permit.
CREATE TABLE ai_model_calls (
    call_id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES ai_runs ON DELETE CASCADE,
    owner uuid NOT NULL,
    route text NOT NULL CHECK (route IN ('local-gateway','chatgpt-web')),
    workspace_id text NOT NULL,
    lease_until timestamptz NOT NULL,
    UNIQUE (run_id)
);
CREATE INDEX ai_model_calls_lease ON ai_model_calls(lease_until);
