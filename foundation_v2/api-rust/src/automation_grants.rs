//! Native immutable Demo grants. Unknown sends retain their durable reservations.
use crate::auth::{Actor, ApiError, AutomationIdentity, Workspace};
use axum::http::StatusCode;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, str::FromStr};
use subtle::ConstantTimeEq;
use tokio_postgres::{Row, Transaction};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AutomationGrantPolicy {
    pub connection_id: Uuid,
    pub connection_generation: i64,
    pub login: String,
    pub server: String,
    pub environment: String,
    pub account_currency: String,
    pub artifact_sha256: String,
    pub symbols: Vec<String>,
    pub actions: Vec<String>,
    pub expires_at: DateTime<Utc>,
    pub max_risk_amount: String,
    pub max_risk_pct: String,
    pub max_aggregate_risk_amount: String,
    pub max_volume: String,
    pub max_positions: u32,
    pub max_attempts: u32,
    pub session_equity_floor: String,
    pub free_margin_floor: String,
    pub cost_buffer_per_lot: String,
    pub max_quote_age_ms: u64,
    pub max_spread_points: String,
    pub deviation_points: u32,
}

fn denied(reason: &str) -> ApiError {
    ApiError::detail(StatusCode::LOCKED, reason)
}
fn conflict() -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, "automation_request_conflict")
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}
fn same_digest(a: &str, b: &str) -> bool {
    valid_sha256(a) && valid_sha256(b) && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
fn decimal(value: &str, positive: bool) -> Result<BigDecimal, ApiError> {
    // Fixed decimal strings bound parsing work and avoid floats/NaN/Infinity.
    if value.is_empty()
        || value.len() > 48
        || value.starts_with('.')
        || value.ends_with('.')
        || value.bytes().filter(|v| *v == b'.').count() > 1
        || !value.bytes().all(|v| v.is_ascii_digit() || v == b'.')
    {
        return Err(denied("automation_decimal_invalid"));
    }
    let parsed = BigDecimal::from_str(value).map_err(|_| denied("automation_decimal_invalid"))?;
    if positive && parsed <= BigDecimal::from(0) {
        return Err(denied("automation_decimal_invalid"));
    }
    Ok(parsed)
}
fn plain(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
impl AutomationGrantPolicy {
    pub fn validate(&self, now: DateTime<Utc>) -> Result<(), ApiError> {
        if self.connection_id.is_nil()
            || self.connection_generation < 1
            || self.environment != "demo"
            || self.login.is_empty()
            || self.login.len() > 20
            || self.login.starts_with('0')
            || !self.login.bytes().all(|v| v.is_ascii_digit())
            || !plain(&self.server, 160)
            || !plain(&self.account_currency, 12)
            || !valid_sha256(&self.artifact_sha256)
            || self.expires_at <= now
            || self.symbols.is_empty()
            || self.symbols.len() > 32
            || self.symbols.iter().any(|v| !plain(v, 64))
            || self.symbols.iter().collect::<HashSet<_>>().len() != self.symbols.len()
            || self.actions.is_empty()
            || self.actions.len() > 2
            || self
                .actions
                .iter()
                .any(|v| !matches!(v.as_str(), "place" | "close"))
            || self.actions.iter().collect::<HashSet<_>>().len() != self.actions.len()
            || !(1..=100).contains(&self.max_positions)
            || !(1..=10000).contains(&self.max_attempts)
            || !(250..=5000).contains(&self.max_quote_age_ms)
            || self.deviation_points > 100
        {
            return Err(denied("automation_policy_invalid"));
        }
        let risk = decimal(&self.max_risk_amount, true)?;
        let aggregate = decimal(&self.max_aggregate_risk_amount, true)?;
        let pct = decimal(&self.max_risk_pct, true)?;
        if aggregate < risk || pct > BigDecimal::from(100) {
            return Err(denied("automation_risk_limits_invalid"));
        }
        decimal(&self.max_volume, true)?;
        decimal(&self.session_equity_floor, true)?;
        decimal(&self.free_margin_floor, false)?;
        decimal(&self.cost_buffer_per_lot, false)?;
        decimal(&self.max_spread_points, true)?;
        Ok(())
    }
    pub fn fingerprint(&self) -> Result<String, ApiError> {
        let value = serde_json::to_value(self).map_err(|_| denied("automation_policy_invalid"))?;
        Ok(sha256(
            &serde_json::to_vec(&value).map_err(|_| denied("automation_policy_invalid"))?,
        ))
    }
}

#[derive(Clone, Debug)]
pub struct StoredGrant {
    pub grant_id: Uuid,
    pub credential_id: Uuid,
    pub terminal_key: String,
    pub policy_sha256: String,
    pub policy: AutomationGrantPolicy,
    pub status: String,
}
fn stored(row: &Row) -> Result<StoredGrant, ApiError> {
    let value: Value = row.get("policy");
    let policy: AutomationGrantPolicy =
        serde_json::from_value(value).map_err(|_| denied("automation_policy_corrupt"))?;
    let policy_sha256: String = row.get("policy_sha256");
    if !same_digest(&policy.fingerprint()?, &policy_sha256)
        || policy.expires_at.timestamp_micros()
            != row.get::<_, DateTime<Utc>>("expires_at").timestamp_micros()
    {
        return Err(denied("automation_policy_corrupt"));
    }
    Ok(StoredGrant {
        grant_id: row.get("grant_id"),
        credential_id: row.get("credential_id"),
        terminal_key: row.get("terminal_key"),
        policy_sha256,
        policy,
        status: row.get("status"),
    })
}

/// Credential identity remains usable for receipt/reconciliation reads after
/// expiry/revocation. Only admission can authorize a new send.
pub async fn resolve_credential(
    pool: &Pool,
    workspace: &str,
    token_sha256: &str,
) -> Result<AutomationIdentity, ApiError> {
    if !valid_sha256(token_sha256) {
        return Err(ApiError::detail(
            StatusCode::UNAUTHORIZED,
            "automation_credential_invalid",
        ));
    }
    let conn = pool.get().await.map_err(|_| ApiError::database())?;
    let row = conn.query_opt(
        "SELECT grant_id,credential_id,credential_sha256 FROM automation_grants WHERE workspace_id=$1 AND credential_sha256=$2",
        &[&workspace, &token_sha256],
    ).await.map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::UNAUTHORIZED, "automation_credential_invalid"))?;
    if !same_digest(&row.get::<_, String>("credential_sha256"), token_sha256) {
        return Err(ApiError::detail(
            StatusCode::UNAUTHORIZED,
            "automation_credential_invalid",
        ));
    }
    Ok(AutomationIdentity {
        workspace_id: workspace.to_owned(),
        grant_id: row.get("grant_id"),
        credential_id: row.get("credential_id"),
        token_sha256: token_sha256.to_owned(),
    })
}

