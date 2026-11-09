CREATE TABLE live_note_folders (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    folder_id text NOT NULL,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, folder_id)
);
CREATE UNIQUE INDEX live_note_folder_names ON live_note_folders(workspace_id, lower(name));
CREATE TABLE live_note_folder_members (
    workspace_id text NOT NULL,
    folder_id text NOT NULL,
    record_id text NOT NULL,
    PRIMARY KEY (workspace_id, folder_id, record_id),
    FOREIGN KEY (workspace_id, folder_id) REFERENCES live_note_folders ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, record_id) REFERENCES live_records ON DELETE CASCADE
);
