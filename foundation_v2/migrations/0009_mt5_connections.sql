-- Local read-only connector. Ciphertext is Windows-user-bound DPAPI, never plaintext.
CREATE TABLE mt5_connections (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    connection_id uuid NOT NULL,
    request_id uuid NOT NULL,
    account_key text NOT NULL,
    name text NOT NULL,
    server text NOT NULL,
    login_hint text NOT NULL,
    start_date date NOT NULL,
    credential text,
    generation bigint NOT NULL DEFAULT 1,
    full_sync boolean NOT NULL DEFAULT true,
    status text NOT NULL CHECK (status IN ('queued','syncing','connected','error','paused','disconnected')),
    error_code text,
    snapshot jsonb,
    last_synced_at timestamptz,
    next_sync_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(workspace_id,connection_id),
    UNIQUE(workspace_id,request_id),
    UNIQUE(workspace_id,account_key)
);
CREATE INDEX mt5_due ON mt5_connections(next_sync_at) WHERE status IN ('queued','syncing','connected','error');
-- Immutable retry receipts contain metadata only, never password or its hash.
CREATE TABLE mt5_connection_requests (
    workspace_id text NOT NULL,
    request_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(workspace_id,request_id),
    FOREIGN KEY(workspace_id,connection_id) REFERENCES mt5_connections(workspace_id,connection_id)
);
