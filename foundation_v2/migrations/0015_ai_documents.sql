CREATE TABLE ai_documents (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    subject text NOT NULL,
    document_id uuid NOT NULL,
    name text NOT NULL,
    sha256 text NOT NULL CHECK (length(sha256) = 64),
    byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (workspace_id, subject, document_id),
    UNIQUE (workspace_id, subject, name, sha256)
);
CREATE TABLE ai_document_chunks (
    workspace_id text NOT NULL,
    subject text NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    body text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 4096),
    search tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
    PRIMARY KEY (workspace_id, subject, document_id, chunk_index),
    FOREIGN KEY (workspace_id, subject, document_id)
        REFERENCES ai_documents(workspace_id, subject, document_id) ON DELETE CASCADE
);
CREATE INDEX ai_document_chunks_search ON ai_document_chunks USING gin(search);
