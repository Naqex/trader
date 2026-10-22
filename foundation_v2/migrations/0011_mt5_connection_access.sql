-- User-selected application access never substitutes for verified broker permission.
ALTER TABLE mt5_connections ADD COLUMN requested_mode text NOT NULL DEFAULT 'read_only'
    CHECK (requested_mode IN ('read_only','trading'));
