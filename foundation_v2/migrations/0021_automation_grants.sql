-- Owner-approved, immutable Demo capability revisions. Only digests of bearer
-- credentials are retained. Native request receipts remain the send authority.
CREATE TABLE automation_grants (
    workspace_id text NOT NULL REFERENCES workspaces(workspace_id),
    grant_id uuid NOT NULL,
    credential_id uuid NOT NULL UNIQUE,
    credential_sha256 text NOT NULL UNIQUE CHECK (credential_sha256 ~ '^[0-9a-f]{64}$'),
    terminal_key text NOT NULL,
    policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
    policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
    status text NOT NULL CHECK (status IN ('active', 'revoked')),
    approved_by text NOT NULL CHECK (length(approved_by) > 0),
    approved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_by text,
    PRIMARY KEY(workspace_id, grant_id),
    CHECK (expires_at > approved_at),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK ((status = 'revoked') = (revoked_by IS NOT NULL AND length(revoked_by) > 0))
);
CREATE INDEX automation_grants_terminal ON automation_grants(terminal_key);

CREATE TABLE automation_grant_requests (
    workspace_id text NOT NULL,
    request_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    credential_id uuid NOT NULL,
    policy_sha256 text NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
    fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    risk_reserved numeric NOT NULL CHECK (risk_reserved >= 0 AND risk_reserved < 'Infinity'::numeric),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(workspace_id, request_id),
    FOREIGN KEY(workspace_id, grant_id) REFERENCES automation_grants(workspace_id, grant_id),
    -- Reservation and the existing unknown receipt must commit together.
    FOREIGN KEY(workspace_id, request_id) REFERENCES mt5_demo_requests(workspace_id, request_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX automation_grant_requests_budget ON automation_grant_requests(workspace_id, grant_id);

CREATE FUNCTION immutable_automation_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'automation grants are retained for reconciliation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'revoked_at' - 'revoked_by') IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'revoked_at' - 'revoked_by') OR
       NOT (OLD.status = 'active' AND NEW.status = 'revoked' AND NEW.revoked_at IS NOT NULL) THEN
        RAISE EXCEPTION 'automation policy revisions are immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER automation_grant_immutable BEFORE UPDATE OR DELETE ON automation_grants
    FOR EACH ROW EXECUTE FUNCTION immutable_automation_grant();

CREATE FUNCTION immutable_automation_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'automation reservation history cannot be deleted';
    END IF;
    IF (to_jsonb(NEW) - 'risk_reserved') IS DISTINCT FROM (to_jsonb(OLD) - 'risk_reserved')
       OR NEW.risk_reserved <> 0 OR OLD.risk_reserved <= 0 OR NOT EXISTS (
        SELECT 1 FROM mt5_demo_requests r
        WHERE r.workspace_id = OLD.workspace_id AND r.request_id = OLD.request_id
          AND r.result->>'status' = r.status
          AND coalesce(r.result->'requires_reconciliation', 'false'::jsonb) = 'false'::jsonb
          AND (r.status = 'rejected' OR (r.status = 'filled' AND
            (r.result->>'retcode' = '10009' OR r.result->>'reason' = 'demo_reconciled_filled')
            AND coalesce(r.result->>'reason', '') NOT LIKE '%partial%'
            AND coalesce(r.result->>'retcode', '') <> '10010'))
       ) THEN
        RAISE EXCEPTION 'automation reservations require proven native settlement';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER automation_reservation_immutable BEFORE UPDATE OR DELETE ON automation_grant_requests
    FOR EACH ROW EXECUTE FUNCTION immutable_automation_reservation();
