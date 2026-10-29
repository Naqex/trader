//! Canonical Prop state and retry receipts commit atomically in PostgreSQL.
use crate::{
    auth::{ApiError, Workspace},
    prop_core,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{MatchedPath, OriginalUri, Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use bigdecimal::BigDecimal;
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use std::{collections::HashMap, str::FromStr, sync::Arc};
use tokio_postgres::Transaction;

pub const WRITE_ROUTES: &[(&str, &str, &str)] = &[
    ("POST", "/api/v2/prop/sessions", "create_prop_session"),
    (
        "POST",
        "/api/v2/prop/session-bundles",
        "create_prop_session_bundle",
    ),
    (
        "PUT",
        "/api/v2/prop/sessions/{session_id}",
        "update_prop_session",
    ),
    (
        "POST",
        "/api/v2/prop/sessions/{session_id}/attempts",
        "create_prop_attempt",
    ),
    (
        "POST",
        "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/transitions",
        "transition_prop_attempt",
    ),
    (
        "PUT",
        "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/resume",
        "save_prop_resume",
    ),
];
pub fn native(method: &str, path: &str) -> bool {
    WRITE_ROUTES
        .iter()
        .any(|(m, p, _)| *m == method && *p == path)
        || method == "GET"
            && matches!(
                path,
                "/api/v2/prop/reports"
                    | "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report"
                    | "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report.csv"
            )
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/prop/sessions", post(write))
        .route("/api/v2/prop/session-bundles", post(write))
        .route("/api/v2/prop/sessions/{session_id}", put(write))
        .route("/api/v2/prop/sessions/{session_id}/attempts", post(write))
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/transitions",
            post(write),
        )
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/resume",
            put(write),
        )
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report",
            get(read),
        )
        .route(
            "/api/v2/prop/sessions/{session_id}/attempts/{attempt_id}/report.csv",
            get(read),
        )
        .route("/api/v2/prop/reports", get(read))
}
fn conflict(s: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, s)
}
fn invalid(s: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, s)
}
fn not_found(s: &str) -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, s)
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn n(v: &Value, k: &str) -> i64 {
    v[k].as_i64().unwrap_or(0)
}
fn decimal(v: &Value, k: &str) -> Result<BigDecimal, ApiError> {
    let raw = v[k]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v[k].to_string());
    if raw.len() > 512 {
        return Err(invalid(&format!("{k} exceeds supported decimal bounds")));
    }
    let value = BigDecimal::from_str(&raw).map_err(|_| invalid(&format!("{k} must be decimal")))?;
    if value.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err(invalid(&format!("{k} exceeds supported decimal bounds")));
    }
    Ok(value)
}
fn time(v: &Value, k: &str) -> Result<chrono::DateTime<Utc>, ApiError> {
    chrono::DateTime::parse_from_rfc3339(s(v, k))
        .map(|x| x.with_timezone(&Utc))
        .map_err(|_| invalid(&format!("{k} must be timezone-aware")))
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}
fn terminal(v: &Value) -> bool {
    matches!(
        s(v, "status"),
        "completed_pass" | "failed_breach" | "expired" | "abandoned"
    )
}
fn scope_check(workspace: &str, session: &str, values: &[&Value]) -> Result<(), ApiError> {
    for v in values {
        if s(v, "workspace_id") != workspace {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "prop_workspace_mismatch",
            ));
        }
        if s(v, "session_id") != session {
            return Err(invalid("prop_session_mismatch"));
        }
    }
    Ok(())
}
fn semantic_equal(a: &Value, b: &Value) -> bool {
    if a == b {
        return true;
    }
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|w| semantic_equal(v, w)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(v, w)| semantic_equal(v, w))
        }
        (Value::String(a), Value::String(b)) => {
            if a.len() <= 512 && b.len() <= 512 {
                if let (Ok(a), Ok(b)) = (BigDecimal::from_str(a), BigDecimal::from_str(b)) {
                    if a.as_bigint_and_exponent().1.unsigned_abs() <= 512
                        && b.as_bigint_and_exponent().1.unsigned_abs() <= 512
                    {
                        return a == b;
                    }
                }
            }
            if let (Ok(a), Ok(b)) = (
                chrono::DateTime::parse_from_rfc3339(a),
                chrono::DateTime::parse_from_rfc3339(b),
            ) {
                return a == b;
            }
            false
        }
        _ => false,
    }
}
fn validate_bundle(
    session: &Value,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
) -> Result<(), ApiError> {
    prop_core::validate_profile_snapshot(&session["profile"]).map_err(|e| conflict(&e))?;
    prop_core::validate_attempt_snapshot(attempt).map_err(|e| conflict(&e))?;
    prop_core::validate_phase_snapshot(phase).map_err(|e| conflict(&e))?;
    prop_core::validate_attempt_against_session(session, attempt).map_err(|e| conflict(&e))?;
    for k in ["workspace_id", "session_id", "attempt_id"] {
        if phase[k] != attempt[k] {
            return Err(conflict("phase state scope does not match attempt"));
        }
    }
    if phase["profile_hash"] != attempt["profile_hash"] {
        return Err(conflict("phase state profile version mismatch"));
    }
    let index = n(phase, "phase_index");
    let spec = session["profile"]["phases"]
        .as_array()
        .and_then(|a| a.get(index.wrapping_sub(1) as usize))
        .ok_or_else(|| conflict("phase state references an unknown frozen phase"))?;
    if decimal(phase, "initial_balance")? != decimal(spec, "initial_capital")? {
        return Err(conflict(
            "phase initial balance does not match frozen phase capital",
        ));
    }
    let dd = &spec["overall_drawdown"];
    let eod = dd["kind"] == "trailing" && dd["trailing_granularity"] == "end_of_day";
    let basis = if dd["kind"] == "trailing" && dd["basis"] == "balance" {
        "balance"
    } else {
        "equity"
    };
    if !eod && decimal(phase, "high_water_mark")? < decimal(phase, basis)? {
        return Err(conflict("high_water_mark cannot be below current equity"));
    }
    let t = time(phase, "virtual_time_utc")?;
    if t < time(attempt, "virtual_start_utc")? || t > time(attempt, "virtual_cutoff_utc")? {
        return Err(conflict(
            "phase virtual time is outside the attempt interval",
        ));
    }
    for key in ["open_positions", "pending_orders"] {
        let count = n(phase, key);
        let v = &resume[key];
        let len = if let Some(a) = v.as_array() {
            Some(a.len())
        } else {
            v.as_object().map(|o| o.len())
        };
        if v.is_null() && count > 0 {
            return Err(conflict(&format!(
                "resume {key} are required when the phase has {}",
                key.replace('_', " ")
            )));
        }
        if !v.is_null() && len.is_none() {
            return Err(conflict(&format!("resume {key} must be a collection")));
        }
        if len.is_some_and(|x| x as i64 != count) {
            return Err(conflict(&format!(
                "resume {key} do not match the phase snapshot count"
            )));
        }
    }
    Ok(())
}
fn cursor_check(current: &Value, previous: &Value) -> Result<(), ApiError> {
    let cursor = &current["cursor"];
    if !cursor.is_object() {
        return Err(conflict("resume cursor is required and must be structured"));
    }
    let index = cursor["bar_index"]
        .as_i64()
        .filter(|v| *v >= 0)
        .ok_or_else(|| conflict("resume cursor bar_index must be a nonnegative integer"))?;
    let timestamp = time(cursor, "timestamp_utc")
        .map_err(|_| conflict("resume cursor timestamp_utc must be timezone-aware"))?;
    if previous["cursor"].is_object()
        && (index < n(&previous["cursor"], "bar_index")
            || timestamp < time(&previous["cursor"], "timestamp_utc")?)
    {
        return Err(conflict(
            "resume cursor cannot move backwards within an attempt",
        ));
    }
    Ok(())
}
pub async fn load_session(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    lock: bool,
) -> Result<Value, ApiError> {
    let sql = if lock {
        "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=$1 AND session_id=$2 FOR UPDATE"
    } else {
        "SELECT snapshot_json FROM prop_sessions WHERE workspace_id=$1 AND session_id=$2"
    };
    let row = tx
        .query_opt(sql, &[&workspace, &id])
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| not_found("prop_session_not_found"))?;
    let value = crate::catalog::validated_prop(
        row.get(0),
        crate::catalog::PropKind::Session,
        workspace,
        id,
        None,
    )?;
    Ok(value)
}
pub async fn load_attempt(
    tx: &Transaction<'_>,
    workspace: &str,
    session: &str,
    attempt: &str,
    lock: bool,
) -> Result<Value, ApiError> {
    let session_value = load_session(tx, workspace, session, lock).await?;
    let sql = if lock {
        "SELECT snapshot_json,phase_json,resume_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 FOR UPDATE"
    } else {
        "SELECT snapshot_json,phase_json,resume_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3"
    };
    let row = tx
        .query_opt(sql, &[&workspace, &session, &attempt])
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| not_found("prop_attempt_not_found"))?;
    stored_attempt_bundle(
        workspace,
        session,
        attempt,
        session_value,
        row.get(0),
        row.get(1),
        row.get(2),
    )
}
fn stored_attempt_bundle(
    workspace: &str,
    session: &str,
    attempt: &str,
    session_value: Value,
    attempt_value: Value,
    phase_value: Value,
    r: Value,
) -> Result<Value, ApiError> {
    let session_value = crate::catalog::validated_prop(
        session_value,
        crate::catalog::PropKind::Session,
        workspace,
        session,
        None,
    )?;
    let a = crate::catalog::validated_prop(
        attempt_value,
        crate::catalog::PropKind::Attempt,
        workspace,
        session,
        Some(attempt),
    )?;
    let p = crate::catalog::validated_prop(
        phase_value,
        crate::catalog::PropKind::Phase,
        workspace,
        session,
        Some(attempt),
    )?;
    scope_check(workspace, session, &[&a, &p])?;
    if a["attempt_id"] != attempt || p["attempt_id"] != attempt {
        return Err(conflict("stored prop attempt scope mismatch"));
    }
    if session_value["profile"]["profile_hash"] != a["profile_hash"]
        || a["profile_hash"] != p["profile_hash"]
    {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "prop_snapshot_untrusted",
        ));
    }
    Ok(json!({"session":session_value,"attempt":a,"phase":p,"resume_state":r}))
}
pub async fn lock_dependencies(
    tx: &Transaction<'_>,
    workspace: &str,
    data: Option<&str>,
    resume: &Value,
) -> Result<(), ApiError> {
    if let Some(data) = data {
        let checksum = data.strip_prefix("sha256:").unwrap_or(data);
        let rows=tx.query("SELECT dataset_id FROM datasets WHERE workspace_id=$1 AND (dataset_id=$2 OR artifact_sha256=$3) ORDER BY dataset_id FOR KEY SHARE",&[&workspace,&data,&checksum]).await.map_err(|_|ApiError::database())?;
        if rows.is_empty()
            && checksum.len() == 64
            && checksum
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(not_found("dataset_not_found"));
        }
    }
    let binding = &resume["replay_binding"];
    if let Some(id) = binding["replay_session_id"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        let row=tx.query_opt("SELECT v.deleted,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND r.record_id=$2 FOR UPDATE OF r",&[&workspace,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(||not_found("replay_not_found"))?;
        if row.get::<_, bool>(0) {
            return Err(not_found("replay_not_found"));
        }
        let mut payload: Value = row.get(1);
        if payload["asset_states"].is_object() {
            if payload["portfolio_execution"].is_null() {
                if payload["asset_states"]
                    .as_object()
                    .unwrap()
                    .values()
                    .any(|asset| {
                        asset["execution"]["ledger"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .any(|event| {
                                matches!(
                                    event["kind"].as_str(),
                                    Some(
                                        "market_fill"
                                            | "manual_close"
                                            | "protective_fill"
                                            | "phase_transition"
                                    )
                                )
                            })
                    })
                {
                    return Err(conflict(
                        "Legacy Prop portfolio lacks a canonical account ledger; create a new session. Existing history is preserved.",
                    ));
                }
                let mut pins = Vec::new();
                for dataset in payload["asset_states"].as_object().unwrap().keys() {
                    let row=tx.query_opt("SELECT artifact_sha256 FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR KEY SHARE",&[&workspace,&dataset]).await.map_err(|_|ApiError::database())?.ok_or_else(||not_found("dataset_not_found"))?;
                    pins.push(
                        json!({"dataset_id":dataset,"dataset_sha256":row.get::<_,String>(0)}),
                    );
                }
                crate::replay_portfolio::initialize(&mut payload, id, pins)
                    .map_err(|e| conflict(&e))?;
                crate::replay_portfolio::update(&mut payload).map_err(|e| conflict(&e))?;
            }
            let portfolio = &payload["portfolio_execution"];
            if binding["dataset_pins"] != portfolio["dataset_pins"]
                || binding["dataset_sha256"] != portfolio["dataset_sha256"]
            {
                return Err(conflict(
                    "Prop portfolio binding does not match immutable replay pins",
                ));
            }
            for pin in portfolio["dataset_pins"]
                .as_array()
                .ok_or_else(|| conflict("portfolio dataset pins are missing"))?
            {
                let dataset = s(pin, "dataset_id");
                let row=tx.query_opt("SELECT artifact_sha256 FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR KEY SHARE",&[&workspace,&dataset]).await.map_err(|_|ApiError::database())?.ok_or_else(||not_found("dataset_not_found"))?;
                if json!(row.get::<_, String>(0)) != pin["dataset_sha256"] {
                    return Err(conflict("portfolio dataset sha256 changed"));
                }
            }
        }
    }
    Ok(())
}
async fn save_session(tx: &Transaction<'_>, session: &Value, now: &str) -> Result<(), ApiError> {
    let workspace = s(session, "workspace_id");
    let id = s(session, "session_id");
    let rev = n(session, "revision") as i32;
    tx.execute("INSERT INTO prop_session_revisions(workspace_id,session_id,revision,snapshot_json,created_at_utc) VALUES($1,$2,$3,$4,$5)",&[&workspace,&id,&rev,session,&now]).await.map_err(|_|ApiError::database())?;
    tx.execute("UPDATE prop_sessions SET current_revision=$3,snapshot_json=$4,updated_at_utc=$5 WHERE workspace_id=$1 AND session_id=$2",&[&workspace,&id,&rev,session,&now]).await.map_err(|_|ApiError::database())?;
    Ok(())
}
async fn sync_status(
    tx: &Transaction<'_>,
    session: &Value,
    status: &Value,
    now: &str,
) -> Result<Value, ApiError> {
    let mut session = session.clone();
    if &session["status"] != status {
        session["status"] = status.clone();
        session["revision"] = json!(n(&session, "revision") + 1);
        save_session(tx, &session, now).await?;
    }
    Ok(session)
}
pub async fn persist_result(
    tx: &Transaction<'_>,
    current: &Value,
    result: &Value,
    operation_id: &str,
    fingerprint: &str,
) -> Result<Value, ApiError> {
    let attempt = &result["attempt"];
    let phase = &result["phase"];
    let resume = &result["resume_state"];
    validate_bundle(&current["session"], attempt, phase, resume)?;
    cursor_check(resume, &current["resume_state"])?;
    let workspace = s(attempt, "workspace_id");
    let session = s(attempt, "session_id");
    let id = s(attempt, "attempt_id");
    let rev = n(attempt, "revision") as i32;
    let now = now();
    tx.execute("INSERT INTO prop_attempt_revisions(workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",&[&workspace,&session,&id,&rev,attempt,phase,resume,&now]).await.map_err(|_|ApiError::database())?;
    tx.execute("UPDATE prop_attempts SET current_revision=$4,snapshot_json=$5,phase_json=$6,resume_json=$7,updated_at_utc=$8 WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3",&[&workspace,&session,&id,&rev,attempt,phase,resume,&now]).await.map_err(|_|ApiError::database())?;
    let session = sync_status(tx, &current["session"], &attempt["status"], &now).await?;
    tx.execute("INSERT INTO prop_mutation_receipts(workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc) VALUES($1,$2,$3,$4,$5,$6,$7)",&[&workspace,&s(attempt,"session_id"),&id,&operation_id,&fingerprint,&rev,&now]).await.map_err(|_|ApiError::database())?;
    let mut out = result.clone();
    out.as_object_mut().unwrap().remove("intent_fingerprint");
    out["session"] = session;
    out["duplicate"] = json!(false);
    Ok(out)
}
pub async fn mutation_receipt(
    tx: &Transaction<'_>,
    workspace: &str,
    session: &str,
    attempt: &str,
    operation: &str,
    fingerprint: &str,
) -> Result<Option<i32>, ApiError> {
    let row=tx.query_opt("SELECT fingerprint,entity_revision FROM prop_mutation_receipts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND operation_id=$4",&[&workspace,&session,&attempt,&operation]).await.map_err(|_|ApiError::database())?;
    if let Some(row) = row {
        if row.get::<_, String>(0) != fingerprint {
            return Err(conflict("prop_idempotency_conflict"));
        }
        return Ok(Some(row.get(1)));
    }
    Ok(None)
}
pub async fn apply_lifecycle_event(
    tx: &Transaction<'_>,
    workspace: &str,
    event: &Value,
    supplied: Option<&Value>,
) -> Result<Value, ApiError> {
    if let Some(resume) = supplied {
        lock_dependencies(tx, workspace, None, resume).await?;
    }
    let current = load_attempt(
        tx,
        workspace,
        s(event, "session_id"),
        s(event, "attempt_id"),
        true,
    )
    .await?;
    let fingerprint =
        prop_core::intent_fingerprint(&json!({"event":event,"resume_state":supplied}))
            .map_err(|e| invalid(&e))?;
    if let Some(rev) = mutation_receipt(
        tx,
        workspace,
        s(event, "session_id"),
        s(event, "attempt_id"),
        s(event, "operation_id"),
        &fingerprint,
    )
    .await?
    {
        let row=tx.query_opt("SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND revision=$4",&[&workspace,&s(event,"session_id"),&s(event,"attempt_id"),&rev]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("idempotency receipt points to a missing attempt revision"))?;
        let receipt=tx.query_one("SELECT created_at_utc FROM prop_mutation_receipts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND operation_id=$4",&[&workspace,&s(event,"session_id"),&s(event,"attempt_id"),&s(event,"operation_id")]).await.map_err(|_|ApiError::database())?;
        let created: String = receipt.get(0);
        let historical=tx.query_opt("SELECT snapshot_json FROM prop_session_revisions WHERE workspace_id=$1 AND session_id=$2 AND created_at_utc<=$3 ORDER BY created_at_utc DESC,revision DESC LIMIT 1",&[&workspace,&s(event,"session_id"),&created]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("idempotency receipt points before prop session history"))?;
        let session: Value = historical.get(0);
        let a: Value = row.get(0);
        let p: Value = row.get(1);
        let r: Value = row.get(2);
        if session["status"] != a["status"] {
            return Err(conflict(
                "historical prop session and attempt lifecycle status diverged",
            ));
        }
        return Ok(
            json!({"session":session,"attempt":a,"phase":p,"resume_state":r,"objectives":r["prop_lifecycle"]["last_objectives"],"duplicate":true}),
        );
    }
    if current["session"]["status"] != current["attempt"]["status"] {
        return Err(conflict(
            "prop session and attempt lifecycle status diverged",
        ));
    }
    let mut resume = if event["evaluation_quality"] == "full_for_declared_model"
        || supplied.is_some_and(|resume| {
            resume["replay_binding"]["schema_version"] == "replay-portfolio-binding-v1"
        }) {
        supplied.unwrap_or(&current["resume_state"]).clone()
    } else {
        current["resume_state"].clone()
    };
    if current["resume_state"].get("prop_lifecycle").is_some() {
        resume["prop_lifecycle"] = current["resume_state"]["prop_lifecycle"].clone();
    }
    let result = prop_core::evaluate_prop_lifecycle_event(
        &current["session"],
        &current["attempt"],
        &current["phase"],
        event,
        &resume,
    )
    .map_err(|e| conflict(&e))?;
    persist_result(
        tx,
        &current,
        &result,
        s(event, "operation_id"),
        &fingerprint,
    )
    .await
}

async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    method: Method,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    path: Option<Path<HashMap<String, String>>>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(raw) = body.map_err(|e| invalid(&e.body_text()))?;
    let handler = WRITE_ROUTES
        .iter()
        .find(|(m, p, _)| *m == method.as_str() && *p == matched.as_str())
        .map(|t| t.2)
        .ok_or_else(|| invalid("prop_contract_missing"))?;
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let mutation = match crate::native_mutation::begin(
        &tx,
        &scope,
        method.as_str(),
        uri.path(),
        uri.query(),
        &headers,
        &raw,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(r) => return Ok(r),
        crate::native_mutation::MutationStart::New(m) => m,
    };
    tx.batch_execute("SAVEPOINT prop_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let p = path.map(|p| p.0).unwrap_or_default();
    let outcome = match crate::native_contracts::validate_body(handler, raw) {
        Ok(body) => execute(&tx, &scope, handler, &p, body).await,
        Err(e) => Err(e),
    };
    let (status, value) = match outcome {
        Ok(v) => v,
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT prop_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = crate::native_mutation::finish(&tx, mutation, status, value).await?;
    crate::native_mutation::commit(tx, response).await
}
pub async fn create_session(tx: &Transaction<'_>, value: &Value) -> Result<Value, ApiError> {
    prop_core::validate_profile_snapshot(&value["profile"]).map_err(|e| invalid(&e))?;
    if n(value, "revision") != 1 {
        return Err(conflict("new prop sessions must start at revision 1"));
    }
    let workspace = s(value, "workspace_id");
    let id = s(value, "session_id");
    let now = now();
    let inserted=tx.execute("INSERT INTO prop_sessions(workspace_id,session_id,current_revision,snapshot_json,created_at_utc,updated_at_utc) VALUES($1,$2,1,$3,$4,$4) ON CONFLICT(workspace_id,session_id) DO NOTHING",&[&workspace,&id,value,&now]).await.map_err(|_|ApiError::database())?;
    if inserted == 0 {
        let current = load_session(tx, workspace, id, true).await?;
        if semantic_equal(&current, value) {
            return Ok(current);
        }
        return Err(conflict(
            "prop session already exists with different content",
        ));
    }
    tx.execute("INSERT INTO prop_session_revisions(workspace_id,session_id,revision,snapshot_json,created_at_utc) VALUES($1,$2,1,$3,$4)",&[&workspace,&id,value,&now]).await.map_err(|_|ApiError::database())?;
    Ok(value.clone())
}
pub async fn create_attempt(
    tx: &Transaction<'_>,
    session: &Value,
    attempt: &Value,
    phase: &Value,
    resume: &Value,
) -> Result<Value, ApiError> {
    validate_bundle(session, attempt, phase, resume)?;
    if n(attempt, "revision") != 1 {
        return Err(conflict("new prop attempts must start at revision 1"));
    }
    if attempt["branch_kind"] != "clean" {
        return Err(conflict(
            "hindsight prop attempts require canonical Replay branch binding",
        ));
    }
    let workspace = s(attempt, "workspace_id");
    let sid = s(attempt, "session_id");
    let id = s(attempt, "attempt_id");
    let rows=tx.query("SELECT attempt_id,snapshot_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 FOR UPDATE",&[&workspace,&sid]).await.map_err(|_|ApiError::database())?;
    for row in rows {
        let a: Value = row.get(1);
        if row.get::<_, String>(0) != id && !terminal(&a) {
            return Err(conflict("prop session already has an active attempt"));
        }
    }
    if let Some(parent) = attempt["parent_attempt_id"]
        .as_str()
        .filter(|v| !v.is_empty())
    {
        let row=tx.query_opt("SELECT snapshot_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3",&[&workspace,&sid,&parent]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("parent prop attempt does not exist in this session"))?;
        if !terminal(&row.get::<_, Value>(0)) {
            return Err(conflict(
                "parent prop attempt must be terminal before restart",
            ));
        }
    }
    let now = now();
    let inserted=tx.execute("INSERT INTO prop_attempts(workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,resume_json,created_at_utc,updated_at_utc) VALUES($1,$2,$3,1,$4,$5,$6,$7,$7) ON CONFLICT(workspace_id,session_id,attempt_id) DO NOTHING",&[&workspace,&sid,&id,attempt,phase,resume,&now]).await.map_err(|_|ApiError::database())?;
    if inserted == 0 {
        let mut current = load_attempt(tx, workspace, sid, id, true).await?;
        if !semantic_equal(&current["attempt"], attempt)
            || !semantic_equal(&current["phase"], phase)
            || current["resume_state"] != *resume
        {
            return Err(conflict(
                "prop attempt already exists with different content",
            ));
        }
        if current["session"]["status"] != current["attempt"]["status"] {
            return Err(conflict(
                "prop session and attempt lifecycle status diverged",
            ));
        }
        current["duplicate"] = json!(true);
        return Ok(current);
    }
    tx.execute("INSERT INTO prop_attempt_revisions(workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc) VALUES($1,$2,$3,1,$4,$5,$6,$7)",&[&workspace,&sid,&id,attempt,phase,resume,&now]).await.map_err(|_|ApiError::database())?;
    let session = sync_status(tx, session, &attempt["status"], &now).await?;
    Ok(
        json!({"session":session,"attempt":attempt,"phase":phase,"resume_state":resume,"duplicate":false}),
    )
}
async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    handler: &str,
    path: &HashMap<String, String>,
    body: Value,
) -> Result<(StatusCode, Value), ApiError> {
    let workspace = scope.workspace_id.as_str();
    let sid = path.get("session_id").map(String::as_str).unwrap_or("");
    let aid = path.get("attempt_id").map(String::as_str).unwrap_or("");
    match handler {
        "create_prop_session" => {
            scope_check(workspace, s(&body, "session_id"), &[&body])?;
            Ok((StatusCode::CREATED, create_session(tx, &body).await?))
        }
        "create_prop_session_bundle" | "create_prop_attempt" => {
            let a = &body["attempt"];
            let p = &body["phase"];
            let r = &body["resume_state"];
            let sid = if handler == "create_prop_session_bundle" {
                s(&body["session"], "session_id")
            } else {
                sid
            };
            scope_check(workspace, sid, &[a, p])?;
            lock_dependencies(tx, workspace, Some(s(a, "data_version")), r).await?;
            let session = if handler == "create_prop_session_bundle" {
                scope_check(workspace, sid, &[&body["session"]])?;
                if body["session"]["status"] != a["status"] {
                    return Err(conflict(
                        "prop session and attempt lifecycle status must match",
                    ));
                }
                create_session(tx, &body["session"]).await?
            } else {
                load_session(tx, workspace, sid, true).await?
            };
            let out = create_attempt(tx, &session, a, p, r).await?;
            Ok((StatusCode::CREATED, out))
        }
        "update_prop_session" => {
            let value = &body["session"];
            scope_check(workspace, sid, &[value])?;
            prop_core::validate_profile_snapshot(&value["profile"]).map_err(|e| invalid(&e))?;
            let current = load_session(tx, workspace, sid, true).await?;
            let fingerprint = prop_core::intent_fingerprint(value).map_err(|e| invalid(&e))?;
            if let Some(rev) = mutation_receipt(
                tx,
                workspace,
                sid,
                "",
                s(&body, "operation_id"),
                &fingerprint,
            )
            .await?
            {
                let row=tx.query_opt("SELECT snapshot_json FROM prop_session_revisions WHERE workspace_id=$1 AND session_id=$2 AND revision=$3",&[&workspace,&sid,&rev]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("idempotency receipt points to a missing session revision"))?;
                return Ok((
                    StatusCode::OK,
                    json!({"session":row.get::<_,Value>(0),"duplicate":true}),
                ));
            }
            if current["revision"] != body["expected_revision"] {
                return Err(conflict("prop session revision conflict"));
            }
            if n(value, "revision") != n(&body, "expected_revision") + 1 {
                return Err(conflict(
                    "prop session snapshot revision must advance exactly once",
                ));
            }
            if value["mode"] != current["mode"] || value["session_type"] != current["session_type"]
            {
                return Err(conflict("prop session mode and type are immutable"));
            }
            if !semantic_equal(&value["profile"], &current["profile"]) {
                return Err(conflict(
                    "frozen prop profile cannot be changed after session creation",
                ));
            }
            if value["status"] != current["status"] {
                return Err(conflict("prop session lifecycle status is server-owned"));
            }
            let now = now();
            save_session(tx, value, &now).await?;
            let rev = n(value, "revision") as i32;
            tx.execute("INSERT INTO prop_mutation_receipts(workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc) VALUES($1,$2,'',$3,$4,$5,$6)",&[&workspace,&sid,&s(&body,"operation_id"),&fingerprint,&rev,&now]).await.map_err(|_|ApiError::database())?;
            Ok((StatusCode::OK, json!({"session":value,"duplicate":false})))
        }
        "transition_prop_attempt" => {
            scope_check(workspace, sid, &[&body])?;
            if body["attempt_id"] != aid {
                return Err(invalid("prop_attempt_mismatch"));
            }
            // Replay rows must be locked before Prop rows to match feed/delete lock order.
            let preview = load_attempt(tx, workspace, sid, aid, false).await?;
            lock_dependencies(tx, workspace, None, &preview["resume_state"]).await?;
            let current = load_attempt(tx, workspace, sid, aid, true).await?;
            let fingerprint = prop_core::intent_fingerprint(&body).map_err(|e| invalid(&e))?;
            if body["action"] == "next_phase"
                && current["resume_state"]["replay_binding"].is_object()
            {
                let out =
                    crate::replay_service::handle_bound_next_phase(tx, workspace, &body, &current)
                        .await?;
                return Ok((StatusCode::OK, out));
            }
            if let Some(rev) =
                mutation_receipt(tx, workspace, sid, aid, s(&body, "intent_id"), &fingerprint)
                    .await?
            {
                let exists=tx.query_opt("SELECT 1 FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND revision=$4",&[&workspace,&sid,&aid,&rev]).await.map_err(|_|ApiError::database())?;
                if exists.is_none() {
                    return Err(conflict(
                        "idempotency receipt points to a missing attempt revision",
                    ));
                }
                let mut out = current;
                out["duplicate"] = json!(true);
                return Ok((StatusCode::OK, out));
            }
            if current["session"]["status"] != current["attempt"]["status"] {
                return Err(conflict(
                    "prop session and attempt lifecycle status diverged",
                ));
            }
            validate_bundle(
                &current["session"],
                &current["attempt"],
                &current["phase"],
                &current["resume_state"],
            )?;
            let result = prop_core::apply_prop_lifecycle_command(
                &current["session"],
                &current["attempt"],
                &current["phase"],
                &body,
                &current["resume_state"],
                false,
            )
            .map_err(|e| conflict(&e))?;
            Ok((
                StatusCode::OK,
                persist_result(tx, &current, &result, s(&body, "intent_id"), &fingerprint).await?,
            ))
        }
        "save_prop_resume" => {
            let a = &body["attempt"];
            let p = &body["phase"];
            let r = &body["resume_state"];
            scope_check(workspace, sid, &[a, p])?;
            if a["attempt_id"] != aid || p["attempt_id"] != aid {
                return Err(invalid("prop_attempt_mismatch"));
            }
            lock_dependencies(tx, workspace, None, r).await?;
            let current = load_attempt(tx, workspace, sid, aid, true).await?;
            let fingerprint =
                prop_core::intent_fingerprint(&json!({"attempt":a,"phase":p,"resume_state":r}))
                    .map_err(|e| invalid(&e))?;
            if let Some(rev) = mutation_receipt(
                tx,
                workspace,
                sid,
                aid,
                s(&body, "operation_id"),
                &fingerprint,
            )
            .await?
            {
                let row=tx.query_opt("SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND revision=$4",&[&workspace,&sid,&aid,&rev]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("idempotency receipt points to a missing attempt revision"))?;
                return Ok((
                    StatusCode::OK,
                    json!({"attempt":row.get::<_,Value>(0),"phase":row.get::<_,Value>(1),"resume_state":row.get::<_,Value>(2),"duplicate":true}),
                ));
            }
            validate_bundle(&current["session"], a, p, r)?;
            cursor_check(r, &current["resume_state"])?;
            if current["attempt"]["revision"] != body["expected_revision"] {
                return Err(conflict("prop attempt revision conflict"));
            }
            if n(a, "revision") != n(&body, "expected_revision") + 1 {
                return Err(conflict(
                    "prop attempt snapshot revision must advance exactly once",
                ));
            }
            for k in [
                "workspace_id",
                "session_id",
                "attempt_id",
                "mode",
                "profile_id",
                "terms_version",
                "profile_hash",
                "data_version",
                "cost_version",
                "engine_version",
                "parent_attempt_id",
                "branch_kind",
                "virtual_start_utc",
                "virtual_cutoff_utc",
            ] {
                if !semantic_equal(&a[k], &current["attempt"][k]) {
                    return Err(conflict(
                        "immutable prop attempt identity/version fields cannot change",
                    ));
                }
            }
            if terminal(&current["attempt"]) {
                return Err(conflict("terminal prop attempts are immutable"));
            }
            if a["status"] != current["attempt"]["status"] {
                return Err(conflict("prop attempt lifecycle status is server-owned"));
            }
            if n(p, "last_event_sequence") < n(&current["phase"], "last_event_sequence") {
                return Err(conflict("prop event sequence cannot move backwards"));
            }
            if time(p, "virtual_time_utc")? < time(&current["phase"], "virtual_time_utc")? {
                return Err(conflict("prop virtual time cannot move backwards"));
            }
            if p["phase_index"] != current["phase"]["phase_index"] {
                return Err(conflict("prop phase index is server-owned"));
            }
            let mut out = persist_result(
                tx,
                &current,
                &json!({"attempt":a,"phase":p,"resume_state":r}),
                s(&body, "operation_id"),
                &fingerprint,
            )
            .await?;
            out.as_object_mut().unwrap().remove("session");
            Ok((StatusCode::OK, out))
        }
        _ => Err(invalid("prop_contract_missing")),
    }
}
async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    path: Option<Path<HashMap<String, String>>>,
) -> Result<Response, ApiError> {
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(|_| ApiError::database())?;
    let workspace = scope.workspace_id.as_str();
    let p = path.map(|p| p.0).unwrap_or_default();
    let sid = p.get("session_id").map(String::as_str).unwrap_or("");
    let aid = p.get("attempt_id").map(String::as_str).unwrap_or("");
    let path = matched.as_str();
    let result = if path == "/api/v2/prop/sessions" {
        let rows=tx.query("SELECT snapshot_json FROM prop_sessions WHERE workspace_id=$1 ORDER BY updated_at_utc DESC,session_id",&[&workspace]).await.map_err(|_|ApiError::database())?;
        json!({"items":rows.iter().map(|r|r.get::<_,Value>(0)).collect::<Vec<_>>()})
    } else if path == "/api/v2/prop/reports" {
        let query: HashMap<String, String> =
            form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
                .into_owned()
                .collect();
        let status = query.get("status");
        let branch = query.get("branch_kind");
        if status.is_some_and(|s| {
            ![
                "ready",
                "running",
                "paused",
                "phase_passed",
                "next_phase_ready",
                "completed_pass",
                "failed_breach",
                "expired",
                "abandoned",
            ]
            .contains(&s.as_str())
        }) || branch.is_some_and(|b| !["clean", "hindsight_exploratory"].contains(&b.as_str()))
        {
            return Err(invalid("invalid prop report filter"));
        }
        let rows=tx.query("SELECT s.snapshot_json,a.snapshot_json,a.phase_json,a.resume_json,s.session_id,a.attempt_id FROM prop_sessions s JOIN prop_attempts a ON a.workspace_id=s.workspace_id AND a.session_id=s.session_id WHERE s.workspace_id=$1 ORDER BY s.updated_at_utc DESC,s.session_id,a.updated_at_utc DESC,a.attempt_id",&[&workspace]).await.map_err(|_|ApiError::database())?;
        let mut reports = vec![];
        for row in rows {
            let current = stored_attempt_bundle(
                workspace,
                row.get::<_, &str>(4),
                row.get::<_, &str>(5),
                row.get(0),
                row.get(1),
                row.get(2),
                row.get(3),
            )?;
            let a = &current["attempt"];
            if status.is_some_and(|v| a["status"] != v.as_str())
                || branch.is_some_and(|v| a["branch_kind"] != v.as_str())
            {
                continue;
            }
            reports.push(
                prop_core::report::build_prop_attempt_report(
                    &current["session"],
                    a,
                    &current["phase"],
                    &current["resume_state"],
                )
                .map_err(|e| invalid(&e))?,
            )
        }
        json!({"schema_version":"prop-report-list-v1","filters":{"status":status,"branch_kind":branch},"count":reports.len(),"items":reports,"broker_execution_capability":false})
    } else if aid.is_empty() {
        let session = load_session(&tx, workspace, sid, false).await?;
        if path.ends_with("/attempts") {
            let rows=tx.query("SELECT snapshot_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 ORDER BY updated_at_utc DESC,attempt_id",&[&workspace,&sid]).await.map_err(|_|ApiError::database())?;
            json!({"items":rows.iter().map(|r|r.get::<_,Value>(0)).collect::<Vec<_>>()})
        } else {
            session
        }
    } else {
        let current = load_attempt(&tx, workspace, sid, aid, false).await?;
        if path.ends_with("/report") || path.ends_with("/report.csv") {
            let report = prop_core::report::build_prop_attempt_report(
                &current["session"],
                &current["attempt"],
                &current["phase"],
                &current["resume_state"],
            )
            .map_err(|e| invalid(&e))?;
            if path.ends_with(".csv") {
                return Ok((
                    [
                        ("content-type", "text/csv; charset=utf-8"),
                        (
                            "content-disposition",
                            "attachment; filename=\"prop-attempt-report.csv\"",
                        ),
                    ],
                    prop_core::report::prop_attempt_report_csv(&report),
                )
                    .into_response());
            }
            report
        } else {
            current
        }
    };
    Ok(Json(result).into_response())
}
