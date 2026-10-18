CREATE TABLE session_presets (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    mode text NOT NULL CHECK (mode IN ('backtest', 'prop')),
    preset_id text NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    name_key text NOT NULL,
    config_json jsonb NOT NULL CHECK (jsonb_typeof(config_json) = 'object'),
    deleted boolean NOT NULL DEFAULT false,
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, mode, preset_id)
);

CREATE UNIQUE INDEX session_presets_active_name
    ON session_presets(workspace_id, mode, name_key) WHERE NOT deleted;

CREATE INDEX session_presets_active_list
    ON session_presets(workspace_id, mode, created_at_utc, preset_id) WHERE NOT deleted;
