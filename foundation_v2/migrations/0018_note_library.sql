CREATE TABLE note_templates (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    template_id uuid NOT NULL,
    name text NOT NULL,
    document jsonb NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    created_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, subject, template_id)
);

CREATE TABLE note_template_preferences (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    favorites text[] NOT NULL DEFAULT ARRAY[]::text[],
    defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (workspace_id, subject)
);

CREATE TABLE trade_media (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    session_id text NOT NULL,
    trade_id text NOT NULL,
    media_id uuid NOT NULL,
    name text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp','image/gif')),
    sha256 text NOT NULL,
    body bytea NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 5242880),
    created_at_utc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, media_id),
    UNIQUE (workspace_id, session_id, trade_id, sha256)
);
CREATE INDEX idx_trade_media_scope ON trade_media(workspace_id, session_id, trade_id, created_at_utc);
