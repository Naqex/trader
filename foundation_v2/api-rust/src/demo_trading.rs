//! Explicit opt-in DEMO execution. Investor connectors never grant trading authority.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/live/trading"),
    ("POST", "/api/v2/live/trading/preview"),
    ("POST", "/api/v2/live/trading/commands"),
    ("POST", "/api/v2/live/trading/reconcile"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(ROUTES[0].1, get(snapshot))
        .route(ROUTES[1].1, post(preview))
        .route(ROUTES[2].1, post(command))
        .route(ROUTES[3].1, post(reconcile))
}
fn error(status: StatusCode, reason: &str) -> ApiError {
    ApiError::detail(status, reason)
}
fn denied(reason: &str) -> ApiError {
    error(StatusCode::LOCKED, reason)
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn local_origin(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return Err(error(StatusCode::FORBIDDEN, "demo_origin_denied"));
    }
    if let Some(origin) = headers.get("origin") {
        let url = origin
            .to_str()
            .ok()
            .and_then(|s| reqwest::Url::parse(s).ok())
            .ok_or_else(|| error(StatusCode::FORBIDDEN, "demo_origin_denied"))?;
        if !matches!(url.scheme(), "http" | "https")
            || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            || !matches!(
                url.port_or_known_default(),
                Some(5180 | 5173 | 8010 | 5191 | 8021)
            )
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(error(StatusCode::FORBIDDEN, "demo_origin_denied"));
        }
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    enabled: bool,
    mode: String,
    workspace_id: String,
    terminal_path: PathBuf,
    login: String,
    server: String,
    symbols: Vec<String>,
    max_risk_amount: f64,
    max_risk_pct: f64,
    max_positions: u32,
    max_volume: f64,
    max_quote_age_ms: u64,
    deviation_points: u32,
    cost_buffer_per_lot: f64,
    magic: u32,
}
fn plain(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn no_links(path: &Path) -> bool {
    path.ancestors().all(|item| {
        std::fs::symlink_metadata(item).is_ok_and(|meta| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                !meta.file_type().is_symlink() && meta.file_attributes() & 0x400 == 0
            }
            #[cfg(not(windows))]
            {
                !meta.file_type().is_symlink()
            }
        })
    })
}
impl Policy {
    fn validate(&self, workspace: &str) -> Result<(), &'static str> {
        if !self.enabled || self.mode != "demo" || self.workspace_id != workspace {
            return Err("demo_policy_locked");
        }
        if self.login.is_empty()
            || self.login.len() > 18
            || self.login.starts_with('0')
            || !self.login.bytes().all(|b| b.is_ascii_digit())
            || !plain(&self.server, 160)
            || self.symbols.is_empty()
            || self.symbols.len() > 32
            || self.symbols.iter().any(|s| !plain(s, 64))
            || self
                .symbols
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.symbols.len()
        {
            return Err("demo_policy_invalid");
        }
        if [self.max_risk_amount, self.max_risk_pct, self.max_volume]
            .iter()
            .any(|v| !v.is_finite() || *v <= 0.0)
            || self.max_risk_pct > 100.0
            || !self.cost_buffer_per_lot.is_finite()
            || self.cost_buffer_per_lot < 0.0
            || !(1..=100).contains(&self.max_positions)
            || !(250..=5000).contains(&self.max_quote_age_ms)
            || self.deviation_points > 100
            || !(1..=2147483647).contains(&self.magic)
        {
            return Err("demo_policy_invalid");
        }
        if !self.terminal_path.is_absolute()
            || self
                .terminal_path
                .file_name()
                .and_then(|v| v.to_str())
                .is_none_or(|v| !v.eq_ignore_ascii_case("terminal64.exe"))
        {
            return Err("demo_terminal_invalid");
        }
        if !self.terminal_path.is_file() || !no_links(&self.terminal_path) {
            return Err("demo_terminal_missing");
        }
        let path = self
            .terminal_path
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if path.contains("/mt5-connectors/")
            || path == "c:/program files/metatrader 5/terminal64.exe"
            || std::env::var("TW_V2_MT5_TERMINAL")
                .ok()
                .is_some_and(|s| s.replace('\\', "/").eq_ignore_ascii_case(&path))
        {
            return Err("demo_terminal_not_dedicated");
        }
        Ok(())
    }
    fn terminal_key(&self) -> String {
        digest(
            std::fs::canonicalize(&self.terminal_path)
                .unwrap_or_else(|_| self.terminal_path.clone())
                .to_string_lossy()
                .replace('\\', "/")
                .to_lowercase()
                .as_bytes(),
        )
    }
}
async fn policy(scope: &Workspace) -> Result<Policy, &'static str> {
    let path = std::env::var_os("TW_V2_MT5_DEMO_POLICY")
        .map(PathBuf::from)
        .ok_or("demo_policy_locked")?;
    if !path.is_absolute() || !path.is_file() || !no_links(&path) {
        return Err("demo_policy_invalid");
    }
    if std::fs::metadata(&path)
        .map_err(|_| "demo_policy_invalid")?
        .len()
        > 16384
    {
        return Err("demo_policy_invalid");
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| "demo_policy_invalid")?;
    let p: Policy = serde_json::from_slice(&bytes).map_err(|_| "demo_policy_invalid")?;
    p.validate(&scope.workspace_id)?;
    Ok(p)
}
fn locked(reason: &str) -> Value {
    json!({"status":"locked","reason":reason,"mode":"demo","execution_enabled":false,"account":null,"symbols":[],"symbol":null,"timeframe":"M1","quote":null,"instrument":null,"bars":[],"positions":[],"orders":[],"policy":null,"requests":[]})
}
async fn control(state: &AppState, p: &Policy) -> Result<(bool, bool), ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let key = p.terminal_key();
    let row = conn.query_one("SELECT EXISTS(SELECT 1 FROM mt5_demo_controls WHERE terminal_key=$1 AND paused), EXISTS(SELECT 1 FROM mt5_demo_requests WHERE terminal_key=$1 AND (status='unknown' OR result->>'requires_reconciliation'='true'))", &[&key]).await.map_err(|_| ApiError::database())?;
    Ok((row.get(0), row.get(1)))
}
async fn gate(state: &AppState, p: &Policy, action: &str) -> Result<(), ApiError> {
    let (paused, unknown) = control(state, p).await?;
    if paused && !matches!(action, "close" | "cancel") {
        return Err(denied("demo_paused"));
    }
    if unknown {
        return Err(denied("demo_unresolved_request"));
    }
    Ok(())
}
async fn snapshot(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    local_origin(&headers)?;
    let p = match policy(&scope).await {
        Ok(p) => p,
        Err(reason) => return Ok(Json(locked(reason))),
    };
    if !state.native_runtime {
        return Ok(Json(locked("demo_native_runtime_required")));
    }
    let (paused, unknown) = control(&state, &p).await?;
    let timeframe = query.get("timeframe").map(String::as_str).unwrap_or("M1");
    if !matches!(timeframe, "M1" | "M5" | "M15" | "H1" | "H4" | "D1") {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_timeframe_unsupported",
        ));
    }
    let symbol = query.get("symbol").unwrap_or(&p.symbols[0]);
    if !p.symbols.contains(symbol) {
        return Err(error(StatusCode::FORBIDDEN, "demo_symbol_denied"));
    }
    let mut result = adapter_for(&state,&p,json!({"operation":"snapshot","workspace":scope.workspace_id,"policy":p,"symbol":symbol,"timeframe":timeframe})).await.unwrap_or_else(|reason| json!({"status":"unavailable","reason":reason}));
    if result["status"] != "ready" {
        let reason = result["reason"].as_str().unwrap_or("demo_unavailable");
        let mut value = locked(reason);
        value["status"] = json!("unavailable");
        return Ok(Json(value));
    }
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows = conn.query("SELECT result FROM mt5_demo_requests WHERE workspace_id=$1 AND terminal_key=$2 ORDER BY created_at DESC LIMIT 50", &[&scope.workspace_id,&p.terminal_key()]).await.map_err(|_|ApiError::database())?;
    result["requests"] = json!(
        rows.into_iter()
            .map(|row| row.get::<_, Value>(0))
            .collect::<Vec<_>>()
    );
    result["paused"] = json!(paused);
    if paused || unknown {
        result["execution_enabled"] = json!(false);
        result["reason"] = json!(if unknown {
            "demo_unresolved_request"
        } else {
            "demo_paused"
        });
    }
    result["capabilities"] = json!({"market":!paused&&!unknown,"limit":false,"stop":false,"close":!unknown,"cancel":!unknown,"protect":!paused&&!unknown});
    Ok(Json(result))
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_id: Option<Uuid>,
    mode: String,
    account_id: String,
    server: String,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    symbol: Option<String>,
    #[serde(default)]
    side: Option<String>,
    #[serde(default)]
    order_type: Option<String>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    entry_price: Option<f64>,
    #[serde(default)]
    stop_loss: Option<f64>,
    #[serde(default)]
    take_profit: Option<f64>,
    #[serde(default)]
    ticket: Option<u64>,
}
fn draft(headers: &HeaderMap, bytes: &[u8]) -> Result<Draft, ApiError> {
    local_origin(headers)?;
    if !headers.get("content-type").is_some_and(|v| {
        v.to_str()
            .is_ok_and(|s| s.split(';').next() == Some("application/json"))
    }) || bytes.len() > 8192
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_request_invalid",
        ));
    }
    let value: Draft = serde_json::from_slice(bytes)
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "demo_request_invalid"))?;
    if value.mode != "demo"
        || !plain(&value.account_id, 18)
        || !plain(&value.server, 160)
        || [
            value.volume,
            value.entry_price,
            value.stop_loss,
            value.take_profit,
        ]
        .iter()
        .flatten()
        .any(|v| !v.is_finite())
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_request_invalid",
        ));
    }
    Ok(value)
}
fn authorize(p: &Policy, d: &Draft) -> Result<(), ApiError> {
    if p.login != d.account_id || p.server != d.server {
        return Err(denied("demo_identity_mismatch"));
    }
    if !matches!(d.action.as_deref(), Some("pause" | "resume"))
        && d.symbol.as_ref().is_none_or(|s| !p.symbols.contains(s))
    {
        return Err(denied("demo_symbol_denied"));
    }
    Ok(())
}
async fn preview(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    let mut d = draft(&headers, &bytes)?;
    if d.action.is_none() {
        d.action = Some("place".into());
    }
    if !matches!(
        d.action.as_deref(),
        Some("place" | "close" | "protect" | "cancel")
    ) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_action_unsupported",
        ));
    }
    let p = policy(&scope).await.map_err(denied)?;
    if !state.native_runtime {
        return Err(denied("demo_native_runtime_required"));
    }
    authorize(&p, &d)?;
    gate(&state, &p, d.action.as_deref().unwrap_or("place")).await?;
    let result = adapter_for(
        &state,
        &p,
        json!({"operation":"preview","workspace":scope.workspace_id,"policy":p,"command":d}),
    )
    .await
    .map_err(|reason| error(StatusCode::SERVICE_UNAVAILABLE, &reason))?;
    Ok(Json(result))
}
async fn command(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    let d = draft(&headers, &bytes)?;
    let id = d
        .request_id
        .ok_or_else(|| error(StatusCode::UNPROCESSABLE_ENTITY, "demo_request_id_required"))?;
    let action = d.action.as_deref().unwrap_or("");
    if !matches!(
        action,
        "place" | "close" | "protect" | "cancel" | "pause" | "resume"
    ) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_action_unsupported",
        ));
    }
    let normalized = serde_json::to_value(&d)
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "demo_request_invalid"))?;
    let fingerprint = digest(
        &serde_json::to_vec(&normalized)
            .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "demo_request_invalid"))?,
    );
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&crate::native_mutation::idempotency_lock(
            &scope,
            &format!("demo:{id}"),
        )],
    )
    .await
    .map_err(|_| ApiError::database())?;
    if let Some(row)=tx.query_opt("SELECT fingerprint,result FROM mt5_demo_requests WHERE workspace_id=$1 AND request_id=$2", &[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())? {
        if row.get::<_,String>(0)!=fingerprint { return Err(error(StatusCode::CONFLICT,"demo_request_conflict")); }
        return Ok(Json(row.get(1)));
    }
    let p = policy(&scope).await.map_err(denied)?;
    if !state.native_runtime {
        return Err(denied("demo_native_runtime_required"));
    }
    authorize(&p, &d)?;
    let key = p.terminal_key();
    // Global terminal lock prevents two workspaces/accounts racing the same terminal.
    let lock = i64::from_be_bytes(Sha256::digest(key.as_bytes())[..8].try_into().unwrap());
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| ApiError::database())?;
    tx.execute(
        "INSERT INTO mt5_demo_controls(terminal_key) VALUES($1) ON CONFLICT DO NOTHING",
        &[&key],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let binding = json!({"account_id":p.login,"server":p.server,"symbol":d.symbol,"magic":p.magic});
    let mut result = json!({"request_id":id,"status":"unknown","reason":"demo_submission_in_progress_or_unknown","action":action,"scope":binding});
    if matches!(action, "pause" | "resume") {
        tx.execute("UPDATE mt5_demo_controls SET paused=$2,updated_at=CURRENT_TIMESTAMP WHERE terminal_key=$1", &[&key,&(action=="pause")]).await.map_err(|_|ApiError::database())?;
        result["status"] = json!("accepted");
        result["reason"] = json!(if action == "pause" {
            "demo_paused"
        } else {
            "demo_resumed"
        });
    } else {
        let row=tx.query_one("SELECT paused,EXISTS(SELECT 1 FROM mt5_demo_requests WHERE terminal_key=$1 AND (status='unknown' OR result->>'requires_reconciliation'='true')) FROM mt5_demo_controls WHERE terminal_key=$1", &[&key]).await.map_err(|_|ApiError::database())?;
        if row.get::<_, bool>(0) && !matches!(action, "close" | "cancel") {
            return Err(denied("demo_paused"));
        }
        if row.get::<_, bool>(1) {
            return Err(denied("demo_unresolved_request"));
        }
    }
    tx.execute("INSERT INTO mt5_demo_requests(workspace_id,request_id,terminal_key,fingerprint,status,result,command_body) VALUES($1,$2,$3,$4,$5,$6,$7)", &[&scope.workspace_id,&id,&key,&fingerprint,&result["status"].as_str().unwrap(),&result,&serde_json::to_value(&d).map_err(|_|ApiError::database())?]).await.map_err(|_|ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    if matches!(action, "pause" | "resume") {
        return Ok(Json(result));
    }
    drop(conn);
    // A committed unknown intent survives process cancellation or broker timeout.
    // No execution path retries this adapter or order_send.
    let next = adapter_for(
        &state,
        &p,
        json!({"operation":"command","workspace":scope.workspace_id,"policy":p,"command":d}),
    )
    .await;
    let mut result = match next {
        Ok(value) => value,
        Err(reason) => {
            json!({"status":if reason=="demo_terminal_busy" {"rejected"} else {"unknown"},"reason":reason})
        }
    };
    if !matches!(
        result["status"].as_str(),
        Some("filled" | "accepted" | "rejected" | "unknown")
    ) {
        result = json!({"status":"unknown","reason":"demo_adapter_failed"});
    }
    result["request_id"] = json!(id);
    result["action"] = json!(action);
    result["scope"] = binding;
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    // If this write fails the original unknown receipt remains, blocking new sends.
    conn.execute("UPDATE mt5_demo_requests SET status=$3,result=$4,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND request_id=$2 AND status='unknown'", &[&scope.workspace_id,&id,&result["status"].as_str().unwrap(),&result]).await.map_err(|_|ApiError::database())?;
    let stored = conn
        .query_one(
            "SELECT result FROM mt5_demo_requests WHERE workspace_id=$1 AND request_id=$2",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(Json(stored.get(0)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reconcile {
    request_id: Uuid,
}
async fn reconcile(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<Value>, ApiError> {
    local_origin(&headers)?;
    if bytes.len() > 1024
        || !headers.get("content-type").is_some_and(|v| {
            v.to_str()
                .is_ok_and(|s| s.split(';').next() == Some("application/json"))
        })
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_request_invalid",
        ));
    }
    let request: Reconcile = serde_json::from_slice(&bytes)
        .map_err(|_| error(StatusCode::UNPROCESSABLE_ENTITY, "demo_request_invalid"))?;
    let p = policy(&scope).await.map_err(denied)?;
    if !state.native_runtime {
        return Err(denied("demo_native_runtime_required"));
    }
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT command_body,result,created_at FROM mt5_demo_requests WHERE workspace_id=$1 AND request_id=$2 AND terminal_key=$3",&[&scope.workspace_id,&request.request_id,&p.terminal_key()]).await.map_err(|_|ApiError::database())?.ok_or_else(||error(StatusCode::NOT_FOUND,"demo_request_not_found"))?;
    let previous: Value = row.get(1);
    if previous["status"] != "unknown" && previous["requires_reconciliation"] != true {
        return Ok(Json(previous));
    }
    let body: Value = row.get(0);
    let d: Draft = serde_json::from_value(body.clone()).map_err(|_| ApiError::database())?;
    authorize(&p, &d)?;
    if previous["scope"]
        != json!({"account_id":p.login,"server":p.server,"symbol":d.symbol,"magic":p.magic})
    {
        return Err(denied("demo_identity_mismatch"));
    }
    let submitted: chrono::DateTime<chrono::Utc> = row.get(2);
    drop(conn);
    let proof=adapter_for(&state,&p,json!({"operation":"reconcile","workspace":scope.workspace_id,"policy":p,"command":body,"submitted_at_utc":submitted,"previous":previous})).await;
    let proof = match proof {
        Ok(value) => value,
        Err(reason) => json!({"resolved":false,"reason":reason}),
    };
    if proof["resolved"] != true {
        let mut unchanged = previous;
        unchanged["reconciliation"] = proof;
        return Ok(Json(unchanged));
    }
    if !matches!(proof["status"].as_str(), Some("accepted" | "filled"))
        || proof["requires_reconciliation"] != false
    {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "demo_reconciliation_unproven",
        ));
    }
    let mut result = proof;
    result["request_id"] = json!(request.request_id);
    result["action"] = body["action"].clone();
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    conn.execute("UPDATE mt5_demo_requests SET status=$3,result=$4,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND request_id=$2 AND result=$5",&[&scope.workspace_id,&request.request_id,&result["status"].as_str().unwrap(),&result,&previous]).await.map_err(|_|ApiError::database())?;
    // A simultaneous command completion can win; return the persisted authority.
    let stored = conn
        .query_one(
            "SELECT result FROM mt5_demo_requests WHERE workspace_id=$1 AND request_id=$2",
            &[&scope.workspace_id, &request.request_id],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(Json(stored.get(0)))
}
async fn adapter_for(state: &AppState, p: &Policy, input: Value) -> Result<Value, String> {
    let mut conn = state
        .pool
        .get()
        .await
        .map_err(|_| "demo_terminal_busy".to_owned())?;
    let tx = conn
        .transaction()
        .await
        .map_err(|_| "demo_terminal_busy".to_owned())?;
    // The transaction outlives the <=15s adapter. All API processes must hold
    // this lock, including readers, before attaching to an owned terminal.
    tx.batch_execute("SET LOCAL idle_in_transaction_session_timeout='25s'")
        .await
        .map_err(|_| "demo_terminal_busy".to_owned())?;
    let key = p.terminal_key();
    let lock = i64::from_be_bytes(Sha256::digest(key.as_bytes())[..8].try_into().unwrap());
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| "demo_terminal_busy".to_owned())?;
    let result = adapter(input).await;
    // Dropping the owned child has ended its terminal lifetime before unlock.
    let _ = tx.rollback().await;
    result
}
async fn adapter(input: Value) -> Result<Value, String> {
    let python = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv/Scripts/python.exe");
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/mt5_demo_trading.py");
    let mut child = crate::owned_process::spawn_with_stdin(
        &python,
        &["-I".into(), script.to_string_lossy().into()],
        None,
        &[],
        crate::owned_process::Limits {
            active_processes: Some(4),
            process_memory_bytes: Some(512 * 1024 * 1024),
        },
        false,
    )
    .map_err(|_| "demo_adapter_unavailable".to_owned())?;
    let work = async {
        let mut stdin = child.stdin.take().ok_or("demo_adapter_failed")?;
        stdin
            .write_all(&serde_json::to_vec(&input).map_err(|_| "demo_adapter_failed")?)
            .await
            .map_err(|_| "demo_adapter_failed")?;
        stdin.shutdown().await.map_err(|_| "demo_adapter_failed")?;
        drop(stdin);
        let mut output = Vec::new();
        child
            .stdout
            .take()
            .ok_or("demo_adapter_failed")?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut output)
            .await
            .map_err(|_| "demo_adapter_failed")?;
        if output.len() > 2 * 1024 * 1024 {
            return Err("demo_adapter_failed");
        }
        if !child
            .wait()
            .await
            .map_err(|_| "demo_adapter_failed")?
            .success()
        {
            return Err("demo_adapter_failed");
        }
        serde_json::from_slice(&output).map_err(|_| "demo_adapter_failed")
    };
    let result = match tokio::time::timeout(Duration::from_secs(15), work).await {
        Ok(result) => result.map_err(str::to_owned),
        Err(_) => Err("demo_adapter_timeout".to_owned()),
    };
    // Wait for every owned descendant before another request can attach.
    child
        .kill()
        .await
        .map_err(|_| "demo_adapter_cleanup_failed".to_owned())?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_and_request_fail_closed() {
        let mut headers = HeaderMap::new();
        headers.insert("origin", "https://evil.example".parse().unwrap());
        assert!(local_origin(&headers).is_err());
        headers.insert("origin", "http://127.0.0.1:5180".parse().unwrap());
        headers.insert("content-type", "application/json".parse().unwrap());
        assert!(local_origin(&headers).is_ok());
        assert!(
            draft(
                &headers,
                br#"{"mode":"real","account_id":"123","server":"demo"}"#
            )
            .is_err()
        );
        assert!(
            draft(
                &headers,
                br#"{"mode":"demo","account_id":"123","server":"demo","password":"x"}"#
            )
            .is_err()
        );
    }
    #[tokio::test]
    async fn absent_policy_never_needs_database_or_adapter() {
        let scope = Workspace {
            workspace_id: "unconfigured-test-workspace".into(),
            subject: "test".into(),
        };
        assert!(policy(&scope).await.is_err());
        assert_eq!(locked("demo_policy_locked")["execution_enabled"], false);
    }
}
