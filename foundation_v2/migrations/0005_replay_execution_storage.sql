-- Native BAR execution keeps bounded heads per record revision and an immutable
-- shared event prefix. Full snapshot remains the compatibility/default format.
ALTER TABLE workspace_record_revisions
    ADD COLUMN storage_format text NOT NULL DEFAULT 'full_snapshot';
ALTER TABLE workspace_record_revisions
    ADD CONSTRAINT workspace_record_revision_storage_format
    CHECK (storage_format = 'full_snapshot' OR
           (kind = 'replay' AND storage_format = 'replay-execution-v1'));

CREATE TABLE replay_execution_revisions (
    workspace_id text NOT NULL,
    kind text NOT NULL DEFAULT 'replay' CHECK (kind = 'replay'),
    record_id text NOT NULL,
    revision integer NOT NULL CHECK (revision >= 1),
    dataset_id text NOT NULL,
    branch_id text NOT NULL,
    dataset_sha256 text NOT NULL,
    validator_version text NOT NULL,
    event_sequence bigint NOT NULL CHECK (event_sequence >= 0),
    prefix_sha256 text NOT NULL CHECK (prefix_sha256 ~ '^[a-f0-9]{64}$'),
    prefix_json jsonb NOT NULL,
    PRIMARY KEY (workspace_id, record_id, revision, dataset_id),
    FOREIGN KEY (workspace_id, kind, record_id, revision)
        REFERENCES workspace_record_revisions(workspace_id, kind, record_id, revision)
);

CREATE TABLE replay_execution_events (
    workspace_id text NOT NULL,
    kind text NOT NULL DEFAULT 'replay' CHECK (kind = 'replay'),
    record_id text NOT NULL,
    dataset_id text NOT NULL,
    sequence bigint NOT NULL CHECK (sequence >= 1),
    event_json jsonb NOT NULL,
    prefix_sha256 text NOT NULL CHECK (prefix_sha256 ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (workspace_id, record_id, dataset_id, sequence),
    FOREIGN KEY (workspace_id, kind, record_id)
        REFERENCES workspace_records(workspace_id, kind, record_id)
);

-- A queued command reserves its identifier before an event exists. The revision
-- bound distinguishes two revisions with the same event cutoff.
CREATE TABLE replay_execution_operations (
    workspace_id text NOT NULL,
    kind text NOT NULL DEFAULT 'replay' CHECK (kind = 'replay'),
    record_id text NOT NULL,
    dataset_id text NOT NULL,
    operation_id text NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 128),
    first_revision integer NOT NULL CHECK (first_revision >= 1),
    first_event_sequence bigint NOT NULL CHECK (first_event_sequence >= 0),
    PRIMARY KEY (workspace_id, record_id, dataset_id, operation_id),
    FOREIGN KEY (workspace_id, kind, record_id, first_revision)
        REFERENCES workspace_record_revisions(workspace_id, kind, record_id, revision)
);

-- This is an application immutability boundary, not protection against a
-- PostgreSQL administrator disabling triggers or replacing the database.
CREATE FUNCTION tw_replay_execution_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'replay execution prefix rows are immutable';
END;
$$;
CREATE TRIGGER replay_execution_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON replay_execution_events
    FOR EACH STATEMENT EXECUTE FUNCTION tw_replay_execution_immutable();
CREATE TRIGGER replay_execution_operations_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON replay_execution_operations
    FOR EACH STATEMENT EXECUTE FUNCTION tw_replay_execution_immutable();
CREATE TRIGGER replay_execution_revisions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON replay_execution_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION tw_replay_execution_immutable();
