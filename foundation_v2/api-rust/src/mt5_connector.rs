//! Local read-only MT5 connections. Secrets never enter command receipts or logs.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration as ChronoDuration, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_postgres::Row;
use uuid::Uuid;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/live/connections"),
    ("POST", "/api/v2/live/connections"),
    ("POST", "/api/v2/live/connections/{id}/{action}"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(ROUTES[0].1, get(list).post(connect))
        .route(ROUTES[2].1, post(action))
}
fn error(code: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, code)
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.runtime/mt5-connectors")
}
fn python() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv/Scripts/python.exe")
}
pub fn available() -> bool {
    cfg!(windows)
        && python().is_file()
        && std::env::var("TW_V2_MT5_TERMINAL")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:/Program Files/MetaTrader 5/terminal64.exe"))
            .is_file()
}
fn local_origin(headers: &HeaderMap) -> Result<(), ApiError> {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return Err(ApiError::detail(
            StatusCode::FORBIDDEN,
            "connector_origin_denied",
        ));
    }
    if let Some(origin) = headers.get("origin") {
        let origin = origin
            .to_str()
            .map_err(|_| error("connector_origin_denied"))?;
        let url = reqwest::Url::parse(origin).map_err(|_| error("connector_origin_denied"))?;
        if !matches!(
            url.port_or_known_default(),
            Some(5180 | 5173 | 8010 | 5191 | 8021)
        ) || !matches!(url.scheme(), "http" | "https")
            || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(ApiError::detail(
                StatusCode::FORBIDDEN,
                "connector_origin_denied",
            ));
        }
    }
    Ok(())
}
const SUMMARY_COLUMNS: &str = "connection_id,name,server,login_hint,start_date,status,error_code,last_synced_at,requested_mode,CASE WHEN snapshot IS NULL THEN NULL ELSE jsonb_build_object('status',snapshot->'status','account',snapshot->'account','source',snapshot->'source','captured_at_utc',snapshot->'captured_at_utc','history_from_utc',snapshot->'history_from_utc','verified_permissions',snapshot->'verified_permissions','account_environment',snapshot->'account_environment') END AS snapshot";
fn public(row: &Row) -> Value {
    let snapshot: Option<Value> = row.get("snapshot");
    json!({"id":row.get::<_,Uuid>("connection_id"),"name":row.get::<_,String>("name"),"server":row.get::<_,String>("server"),"login_hint":row.get::<_,String>("login_hint"),"start_date":row.get::<_,NaiveDate>("start_date"),"requested_mode":row.get::<_,String>("requested_mode"),"status":row.get::<_,String>("status"),"error_code":row.get::<_,Option<String>>("error_code"),"last_synced_at":row.get::<_,Option<chrono::DateTime<Utc>>>("last_synced_at"),"account":snapshot.as_ref().and_then(|v|v.get("account")),"source":snapshot.as_ref().and_then(|v|v.get("source")),"verified_permissions":snapshot.as_ref().and_then(|v|v.get("verified_permissions")),"account_environment":snapshot.as_ref().and_then(|v|v.get("account_environment")),"execution_capability":false})
}
async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows = conn
        .query(
            &format!("SELECT {SUMMARY_COLUMNS} FROM mt5_connections WHERE workspace_id=$1 ORDER BY created_at,connection_id"),
            &[&scope.workspace_id],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(Json(
        json!({"items":rows.iter().map(public).collect::<Vec<_>>(),"available":available(),"execution_capability":false}),
    ))
}

