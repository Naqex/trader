-- Manual closed-trade journal; this ledger grants no broker execution capability.
CREATE TABLE live_records (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    record_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('account', 'trade', 'note')),
    current_revision bigint NOT NULL CHECK (current_revision > 0),
    created_at_utc text NOT NULL,
    updated_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, record_id)
);

CREATE TABLE live_record_revisions (
    workspace_id text NOT NULL,
    record_id text NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
    created_at_utc text NOT NULL,
    PRIMARY KEY (workspace_id, record_id, revision),
    FOREIGN KEY (workspace_id, record_id) REFERENCES live_records(workspace_id, record_id)
);

CREATE INDEX live_records_list ON live_records(workspace_id, updated_at_utc DESC, record_id);
