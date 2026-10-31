CREATE TABLE note_type_catalogs (
    workspace_id text PRIMARY KEY REFERENCES workspaces(workspace_id),
    revision integer NOT NULL CHECK (revision > 0),
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array')
);
