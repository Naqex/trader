-- Trading is disabled unless an operator separately configures a dedicated DEMO policy.
-- Commit an unknown receipt before starting any adapter: a crash cannot cause a resend.
CREATE TABLE mt5_demo_requests (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    request_id uuid NOT NULL,
    terminal_key text NOT NULL,
    fingerprint text NOT NULL,
    command_body jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('filled','accepted','rejected','unknown')),
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(workspace_id,request_id)
);
CREATE INDEX mt5_demo_unknown ON mt5_demo_requests(terminal_key) WHERE status='unknown';
CREATE TABLE mt5_demo_controls (
    terminal_key text PRIMARY KEY,
    paused boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