pub async fn create_grant(
    pool: &Pool,
    scope: &Workspace,
    actor: &Actor,
    policy: AutomationGrantPolicy,
    credential_sha256: &str,
) -> Result<StoredGrant, ApiError> {
    actor.require_owner()?;
    policy.validate(Utc::now())?;
    if !valid_sha256(credential_sha256) || !plain(&scope.subject, 256) {
        return Err(denied("automation_credential_invalid"));
    }
    let mut conn = pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    // Connection aliases share one execution owner. This lock covers creation,
    // not the lifetime of independent observation/research sessions.
    let account_key = serde_json::to_string(&(
        "automation-account-v1",
        &scope.workspace_id,
        &policy.server,
        &policy.login,
    ))
    .map_err(|_| denied("automation_policy_invalid"))?;
    lock_terminal(&tx, &account_key).await?;
    let occupied: bool = tx.query_one(
        "SELECT EXISTS(SELECT 1 FROM automation_grants WHERE workspace_id=$1 AND policy->>'server'=$2 AND policy->>'login'=$3 AND status='active' AND expires_at>clock_timestamp())",
        &[&scope.workspace_id, &policy.server, &policy.login],
    ).await.map_err(|_| ApiError::database())?.get(0);
    if occupied {
        return Err(denied("automation_execution_session_active"));
    }
    let terminal_key =
        crate::demo_trading::managed_terminal_key(&scope.workspace_id, policy.connection_id);
    lock_terminal(&tx, &terminal_key).await?;
    check_connection(&tx, &scope.workspace_id, &policy).await?;
    let grant_id = Uuid::new_v4();
    let credential_id = Uuid::new_v4();
    let policy_sha256 = policy.fingerprint()?;
    let value = serde_json::to_value(&policy).map_err(|_| denied("automation_policy_invalid"))?;
    let row = tx.query_one(
        "INSERT INTO automation_grants(workspace_id,grant_id,credential_id,credential_sha256,terminal_key,policy_sha256,policy,status,approved_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9) RETURNING *",
        &[&scope.workspace_id,&grant_id,&credential_id,&credential_sha256,&terminal_key,&policy_sha256,&value,&scope.subject,&policy.expires_at],
    ).await.map_err(|_| ApiError::database())?;
    let result = stored(&row)?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(result)
}

async fn lock_terminal(tx: &Transaction<'_>, terminal_key: &str) -> Result<(), ApiError> {
    // Same key and lock as the native managed adapter: revoke acknowledges only
    // after an already admitted terminal operation releases its transaction.
    let lock = i64::from_be_bytes(
        Sha256::digest(terminal_key.as_bytes())[..8]
            .try_into()
            .unwrap(),
    );
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| ApiError::database())?;
    Ok(())
}
async fn check_connection(
    tx: &Transaction<'_>,
    workspace: &str,
    policy: &AutomationGrantPolicy,
) -> Result<(), ApiError> {
    let row = tx.query_opt(
        "SELECT generation,server,requested_mode,status,snapshot FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",
        &[&workspace,&policy.connection_id],
    ).await.map_err(|_| ApiError::database())?.ok_or_else(|| denied("automation_connection_missing"))?;
    let snapshot: Option<Value> = row.get("snapshot");
    let snapshot = snapshot.ok_or_else(|| denied("automation_connection_unverified"))?;
    let binding = &snapshot["execution_binding"];
    if row.get::<_, i64>("generation") != policy.connection_generation
        || row.get::<_, String>("server") != policy.server
        || row.get::<_, String>("requested_mode") != "trading"
        || row.get::<_, String>("status") != "connected"
        || binding["generation"].as_i64() != Some(policy.connection_generation)
        || binding["login"].as_str() != Some(policy.login.as_str())
        || binding["server"].as_str() != Some(policy.server.as_str())
        || binding["account_environment"] != "demo"
        || snapshot["verified_permissions"]["trade"] != true
    {
        return Err(denied("automation_connection_changed"));
    }
    Ok(())
}