// Raw bytes + generic validation failures avoid serde rejection messages echoing secrets.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Connect {
    request_id: Uuid,
    name: String,
    server: String,
    login: String,
    password: String,
    start_date: String,
    #[serde(default = "read_only_mode")]
    requested_mode: String,
}
fn read_only_mode() -> String {
    "read_only".into()
}
fn validate(draft: &Connect) -> Result<NaiveDate, ApiError> {
    let text = |s: &str, max: usize| {
        !s.trim().is_empty() && s.len() <= max && !s.chars().any(char::is_control)
    };
    if !matches!(draft.requested_mode.as_str(), "read_only" | "trading")
        || !text(&draft.name, 160)
        || !text(&draft.server, 160)
        || draft.server != draft.server.trim()
        || draft.login.len() > 20
        || draft.login.is_empty()
        || !draft.login.bytes().all(|b| b.is_ascii_digit())
        || draft.login.starts_with('0')
        || draft.login.parse::<u64>().is_err()
        || !text(&draft.password, 512)
    {
        return Err(error("invalid_mt5_connection"));
    }
    let date = NaiveDate::parse_from_str(&draft.start_date, "%Y-%m-%d")
        .map_err(|_| error("invalid_mt5_start_date"))?;
    if date < NaiveDate::from_ymd_opt(2000, 1, 1).unwrap() || date > Utc::now().date_naive() {
        return Err(error("invalid_mt5_start_date"));
    }
    Ok(date)
}
async fn connect(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    local_origin(&headers)?;
    if !state.native_runtime {
        return Err(error("mt5_native_runtime_required"));
    }
    if !headers.get("content-type").is_some_and(|v| {
        v.to_str()
            .is_ok_and(|v| v.split(';').next() == Some("application/json"))
    }) {
        return Err(error("invalid_mt5_content_type"));
    }
    if !available() {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "mt5_terminal_missing",
        ));
    }
    if body.len() > 4096 {
        return Err(error("invalid_mt5_connection"));
    }
    let draft: Connect =
        serde_json::from_slice(&body).map_err(|_| error("invalid_mt5_connection"))?;
    let date = validate(&draft)?;
    let key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json!([draft.server, draft.login])).unwrap())
    );
    let id = Uuid::new_v4();
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&crate::native_mutation::idempotency_lock(
            &scope,
            "mt5-connections",
        )],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([key, draft.name.trim(), date, draft.requested_mode]))
                .unwrap()
        )
    );
    if let Some(receipt)=tx.query_opt("SELECT connection_id,fingerprint FROM mt5_connection_requests WHERE workspace_id=$1 AND request_id=$2",&[&scope.workspace_id,&draft.request_id]).await.map_err(|_|ApiError::database())? {
        if receipt.get::<_,String>("fingerprint")!=fingerprint{return Err(ApiError::detail(StatusCode::CONFLICT,"mt5_request_conflict"))}
        let connection_id:Uuid=receipt.get("connection_id");
        let row=tx.query_one("SELECT * FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",&[&scope.workspace_id,&connection_id]).await.map_err(|_|ApiError::database())?;
        return Ok((StatusCode::ACCEPTED,Json(public(&row))))
    }
    let old = tx
        .query_opt(
            "SELECT * FROM mt5_connections WHERE workspace_id=$1 AND account_key=$2",
            &[&scope.workspace_id, &key],
        )
        .await
        .map_err(|_| ApiError::database())?;
    let id = old
        .as_ref()
        .map(|r| r.get::<_, Uuid>("connection_id"))
        .unwrap_or(id);
    if old.is_none()
        && tx
            .query_one(
                "SELECT count(*) FROM mt5_connections WHERE workspace_id=$1",
                &[&scope.workspace_id],
            )
            .await
            .map_err(|_| ApiError::database())?
            .get::<_, i64>(0)
            >= 10
    {
        return Err(error("mt5_connection_limit"));
    }
    let sealed=adapter(json!({"action":"seal","workspace":scope.workspace_id,"connection_id":id,"secret":{"server":draft.server,"login":draft.login,"password":draft.password}}),Duration::from_secs(10)).await.map_err(|code|ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,&code))?;
    let credential = sealed["credential"]
        .as_str()
        .ok_or_else(|| error("mt5_secret_unavailable"))?;
    let hint = format!(
        "…{}",
        draft
            .login
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
    );
    tx.execute(
        "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING",
        &[&scope.workspace_id, &Utc::now().to_rfc3339()],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let row=tx.query_one("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,credential,status,requested_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10) ON CONFLICT(workspace_id,account_key) DO UPDATE SET request_id=EXCLUDED.request_id,name=EXCLUDED.name,credential=EXCLUDED.credential,start_date=EXCLUDED.start_date,requested_mode=EXCLUDED.requested_mode,snapshot=CASE WHEN mt5_connections.start_date=EXCLUDED.start_date AND mt5_connections.requested_mode=EXCLUDED.requested_mode THEN mt5_connections.snapshot ELSE NULL END,last_synced_at=CASE WHEN mt5_connections.start_date=EXCLUDED.start_date AND mt5_connections.requested_mode=EXCLUDED.requested_mode THEN mt5_connections.last_synced_at ELSE NULL END,generation=mt5_connections.generation+1,full_sync=true,status='queued',error_code=NULL,next_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP RETURNING *",&[&scope.workspace_id,&id,&draft.request_id,&key,&draft.name.trim(),&draft.server,&hint,&date,&credential,&draft.requested_mode]).await.map_err(|_|ApiError::database())?;
    tx.execute("INSERT INTO mt5_connection_requests(workspace_id,request_id,connection_id,fingerprint) VALUES($1,$2,$3,$4)",&[&scope.workspace_id,&draft.request_id,&id,&fingerprint]).await.map_err(|_|ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    let workspace = scope.workspace_id.clone();
    tokio::spawn(async move {
        crate::demo_trading::revoke_managed_worker(&workspace, id).await;
    });
    Ok((StatusCode::ACCEPTED, Json(public(&row))))
}
async fn action(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path((id, action)): Path<(Uuid, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    local_origin(&headers)?;
    if action == "rename" || action == "remove" {
        let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
        let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
        tx.query_one(
            "SELECT pg_advisory_xact_lock($1)",
            &[&crate::native_mutation::idempotency_lock(
                &scope,
                "mt5-connections",
            )],
        )
        .await
        .map_err(|_| ApiError::database())?;
        if action == "rename" {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Rename {
                name: String,
            }
            if body.len() > 1024 {
                return Err(error("invalid_mt5_connection"));
            }
            let draft: Rename =
                serde_json::from_slice(&body).map_err(|_| error("invalid_mt5_connection"))?;
            let name = draft.name.trim();
            if name.is_empty() || name.len() > 160 || name.chars().any(char::is_control) {
                return Err(error("invalid_mt5_connection"));
            }
            let row = tx.query_opt("UPDATE mt5_connections SET name=$3,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND connection_id=$2 RETURNING *", &[&scope.workspace_id, &id, &name]).await.map_err(|_| ApiError::database())?.ok_or_else(|| error("mt5_connection_missing_or_credentials_required"))?;
            let result = public(&row);
            tx.commit().await.map_err(|_| ApiError::database())?;
            return Ok(Json(result));
        }
        // Removing this local connector never closes or deletes the broker account.
        // A worker with an in-flight snapshot cannot update a missing connection id.
        let key = crate::demo_trading::managed_terminal_key(&scope.workspace_id, id);
        let lock = i64::from_be_bytes(Sha256::digest(key.as_bytes())[..8].try_into().unwrap());
        tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
            .await
            .map_err(|_| ApiError::database())?;
        let unresolved: bool = tx.query_one("SELECT EXISTS(SELECT 1 FROM mt5_demo_requests WHERE terminal_key=$1 AND (status='unknown' OR result->>'requires_reconciliation'='true'))", &[&key]).await.map_err(|_|ApiError::database())?.get(0);
        if unresolved {
            return Err(ApiError::detail(
                StatusCode::LOCKED,
                "mt5_reconciliation_required",
            ));
        }
        tx.execute(
            "DELETE FROM mt5_connection_requests WHERE workspace_id=$1 AND connection_id=$2",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?;
        tx.execute(
            "DELETE FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?;
        tx.commit().await.map_err(|_| ApiError::database())?;
        let workspace = scope.workspace_id.clone();
        tokio::spawn(async move {
            crate::demo_trading::revoke_managed_worker(&workspace, id).await;
        });
        return Ok(Json(
            json!({"id":id,"removed":true,"execution_capability":false}),
        ));
    }
    let status = match action.as_str() {
        "sync" | "resume" => "queued",
        "pause" => "paused",
        "disconnect" => "disconnected",
        _ => return Err(error("invalid_mt5_action")),
    };
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("UPDATE mt5_connections SET status=$3,generation=generation+1,error_code=NULL,credential=CASE WHEN $3='disconnected' THEN NULL ELSE credential END,full_sync=CASE WHEN $3='queued' THEN true ELSE full_sync END,next_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND connection_id=$2 AND ($3 IN ('paused','disconnected') OR credential IS NOT NULL) RETURNING *",&[&scope.workspace_id,&id,&status]).await.map_err(|_|ApiError::database())?.ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,"mt5_connection_missing_or_credentials_required"))?;
    let workspace = scope.workspace_id.clone();
    tokio::spawn(async move {
        crate::demo_trading::revoke_managed_worker(&workspace, id).await;
    });
    Ok(Json(public(&row)))
}

#[derive(Deserialize)]
pub struct LiveQuery {
    connection_id: Option<Uuid>,
    #[serde(default)]
    summary: bool,
}
pub async fn live_status(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Query(query): Query<LiveQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    // Metadata, validator and history must describe the same sync revision.
    let conn = client
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(|_| ApiError::database())?;
    let rows=conn.query(&format!("SELECT {SUMMARY_COLUMNS} FROM mt5_connections WHERE workspace_id=$1 ORDER BY (status='connected') DESC,created_at,connection_id"),&[&scope.workspace_id]).await.map_err(|_|ApiError::database())?;
    let chosen = if let Some(id) = query.connection_id {
        rows.iter()
            .find(|r| r.get::<_, Uuid>("connection_id") == id)
    } else {
        rows.first()
    };
    let mut value = chosen
        .and_then(|r| r.get::<_, Option<Value>>("snapshot"))
        .unwrap_or(json!({"status":"unavailable"}));
    if let Some(row) = chosen {
        let status: String = row.get("status");
        value["connection_id"] = json!(row.get::<_, Uuid>("connection_id"));
        value["connection_status"] = json!(status);
        value["stale"] = json!(
            status != "connected"
                || row
                    .get::<_, Option<chrono::DateTime<Utc>>>("last_synced_at")
                    .is_some_and(|date| Utc::now() - date > ChronoDuration::minutes(3))
        );
    }
    value["connections"] = json!(rows.iter().map(public).collect::<Vec<_>>());
    value["execution_capability"] = json!(false);
    let etag = format!(
        "\"{:x}\"",
        Sha256::digest(
            serde_json::to_vec(&json!([
                scope.workspace_id,
                query.connection_id,
                query.summary,
                value
            ]))
            .unwrap()
        )
    );
    if headers
        .get("if-none-match")
        .is_some_and(|h| h.as_bytes() == etag.as_bytes())
    {
        return Ok((StatusCode::NOT_MODIFIED, [("etag", etag)]).into_response());
    }
    if !query.summary {
        if let Some(row) = chosen {
            let id: Uuid = row.get("connection_id");
            let full=conn.query_one("SELECT snapshot FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?.get::<_,Option<Value>>(0);
            if let Some(full) = full {
                for (key, item) in full.as_object().into_iter().flatten() {
                    if !matches!(
                        key.as_str(),
                        "connection_id"
                            | "connection_status"
                            | "stale"
                            | "connections"
                            | "execution_capability"
                    ) {
                        value[key] = item.clone();
                    }
                }
            }
        }
    }
    Ok(([("etag", etag)], Json(value)).into_response())
}

async fn adapter(input: Value, timeout: Duration) -> Result<Value, String> {
    let mut child = crate::owned_process::spawn_with_stdin(
        &python(),
        &[
            "-I".into(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../scripts/mt5_connector.py")
                .to_string_lossy()
                .into(),
        ],
        None,
        &[],
        crate::owned_process::Limits {
            active_processes: Some(4),
            process_memory_bytes: Some(1024 * 1024 * 1024),
        },
        false,
    )
    .map_err(|_| "mt5_worker_unavailable")?;
    let work = async {
        let mut stdin = child.stdin.take().ok_or("mt5_worker_unavailable")?;
        stdin
            .write_all(&serde_json::to_vec(&input).map_err(|_| "mt5_worker_unavailable")?)
            .await
            .map_err(|_| "mt5_worker_unavailable")?;
        stdin
            .shutdown()
            .await
            .map_err(|_| "mt5_worker_unavailable")?;
        drop(stdin);
        let mut bytes = Vec::new();
        child
            .stdout
            .take()
            .ok_or("mt5_worker_unavailable")?
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "mt5_worker_unavailable")?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("mt5_history_too_large");
        }
        let status = child.wait().await.map_err(|_| "mt5_worker_unavailable")?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "mt5_worker_failed")?;
        if !status.success() || value.get("error").is_some() {
            return Err(match value["error"].as_str() {
                Some("mt5_login_failed") => "mt5_login_failed",
                Some("mt5_auth_failed") => "mt5_auth_failed",
                Some("mt5_initialization_failed") => "mt5_initialization_failed",
                Some("mt5_terminal_unavailable") => "mt5_terminal_unavailable",
                Some("mt5_version_unsupported") => "mt5_version_unsupported",
                Some("mt5_sync_timeout") => "mt5_sync_timeout",
                Some("mt5_investor_required") => "mt5_investor_required",
                Some("mt5_identity_changed") => "mt5_identity_changed",
                Some("mt5_history_too_large") => "mt5_history_too_large",
                Some("mt5_secret_unavailable") => "mt5_secret_unavailable",
                Some("mt5_terminal_missing") => "mt5_terminal_missing",
                Some("mt5_sdk_missing") => "mt5_sdk_missing",
                _ => "mt5_sync_failed",
            });
        }
        Ok(value)
    };
    tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| "mt5_sync_timeout".to_owned())?
        .map_err(str::to_owned)
    // Dropping child closes the job and kills every terminal/SDK descendant.
}

