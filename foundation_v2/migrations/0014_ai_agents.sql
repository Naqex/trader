CREATE TABLE ai_agents (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    agent_id uuid NOT NULL,
    config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 100000),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (workspace_id, subject, agent_id)
);
-- NULL identifies the built-in Mentor, including all pre-existing chats.
ALTER TABLE ai_conversations ADD COLUMN agent_id uuid;
ALTER TABLE ai_conversations ADD FOREIGN KEY (workspace_id, subject, agent_id)
    REFERENCES ai_agents(workspace_id, subject, agent_id);