/// Read-only policy access, including after expiry/revocation. Not admission.
pub async fn inspect(
    tx: &Transaction<'_>,
    identity: &AutomationIdentity,
) -> Result<StoredGrant, ApiError> {
    let row = tx
        .query_opt(
            "SELECT * FROM automation_grants WHERE workspace_id=$1 AND grant_id=$2",
            &[&identity.workspace_id, &identity.grant_id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| denied("automation_grant_missing"))?;
    if row.get::<_, Uuid>("credential_id") != identity.credential_id
        || !same_digest(
            &row.get::<_, String>("credential_sha256"),
            &identity.token_sha256,
        )
    {
        return Err(denied("automation_credential_invalid"));
    }
    stored(&row)
}

/// Caller must keep this transaction through the final adapter operation, or
/// re-load under the same terminal lock immediately before submission.
pub async fn load(
    tx: &Transaction<'_>,
    identity: &AutomationIdentity,
) -> Result<StoredGrant, ApiError> {
    let row = tx
        .query_opt(
            "SELECT * FROM automation_grants WHERE workspace_id=$1 AND grant_id=$2",
            &[&identity.workspace_id, &identity.grant_id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| denied("automation_grant_missing"))?;
    let terminal: String = row.get("terminal_key");
    lock_terminal(tx, &terminal).await?;
    let row = tx.query_one("SELECT *,clock_timestamp() AS db_now FROM automation_grants WHERE workspace_id=$1 AND grant_id=$2 FOR UPDATE",
        &[&identity.workspace_id,&identity.grant_id]).await.map_err(|_| ApiError::database())?;
    if row.get::<_, Uuid>("credential_id") != identity.credential_id
        || !same_digest(
            &row.get::<_, String>("credential_sha256"),
            &identity.token_sha256,
        )
    {
        return Err(denied("automation_credential_invalid"));
    }
    let grant = stored(&row)?;
    if grant.status != "active" {
        return Err(denied("automation_grant_revoked"));
    }
    let now: DateTime<Utc> = row.get("db_now");
    if grant.policy.expires_at <= now {
        return Err(denied("automation_grant_expired"));
    }
    grant.policy.validate(now)?;
    let expected_terminal = crate::demo_trading::managed_terminal_key(
        &identity.workspace_id,
        grant.policy.connection_id,
    );
    if grant.terminal_key != expected_terminal {
        return Err(denied("automation_policy_corrupt"));
    }
    check_connection(tx, &identity.workspace_id, &grant.policy).await?;
    Ok(grant)
}

#[derive(Clone, Debug)]
pub struct GrantAdmission {
    pub request_id: Uuid,
    pub fingerprint: String,
    pub artifact_sha256: String,
    pub symbol: String,
    pub action: String,
    pub volume: Option<String>,
    pub connection_id: Uuid,
    pub connection_generation: i64,
    pub login: String,
    pub server: String,
    pub environment: String,
}
#[derive(Clone, Debug)]
pub struct AdmissionReservation {
    pub grant: StoredGrant,
    pub duplicate: bool,
}
fn check_budget(
    policy: &AutomationGrantPolicy,
    request: &GrantAdmission,
    attempts: i64,
    reserved: &str,
) -> Result<String, ApiError> {
    if request.request_id.is_nil()
        || !valid_sha256(&request.fingerprint)
        || !same_digest(&request.artifact_sha256, &policy.artifact_sha256)
        || !policy.symbols.contains(&request.symbol)
        || !policy.actions.contains(&request.action)
        || request.connection_id != policy.connection_id
        || request.connection_generation != policy.connection_generation
        || request.login != policy.login
        || request.server != policy.server
        || request.environment != "demo"
    {
        return Err(denied("automation_scope_denied"));
    }
    if let Some(volume) = &request.volume {
        if decimal(volume, true)? > decimal(&policy.max_volume, true)? {
            return Err(denied("automation_volume_exceeded"));
        }
    } else if request.action == "place" {
        return Err(denied("automation_volume_required"));
    }
    // Capacity reservation is deliberately the entire approved per-trade cap.
    // Fresh actual financial admission belongs to the single SDK send boundary.
    let risk = if request.action == "place" {
        decimal(&policy.max_risk_amount, true)?
    } else {
        BigDecimal::from(0)
    };
    if attempts >= i64::from(policy.max_attempts)
        || decimal(reserved, false)? + &risk > decimal(&policy.max_aggregate_risk_amount, true)?
    {
        return Err(denied("automation_budget_exhausted"));
    }
    Ok(risk.to_string())
}

/// Commit this reservation in the SAME transaction as the native unknown
/// receipt. Never call the adapter until commit; duplicate=true never resends.
pub async fn admit_in_transaction(
    tx: &Transaction<'_>,
    identity: &AutomationIdentity,
    request: &GrantAdmission,
) -> Result<AdmissionReservation, ApiError> {
    let request_lock = i64::from_be_bytes(
        Sha256::digest(
            format!(
                "automation-request:{}:{}",
                identity.workspace_id, request.request_id
            )
            .as_bytes(),
        )[..8]
            .try_into()
            .unwrap(),
    );
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&request_lock])
        .await
        .map_err(|_| ApiError::database())?;
    let grant = load(tx, identity).await?;
    if let Some(row) = tx.query_opt("SELECT grant_id,credential_id,policy_sha256,fingerprint FROM automation_grant_requests WHERE workspace_id=$1 AND request_id=$2",
        &[&identity.workspace_id,&request.request_id]).await.map_err(|_| ApiError::database())?
    {
        if row.get::<_, Uuid>("grant_id") != identity.grant_id
            || row.get::<_, Uuid>("credential_id") != identity.credential_id
            || !same_digest(&row.get::<_, String>("policy_sha256"), &grant.policy_sha256)
            || !same_digest(&row.get::<_, String>("fingerprint"), &request.fingerprint)
        {
            return Err(conflict());
        }
        return Ok(AdmissionReservation { grant, duplicate: true });
    }
    let totals = tx.query_one("SELECT count(*)::bigint AS attempts,coalesce(sum(risk_reserved),0)::text AS risk FROM automation_grant_requests WHERE workspace_id=$1 AND grant_id=$2",
        &[&identity.workspace_id,&identity.grant_id]).await.map_err(|_| ApiError::database())?;
    let risk_reserved = check_budget(
        &grant.policy,
        request,
        totals.get("attempts"),
        &totals.get::<_, String>("risk"),
    )?;
    tx.execute("INSERT INTO automation_grant_requests(workspace_id,request_id,grant_id,credential_id,policy_sha256,fingerprint,risk_reserved) VALUES($1,$2,$3,$4,$5,$6,$7::text::numeric)",
        &[&identity.workspace_id,&request.request_id,&identity.grant_id,&identity.credential_id,&grant.policy_sha256,&request.fingerprint,&risk_reserved])
        .await.map_err(|_| ApiError::database())?;
    Ok(AdmissionReservation {
        grant,
        duplicate: false,
    })
}