fn merge_snapshot(old: Option<Value>, mut next: Value, full_sync: bool) -> Value {
    if full_sync {
        return next;
    }
    if let Some(old) = old {
        for field in ["deals", "cashflows"] {
            let cutoff = next["history_read_from_utc"]
                .as_str()
                .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                .map(|date| date.timestamp_millis());
            let mut rows = BTreeMap::new();
            for row in old[field]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|v| {
                    cutoff
                        .is_none_or(|start| v["time_msc"].as_i64().is_some_and(|time| time < start))
                })
                .chain(next[field].as_array().into_iter().flatten())
            {
                if let Some(ticket) = row["ticket"].as_u64() {
                    rows.insert(ticket, row.clone());
                }
            }
            let mut rows = rows.into_values().collect::<Vec<_>>();
            rows.sort_by_key(|v| v["time_msc"].as_i64().unwrap_or(0));
            next[field] = json!(rows);
        }
    }
    next
}
pub fn start(state: Arc<AppState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(code) = reap_sessions(&state).await {
            tracing::warn!(detail=%code,"MT5 session recovery unavailable");
        }
        while !state.draining.load(Ordering::Acquire) {
            if let Err(code) = run_one(&state).await {
                tracing::warn!(detail=%code,"MT5 read-only worker unavailable");
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    })
}
async fn reap_sessions(state: &Arc<AppState>) -> Result<(), String> {
    let conn = deadpool_postgres::Client::take(
        state
            .pool
            .get()
            .await
            .map_err(|_| "mt5_database_unavailable")?,
    );
    if conn
        .query_one("SELECT pg_try_advisory_lock(1297364253)", &[])
        .await
        .map_err(|_| "mt5_database_unavailable")?
        .get::<_, bool>(0)
    {
        adapter(
            json!({"action":"cleanup_all","root":root()}),
            Duration::from_secs(20),
        )
        .await?;
    }
    Ok(())
}
async fn run_one(state: &Arc<AppState>) -> Result<(), String> {
    let conn = state
        .pool
        .get()
        .await
        .map_err(|_| "mt5_database_unavailable")?;
    // Session-scoped lock, held on a detached socket throughout SDK processing.
    let conn = deadpool_postgres::Client::take(conn);
    if !conn
        .query_one("SELECT pg_try_advisory_lock(1297364253)", &[])
        .await
        .map_err(|_| "mt5_database_unavailable")?
        .get::<_, bool>(0)
    {
        return Ok(());
    }
    let allowed = state.authorization.authorized_workspace_ids();
    let row=conn.query_opt("SELECT workspace_id,connection_id,generation,start_date,last_synced_at,full_sync,status,credential,requested_mode FROM mt5_connections WHERE workspace_id=ANY($1) AND credential IS NOT NULL AND status IN ('queued','syncing','connected','error') AND next_sync_at<=CURRENT_TIMESTAMP ORDER BY next_sync_at LIMIT 1",&[&allowed]).await.map_err(|_|"mt5_database_unavailable")?;
    let Some(row) = row else { return Ok(()) };
    let workspace: String = row.get("workspace_id");
    if !state
        .authorization
        .authorized_workspace_ids()
        .contains(&workspace)
    {
        return Ok(());
    }
    let id: Uuid = row.get("connection_id");
    let generation: i64 = row.get("generation");
    if conn.execute("UPDATE mt5_connections SET status=CASE WHEN status='connected' THEN status ELSE 'syncing' END,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND connection_id=$2 AND generation=$3",&[&workspace,&id,&generation]).await.map_err(|_|"mt5_database_unavailable")?!=1{return Ok(())}
    let date: NaiveDate = row.get("start_date");
    let history = format!("{date}T00:00:00Z");
    let last: Option<chrono::DateTime<Utc>> = if row.get::<_, bool>("full_sync") {
        None
    } else {
        row.get("last_synced_at")
    };
    let from = last
        .map(|date| (date - ChronoDuration::days(2)).to_rfc3339())
        .filter(|value| value.as_str() > history.as_str())
        .unwrap_or_else(|| history.clone());
    let include_history = row.get::<_, bool>("full_sync")
        || row.get::<_, String>("status") != "connected"
        || row
            .get::<_, Option<chrono::DateTime<Utc>>>("last_synced_at")
            .is_none_or(|last| Utc::now() - last >= ChronoDuration::seconds(60));
    let result = {
        let work = crate::demo_trading::managed_read(
            state,
            &workspace,
            id,
            generation,
            row.get::<_, String>("credential"),
            row.get::<_, String>("requested_mode"),
            &from,
            &history,
            include_history,
        );
        tokio::pin!(work);
        loop {
            tokio::select! {
                result=&mut work=>break Some(result),
                _=tokio::time::sleep(Duration::from_secs(1))=>{
                    let active=match conn.query_opt("SELECT generation FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",&[&workspace,&id]).await {Ok(row)=>row,Err(_)=>break Some(Err("mt5_database_unavailable".into()))};
                    if state.draining.load(Ordering::Acquire)||active.is_none_or(|r|r.get::<_,i64>(0)!=generation){break None}
                }
            }
        }
    };
    let Some(result) = result else { return Ok(()) };
    if !include_history && result.is_ok() {
        conn.execute("UPDATE mt5_connections SET next_sync_at=CURRENT_TIMESTAMP+interval '10 seconds' WHERE workspace_id=$1 AND connection_id=$2 AND generation=$3",&[&workspace,&id,&generation]).await.map_err(|_|"mt5_database_unavailable")?;
        return Ok(());
    }
    // Heartbeats never transfer/decode the journal. Fetch it only when a
    // successful incremental collection needs the previous revision to merge.
    let previous = if include_history && result.is_ok() && !row.get::<_, bool>("full_sync") {
        let previous = conn.query_opt("SELECT snapshot FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2 AND generation=$3", &[&workspace, &id, &generation]).await.map_err(|_|"mt5_database_unavailable")?;
        let Some(previous) = previous else { return Ok(()) };
        previous.get::<_, Option<Value>>(0)
    } else {
        None
    };
    let result = result.and_then(|next| {
        let snapshot = merge_snapshot(previous, next, row.get("full_sync"));
        if serde_json::to_vec(&snapshot)
            .map_err(|_| "mt5_snapshot_failed")?
            .len()
            > 32 * 1024 * 1024
        {
            Err("mt5_history_too_large".into())
        } else {
            Ok(snapshot)
        }
    });
    match result {
        Ok(snapshot) => {
            conn.execute("UPDATE mt5_connections SET status='connected',full_sync=false,snapshot=$4,error_code=NULL,last_synced_at=CURRENT_TIMESTAMP,next_sync_at=CURRENT_TIMESTAMP+interval '10 seconds',updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND connection_id=$2 AND generation=$3",&[&workspace,&id,&generation,&snapshot]).await.map_err(|_|"mt5_database_unavailable")?;
        }
        Err(code) => {
            let retry_seconds = retry_seconds(&code);
            conn.execute("UPDATE mt5_connections SET status='error',error_code=$4,next_sync_at=CURRENT_TIMESTAMP+make_interval(secs=>$5),updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND connection_id=$2 AND generation=$3",&[&workspace,&id,&generation,&code,&retry_seconds]).await.map_err(|_|"mt5_database_unavailable")?;
        }
    }
    Ok(())
}

