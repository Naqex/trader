-- Presentation groups retain source trades, execution history and note identities.
CREATE TABLE journal_trade_group_catalogs (
    workspace_id text PRIMARY KEY REFERENCES workspaces(workspace_id),
    revision integer NOT NULL CHECK (revision > 0),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array')
);