pub async fn revoke(
    pool: &Pool,
    scope: &Workspace,
    actor: &Actor,
    grant_id: Uuid,
) -> Result<(), ApiError> {
    actor.require_owner()?;
    let mut conn = pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let row = tx
        .query_opt(
            "SELECT terminal_key FROM automation_grants WHERE workspace_id=$1 AND grant_id=$2",
            &[&scope.workspace_id, &grant_id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| denied("automation_grant_missing"))?;
    lock_terminal(&tx, &row.get::<_, String>("terminal_key")).await?;
    tx.execute("UPDATE automation_grants SET status='revoked',revoked_at=clock_timestamp(),revoked_by=$3 WHERE workspace_id=$1 AND grant_id=$2 AND status='active'",
        &[&scope.workspace_id,&grant_id,&scope.subject]).await.map_err(|_| ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(())
}

fn receipt_releases_reservation(status: &str, result: &Value) -> bool {
    if result["status"].as_str() != Some(status)
        || !matches!(
            result.get("requires_reconciliation"),
            None | Some(Value::Bool(false))
        )
    {
        return false;
    }
    if status == "rejected" {
        return true;
    }
    status == "filled"
        && (result["retcode"].as_i64() == Some(10009)
            || result["reason"] == "demo_reconciled_filled")
        && result["retcode"].as_i64() != Some(10010)
        && !result["reason"].as_str().unwrap_or("").contains("partial")
}

/// Called after persisting a native result, in that same transaction. Attempts
/// remain consumed forever; only proven unused/pending capacity is released.
pub async fn settle_in_transaction(
    tx: &Transaction<'_>,
    workspace: &str,
    request_id: Uuid,
) -> Result<bool, ApiError> {
    let row = tx.query_opt("SELECT status,result FROM mt5_demo_requests WHERE workspace_id=$1 AND request_id=$2 FOR UPDATE",
        &[&workspace,&request_id]).await.map_err(|_| ApiError::database())?
        .ok_or_else(|| denied("automation_request_missing"))?;
    if !receipt_releases_reservation(
        &row.get::<_, String>("status"),
        &row.get::<_, Value>("result"),
    ) {
        return Ok(false);
    }
    let changed = tx.execute("UPDATE automation_grant_requests SET risk_reserved=0 WHERE workspace_id=$1 AND request_id=$2 AND risk_reserved>0",
        &[&workspace,&request_id]).await.map_err(|_| ApiError::database())?;
    Ok(changed == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy() -> AutomationGrantPolicy {
        AutomationGrantPolicy {
            connection_id: Uuid::new_v4(),
            connection_generation: 2,
            login: "123456".into(),
            server: "Demo-Server".into(),
            environment: "demo".into(),
            account_currency: "USD".into(),
            artifact_sha256: "a".repeat(64),
            symbols: vec!["EURUSD".into()],
            actions: vec!["place".into(), "close".into()],
            expires_at: Utc::now() + chrono::Duration::hours(1),
            max_risk_amount: "10".into(),
            max_risk_pct: "1".into(),
            max_aggregate_risk_amount: "20".into(),
            max_volume: "0.1".into(),
            max_positions: 2,
            max_attempts: 4,
            session_equity_floor: "990".into(),
            free_margin_floor: "100".into(),
            cost_buffer_per_lot: "5".into(),
            max_quote_age_ms: 1000,
            max_spread_points: "30".into(),
            deviation_points: 10,
        }
    }
    fn request(policy: &AutomationGrantPolicy) -> GrantAdmission {
        GrantAdmission {
            request_id: Uuid::new_v4(),
            fingerprint: "b".repeat(64),
            artifact_sha256: "a".repeat(64),
            symbol: "EURUSD".into(),
            action: "place".into(),
            volume: Some("0.01".into()),
            connection_id: policy.connection_id,
            connection_generation: policy.connection_generation,
            login: policy.login.clone(),
            server: policy.server.clone(),
            environment: "demo".into(),
        }
    }
    #[test]
    fn immutable_policy_roundtrip_and_digest_changes_with_scope() {
        let policy = policy();
        policy.validate(Utc::now()).unwrap();
        let restored: AutomationGrantPolicy =
            serde_json::from_value(serde_json::to_value(&policy).unwrap()).unwrap();
        assert_eq!(policy, restored);
        assert!(same_digest(
            &policy.fingerprint().unwrap(),
            &restored.fingerprint().unwrap()
        ));
        let mut changed = restored;
        changed.connection_generation += 1;
        assert_ne!(
            policy.fingerprint().unwrap(),
            changed.fingerprint().unwrap()
        );
    }
    #[test]
    fn wrong_scope_expiry_real_and_nonfinite_limits_deny() {
        for change in ["real", "expired", "nan", "duplicate", "negative"] {
            let mut policy = policy();
            match change {
                "real" => policy.environment = "real".into(),
                "expired" => policy.expires_at = Utc::now(),
                "nan" => policy.max_risk_amount = "NaN".into(),
                "duplicate" => policy.symbols.push("EURUSD".into()),
                _ => policy.cost_buffer_per_lot = "-1".into(),
            }
            assert!(policy.validate(Utc::now()).is_err(), "{change}");
        }
    }

    #[test]
    fn two_calendar_years_preserve_exact_expiry_and_timezone_equivalence() {
        let mut day = DateTime::parse_from_rfc3339("2027-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let end = DateTime::parse_from_rfc3339("2029-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        while day < end {
            let mut policy = policy();
            policy.expires_at = day + chrono::Duration::minutes(15);
            let mut encoded = serde_json::to_value(&policy).unwrap();
            // The same instant expressed by a local offset must not extend a grant.
            encoded["expires_at"] = serde_json::json!(
                policy
                    .expires_at
                    .with_timezone(&chrono::FixedOffset::east_opt(7 * 3600).unwrap())
                    .to_rfc3339()
            );
            let restored: AutomationGrantPolicy = serde_json::from_value(encoded).unwrap();
            assert_eq!(
                policy.fingerprint().unwrap(),
                restored.fingerprint().unwrap()
            );
            assert!(
                restored
                    .validate(policy.expires_at - chrono::Duration::microseconds(1))
                    .is_ok()
            );
            assert!(restored.validate(policy.expires_at).is_err());
            assert!(
                restored
                    .validate(policy.expires_at + chrono::Duration::days(731))
                    .is_err()
            );
            day += chrono::Duration::days(1);
        }
    }

    #[tokio::test]
    #[ignore = "owned disposable PostgreSQL via scripts/demo_recovery_rehearsal.py only"]
    async fn postgres_recovered_grants_remain_fenced() {
        assert_eq!(
            std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").unwrap();
        let pool = Pool::builder(deadpool_postgres::Manager::new(
            dsn.parse().unwrap(),
            tokio_postgres::NoTls,
        ))
        .max_size(2)
        .runtime(deadpool_postgres::Runtime::Tokio1)
        .build()
        .unwrap();
        let guard = pool.get().await.unwrap();
        let identity = guard
            .query_one("SELECT current_user,current_database()", &[])
            .await
            .unwrap();
        assert_eq!(identity.get::<_, String>(0), "rust_runtime_fixture");
        assert!(
            ["rust_runtime_fixture", "demo_recovery_restored"]
                .contains(&identity.get::<_, String>(1).as_str())
        );
        drop(guard);
        for (credential, reason) in [
            (
                b"fixture credential intentionally not an actual bearer".as_slice(),
                "automation_grant_revoked",
            ),
            (
                b"separate expiring fixture credential".as_slice(),
                "automation_grant_expired",
            ),
        ] {
            let identity = resolve_credential(&pool, "automation-fixture", &sha256(credential))
                .await
                .unwrap();
            let mut client = pool.get().await.unwrap();
            let tx = client.transaction().await.unwrap();
            assert_eq!(load(&tx, &identity).await.unwrap_err().1["detail"], reason);
            tx.rollback().await.unwrap();
        }
        pool.close();
    }
    #[test]
    fn durable_attempt_and_aggregate_reservations_do_not_reset() {
        let policy = policy();
        let request = request(&policy);
        assert_eq!("10", check_budget(&policy, &request, 3, "10").unwrap());
        assert!(check_budget(&policy, &request, 4, "0").is_err());
        assert!(check_budget(&policy, &request, 0, "10.000000000000000001").is_err());
    }
    #[test]
    fn context_identity_scope_and_volume_caps_deny() {
        let policy = policy();
        for change in [
            "artifact",
            "symbol",
            "action",
            "generation",
            "environment",
            "volume",
            "missing_volume",
        ] {
            let mut request = request(&policy);
            match change {
                "artifact" => request.artifact_sha256 = "c".repeat(64),
                "symbol" => request.symbol = "GBPUSD".into(),
                "action" => request.action = "protect".into(),
                "generation" => request.connection_generation += 1,
                "environment" => request.environment = "real".into(),
                "volume" => request.volume = Some("0.100000000000000001".into()),
                _ => request.volume = None,
            }
            assert!(check_budget(&policy, &request, 0, "0").is_err(), "{change}");
        }
    }
    #[test]
    fn close_is_bounded_and_cannot_reserve_opening_risk() {
        let policy = policy();
        let mut request = request(&policy);
        request.action = "close".into();
        request.volume = None;
        assert_eq!("0", check_budget(&policy, &request, 0, "20").unwrap());
        assert!(check_budget(&policy, &request, 4, "20").is_err());
    }
    #[test]
    fn only_proven_final_native_receipts_release_capacity() {
        use serde_json::json;
        for (status, result, releases) in [
            ("rejected", json!({"status":"rejected"}), true),
            (
                "rejected",
                json!({"status":"rejected","requires_reconciliation":true}),
                false,
            ),
            ("filled", json!({"status":"filled","retcode":10009}), true),
            (
                "filled",
                json!({"status":"filled","reason":"demo_reconciled_filled","requires_reconciliation":false}),
                true,
            ),
            (
                "filled",
                json!({"status":"filled","retcode":10010,"requires_reconciliation":false}),
                false,
            ),
            (
                "filled",
                json!({"status":"filled","reason":"demo_reconciled_partial_final","requires_reconciliation":false}),
                false,
            ),
            (
                "filled",
                json!({"status":"filled","retcode":10009,"requires_reconciliation":true}),
                false,
            ),
            ("filled", json!({"status":"filled"}), false),
            ("unknown", json!({"status":"unknown"}), false),
            (
                "accepted",
                json!({"status":"accepted","requires_reconciliation":false}),
                false,
            ),
            ("unknown", json!({"status":"rejected"}), false),
            (
                "rejected",
                json!({"status":"rejected","requires_reconciliation":"false"}),
                false,
            ),
        ] {
            assert_eq!(
                receipt_releases_reservation(status, &result),
                releases,
                "{result}"
            );
        }
    }

    async fn insert_unknown(
        tx: &Transaction<'_>,
        identity: &AutomationIdentity,
        grant: &StoredGrant,
        request: &GrantAdmission,
    ) {
        let result = serde_json::json!({"status":"unknown","requires_reconciliation":true});
        tx.execute("INSERT INTO mt5_demo_requests(workspace_id,request_id,terminal_key,fingerprint,command_body,status,result) VALUES($1,$2,$3,$4,'{}','unknown',$5)",
            &[&identity.workspace_id,&request.request_id,&grant.terminal_key,&request.fingerprint,&result])
            .await.unwrap();
    }

    async fn reserve_fixture(
        pool: &Pool,
        identity: &AutomationIdentity,
        request: GrantAdmission,
    ) -> bool {
        let mut conn = pool.get().await.unwrap();
        let tx = conn.transaction().await.unwrap();
        match admit_in_transaction(&tx, identity, &request).await {
            Ok(admitted) => {
                assert!(!admitted.duplicate);
                insert_unknown(&tx, identity, &admitted.grant, &request).await;
                tx.commit().await.unwrap();
                true
            }
            Err(error) => {
                assert_eq!(error.1["detail"], "automation_budget_exhausted");
                tx.rollback().await.unwrap();
                false
            }
        }
    }

    #[tokio::test]
    #[ignore = "owned disposable PostgreSQL via scripts/rust_runtime_parity.py only"]
    async fn postgres_grant_lifecycle_reservations_settlement_and_revocation() {
        use serde_json::json;
        assert_eq!(
            std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").unwrap();
        let (mut client, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
            .await
            .unwrap();
        let connection_task = tokio::spawn(connection);
        let identity_row = client
            .query_one("SELECT current_user,current_database()", &[])
            .await
            .unwrap();
        assert_eq!(identity_row.get::<_, String>(0), "rust_runtime_fixture");
        assert_eq!(identity_row.get::<_, String>(1), "rust_runtime_fixture");
        let applied = crate::rust_runtime::apply_migrations(&mut client, false)
            .await
            .unwrap();
        assert!(
            applied
                .iter()
                .any(|name| name == "0021_automation_grants.sql")
        );
        assert!(
            crate::rust_runtime::apply_migrations(&mut client, false)
                .await
                .unwrap()
                .is_empty()
        );
        let pool = Pool::builder(deadpool_postgres::Manager::new(
            dsn.parse().unwrap(),
            tokio_postgres::NoTls,
        ))
        .max_size(6)
        .runtime(deadpool_postgres::Runtime::Tokio1)
        .build()
        .unwrap();
        let scope = Workspace {
            workspace_id: "automation-fixture".into(),
            subject: "fixture-owner".into(),
        };
        client
            .execute(
                "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,'fixture')",
                &[&scope.workspace_id],
            )
            .await
            .unwrap();
        let mut policy = policy();
        policy.max_attempts = 2;
        let snapshot = json!({"execution_binding":{"generation":policy.connection_generation,"login":policy.login,
            "server":policy.server,"account_environment":"demo"},"verified_permissions":{"trade":true}});
        client.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,credential,generation,status,requested_mode,snapshot) VALUES($1,$2,$2,'fixture-account','fixture',$3,$4,'2026-11-03','not-a-broker-credential',$5,'connected','trading',$6)",
            &[&scope.workspace_id,&policy.connection_id,&policy.server,&policy.login,&policy.connection_generation,&snapshot]).await.unwrap();
        let token_hash = sha256(b"fixture credential intentionally not an actual bearer");
        let not_owner = Actor::Automation {
            grant_id: Uuid::new_v4(),
            credential_id: Uuid::new_v4(),
        };
        assert!(
            create_grant(&pool, &scope, &not_owner, policy.clone(), &token_hash)
                .await
                .is_err()
        );
        let racing_hash = sha256(b"independent racing fixture credential");
        let (one, two) = tokio::join!(
            create_grant(&pool, &scope, &Actor::Owner, policy.clone(), &token_hash),
            create_grant(&pool, &scope, &Actor::Owner, policy.clone(), &racing_hash)
        );
        assert_ne!(
            one.is_ok(),
            two.is_ok(),
            "one execution grant per account under race"
        );
        let (grant, token_hash) = match one {
            Ok(grant) => {
                assert_eq!(
                    two.unwrap_err().1["detail"],
                    "automation_execution_session_active"
                );
                (grant, token_hash)
            }
            Err(error) => {
                assert_eq!(error.1["detail"], "automation_execution_session_active");
                (two.unwrap(), racing_hash)
            }
        };
        let mut alias = policy.clone();
        alias.connection_id = Uuid::new_v4();
        client.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,credential,generation,status,requested_mode,snapshot) VALUES($1,$2,$2,'fixture-alias','alias',$3,$4,'2026-11-03','not-a-broker-credential',$5,'connected','trading',$6)",
            &[&scope.workspace_id,&alias.connection_id,&alias.server,&alias.login,&alias.connection_generation,&snapshot]).await.unwrap();
        assert_eq!(
            create_grant(
                &pool,
                &scope,
                &Actor::Owner,
                alias.clone(),
                &sha256(b"alias credential")
            )
            .await
            .unwrap_err()
            .1["detail"],
            "automation_execution_session_active"
        );
        // A different account is not serialized for the session's lifetime.
        alias.login = "4321".into();
        let other_snapshot = json!({"execution_binding":{"generation":alias.connection_generation,"login":alias.login,
            "server":alias.server,"account_environment":"demo"},"verified_permissions":{"trade":true}});
        client
            .execute(
                "UPDATE mt5_connections SET login_hint=$2,snapshot=$3 WHERE connection_id=$1",
                &[&alias.connection_id, &alias.login, &other_snapshot],
            )
            .await
            .unwrap();
        let other = create_grant(
            &pool,
            &scope,
            &Actor::Owner,
            alias,
            &sha256(b"other account credential"),
        )
        .await
        .unwrap();
        revoke(&pool, &scope, &Actor::Owner, other.grant_id)
            .await
            .unwrap();
        let identity = resolve_credential(&pool, &scope.workspace_id, &token_hash)
            .await
            .unwrap();
        assert_eq!(identity.grant_id, grant.grant_id);
        assert!(
            resolve_credential(&pool, "other-workspace", &token_hash)
                .await
                .is_err()
        );
        assert!(
            resolve_credential(&pool, &scope.workspace_id, &"f".repeat(64))
                .await
                .is_err()
        );
        assert!(client.execute("UPDATE automation_grants SET policy=policy || '{\"max_attempts\":999}' WHERE grant_id=$1", &[&grant.grant_id]).await.is_err());
        assert!(
            client
                .execute(
                    "DELETE FROM automation_grants WHERE grant_id=$1",
                    &[&grant.grant_id]
                )
                .await
                .is_err()
        );

        let first = request(&policy);
        assert!(reserve_fixture(&pool, &identity, first.clone()).await);
        let mut conn = pool.get().await.unwrap();
        let tx = conn.transaction().await.unwrap();
        assert!(
            admit_in_transaction(&tx, &identity, &first)
                .await
                .unwrap()
                .duplicate
        );
        tx.rollback().await.unwrap();
        let mut conflict = first.clone();
        conflict.fingerprint = "d".repeat(64);
        let tx = conn.transaction().await.unwrap();
        assert_eq!(
            admit_in_transaction(&tx, &identity, &conflict)
                .await
                .unwrap_err()
                .0,
            StatusCode::CONFLICT
        );
        tx.rollback().await.unwrap();
        // A reservation without the matching native unknown receipt cannot commit.
        let orphan = request(&policy);
        let tx = conn.transaction().await.unwrap();
        admit_in_transaction(&tx, &identity, &orphan).await.unwrap();
        assert!(tx.commit().await.is_err());
        assert_eq!(
            client
                .query_one("SELECT count(*) FROM automation_grant_requests", &[])
                .await
                .unwrap()
                .get::<_, i64>(0),
            1
        );
        assert!(
            client
                .execute(
                    "UPDATE automation_grant_requests SET risk_reserved=0 WHERE request_id=$1",
                    &[&first.request_id]
                )
                .await
                .is_err()
        );
        assert!(
            client
                .execute(
                    "UPDATE automation_grant_requests SET fingerprint=$2 WHERE request_id=$1",
                    &[&first.request_id, &"d".repeat(64)]
                )
                .await
                .is_err()
        );
        let tx = conn.transaction().await.unwrap();
        assert!(
            !settle_in_transaction(&tx, &scope.workspace_id, first.request_id)
                .await
                .unwrap()
        );
        tx.commit().await.unwrap();
        drop(conn);
        let (one, two) = tokio::join!(
            reserve_fixture(&pool, &identity, request(&policy)),
            reserve_fixture(&pool, &identity, request(&policy))
        );
        assert_ne!(one, two, "one remaining slot may be reserved only once");
        let totals = client
            .query_one(
                "SELECT count(*),sum(risk_reserved)::text FROM automation_grant_requests",
                &[],
            )
            .await
            .unwrap();
        assert_eq!(totals.get::<_, i64>(0), 2);
        assert_eq!(totals.get::<_, String>(1), "20");
        // Re-open a pooled session: attempts and reservations live in PostgreSQL,
        // never a worker counter that cold starts can reset.
        let mut conn = pool.get().await.unwrap();
        let tx = conn.transaction().await.unwrap();
        assert!(
            admit_in_transaction(&tx, &identity, &request(&policy))
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        let partial = json!({"status":"filled","reason":"demo_reconciled_partial_final","requires_reconciliation":false});
        client
            .execute(
                "UPDATE mt5_demo_requests SET status='filled',result=$2 WHERE request_id=$1",
                &[&first.request_id, &partial],
            )
            .await
            .unwrap();
        assert!(
            client
                .execute(
                    "UPDATE automation_grant_requests SET risk_reserved=0 WHERE request_id=$1",
                    &[&first.request_id]
                )
                .await
                .is_err()
        );
        let tx = conn.transaction().await.unwrap();
        assert!(
            !settle_in_transaction(&tx, &scope.workspace_id, first.request_id)
                .await
                .unwrap()
        );
        tx.rollback().await.unwrap();
        let final_result =
            json!({"status":"filled","retcode":10009,"requires_reconciliation":false});
        let tx = conn.transaction().await.unwrap();
        tx.execute(
            "UPDATE mt5_demo_requests SET status='filled',result=$2 WHERE request_id=$1",
            &[&first.request_id, &final_result],
        )
        .await
        .unwrap();
        assert!(
            settle_in_transaction(&tx, &scope.workspace_id, first.request_id)
                .await
                .unwrap()
        );
        assert!(
            !settle_in_transaction(&tx, &scope.workspace_id, first.request_id)
                .await
                .unwrap()
        );
        tx.commit().await.unwrap();
        let totals = client
            .query_one(
                "SELECT count(*),sum(risk_reserved)::text FROM automation_grant_requests",
                &[],
            )
            .await
            .unwrap();
        assert_eq!(totals.get::<_, i64>(0), 2);
        assert_eq!(totals.get::<_, String>(1), "10");
        let tx = conn.transaction().await.unwrap();
        assert!(
            admit_in_transaction(&tx, &identity, &request(&policy))
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        assert!(
            client
                .execute(
                    "UPDATE automation_grant_requests SET risk_reserved=10 WHERE request_id=$1",
                    &[&first.request_id]
                )
                .await
                .is_err()
        );
        let rejected_id: Uuid = client
            .query_one(
                "SELECT request_id FROM automation_grant_requests WHERE request_id<>$1",
                &[&first.request_id],
            )
            .await
            .unwrap()
            .get(0);
        let tx = conn.transaction().await.unwrap();
        tx.execute("UPDATE mt5_demo_requests SET status='rejected',result='{\"status\":\"rejected\"}' WHERE request_id=$1", &[&rejected_id]).await.unwrap();
        assert!(
            settle_in_transaction(&tx, &scope.workspace_id, rejected_id)
                .await
                .unwrap()
        );
        tx.commit().await.unwrap();
        assert_eq!(
            client
                .query_one(
                    "SELECT sum(risk_reserved)::text FROM automation_grant_requests",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, String>(0),
            "0"
        );
        let tx = conn.transaction().await.unwrap();
        assert!(
            admit_in_transaction(&tx, &identity, &request(&policy))
                .await
                .is_err(),
            "settlement must not restore attempts"
        );
        tx.rollback().await.unwrap();
        client
            .execute(
                "UPDATE mt5_connections SET generation=generation+1 WHERE connection_id=$1",
                &[&policy.connection_id],
            )
            .await
            .unwrap();
        let tx = conn.transaction().await.unwrap();
        assert_eq!(
            load(&tx, &identity).await.unwrap_err().1["detail"],
            "automation_connection_changed"
        );
        tx.rollback().await.unwrap();
        client
            .execute(
                "UPDATE mt5_connections SET generation=generation-1 WHERE connection_id=$1",
                &[&policy.connection_id],
            )
            .await
            .unwrap();
        // Revocation cannot acknowledge while an admitted operation holds the
        // exact native terminal lock; the disposable DB exposes the wait itself.
        let tx = conn.transaction().await.unwrap();
        load(&tx, &identity).await.unwrap();
        let revoke_pool = pool.clone();
        let revoke_scope = scope.clone();
        let revoke_task = tokio::spawn(async move {
            revoke(&revoke_pool, &revoke_scope, &Actor::Owner, grant.grant_id).await
        });
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let waiting: bool = client.query_one("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted)", &[]).await.unwrap().get(0);
            if waiting {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "revocation never waited on terminal lock"
            );
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(!revoke_task.is_finished());
        tx.rollback().await.unwrap();
        revoke_task.await.unwrap().unwrap();
        let tx = conn.transaction().await.unwrap();
        assert_eq!(
            load(&tx, &identity).await.unwrap_err().1["detail"],
            "automation_grant_revoked"
        );
        assert_eq!(inspect(&tx, &identity).await.unwrap().status, "revoked");
        tx.rollback().await.unwrap();
        assert!(
            resolve_credential(&pool, &scope.workspace_id, &token_hash)
                .await
                .is_ok(),
            "receipt authentication survives revoke"
        );
        assert!(
            revoke(&pool, &scope, &not_owner, grant.grant_id)
                .await
                .is_err()
        );
        let mut expiring_policy = policy.clone();
        expiring_policy.expires_at = Utc::now() + chrono::Duration::milliseconds(200);
        let expiring_hash = sha256(b"separate expiring fixture credential");
        create_grant(
            &pool,
            &scope,
            &Actor::Owner,
            expiring_policy,
            &expiring_hash,
        )
        .await
        .unwrap();
        let expiring_identity = resolve_credential(&pool, &scope.workspace_id, &expiring_hash)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        let tx = conn.transaction().await.unwrap();
        assert_eq!(
            load(&tx, &expiring_identity).await.unwrap_err().1["detail"],
            "automation_grant_expired"
        );
        assert!(inspect(&tx, &expiring_identity).await.is_ok());
        let wrong_identity = AutomationIdentity {
            workspace_id: expiring_identity.workspace_id.clone(),
            grant_id: expiring_identity.grant_id,
            credential_id: Uuid::new_v4(),
            token_sha256: expiring_identity.token_sha256.clone(),
        };
        assert!(inspect(&tx, &wrong_identity).await.is_err());
        tx.rollback().await.unwrap();
        drop(conn);
        pool.close();
        drop(client);
        connection_task.await.unwrap().unwrap();
    }
}