fn retry_seconds(code: &str) -> f64 {
    match code {
        "mt5_disconnected"
        | "mt5_terminal_stopped"
        | "mt5_operation_timeout"
        | "mt5_startup_timeout"
        | "mt5_terminal_unavailable"
        | "mt5_worker_failed" => 15.0,
        _ => 300.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_or_network_failures_retry_quickly_without_authentication_loop() {
        assert_eq!(retry_seconds("mt5_terminal_stopped"), 15.0);
        assert_eq!(retry_seconds("mt5_disconnected"), 15.0);
        assert_eq!(retry_seconds("mt5_auth_failed"), 300.0);
        assert_eq!(retry_seconds("mt5_identity_changed"), 300.0);
    }
    #[test]
    fn credentials_validate_without_echo() {
        let mut d = Connect {
            request_id: Uuid::new_v4(),
            name: "Test".into(),
            server: "Broker-Demo".into(),
            login: "12345".into(),
            password: "secret".into(),
            start_date: "2026-01-01".into(),
            requested_mode: "read_only".into(),
        };
        assert!(validate(&d).is_ok());
        d.login = "../../a".into();
        assert_eq!(
            validate(&d).unwrap_err().1["detail"],
            "invalid_mt5_connection"
        );
    }
    #[test]
    fn cashflow_merge_is_ticket_idempotent() {
        let result = merge_snapshot(
            Some(
                json!({"deals":[{"ticket":1,"time_msc":2}],"cashflows":[{"ticket":3,"time_msc":1}]}),
            ),
            json!({"deals":[{"ticket":1,"time_msc":2,"profit":8},{"ticket":2,"time_msc":3}],"cashflows":[]}),
            false,
        );
        assert_eq!(result["deals"].as_array().unwrap().len(), 2);
        assert_eq!(result["deals"][0]["profit"], 8);
        assert_eq!(result["cashflows"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn remote_browser_origin_denied() {
        let mut h = HeaderMap::new();
        h.insert("origin", "https://evil.example".parse().unwrap());
        assert!(local_origin(&h).is_err());
        h.insert("origin", "http://127.0.0.1:5180".parse().unwrap());
        assert!(local_origin(&h).is_ok());
    }
    #[test]
    fn authoritative_overlap_removes_deleted_deals() {
        let result = merge_snapshot(
            Some(
                json!({"deals":[{"ticket":1,"time_msc":100},{"ticket":2,"time_msc":2000}],"cashflows":[{"ticket":3,"time_msc":3000}]}),
            ),
            json!({"history_read_from_utc":"1970-01-01T00:00:01Z","deals":[],"cashflows":[]}),
            false,
        );
        assert_eq!(result["deals"], json!([{"ticket":1,"time_msc":100}]));
        assert_eq!(result["cashflows"], json!([]));
    }
    #[test]
    fn full_sync_replaces_previous_start_date_scope() {
        let result = merge_snapshot(
            Some(
                json!({"deals":[{"ticket":1,"time_msc":100}],"cashflows":[{"ticket":3,"time_msc":100}]}),
            ),
            json!({"history_read_from_utc":"1970-01-01T00:00:01Z","deals":[],"cashflows":[]}),
            true,
        );
        assert_eq!(result["deals"], json!([]));
        assert_eq!(result["cashflows"], json!([]));
    }
}
