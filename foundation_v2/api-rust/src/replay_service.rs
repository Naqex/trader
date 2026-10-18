//! Native replay persistence. Records, revisions and retry receipts commit together.
use crate::{
    artifact_data::{ArtifactData, ChartPeriod, TimingQuery},
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::Arc,
};
use tokio_postgres::Transaction;
use uuid::Uuid;

struct ReplayTimings {
    operation: String,
    last: Option<std::time::Instant>,
    phases: Vec<Value>,
}
impl ReplayTimings {
    fn new() -> Self {
        Self { operation: String::new(), last: std::env::var("TW_V2_REPLAY_TIMINGS")
            .is_ok_and(|v|v=="1").then(std::time::Instant::now), phases: Vec::new() }
    }
    fn mark(&mut self, phase: &'static str) {
        if let Some(last) = self.last.as_mut() {
            self.phases.push(json!({"phase":phase,"us":last.elapsed().as_micros() as u64}));
            *last=std::time::Instant::now();
        }
    }
}
impl Drop for ReplayTimings {
    fn drop(&mut self) {
        if self.last.is_some() {
            tracing::info!(operation=%self.operation, phases=%json!(self.phases), "native_replay_phases");
        }
    }
}

pub fn native(method: &str, path: &str) -> bool {
    match method {
        "GET" => matches!(
            path,
            "/api/v2/replay/sessions/{session_id}"
                | "/api/v2/replay/sessions/{session_id}/metadata"
                | "/api/v2/replay/sessions/{session_id}/chart-window"
                | "/api/v2/replay/sessions/{session_id}/tick-data"
        ),
        "PATCH" => path == "/api/v2/replay/sessions/{session_id}",
        "POST" => matches!(
            path,
            "/api/v2/replay/sessions"
                | "/api/v2/replay/sessions/{session_id}/execution"
                | "/api/v2/replay/sessions/{session_id}/orders/market"
                | "/api/v2/replay/sessions/{session_id}/orders/quick"
                | "/api/v2/replay/sessions/{session_id}/orders/protection"
                | "/api/v2/replay/sessions/{session_id}/orders/close"
                | "/api/v2/replay/sessions/{session_id}/step"
                | "/api/v2/replay/sessions/{session_id}/branch"
                | "/api/v2/replay/sessions/{session_id}/asset"
                | "/api/v2/replay/sessions/{session_id}/activity"
                | "/api/v2/replay/sessions/{session_id}/delete"
                | "/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{attempt_id}/feed"
                | "/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{parent_attempt_id}/branch"
        ),
        _ => false,
    }
}
pub fn routes() -> Router<Arc<AppState>> {
    let mut r=Router::new().route("/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{attempt_id}/feed",post(invoke)).route("/api/v2/replay/sessions/{replay_session_id}/prop/sessions/{prop_session_id}/attempts/{parent_attempt_id}/branch",post(invoke)).route("/api/v2/replay/sessions",post(invoke)).route("/api/v2/replay/sessions/{session_id}",get(invoke).patch(invoke));
    for tail in ["metadata", "chart-window", "tick-data"] {
        r = r.route(
            &format!("/api/v2/replay/sessions/{{session_id}}/{tail}"),
            get(invoke),
        );
    }
    for tail in [
        "execution",
        "orders/market",
        "orders/quick",
        "orders/protection",
        "orders/close",
        "step",
        "branch",
        "asset",
        "activity",
        "delete",
    ] {
        r = r.route(
            &format!("/api/v2/replay/sessions/{{session_id}}/{tail}"),
            post(invoke),
        );
    }
    r
}
fn bad(message: impl AsRef<str>) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, message.as_ref())
}
fn conflict(message: impl AsRef<str>) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, message.as_ref())
}
fn internal(message: impl AsRef<str>) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, message.as_ref())
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    v[key]
        .as_str()
        .ok_or_else(|| bad(format!("{key} must be a string")))
}
fn integer(v: &Value, key: &str) -> Result<i64, ApiError> {
    v[key]
        .as_i64()
        .ok_or_else(|| bad(format!("{key} must be an integer")))
}
fn dec(v: &Value) -> Result<BigDecimal, ApiError> {
    let raw = if let Some(s) = v.as_str() {
        s.to_string()
    } else {
        v.to_string()
    };
    if raw.len() > 512 {
        return Err(bad("decimal input exceeds supported bounds"));
    }
    let value = BigDecimal::from_str(&raw).map_err(|_| bad("invalid decimal"))?;
    if value.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err(bad("decimal exponent exceeds supported bounds"));
    }
    Ok(value)
}
fn uid() -> String {
    Uuid::new_v4().simple().to_string()
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}
fn timing(legacy: bool) -> Value {
    json!({"schema_version":"replay-timing-v1","started_at_utc":now(),"legacy_baseline":legacy,"historical_time_replayed_seconds":0})
}
fn engine_snapshot(action: &str, snapshot: &Value, args: Value) -> Result<Value, ApiError> {
    let mut result = crate::replay_core::transform_owned(json!({"action":action,"snapshot":snapshot,"args":args}))
        .map_err(bad)?;
    Ok(result["snapshot"].take())
}
async fn engine_snapshot_owned(action: &'static str, snapshot: Value, args: Value) -> Result<Value, ApiError> {
    let mut request = json!({"action":action,"args":args});
    request["snapshot"] = snapshot;
    let mut result = tokio::task::spawn_blocking(move || crate::replay_core::transform_owned(request))
        .await.map_err(|_| internal("execution_task_failed"))?.map_err(bad)?;
    Ok(result["snapshot"].take())
}
fn pairs(raw: Option<&str>) -> HashMap<String, String> {
    form_urlencoded::parse(raw.unwrap_or("").as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}
fn qint(q: &HashMap<String, String>, key: &str) -> Result<Option<i64>, ApiError> {
    q.get(key)
        .map(|s| {
            s.parse::<i64>()
                .map_err(|_| bad(format!("{key} must be an integer")))
        })
        .transpose()
}

fn reader(state: &AppState) -> Result<Arc<ArtifactData>, ApiError> {
    Ok(state.artifact_data.clone())
}
async fn read<T: Send + 'static>(
    state: &AppState,
    f: impl FnOnce(Arc<ArtifactData>) -> Result<T, String> + Send + 'static,
) -> Result<T, ApiError> {
    let r = reader(state)?;
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| internal("artifact_reader_unavailable"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        f(r)
    })
    .await
    .map_err(|_| internal("artifact_read_failed"))?
    .map_err(bad)
}

pub async fn load_record(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    lock: bool,
) -> Result<Value, ApiError> {
    load_record_inner(tx, workspace, id, lock, true).await
}

async fn load_record_inner(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    lock: bool,
    hydrate: bool,
) -> Result<Value, ApiError> {
    // Lock the head first, then read its revision: a joined FOR UPDATE can retain a stale revision under contention.
    let sql = format!(
        "SELECT record_id,source_key,current_revision,created_at_utc,updated_at_utc FROM workspace_records WHERE workspace_id=$1 AND kind='replay' AND record_id=$2{}",
        if lock { " FOR UPDATE" } else { "" }
    );
    let head = tx
        .query_opt(&sql, &[&workspace, &id])
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "replay_not_found"))?;
    let rev: i32 = head.get("current_revision");
    let version=tx.query_opt("SELECT payload_json,deleted FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3",&[&workspace,&id,&rev]).await.map_err(|_|ApiError::database())?.ok_or_else(||internal("replay_revision_missing"))?;
    if version.get::<_, bool>("deleted") {
        return Err(ApiError::detail(StatusCode::NOT_FOUND, "replay_not_found"));
    }
    let mut payload = tokio::task::spawn_blocking(move || version.try_get::<_, Value>("payload_json"))
        .await.map_err(|_| internal("replay_decode_failed"))?
        .map_err(|_| internal("replay_revision_invalid"))?;
    if hydrate {
        payload = crate::replay_storage::hydrate_payload(tx, workspace, id, i64::from(rev), payload)
            .await.map_err(internal)?;
    }
    let mut record = json!({"record_id":id,"source_key":head.get::<_,Option<String>>("source_key"),"revision":rev,"deleted":false,"created_at_utc":head.get::<_,String>("created_at_utc"),"updated_at_utc":head.get::<_,String>("updated_at_utc")});
    record["payload"] = payload;
    Ok(record)
}
async fn manifest(tx: &Transaction<'_>, workspace: &str, id: &str) -> Result<Value, ApiError> {
    tx.query_opt(
        "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR KEY SHARE",
        &[&workspace, &id],
    )
    .await
    .map_err(|_| ApiError::database())?
    .map(|r| r.get(0))
    .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "dataset_not_found"))
}
// Read projections use their transaction snapshot; dataset deletion is forbidden
// while any replay revision pins it. Row locks belong to admission/mutation paths.
async fn snapshot_manifest(tx: &Transaction<'_>, workspace: &str, id: &str) -> Result<Value, ApiError> {
    tx.query_opt("SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2", &[&workspace, &id])
        .await.map_err(|_| ApiError::database())?
        .map(|r| r.get(0))
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "dataset_not_found"))
}
async fn slice(state: &AppState, m: &Value, start: i64, end: i64) -> Result<Vec<Value>, ApiError> {
    if start < 0 || end < start {
        return Err(bad("invalid dataset indices"));
    }
    let path = text(m, "artifact_path")?.to_owned();
    let sha = text(m, "artifact_sha256")?.to_owned();
    read(state, move |r| {
        r.indices(&path, &sha, start as usize, end as usize)
    })
    .await
}
async fn times(
    state: &AppState,
    m: &Value,
    index: i64,
    at: Option<i64>,
) -> Result<Value, ApiError> {
    if index < 0 {
        return Err(bad("start_index exceeds dataset"));
    }
    let path = text(m, "artifact_path")?.to_owned();
    let sha = text(m, "artifact_sha256")?.to_owned();
    let out = read(state, move |r| {
        r.timings(
            &path,
            &sha,
            &[TimingQuery {
                index: index as usize,
                at_or_before: at,
            }],
        )
    })
    .await?;
    let v = out
        .into_iter()
        .next()
        .ok_or_else(|| internal("dataset_timing_missing"))?;
    if v["row_count"] != m["row_count"] {
        return Err(internal(
            "dataset row count differs from immutable manifest",
        ));
    }
    Ok(v)
}
fn bounds(p: &Value) -> Result<Option<Value>, ApiError> {
    if p["session_period"].is_null() {
        return Ok(None);
    }
    let b = &p["session_period"]["asset_bounds"][text(p, "dataset_id")?];
    let start = integer(b, "start_cursor_index")?;
    let end = integer(b, "end_cursor_index")?;
    if start < 0 || end < start {
        return Err(internal("stored replay period is invalid"));
    }
    Ok(Some(b.clone()))
}
fn sync(p: &mut Value) -> Result<(), ApiError> {
    if p["asset_states"].is_object() {
        let id = text(p, "dataset_id")?.to_owned();
        p["asset_states"][&id] = json!({"cursor_index":p["cursor_index"],"execution":p.get("execution").cloned().unwrap_or(Value::Null)});
    }
    Ok(())
}
async fn lock_datasets(tx: &Transaction<'_>, workspace: &str, p: &Value) -> Result<(), ApiError> {
    let mut keys: Vec<String> = p["dataset_ids"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_else(|| vec![p["dataset_id"].as_str().unwrap_or("").to_owned()]);
    keys.sort();
    keys.dedup();
    for key in keys {
        manifest(tx, workspace, &key).await?;
    }
    Ok(())
}
pub async fn save_record(
    tx: &Transaction<'_>,
    workspace: &str,
    record: &Value,
    mut payload: Value,
    deleted: bool,
) -> Result<Value, ApiError> {
    sync(&mut payload)?;
    lock_datasets(tx, workspace, &payload).await?;
    let id = text(record, "record_id")?;
    let expected = integer(record, "revision")?;
    let rev = i32::try_from(expected + 1).map_err(|_| bad("record revision overflow"))?;
    let stamp = now();
    let n=tx.execute("UPDATE workspace_records SET current_revision=$3,updated_at_utc=$4 WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND current_revision=$5",&[&workspace,&id,&rev,&stamp,&(expected as i32)]).await.map_err(|_|ApiError::database())?;
    if n != 1 {
        return Err(conflict("record revision conflict"));
    }
    tx.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc) VALUES($1,'replay',$2,$3,$4,$5,$6)",&[&workspace,&id,&rev,&payload,&deleted,&stamp]).await.map_err(|_|ApiError::database())?;
    let mut saved = json!({"record_id":id,"source_key":record["source_key"],"revision":rev,"deleted":deleted,"created_at_utc":record["created_at_utc"],"updated_at_utc":stamp});
    saved["payload"] = payload;
    Ok(saved)
}
async fn create_record(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    p: Value,
) -> Result<Value, ApiError> {
    lock_datasets(tx, workspace, &p).await?;
    let stamp = now();
    tx.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES($1,'replay',$2,1,$3,$3)",&[&workspace,&id,&stamp]).await.map_err(|_|ApiError::database())?;
    tx.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc) VALUES($1,'replay',$2,1,$3,false,$4)",&[&workspace,&id,&p,&stamp]).await.map_err(|_|ApiError::database())?;
    let mut record = json!({"record_id":id,"source_key":null,"revision":1,"deleted":false,"created_at_utc":stamp,"updated_at_utc":stamp});
    record["payload"] = p;
    Ok(record)
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    request: Request,
) -> Result<Response, ApiError> {
    let mut timings=ReplayTimings::new();
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().map(str::to_owned);
    let headers = request.headers().clone();
    let bytes = to_bytes(request.into_body(), state.config.max_body_bytes)
        .await
        .map_err(|_| bad("invalid_request_body"))?;
    let raw = crate::commands::parse_body_for_content_type(
        &bytes,
        headers.get("content-type").and_then(|v| v.to_str().ok()),
    )?
    .unwrap_or(json!({}));
    let parts: Vec<_> = path.split('/').collect();
    let id = parts.get(5).copied().unwrap_or("");
    let tail = parts.get(6..).unwrap_or(&[]).join("/");
    timings.operation=if tail.is_empty(){method.clone()}else{tail.clone()};
    let q = pairs(query.as_deref());
    let handler = if tail.starts_with("prop/") {
        if tail.ends_with("/feed") {
            "feed_replay_prop_lifecycle"
        } else {
            "branch_replay_prop_attempt"
        }
    } else {
        match (method.as_str(), id, tail.as_str()) {
            ("POST", "", _) => "create_replay",
            ("PATCH", _, _) => "update_replay_metadata",
            (_, _, "execution") => "initialize_replay_execution",
            (_, _, "orders/market") => "queue_replay_market_order",
            (_, _, "orders/quick") => "quick_replay_market_order",
            (_, _, "orders/protection") => "change_replay_protection_route",
            (_, _, "orders/close") => "close_replay_order_route",
            (_, _, "step") => "step_replay",
            (_, _, "branch") => "branch_replay",
            (_, _, "asset") => "select_replay_asset",
            (_, _, "activity") => "record_replay_activity",
            (_, _, "delete") => "delete_replay_session",
            _ => "",
        }
    };
    timings.mark("request_decode");
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    timings.mark("pool_checkout");
    let tx = client
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    timings.mark("transaction_begin");
    if method == "GET" {
        let record = load_record(&tx, &scope.workspace_id, id, false).await?;
        let result = match tail.as_str() {
            "metadata" => metadata(&tx, &scope.workspace_id, &record).await?,
            "chart-window" => chart(&tx, &state, &scope.workspace_id, &record, &q).await?,
            "tick-data" => tick_options(&tx, &state, &scope.workspace_id, &record).await?,
            _ => view(&tx, &state, &scope.workspace_id, record, &q).await?,
        };
        tx.commit().await.map_err(|_| ApiError::database())?;
        return Ok(Json(result).into_response());
    }
    let mutation = match crate::native_mutation::begin(
        &tx,
        &scope,
        &method,
        &path,
        query.as_deref(),
        &headers,
        &raw,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(response) => {
            tx.commit().await.map_err(|_| ApiError::database())?;
            return Ok(response);
        }
        crate::native_mutation::MutationStart::New(m) => m,
    };
    tx.batch_execute("SAVEPOINT native_replay_domain")
        .await
        .map_err(|_| ApiError::database())?;
    timings.mark("receipt_admission");
    let result = match crate::native_contracts::validate_body(handler, raw) {
        Ok(body) => match mutation_response(&q, &tail) {
            Ok(_) if id.is_empty() => create(&tx, &state, &scope.workspace_id, &body).await,
            Ok(response_view) => mutate(&tx, &state, &scope.workspace_id, id, &tail, &method, &body, response_view, &mut timings).await,
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };
    let (status, value) = match result {
        Ok(v) => (
            if id.is_empty() || tail == "branch" || tail.ends_with("/branch") {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            v,
        ),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT native_replay_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    timings.mark("result_status");
    let response = if status.is_success() {
        crate::native_mutation::finish_json_text(&tx, mutation, status, value).await?
    } else {
        crate::native_mutation::finish(&tx, mutation, status, value).await?
    };
    timings.mark("receipt_save_and_response_serialize");
    let response=crate::native_mutation::commit(tx, response).await;
    timings.mark("commit");
    response
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResponseView { Full, Mutation, Step }

fn mutation_response(q: &HashMap<String, String>, tail: &str) -> Result<ResponseView, ApiError> {
    match q.get("response_view").map(String::as_str) {
        None => Ok(ResponseView::Full),
        Some("mutation-v1") if matches!(tail, "execution" | "orders/market" | "orders/quick" | "orders/protection" | "orders/close") => Ok(ResponseView::Mutation),
        Some("step-v1") if tail == "step" => Ok(ResponseView::Step),
        Some(_) => Err(bad("unsupported replay mutation response view")),
    }
}

async fn identities(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    p: &Value,
) -> Result<Value, ApiError> {
    let r=tx.query_opt("SELECT session_id,attempt_id FROM prop_attempts WHERE workspace_id=$1 AND resume_json->'replay_binding'->>'replay_session_id'=$2 ORDER BY updated_at_utc DESC,attempt_id LIMIT 1",&[&workspace,&id]).await.map_err(|_|ApiError::database())?;
    Ok(if let Some(r) = r {
        json!({"session_kind":"prop","prop_session_id":r.get::<_,String>(0),"prop_attempt_id":r.get::<_,String>(1)})
    } else {
        let mut out = Map::new();
        for key in ["session_kind", "prop_session_id", "prop_attempt_id"] {
            if let Some(v) = p.get(key) {
                out.insert(key.into(), v.clone());
            }
        }
        Value::Object(out)
    })
}
async fn metadata(
    _tx: &Transaction<'_>,
    workspace: &str,
    record: &Value,
) -> Result<Value, ApiError> {
    let p = &record["payload"];
    let execution = &p["execution"];
    let cutoff = p
        .get("replay_clock_utc")
        .cloned()
        .filter(|v| !v.is_null())
        .or_else(|| {
            execution["ledger"]
                .as_array()
                .and_then(|a| a.last())
                .map(|e| e["virtual_time_utc"].clone())
        })
        .unwrap_or(Value::Null);
    let mut config = Map::new();
    for key in [
        "dataset_id",
        "dataset_ids",
        "name",
        "description",
        "playbook_id",
        "playbook_revision",
        "starting_balance",
        "starting_balance_ccy",
        "cursor_index",
    ] {
        if let Some(v) = p.get(key) {
            config.insert(key.into(), v.clone());
        }
    }
    let mut e = Map::new();
    for key in [
        "starting_balance",
        "balance",
        "cost_model",
        "spread_price",
        "instrument_spec",
    ] {
        if let Some(v) = execution.get(key) {
            e.insert(key.into(), v.clone());
        }
    }
    config.insert(
        "execution".into(),
        if execution.is_null() {
            Value::Null
        } else {
            Value::Object(e)
        },
    );
    let mut out = json!({"schema_version":"replay-metadata-v1","workspace_id":workspace,"record_id":record["record_id"],"revision":record["revision"],"cutoff_timestamp":cutoff,"payload":config,"freshness":"current_revision"});
    if p["asset_states"].is_object() {
        out["portfolio_account"] = account(p)?;
    }
    Ok(out)
}

fn account(p: &Value) -> Result<Value, ApiError> {
    let initial = dec(p.get("starting_balance").unwrap_or(&json!("10000")))?;
    let mut balance = initial.clone();
    let mut floating = BigDecimal::from(0);
    let (mut positions, mut pending) = (0, 0);
    for a in p["asset_states"]
        .as_object()
        .ok_or_else(|| bad("invalid portfolio state"))?
        .values()
    {
        let s = &a["execution"];
        if s.is_null() {
            continue;
        }
        crate::replay_core::validate(s).map_err(bad)?;
        if dec(&s["starting_balance"])? != initial {
            return Err(bad("portfolio starting balance is inconsistent"));
        }
        balance += dec(&s["balance"])? - &initial;
        floating += dec(&s["floating_pl"])?;
        positions += i64::from(!s["position"].is_null());
        pending += i64::from(!s["pending_market_order"].is_null());
    }
    Ok(
        json!({"starting_balance":initial.to_string(),"balance":balance.to_string(),"floating_pl":floating.to_string(),"equity":(&balance+&floating).to_string(),"account_ccy":p.get("starting_balance_ccy").cloned().unwrap_or(json!("USD")),"open_position_count":positions,"pending_order_count":pending}),
    )
}

pub async fn checkpoint_record(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    mut record: Value,
    cursor: Option<i64>,
    cutoff: Option<i64>,
    event: Option<i64>,
) -> Result<Value, ApiError> {
    let canonical = integer(&record["payload"], "cursor_index")?;
    let mut selected = cursor.unwrap_or(canonical);
    let mut p = record["payload"].take();
    let m = snapshot_manifest(tx, workspace, text(&p, "dataset_id")?).await?;
    if let Some(cutoff) = cutoff {
        let t = times(state, &m, canonical, Some(cutoff)).await?;
        if cutoff < integer(&t, "first_utc")? || cutoff > integer(&t, "index_utc")? {
            return Err(bad("analytics cutoff is outside the visible replay range"));
        }
        let ix = integer(&t, "cursor_index")?;
        if cursor.is_some_and(|c| c != ix) {
            return Err(bad("analytics cursor and cutoff disagree"));
        }
        selected = ix;
    }
    if selected < 0 || selected > canonical {
        return Err(bad("analytics cursor is outside the visible replay range"));
    }
    let snapshot = &p["execution"];
    let canonical_seq = snapshot
        .get("event_sequence")
        .cloned()
        .unwrap_or(Value::Null);
    if p["asset_states"].is_object() {
        if event.is_some() {
            return Err(bad(
                "multi-asset checkpoints use the shared replay time, not a local event sequence",
            ));
        }
        if selected < canonical {
            let clock = integer(&times(state, &m, selected, None).await?, "index_utc")?
                + integer(&m, "timeframe_seconds")?;
            let keys: Vec<String> = p["asset_states"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect();
            for key in keys {
                let am = snapshot_manifest(tx, workspace, &key).await?;
                let target = integer(
                    &times(
                        state,
                        &am,
                        0,
                        Some(clock - integer(&am, "timeframe_seconds")?),
                    )
                    .await?,
                    "cursor_index",
                )?;
                let raw = p["asset_states"][&key]["execution"].clone();
                let restored = if raw.is_null() || target < 0 {
                    Value::Null
                } else if raw["cursor_index"] == target {
                    raw
                } else {
                    restore(
                        tx,
                        workspace,
                        text(&record, "record_id")?,
                        &raw,
                        target,
                        None,
                        Some(&key),
                    )
                    .await?
                };
                p["asset_states"][&key] = json!({"cursor_index":target,"execution":restored});
            }
            p["replay_clock_utc"] = json!(clock);
        }
        let active = text(&p, "dataset_id")?.to_owned();
        p["execution"] = p["asset_states"][&active]["execution"].clone();
        p["cursor_index"] = json!(selected);
        let mut out = record;
        out["payload"] = p;
        out["view_cursor_index"] = json!(selected);
        out["canonical_cursor_index"] = json!(canonical);
        out["historical_view"] = json!(selected < canonical);
        out["canonical_execution_event_sequence"] = Value::Null;
        // Map each asset's closed-trade cursor onto the active chart clock.
        let mut trade_cursors = Map::new();
        for (key, a) in out["payload"]["asset_states"].as_object().unwrap() {
            let am = snapshot_manifest(tx, workspace, key).await?;
            for e in a["execution"]["ledger"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|e| matches!(e["kind"].as_str(), Some("protective_fill" | "manual_close")))
            {
                let t = times(state, &am, integer(e, "cursor_index")?, None).await?;
                let clock = integer(&t, "index_utc")? + integer(&am, "timeframe_seconds")?
                    - integer(&m, "timeframe_seconds")?;
                let active_t = times(state, &m, 0, Some(clock)).await?;
                trade_cursors.insert(
                    format!("{}:{}", key, integer(e, "sequence")?),
                    active_t["cursor_index"].clone(),
                );
            }
        }
        out["portfolio_trade_cursors"] = Value::Object(trade_cursors);
        return Ok(out);
    }
    if let Some(e) = event {
        if snapshot.is_null() || e < 0 || e > integer(&snapshot, "event_sequence")? {
            return Err(bad(
                "analytics event sequence is outside canonical execution",
            ));
        }
    }
    if !snapshot.is_null() && (selected < canonical || event.is_some()) {
        p["execution"] = restore(
            tx,
            workspace,
            text(&record, "record_id")?,
            &snapshot,
            selected,
            event,
            None,
        )
        .await?;
    }
    p["cursor_index"] = json!(selected);
    let historical = selected < canonical
        || event.is_some_and(|e| canonical_seq.as_i64().is_some_and(|n| e < n));
    let mut out = record;
    out["payload"] = p;
    out["view_cursor_index"] = json!(selected);
    out["canonical_cursor_index"] = json!(canonical);
    out["canonical_execution_event_sequence"] = canonical_seq;
    out["historical_view"] = json!(historical);
    Ok(out)
}
const LINEAGE: &[&str] = &[
    "replay_session_id",
    "branch_id",
    "dataset_id",
    "dataset_sha256",
    "instrument_spec",
    "cost_model",
    "spread_price",
    "timeframe_seconds",
    "starting_balance",
    "schema_version",
    "research_margin",
    "tick_snapshot_id",
    "tick_snapshot_sha256",
    "quote_source",
];
fn lineage(a: &Value, b: &Value) -> Result<(), ApiError> {
    for key in LINEAGE {
        if a[*key] != b[*key] {
            return Err(bad(
                "historical analytics checkpoint lineage is inconsistent",
            ));
        }
    }
    Ok(())
}
async fn restore(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    snapshot: &Value,
    cursor: i64,
    event: Option<i64>,
    asset: Option<&str>,
) -> Result<Value, ApiError> {
    let mut args = json!({"cursor_index":cursor});
    if let Some(e) = event {
        args["event_sequence"] = json!(e)
    }
    let checkpoint = match engine_snapshot("reconstruct", snapshot, args) {
        Ok(v) => v,
        Err(e) => {
            if e.1["detail"] != "execution branch cursor has no canonical checkpoint" {
                return Err(e);
            }
            if event.is_some_and(|e| e != 0) {
                return Err(bad(
                    "analytics event must select a bar-close or phase checkpoint",
                ));
            }
            let rows=tx.query("SELECT revision,payload_json FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND NOT deleted ORDER BY revision DESC",&[&workspace,&id]).await.map_err(|_|ApiError::database())?;
            let mut found = None;
            for row in rows {
                let p = crate::replay_storage::hydrate_payload(tx, workspace, id,
                    i64::from(row.get::<_, i32>(0)), row.get(1)).await.map_err(internal)?;
                let p = asset.map(|a| &p["asset_states"][a]).unwrap_or(&p);
                let candidate = &p["execution"];
                if p["cursor_index"] == cursor
                    && !candidate.is_null()
                    && event.is_none_or(|e| candidate["event_sequence"] == e)
                {
                    crate::replay_core::validate(candidate).map_err(bad)?;
                    found = Some(candidate.clone());
                    break;
                }
            }
            match found {
                Some(candidate) => candidate,
                None if asset.is_some() => {
                    let first_cursor = snapshot["ledger"].as_array()
                        .and_then(|events| events.first())
                        .and_then(|event| event["cursor_index"].as_i64());
                    // An asset initialized after this clock has no historical execution yet.
                    if first_cursor.is_none_or(|first| cursor < first) {
                        return Ok(Value::Null);
                    }
                    return Err(bad("historical portfolio checkpoint is unavailable"));
                }
                None => return Err(bad("historical analytics checkpoint is unavailable")),
            }
        }
    };
    lineage(&checkpoint, snapshot)?;
    if checkpoint["cursor_index"] != cursor {
        return Err(bad(
            "historical analytics checkpoint cursor is inconsistent",
        ));
    }
    Ok(checkpoint)
}

pub async fn view(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    mut record: Value,
    q: &HashMap<String, String>,
) -> Result<Value, ApiError> {
    let original = &record["payload"];
    let m = manifest(tx, workspace, text(&original, "dataset_id")?).await?;
    let canonical = integer(&original, "cursor_index")?;
    let total = integer(&m, "row_count")?;
    if canonical < 0 || canonical >= total {
        return Err(internal("replay cursor exceeds immutable dataset"));
    }
    let period = bounds(&original)?;
    if let Some(b) = &period {
        if canonical < integer(b, "start_cursor_index")?
            || canonical > integer(b, "end_cursor_index")?
            || integer(b, "end_cursor_index")? >= total
        {
            return Err(internal("stored replay cursor exceeds its session period"));
        }
    }
    let requested = qint(q, "cursor_index")?;
    let interval = qint(q, "advance_interval_seconds")?;
    let cutoff = qint(q, "cutoff_timestamp")?;
    let mut cursor = requested.unwrap_or(canonical);
    if let Some(cutoff) = cutoff {
        if requested.is_some() || interval.is_some() {
            return Err(bad("choose a UTC cutoff or a cursor/interval"));
        }
        let path = text(&m, "artifact_path")?.to_owned();
        let sha = text(&m, "artifact_sha256")?.to_owned();
        cursor = read(state, move |r| {
            r.find_cursor(&path, &sha, canonical as usize, cutoff)
        })
        .await? as i64;
    }
    if cursor < 0 || cursor > canonical {
        return Err(bad("view cursor cannot exceed current replay cursor"));
    }
    if interval.is_some() {
        cursor = step_window(state, &m, cursor, 1, interval, canonical)
            .await?
            .1;
    }
    let start = (cursor - 1999).max(0);
    let visible = slice(state, &m, start, cursor + 1).await?;
    let mut status = if original["execution"].is_null() {
        "not_initialized"
    } else {
        "current"
    };
    let future = if original["asset_states"].is_object() {
        integer(original, "replay_clock_utc")? < integer(original, "replay_end_utc")?
    } else {
        cursor < period.as_ref().map(|b| integer(b, "end_cursor_index"))
            .transpose()?.unwrap_or(total - 1)
    };
    let multi = original["asset_states"].is_object();
    let session_period = period.as_ref().map(|_| original["session_period"].clone());
    let ident = identities(tx, workspace, text(&record, "record_id")?, original).await?;
    if cursor != canonical
        && (!original["execution"].is_null() || original["asset_states"].is_object())
    {
        match checkpoint_record(
            tx,
            state,
            workspace,
            record.clone(),
            Some(cursor),
            None,
            None,
        )
        .await
        {
            Ok(v) => {
                record = v;
                status = "checkpoint"
            }
            Err(e) if e.1["detail"] == "historical analytics checkpoint is unavailable" => {
                record["payload"]["cursor_index"] = json!(cursor);
                record["payload"]["execution"] = Value::Null;
                status = "unavailable"
            }
            Err(e) => return Err(e),
        }
    }
    let portfolio = if multi {
        Some(account(&record["payload"])?)
    } else {
        None
    };
    let out = record
        .as_object_mut()
        .ok_or_else(|| internal("invalid replay record"))?;
    out.extend(ident.as_object().unwrap().clone());
    out.insert("dataset_sha256".into(), m["artifact_sha256"].clone());
    out.insert(
        "cutoff_timestamp".into(),
        visible
            .last()
            .ok_or_else(|| internal("visible replay window is empty"))?["timestamp"]
            .clone(),
    );
    out.insert("visible_row_count".into(), json!(visible.len()));
    out.insert("visible_rows".into(), json!(visible));
    out.insert("visible_row_start".into(), json!(start));
    out.insert("total_row_count".into(), json!(total));
    out.insert("has_future_rows".into(), json!(future));
    out.insert("view_cursor_index".into(), json!(cursor));
    out.insert("canonical_cursor_index".into(), json!(canonical));
    out.insert("historical_view".into(), json!(cursor != canonical));
    out.insert("execution_view_status".into(), json!(status));
    if state.native_runtime && !multi && cursor == canonical
        && bar_execution(&out["payload"]["execution"])
    {
        out.insert("step_view_version".into(), json!("replay-step-v1"));
    }
    if let Some(a) = portfolio {
        out.insert("portfolio_account".into(), a);
    }
    if let Some(b) = period {
        let mut p = session_period.unwrap().as_object().unwrap().clone();
        p.remove("asset_bounds");
        p.insert("start_cursor_index".into(), b["start_cursor_index"].clone());
        p.insert("end_cursor_index".into(), b["end_cursor_index"].clone());
        p.insert("asset_start_timestamp".into(), b["start_timestamp"].clone());
        p.insert("asset_end_timestamp".into(), b["end_timestamp"].clone());
        out.insert("session_period".into(), Value::Object(p));
    }
    Ok(record)
}
async fn chart(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    r: &Value,
    q: &HashMap<String, String>,
) -> Result<Value, ApiError> {
    let p = &r["payload"];
    let dataset = q
        .get("dataset_id")
        .ok_or_else(|| bad("dataset_id is required"))?;
    if p["dataset_id"] != *dataset {
        return Err(bad("chart dataset is not the active replay asset"));
    }
    let m = manifest(tx, workspace, dataset).await?;
    let sha = q
        .get("dataset_sha256")
        .ok_or_else(|| bad("dataset_sha256 is required"))?;
    if m["artifact_sha256"] != *sha {
        return Err(bad("chart dataset checksum conflicts with replay"));
    }
    let canonical = integer(p, "cursor_index")?;
    if bounds(p)?.is_some_and(|b| {
        b["end_cursor_index"]
            .as_i64()
            .is_some_and(|end| canonical > end)
    }) {
        return Err(internal("stored replay cursor exceeds its session period"));
    }
    let cursor = qint(q, "cursor_index")?.unwrap_or(canonical);
    if cursor < 0 || cursor > canonical {
        return Err(bad("chart cursor is outside the visible replay range"));
    }
    let count = qint(q, "count_back")?.unwrap_or(300);
    if !(1..=2000).contains(&count) {
        return Err(bad("chart count_back must be between 1 and 2000"));
    }
    let from = qint(q, "from_utc")?;
    let to = qint(q, "to_utc")?;
    if from.zip(to).is_some_and(|(f, t)| f > t) {
        return Err(bad("invalid chart time range"));
    }
    let resolution = q.get("resolution").cloned().unwrap_or("1".into());
    let period = ChartPeriod::parse(&resolution, integer(&m, "timeframe_seconds")?).map_err(bad)?;
    let path = text(&m, "artifact_path")?.to_owned();
    let hash = sha.clone();
    let window = read(state, move |r| {
        r.chart_window(&path, &hash, cursor as usize, period, to, count as usize)
    })
    .await?;
    let mut result = json!({"schema_version":"replay-chart-window-v1","workspace_id":workspace,"session_id":r["record_id"],"dataset_id":dataset,"dataset_sha256":sha,"revision":r["revision"],"cursor_index":cursor,"canonical_cursor_index":canonical,"resolution":resolution});
    result.as_object_mut().unwrap().extend(
        window
            .as_object()
            .ok_or_else(|| internal("invalid chart window"))?
            .clone(),
    );
    Ok(result)
}

async fn step_window(
    state: &AppState,
    m: &Value,
    current: i64,
    steps: i64,
    interval: Option<i64>,
    limit: i64,
) -> Result<(Vec<Value>, i64), ApiError> {
    if !(1..=1000).contains(&steps) {
        return Err(bad("replay steps must be an integer between 1 and 1000"));
    }
    let stop = (current + if interval.is_some() { 1000 } else { steps }).min(limit);
    let rows = slice(state, m, current, stop + 1).await?;
    let cursor = if let Some(interval) = interval {
        let frame = integer(m, "timeframe_seconds")?;
        if !(1..=86400).contains(&interval)
            || frame < 1
            || interval < frame
            || interval % frame != 0
        {
            return Err(bad(
                "replay interval must be a multiple of the dataset timeframe",
            ));
        }
        if steps != 1 {
            return Err(bad("choose either replay interval or a bar count"));
        }
        let boundary = (integer(&rows[0], "timestamp")? / interval + 1) * interval;
        let local = rows
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, r)| r["timestamp"].as_i64().is_some_and(|t| t >= boundary))
            .map(|(i, _)| i as i64);
        if local.is_none() && stop < limit {
            return Err(bad("replay interval exceeds the 1000-bar execution limit"));
        }
        current + local.unwrap_or(stop - current)
    } else {
        stop
    };
    Ok((
        rows.into_iter()
            .take((cursor - current + 1) as usize)
            .collect(),
        cursor,
    ))
}

async fn create(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    b: &Value,
) -> Result<Value, ApiError> {
    let dataset = text(b, "dataset_id")?;
    let start = b["start_index"].as_i64().unwrap_or(0);
    let m = manifest(tx, workspace, dataset).await?;
    let t = times(state, &m, start, None).await?;
    let requested_start = b["start_timestamp"].as_i64();
    let requested_end = b["end_timestamp"].as_i64();
    if requested_start.is_some() && start != 0 {
        return Err(bad("choose start_timestamp or a nonzero start_index"));
    }
    if requested_start
        .zip(requested_end)
        .is_some_and(|(s, e)| e <= s)
    {
        return Err(bad("end_timestamp must be after start_timestamp"));
    }
    if b["chart_engine"].as_str().is_some_and(|s| s != "legacy") {
        return Err(bad("chart engine is unavailable"));
    }
    if b["prop_session_id"].is_null() != b["prop_attempt_id"].is_null() {
        return Err(bad("prop session and attempt must be supplied together"));
    }
    let mut balance = b["starting_balance"].clone();
    if !b["prop_session_id"].is_null() {
        let ps = text(b, "prop_session_id")?;
        let pa = text(b, "prop_attempt_id")?;
        let row=tx.query_opt("SELECT snapshot_json,phase_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 FOR KEY SHARE",&[&workspace,&ps,&pa]).await.map_err(|_|ApiError::database())?.ok_or_else(||bad("prop attempt not found in workspace"))?;
        let attempt: Value = row.get(0);
        let phase: Value = row.get(1);
        if text(&attempt, "data_version")?.trim_start_matches("sha256:")
            != text(&m, "artifact_sha256")?.trim_start_matches("sha256:")
        {
            return Err(bad("prop replay dataset does not match the attempt"));
        }
        if balance.is_null() {
            balance = phase["initial_balance"].clone()
        } else if dec(&balance)? != dec(&phase["initial_balance"])? {
            return Err(bad("prop replay balance does not match the attempt"));
        }
    }
    if b["playbook_id"].is_null() != b["playbook_revision"].is_null() {
        return Err(bad("playbook id and revision must be supplied together"));
    }
    if !b["playbook_id"].is_null() {
        let id = text(b, "playbook_id")?;
        let rev = integer(b, "playbook_revision")? as i32;
        if tx.query_opt("SELECT 1 FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='playbook' AND record_id=$2 AND revision=$3 AND NOT deleted",&[&workspace,&id,&rev]).await.map_err(|_|ApiError::database())?.is_none(){return Err(ApiError::detail(StatusCode::NOT_FOUND,"playbook not found"))}
    }
    let mut p = json!({"dataset_id":dataset,"cursor_index":start,"branch_id":uid(),"parent_session_id":null,"parent_revision":null,"status":"paused","timing":timing(false),"chart_engine":"legacy"});
    for key in ["name", "description", "playbook_id", "playbook_revision"] {
        if !b[key].is_null() && (key != "description" || b[key] != "") {
            p[key] = b[key].clone();
        }
    }
    if let Some(name) = p["name"].as_str() {
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 160 {
            return Err(bad("name is invalid"));
        }
        p["name"] = json!(name)
    }
    if !b["prop_session_id"].is_null() {
        p["session_kind"] = json!("prop");
        p["prop_session_id"] = b["prop_session_id"].clone();
        p["prop_attempt_id"] = b["prop_attempt_id"].clone();
    }
    let ids = b["dataset_ids"].as_array().cloned();
    let multi = ids.as_ref().is_some_and(|ids| ids.len() > 1);
    if !multi && (requested_start.is_some() || requested_end.is_some()) {
        let (cursor, period) =
            single_period(state, &m, start, requested_start, requested_end).await?;
        p["cursor_index"] = json!(cursor);
        p["session_period"] = period;
    }
    if let Some(ids) = ids {
        if ids.is_empty()
            || ids.len() > 12
            || ids[0] != dataset
            || ids
                .iter()
                .any(|v| v.as_str().is_none_or(|s| s.trim().is_empty()))
            || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        {
            return Err(bad("choose unique datasets with the primary dataset first"));
        }
        if multi {
            init_portfolio(
                tx,
                state,
                workspace,
                &mut p,
                &ids,
                &m,
                &t,
                requested_start,
                requested_end,
            )
            .await?;
            if balance.is_null() {
                balance = json!("10000")
            }
        }
    }
    if !balance.is_null() {
        if dec(&balance)? <= BigDecimal::from(0) {
            return Err(bad("starting balance must be finite and positive"));
        }
        p["starting_balance"] = json!(dec(&balance)?.to_string());
        p["starting_balance_ccy"] = m["instrument_spec"]
            .get("account_ccy")
            .cloned()
            .unwrap_or(json!("USD"));
    }
    let record = create_record(tx, workspace, &uid(), p).await?;
    view(tx, state, workspace, record, &HashMap::new()).await
}
async fn single_period(
    state: &AppState,
    m: &Value,
    current: i64,
    start: Option<i64>,
    end: Option<i64>,
) -> Result<(i64, Value), ApiError> {
    let t = times(state, m, current, None).await?;
    for v in [start, end].into_iter().flatten() {
        if v < integer(&t, "first_utc")? || v > integer(&t, "last_utc")? {
            return Err(bad(
                "requested replay period is outside available dataset range",
            ));
        }
    }
    let cursor = if let Some(start) = start {
        integer(&times(state, m, 0, Some(start - 1)).await?, "cursor_index")? + 1
    } else {
        current
    };
    let terminal = if let Some(end) = end {
        integer(&times(state, m, 0, Some(end)).await?, "cursor_index")?
    } else {
        integer(&t, "row_count")? - 1
    };
    if terminal <= cursor {
        return Err(bad("selected replay period has no future bars"));
    }
    let st = times(state, m, cursor, None).await?["index_utc"].clone();
    let en = times(state, m, terminal, None).await?["index_utc"].clone();
    let id = text(m, "dataset_id")?;
    let mut assets = Map::new();
    assets.insert(id.to_owned(),json!({"start_cursor_index":cursor,"end_cursor_index":terminal,"start_timestamp":st,"end_timestamp":en}));
    Ok((
        cursor,
        json!({"schema_version":"replay-period-v1","requested_start_timestamp":start,"requested_end_timestamp":end,"start_timestamp":st,"end_timestamp":en,"asset_bounds":assets}),
    ))
}
async fn init_portfolio(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    p: &mut Value,
    ids: &[Value],
    primary: &Value,
    primary_t: &Value,
    start: Option<i64>,
    end: Option<i64>,
) -> Result<(), ApiError> {
    let mut assets = vec![];
    let mut symbols = HashSet::new();
    let mut currencies = HashSet::new();
    for id in ids {
        let id = id.as_str().unwrap();
        let m = if primary["dataset_id"] == id {
            primary.clone()
        } else {
            manifest(tx, workspace, id).await?
        };
        let t = if primary["dataset_id"] == id {
            primary_t.clone()
        } else {
            times(state, &m, 0, None).await?
        };
        if integer(&m, "timeframe_seconds")? <= 0 {
            return Err(bad("multi-asset replay requires a declared bar timeframe"));
        }
        if !symbols.insert(m["instrument_id"].clone()) {
            return Err(bad("choose one immutable dataset version per instrument"));
        }
        currencies.insert(
            m["instrument_spec"]
                .get("account_ccy")
                .cloned()
                .unwrap_or(json!("USD")),
        );
        assets.push((id.to_owned(), m, t));
    }
    if currencies.len() != 1 {
        return Err(bad("all replay assets must use the same account currency"));
    }
    let begin = assets
        .iter()
        .map(|(_, m, t)| {
            t["first_utc"].as_i64().unwrap() + m["timeframe_seconds"].as_i64().unwrap()
        })
        .max()
        .unwrap();
    let mut clock =
        begin.max(integer(primary_t, "index_utc")? + integer(primary, "timeframe_seconds")?);
    let mut terminal = assets
        .iter()
        .map(|(_, m, t)| t["last_utc"].as_i64().unwrap() + m["timeframe_seconds"].as_i64().unwrap())
        .min()
        .unwrap();
    let period = start.is_some() || end.is_some();
    let mut end_cutoff = 0;
    if period {
        let common_first = assets
            .iter()
            .map(|(_, _, t)| t["first_utc"].as_i64().unwrap())
            .max()
            .unwrap();
        let common_last = assets
            .iter()
            .map(|(_, _, t)| t["last_utc"].as_i64().unwrap())
            .min()
            .unwrap();
        for v in [start, end].into_iter().flatten() {
            if v < common_first || v > common_last {
                return Err(bad(
                    "requested replay period is outside common dataset range",
                ));
            }
        }
        end_cutoff = end.unwrap_or(common_last).min(common_last);
        let start_cutoff = start
            .unwrap_or(integer(primary_t, "index_utc")?)
            .max(common_first);
        if start_cutoff >= end_cutoff {
            return Err(bad("assets have no common replay period with future bars"));
        }
        let selected = integer(
            &times(state, primary, 0, Some(start_cutoff - 1)).await?,
            "cursor_index",
        )? + 1;
        let selected_time = integer(&times(state, primary, selected, None).await?, "index_utc")?;
        if selected_time > end_cutoff {
            return Err(bad("start_timestamp is outside the common dataset period"));
        }
        clock = begin.max(selected_time + integer(primary, "timeframe_seconds")?);
        terminal = i64::MAX;
        for (_, m, _) in &assets {
            let ix = integer(&times(state, m, 0, Some(end_cutoff)).await?, "cursor_index")?;
            let t = integer(&times(state, m, ix, None).await?, "index_utc")?;
            terminal = terminal.min(t + integer(m, "timeframe_seconds")?);
        }
    }
    if clock >= terminal {
        return Err(bad("assets have no common replay period with future bars"));
    }
    let mut states = Map::new();
    let mut periods = Map::new();
    for (id, m, _) in assets {
        let cursor = integer(
            &times(
                state,
                &m,
                0,
                Some(clock - integer(&m, "timeframe_seconds")?),
            )
            .await?,
            "cursor_index",
        )?;
        if cursor < 0 {
            return Err(bad("assets have no common closed-bar replay period"));
        }
        states.insert(id.clone(), json!({"cursor_index":cursor,"execution":null}));
        if period {
            let last = integer(
                &times(
                    state,
                    &m,
                    0,
                    Some(terminal - integer(&m, "timeframe_seconds")?),
                )
                .await?,
                "cursor_index",
            )?;
            let st = times(state, &m, cursor, None).await?["index_utc"].clone();
            let en = times(state, &m, last, None).await?["index_utc"].clone();
            periods.insert(id,json!({"start_cursor_index":cursor,"end_cursor_index":last,"start_timestamp":st,"end_timestamp":en}));
        }
    }
    let active = text(p, "dataset_id")?.to_owned();
    p["dataset_ids"] = json!(ids);
    p["asset_states"] = Value::Object(states);
    p["cursor_index"] = p["asset_states"][&active]["cursor_index"].clone();
    p["replay_clock_utc"] = json!(clock);
    p["replay_start_utc"] = json!(clock);
    p["replay_end_utc"] = json!(terminal);
    if period {
        p["session_period"] = json!({"schema_version":"replay-period-v1","requested_start_timestamp":start,"requested_end_timestamp":end,"start_timestamp":periods[&active]["start_timestamp"],"end_timestamp":end_cutoff,"start_clock_utc":clock,"end_clock_utc":terminal,"asset_bounds":periods});
    }
    Ok(())
}

async fn initialize(
    state: &AppState,
    workspace: &str,
    id: &str,
    p: &mut Value,
    m: &Value,
    b: &Value,
) -> Result<(), ApiError> {
    if !p["execution"].is_null() {
        return Err(conflict("replay execution is already initialized"));
    }
    for key in [
        "instrument_spec",
        "cost_model",
        "spread_price",
        "timeframe_seconds",
        "starting_balance",
    ] {
        if b[key].is_null() {
            return Err(bad("quick order initialization is incomplete"));
        }
    }
    if m["timeframe_seconds"] != b["timeframe_seconds"] {
        return Err(bad(
            "timeframe_seconds does not match the immutable dataset manifest",
        ));
    }
    let portfolio = p["asset_states"].is_object();
    if portfolio {
        if !b["tick_snapshot_id"].is_null() || !b["research_margin"].is_null() {
            return Err(bad(
                "multi-asset replay supports bar execution without a broker margin model",
            ));
        }
        if dec(&b["starting_balance"])? != dec(&p["starting_balance"])? {
            return Err(bad(
                "multi-asset execution must use the shared starting balance",
            ));
        }
        if b["instrument_spec"]["account_ccy"] != p["starting_balance_ccy"]
            || b["cost_model"]["account_ccy"] != p["starting_balance_ccy"]
        {
            return Err(bad(
                "multi-asset execution must use the shared account currency",
            ));
        }
    }
    let mut args = b.clone();
    args["replay_session_id"] = json!(id);
    args["branch_id"] = p["branch_id"].clone();
    args["dataset_id"] = p["dataset_id"].clone();
    args["dataset_sha256"] = m["artifact_sha256"].clone();
    args["cursor_index"] = p["cursor_index"].clone();
    // Validate the base model first; the stored tick pin is resolved below.
    args["tick_snapshot_id"] = Value::Null;
    let mut snapshot = engine_snapshot("initialize", &Value::Null, args.clone())?;
    if snapshot["instrument_spec"]["instrument_id"] != m["instrument_id"] {
        return Err(bad(
            "instrument_spec does not match the replay dataset instrument",
        ));
    }
    if m["instrument_spec"].is_object() {
        let mut compare = args.clone();
        compare["instrument_spec"] = m["instrument_spec"].clone();
        let expected = engine_snapshot("initialize", &Value::Null, compare)?;
        if snapshot["instrument_spec"] != expected["instrument_spec"] {
            return Err(bad(
                "instrument_spec does not match the immutable dataset manifest",
            ));
        }
    }
    if let Some(tick_id) = b["tick_snapshot_id"].as_str() {
        if b["research_margin"].is_null() {
            return Err(bad(
                "tick execution requires an explicit research leverage assumption",
            ));
        }
        let w = workspace.to_owned();
        let tid = tick_id.to_owned();
        let ticks = read(state, move |r| r.tick_manifest(&w, &tid)).await?;
        if ticks["symbol"] != m["instrument_id"]
            || ticks["source"]["mode"] != "demo"
            || m["source"]["provider"]
                != format!("{} / MT5", ticks["source"]["server"].as_str().unwrap_or(""))
        {
            return Err(bad("tick source does not match the replay dataset"));
        }
        let cursor = integer(p, "cursor_index")?;
        let bar = slice(state, m, cursor, cursor + 1).await?.remove(0);
        let begin = integer(&bar, "timestamp")? * 1000;
        let end = begin + integer(b, "timeframe_seconds")? * 1000;
        let w = workspace.to_owned();
        let tid = tick_id.to_owned();
        let quotes = read(state, move |r| r.tick_interval(&w, &tid, begin, end)).await?;
        let last = quotes
            .last()
            .ok_or_else(|| bad("current replay minute has no ticks"))?;
        args["tick_snapshot_id"] = json!(tick_id);
        args["tick_snapshot_sha256"] = json!(tick_id.trim_start_matches("ticks-"));
        snapshot = engine_snapshot("initialize", &Value::Null, args)?;
        let bid = dec(&last["bid"])?;
        let ask = dec(&last["ask"])?;
        let mark = json!({"schema_version":"replay-execution-event-v2","sequence":1,"kind":"price_mark","replay_session_id":id,"branch_id":p["branch_id"],"dataset_id":p["dataset_id"],"dataset_sha256":m["artifact_sha256"],"cursor_index":cursor,"virtual_time_utc":end/1000,"balance":snapshot["balance"],"floating_pl":"0","equity":snapshot["balance"],"open_positions":0,"pending_orders":0,"evaluation_quality":"full_for_declared_model","details":{"tick_snapshot_id":tick_id,"tick_snapshot_sha256":tick_id.trim_start_matches("ticks-"),"window_start_msc":begin,"window_end_msc":end,"quote_source":"broker_bid_ask","time_msc":last["time_msc"],"sequence":last["sequence"],"bid":bid.to_string(),"ask":ask.to_string(),"bid_close":bid.to_string(),"ask_close":ask.to_string(),"quote_mid_close":((&bid+&ask)/BigDecimal::from(2)).to_string(),"mid_close":dec(&bar["close"])?.to_string(),"open_position":null,"pending_market_order":null,"intrabar_equity_coverage":"complete"}});
        snapshot["last_bid"] = json!(bid.to_string());
        snapshot["last_ask"] = json!(ask.to_string());
        snapshot["event_sequence"] = json!(1);
        snapshot["ledger"] = json!([mark]);
        crate::replay_core::validate(&snapshot).map_err(bad)?;
    }
    p["execution"] = snapshot;
    Ok(())
}

async fn mutate(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    id: &str,
    tail: &str,
    method: &str,
    b: &Value,
    response_view: ResponseView,
    timings: &mut ReplayTimings,
) -> Result<Value, ApiError> {
    if tail.starts_with("prop/") && tail.ends_with("/branch") {
        let parts: Vec<_> = tail.split('/').collect();
        if parts.len() == 6 {
            return branch_prop(tx, workspace, id, parts[2], parts[4], b).await;
        }
    }
    if tail == "activity" {
        return activity(tx, workspace, id, b).await;
    }
    let compact = response_view == ResponseView::Mutation;
    let step_view = response_view == ResponseView::Step;
    let bounded_storage = (response_view != ResponseView::Full || tail.starts_with("prop/") && tail.ends_with("/feed")) && state.native_runtime
        && std::env::var("TW_V2_REPLAY_STORAGE_PROFILE").is_ok_and(|profile| profile == "compact");
    let mut record = load_record_inner(tx, workspace, id, true, !bounded_storage).await?;
    timings.mark("load_record");
    if tail.starts_with("prop/") {
        let parts: Vec<_> = tail.split('/').collect();
        if parts.len() == 6 && parts[5] == "feed" {
            return feed_prop(tx, workspace, &record, parts[2], parts[4], b, bounded_storage).await;
        }
        return Err(bad("native Prop branch route is not implemented"));
    }
    if integer(&record, "revision")? != integer(b, "expected_revision")? {
        return Err(conflict("record revision conflict"));
    }
    let base_revision = integer(&record, "revision")?;
    let mut p = record["payload"].take();
    if compact && p["asset_states"].is_object() {
        return Err(bad("mutation_view_multi_asset_unsupported"));
    }
    if step_view && (!state.native_runtime || p["asset_states"].is_object() || !bar_execution(&p["execution"])) {
        return Err(bad("step_view_requires_native_single_asset_bar_replay"));
    }
    let bar_storage = bounded_storage && b["tick_snapshot_id"].is_null()
        && (p["execution"].is_null() || matches!(p["execution"]["schema_version"].as_str(),
            Some("replay-execution-v1" | "replay-execution-v2")));
    if bounded_storage && !bar_storage {
        p = crate::replay_storage::hydrate_payload(tx, workspace, id, base_revision, p)
            .await.map_err(internal)?;
    }
    let base_event_sequence = if response_view != ResponseView::Full && !p["execution"].is_null() {
        integer(&p["execution"], "event_sequence")?
    } else {
        0
    };
    let m = manifest(tx, workspace, text(&p, "dataset_id")?).await?;
    timings.mark("load_manifest");
    let current = integer(&p, "cursor_index")?;
    let total = integer(&m, "row_count")?;
    let period = bounds(&p)?;
    let limit = period
        .as_ref()
        .map(|b| integer(b, "end_cursor_index"))
        .transpose()?
        .unwrap_or(total - 1);
    if method == "PATCH" {
        let changes = b.as_object().ok_or_else(|| bad("invalid metadata"))?;
        let mut count = 0;
        for (key, v) in changes {
            if key == "expected_revision" {
                continue;
            }
            if !["name", "description", "archived"].contains(&key.as_str()) {
                return Err(bad("only replay metadata can be updated"));
            }
            if !v.is_null() {
                p[key] = v.clone();
                count += 1
            }
        }
        if count == 0 {
            return Err(bad("only replay metadata can be updated"));
        }
        let ident = identities(tx, workspace, id, &p).await?;
        p.as_object_mut()
            .unwrap()
            .extend(ident.as_object().unwrap().clone());
        return save_record(tx, workspace, &record, p, false).await;
    }
    if step_view {
        return mutate_step_view(tx, state, workspace, id, b, record, p, &m,
            base_revision, base_event_sequence, limit, bar_storage, timings).await;
    }
    if bar_storage {
        return mutate_compact_bar(tx, state, workspace, id, tail, b, record, p, &m,
            base_revision, base_event_sequence, limit, timings).await;
    }
    match tail {
        "delete" => {
            let expected_name = p["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(id);
            if b["confirmation_name"] != expected_name {
                return Err(bad("session_delete_confirmation_mismatch"));
            }
            if tx.query_opt("SELECT 1 FROM prop_attempt_revisions WHERE workspace_id=$1 AND resume_json->'replay_binding'->>'replay_session_id'=$2 LIMIT 1",&[&workspace,&id]).await.map_err(|_|ApiError::database())?.is_some(){return Err(conflict("replay_linked_to_prop_attempt"))}
            let saved = save_record(tx, workspace, &record, p, true).await?;
            return Ok(json!({"record_id":id,"revision":saved["revision"],"deleted":true}));
        }
        "asset" => {
            let dataset = text(b, "dataset_id")?;
            let asset = p["asset_states"][dataset].clone();
            if !asset.is_object() {
                return Err(bad("asset is not part of this replay session"));
            }
            let am = manifest(tx, workspace, dataset).await?;
            times(state, &am, integer(&asset, "cursor_index")?, None).await?;
            p["dataset_id"] = json!(dataset);
            p["cursor_index"] = asset["cursor_index"].clone();
            p["execution"] = asset["execution"].clone();
            if let Some(bound) = bounds(&p)? {
                let c = integer(&p, "cursor_index")?;
                if c < integer(&bound, "start_cursor_index")?
                    || c > integer(&bound, "end_cursor_index")?
                {
                    return Err(internal("stored replay cursor exceeds its session period"));
                }
            }
        }
        "execution" => initialize(state, workspace, id, &mut p, &m, b).await?,
        "orders/market" | "orders/quick" => {
            if tail == "orders/quick" && p["execution"].is_null() {
                initialize(state, workspace, id, &mut p, &m, b).await?;
                record = save_record(tx, workspace, &record, p.clone(), false).await?;
            }
            let snapshot = p["execution"].take();
            if snapshot.is_null() {
                return Err(bad("replay execution is not initialized"));
            }
            if snapshot["cursor_index"] != current {
                return Err(conflict(
                    "replay execution cursor is inconsistent with replay state",
                ));
            }
            if p["status"] == "completed" || current >= limit {
                return Err(bad("market order requires a future replay bar"));
            }
            let bar = slice(state, &m, current, current + 1).await?.remove(0);
            asset_ready(&p, &m, &bar)?;
            let mut args = b.clone();
            let action = match b["execution_timing"].as_str().unwrap_or("next_bar") {
                "next_bar" => "queue",
                "current_quote" => {
                    args["mid_close"] = bar["close"].clone();
                    args["virtual_time_utc"] = json!(integer(&bar,"timestamp")?+integer(&snapshot,"timeframe_seconds")?);
                    "queue_current_quote"
                }
                _ => return Err(bad("unsupported market execution timing")),
            };
            p["execution"] = engine_snapshot_owned(action, snapshot, args).await?;
        }
        "orders/protection" | "orders/close" => {
            let snapshot = p["execution"].take();
            if snapshot.is_null() {
                return Err(bad("replay execution is not initialized"));
            }
            if snapshot["cursor_index"] != current {
                return Err(conflict(
                    "replay execution cursor is inconsistent with replay state",
                ));
            }
            if tail == "orders/protection" && (p["status"] == "completed" || current >= limit) {
                return Err(bad("protection changes require a future replay bar"));
            }
            let bar = slice(state, &m, current, current + 1).await?.remove(0);
            asset_ready(&p, &m, &bar)?;
            let mut args = b.clone();
            args["mid_close"] = bar["close"].clone();
            args["virtual_time_utc"] =
                json!(integer(&bar, "timestamp")? + integer(&snapshot, "timeframe_seconds")?);
            p["execution"] = engine_snapshot_owned(
                if tail == "orders/close" {
                    "close"
                } else {
                    "protection"
                },
                snapshot,
                args,
            ).await?;
        }
        "step" => {
            let steps = b["steps"].as_i64().unwrap_or(1);
            let interval = b["replay_interval_seconds"].as_i64();
            let events = if p["asset_states"].is_object() {
                step_portfolio(tx, state, workspace, &mut p, &m, steps, interval).await?
            } else {
                if let Some(bound) = &period {
                    if current < integer(bound, "start_cursor_index")? || current > limit {
                        return Err(internal("stored replay cursor exceeds its session period"));
                    }
                    if current >= limit {
                        return Err(bad("selected replay period is completed"));
                    }
                }
                let (rows, cursor) =
                    step_window(state, &m, current, steps, interval, limit).await?;
                let mut events = vec![];
                let mut s = p["execution"].take();
                if !s.is_null() {
                    if s["cursor_index"] != current {
                        return Err(conflict(
                            "replay execution cursor is inconsistent with replay state",
                        ));
                    }
                    if rows.len() > 1 {
                        let mut advanced =
                            advance_many(state, workspace, s, &rows[1..], current + 1).await?;
                        s = advanced["snapshot"].take();
                        events = advanced["events"]
                            .as_array_mut()
                            .ok_or_else(|| internal("invalid execution result"))?
                            .drain(..)
                            .collect();
                    }
                    p["execution"] = s;
                }
                let elapsed =
                    integer(rows.last().unwrap(), "timestamp")? - integer(&rows[0], "timestamp")?;
                add_elapsed(&mut p, elapsed.max(0))?;
                p["cursor_index"] = json!(cursor);
                p["status"] = json!(if cursor == limit {
                    "completed"
                } else {
                    "paused"
                });
                events
            };
            let saved = save_record(tx, workspace, &record, p, false).await?;
            let mut result = view(tx, state, workspace, saved, &HashMap::new()).await?;
            result["execution_events"] = json!(events);
            return Ok(result);
        }
        "branch" => {
            record["payload"] = p;
            return branch(tx, state, workspace, record, integer(b, "cursor_index")?).await;
        }
        _ => {
            return Err(ApiError::detail(
                StatusCode::NOT_FOUND,
                "native_replay_route_not_found",
            ));
        }
    }
    timings.mark("domain_transition");
    let saved = save_record(tx, workspace, &record, p, false).await?;
    timings.mark("revision_save");
    let response = if compact {
        mutation_view(tx, state, workspace, saved, &m, base_revision, base_event_sequence, None).await
    } else {
        view(tx, state, workspace, saved, &HashMap::new()).await
    };
    timings.mark("view_projection");
    response
}

fn bar_execution(execution: &Value) -> bool {
    execution.is_null() || matches!(execution["schema_version"].as_str(),
        Some("replay-execution-v1" | "replay-execution-v2"))
}

async fn mutate_step_view(
    tx: &Transaction<'_>, state: &AppState, workspace: &str, id: &str,
    b: &Value, record: Value, mut p: Value, manifest: &Value,
    base_revision: i64, base_event_sequence: i64, limit: i64,
    bounded_storage: bool, timings: &mut ReplayTimings,
) -> Result<Value, ApiError> {
    let current = integer(&p, "cursor_index")?;
    let total = integer(manifest, "row_count")?;
    if current < 0 || current >= total {
        return Err(internal("replay cursor exceeds immutable dataset"));
    }
    if let Some(period) = bounds(&p)? {
        if current < integer(&period, "start_cursor_index")? || current > limit || limit >= total {
            return Err(internal("stored replay cursor exceeds its session period"));
        }
        if current >= limit { return Err(bad("selected replay period is completed")); }
    }
    let (rows, cursor) = step_window(state, manifest, current,
        b["steps"].as_i64().unwrap_or(1), b["replay_interval_seconds"].as_i64(), limit).await?;
    let base_cutoff = rows.first().ok_or_else(|| internal("visible replay window is empty"))?["timestamp"].clone();
    let elapsed = integer(rows.last().unwrap(), "timestamp")? - integer(&rows[0], "timestamp")?;
    let mut events = Vec::new();
    let mut checked_transition = None;
    if p["execution"].is_null() {
        p["execution"] = Value::Null;
    }
    if !p["execution"].is_null() {
        if p["execution"]["cursor_index"] != current {
            return Err(conflict("replay execution cursor is inconsistent with replay state"));
        }
        if bounded_storage && rows.len() > 1 {
            let dataset = text(&p, "dataset_id")?.to_owned();
            let prefix = match crate::replay_storage::load_prefix(tx, workspace, id, base_revision, &dataset)
                .await.map_err(internal)? {
                Some(prefix) => prefix,
                None => {
                    p = crate::replay_storage::import_revision(tx, workspace, id, base_revision, &p)
                        .await.map_err(internal)?;
                    crate::replay_storage::load_prefix(tx, workspace, id, base_revision, &dataset)
                        .await.map_err(internal)?.ok_or_else(|| internal("imported replay prefix is unavailable"))?
                }
            };
            if !crate::replay_core::history::equivalent_json(&p["execution"], prefix.head()) {
                return Err(internal("compact replay payload differs from its validated head"));
            }
            let admission = crate::replay_storage::OperationAdmission::prepare(tx, workspace, id,
                base_revision, &prefix, &[]).await.map_err(internal)?;
            let steps: Vec<Value> = rows.iter().skip(1).enumerate()
                .map(|(index, bar)| json!({"bar":bar,"cursor_index":current + index as i64 + 1})).collect();
            timings.mark("storage_prefix_admission");
            let (prefix, transition) = tokio::task::spawn_blocking(move || {
                let transition = prefix.transition("advance_many", json!({"steps":steps}), &admission)?;
                Ok::<_, String>((prefix, transition))
            }).await.map_err(|_| internal("execution_task_failed"))?.map_err(bad)?;
            p["execution"] = transition.next.head().clone();
            events = transition.events.clone();
            checked_transition = Some((prefix, transition));
        } else {
            // A no-advance final step still saves a real revision. Keep this rare
            // edge on the fully validated cold path instead of fabricating a transition.
            if bounded_storage {
                p = crate::replay_storage::hydrate_payload(tx, workspace, id, base_revision, p)
                    .await.map_err(internal)?;
            }
            let mut snapshot = p["execution"].take();
            if rows.len() > 1 {
                let mut advanced = advance_many(state, workspace, snapshot, &rows[1..], current + 1).await?;
                snapshot = advanced["snapshot"].take();
                events = advanced["events"].as_array_mut().ok_or_else(|| internal("invalid execution result"))?
                    .drain(..).collect();
            }
            p["execution"] = snapshot;
        }
    }
    add_elapsed(&mut p, elapsed.max(0))?;
    p["cursor_index"] = json!(cursor);
    p["status"] = json!(if cursor == limit { "completed" } else { "paused" });
    if let Some((_, transition)) = &checked_transition {
        p = crate::replay_storage::compact_payload(p, &transition.next).map_err(internal)?;
    }
    timings.mark("domain_transition");
    let mut saved = save_record(tx, workspace, &record, p, false).await?;
    if let Some((prefix, transition)) = &checked_transition {
        saved["payload"] = crate::replay_storage::persist_transition(tx, workspace, id,
            base_revision, integer(&saved, "revision")?, prefix, transition, &saved["payload"])
            .await.map_err(internal)?;
    }
    timings.mark("revision_save");
    let response = step_view_response(tx, workspace, saved, manifest, base_revision,
        base_event_sequence, current, base_cutoff, rows.into_iter().skip(1).collect(), events, limit).await;
    timings.mark("view_projection");
    response
}

async fn step_view_response(
    tx: &Transaction<'_>, workspace: &str, mut saved: Value, manifest: &Value,
    base_revision: i64, base_event_sequence: i64, base_cursor: i64,
    base_cutoff: Value, rows: Vec<Value>, events: Vec<Value>, limit: i64,
) -> Result<Value, ApiError> {
    let p = &saved["payload"];
    let cursor = integer(p, "cursor_index")?;
    let identity = identities(tx, workspace, text(&saved, "record_id")?, p).await?;
    let mut execution = saved["payload"]["execution"].take();
    let sequence = if execution.is_null() { 0 } else {
        execution.as_object_mut().ok_or_else(|| internal("invalid step execution head"))?.remove("ledger");
        integer(&execution, "event_sequence")?
    };
    if saved["revision"].as_i64() != base_revision.checked_add(1)
        || cursor < base_cursor || cursor - base_cursor != rows.len() as i64
        || rows.len() > 1000 || events.len() > 3000
        || sequence.checked_sub(base_event_sequence) != Some(events.len() as i64)
        || events.iter().enumerate().any(|(index, event)|
            event["sequence"].as_i64() != Some(base_event_sequence + index as i64 + 1)
            || event["cursor_index"].as_i64().is_none_or(|event_cursor| event_cursor <= base_cursor || event_cursor > cursor))
    {
        return Err(internal("step response suffix is inconsistent or exceeds its bound"));
    }
    let cutoff = rows.last().map(|row| row["timestamp"].clone()).unwrap_or_else(|| base_cutoff.clone());
    let start = (cursor - 1999).max(0);
    let p = &saved["payload"];
    let mut result = json!({
        "schema_version":"replay-step-v1", "workspace_id":workspace,
        "record_id":saved["record_id"], "dataset_id":p["dataset_id"],
        "dataset_sha256":manifest["artifact_sha256"], "branch_id":p["branch_id"],
        "base_revision":base_revision, "revision":saved["revision"],
        "base_event_sequence":base_event_sequence, "execution_event_sequence":sequence,
        "base_cursor_index":base_cursor, "base_cutoff_timestamp":base_cutoff,
        "cursor_index":cursor,"view_cursor_index":cursor,"canonical_cursor_index":cursor,
        "cutoff_timestamp":cutoff,"appended_rows":rows,"appended_events":events,
        "historical_view":false,"has_future_rows":cursor < limit,
        "execution_view_status":if execution.is_null(){"not_initialized"}else{"current"},
        "updated_at_utc":saved["updated_at_utc"],"visible_row_start":start,
        "visible_row_count":cursor-start+1,"total_row_count":manifest["row_count"],
        "payload_patch":{"execution":execution,"cursor_index":cursor,"status":p["status"],"timing":p["timing"]}
    });
    result.as_object_mut().unwrap().extend(identity.as_object().unwrap().clone());
    Ok(result)
}

#[cfg(test)]
mod response_view_tests {
    use super::*;

    #[test]
    fn response_views_are_explicit_and_route_scoped() {
        assert!(matches!(mutation_response(&HashMap::new(), "step"), Ok(ResponseView::Full)));
        for tail in ["execution", "orders/quick", "orders/market", "orders/protection", "orders/close"] {
            assert!(matches!(mutation_response(&pairs(Some("response_view=mutation-v1")), tail), Ok(ResponseView::Mutation)));
            assert!(mutation_response(&pairs(Some("response_view=step-v1")), tail).is_err());
        }
        assert!(matches!(mutation_response(&pairs(Some("response_view=step-v1")), "step"), Ok(ResponseView::Step)));
        for tail in ["", "step", "branch", "asset"] {
            assert!(mutation_response(&pairs(Some("response_view=mutation-v1")), tail).is_err());
        }
        for value in ["", "unknown", "full"] {
            assert!(mutation_response(&pairs(Some(&format!("response_view={value}"))), "step").is_err());
        }
    }

    #[test]
    fn step_capability_excludes_tick_and_unknown_execution_schemas() {
        assert!(bar_execution(&Value::Null));
        for version in ["replay-execution-v1", "replay-execution-v2"] {
            assert!(bar_execution(&json!({"schema_version":version})));
        }
        for version in ["replay-execution-tick-v1", "future-schema"] {
            assert!(!bar_execution(&json!({"schema_version":version})));
        }
    }
}

async fn mutate_compact_bar(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    id: &str,
    tail: &str,
    b: &Value,
    mut record: Value,
    mut p: Value,
    manifest: &Value,
    base_revision: i64,
    base_event_sequence: i64,
    limit: i64,
    timings: &mut ReplayTimings,
) -> Result<Value, ApiError> {
    let mut initialized_events = Vec::new();
    if tail == "execution" || (tail == "orders/quick" && p["execution"].is_null()) {
        initialize(state, workspace, id, &mut p, manifest, b).await?;
        let events = p["execution"]["ledger"].as_array()
            .ok_or_else(|| internal("invalid initialized replay ledger"))?.clone();
        record = save_record(tx, workspace, &record, p, false).await?;
        let revision = integer(&record, "revision")?;
        record["payload"] = crate::replay_storage::import_revision(tx, workspace, id,
            revision, &record["payload"]).await.map_err(internal)?;
        if tail == "execution" {
            timings.mark("domain_transition");
            timings.mark("revision_save");
            let response = mutation_view(tx, state, workspace, record, manifest,
                base_revision, base_event_sequence, Some(events)).await;
            timings.mark("view_projection");
            return response;
        }
        initialized_events = events;
        p = record["payload"].take();
    }
    if p["execution"].is_null() {
        return Err(bad("replay execution is not initialized"));
    }
    let revision = integer(&record, "revision")?;
    let dataset = text(&p, "dataset_id")?.to_owned();
    let prefix = match crate::replay_storage::load_prefix(tx, workspace, id, revision, &dataset)
        .await.map_err(internal)? {
        Some(prefix) => prefix,
        None => {
            p = crate::replay_storage::import_revision(tx, workspace, id, revision, &p)
                .await.map_err(internal)?;
            crate::replay_storage::load_prefix(tx, workspace, id, revision, &dataset)
                .await.map_err(internal)?
                .ok_or_else(|| internal("imported replay prefix is unavailable"))?
        }
    };
    let head = prefix.head();
    if p["execution"] != *head {
        return Err(internal("compact replay payload differs from its validated head"));
    }
    let current = integer(&p, "cursor_index")?;
    if head["cursor_index"] != current {
        return Err(conflict("replay execution cursor is inconsistent with replay state"));
    }
    if matches!(tail, "orders/market" | "orders/quick")
        && (p["status"] == "completed" || current >= limit)
    {
        return Err(bad("market order requires a future replay bar"));
    }
    if tail == "orders/protection" && (p["status"] == "completed" || current >= limit) {
        return Err(bad("protection changes require a future replay bar"));
    }
    let bar = slice(state, manifest, current, current + 1).await?.remove(0);
    asset_ready(&p, manifest, &bar)?;
    let mut args = b.clone();
    let action = match tail {
        "orders/market" | "orders/quick" => match b["execution_timing"].as_str().unwrap_or("next_bar") {
            "next_bar" => "queue",
            "current_quote" => {
                args["mid_close"] = bar["close"].clone();
                args["virtual_time_utc"] = json!(integer(&bar, "timestamp")? + integer(head, "timeframe_seconds")?);
                "queue_current_quote"
            }
            _ => return Err(bad("unsupported market execution timing")),
        },
        "orders/protection" | "orders/close" => {
            args["mid_close"] = bar["close"].clone();
            args["virtual_time_utc"] = json!(integer(&bar, "timestamp")? + integer(head, "timeframe_seconds")?);
            if tail == "orders/close" { "close" } else { "protection" }
        }
        _ => return Err(bad("unsupported compact replay transition")),
    };
    let operation = text(b, "operation_id")?;
    if operation.trim().is_empty() || operation.len() > 128 {
        return Err(bad("operation_id must be a bounded nonempty identifier"));
    }
    let admission = crate::replay_storage::OperationAdmission::prepare(tx, workspace, id,
        revision, &prefix, &[operation]).await.map_err(internal)?;
    timings.mark("storage_prefix_admission");
    let (prefix, transition) = tokio::task::spawn_blocking(move || {
        let transition = prefix.transition(action, args, &admission)?;
        Ok::<_, String>((prefix, transition))
    }).await.map_err(|_| internal("execution_task_failed"))?.map_err(bad)?;
    p["execution"] = transition.next.head().clone();
    let payload = crate::replay_storage::compact_payload(p, &transition.next).map_err(internal)?;
    timings.mark("domain_transition");
    let mut saved = save_record(tx, workspace, &record, payload, false).await?;
    saved["payload"] = crate::replay_storage::persist_transition(tx, workspace, id, revision,
        integer(&saved, "revision")?, &prefix, &transition, &saved["payload"])
        .await.map_err(internal)?;
    timings.mark("revision_save");
    initialized_events.extend(transition.events);
    let response = mutation_view(tx, state, workspace, saved, manifest,
        base_revision, base_event_sequence, Some(initialized_events)).await;
    timings.mark("view_projection");
    response
}

async fn mutation_view(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    mut saved: Value,
    manifest: &Value,
    base_revision: i64,
    base_event_sequence: i64,
    appended_events: Option<Vec<Value>>,
) -> Result<Value, ApiError> {
    let p = &saved["payload"];
    let cursor = integer(p, "cursor_index")?;
    let total = integer(manifest, "row_count")?;
    if cursor < 0 || cursor >= total {
        return Err(internal("replay cursor exceeds immutable dataset"));
    }
    let period = bounds(p)?;
    if let Some(bound) = &period {
        if cursor < integer(bound, "start_cursor_index")?
            || cursor > integer(bound, "end_cursor_index")?
            || integer(bound, "end_cursor_index")? >= total
        {
            return Err(internal("stored replay cursor exceeds its session period"));
        }
    }
    let future = cursor < period.as_ref().map(|bound| integer(bound, "end_cursor_index"))
        .transpose()?.unwrap_or(total - 1);
    let cutoff = slice(state, manifest, cursor, cursor + 1).await?
        .pop().ok_or_else(|| internal("visible replay window is empty"))?["timestamp"].clone();
    let identity = identities(tx, workspace, text(&saved, "record_id")?, p).await?;
    let mut execution = saved["payload"]["execution"].take();
    let sequence = integer(&execution, "event_sequence")?;
    let base = usize::try_from(base_event_sequence)
        .map_err(|_| internal("invalid mutation base event sequence"))?;
    let events = if let Some(events) = appended_events {
        if execution.get("ledger").is_some() {
            return Err(internal("compact mutation head unexpectedly contains a ledger"));
        }
        events
    } else {
        let ledger = execution.as_object_mut()
            .and_then(|head| head.remove("ledger"))
            .and_then(|ledger| match ledger { Value::Array(events) => Some(events), _ => None })
            .ok_or_else(|| internal("invalid execution ledger in mutation response"))?;
        if usize::try_from(sequence).ok() != Some(ledger.len()) || base > ledger.len() {
            return Err(internal("mutation event suffix is inconsistent"));
        }
        ledger.into_iter().skip(base).collect()
    };
    if sequence.checked_sub(base_event_sequence).and_then(|count| usize::try_from(count).ok()) != Some(events.len())
        || events.len() > 16 {
        return Err(internal("mutation event suffix is inconsistent or exceeds its bound"));
    }
    if events.iter().enumerate().any(|(index, event)| event["sequence"].as_i64() != Some(base_event_sequence + index as i64 + 1)) {
        return Err(internal("mutation event suffix is not contiguous"));
    }
    let p = &saved["payload"];
    let mut result = json!({
        "schema_version":"replay-mutation-v1", "workspace_id":workspace,
        "record_id":saved["record_id"], "dataset_id":p["dataset_id"],
        "dataset_sha256":manifest["artifact_sha256"], "branch_id":p["branch_id"],
        "base_revision":base_revision, "revision":saved["revision"],
        "base_event_sequence":base_event_sequence, "execution_event_sequence":sequence,
        "appended_events":events, "updated_at_utc":saved["updated_at_utc"],
        "cursor_index":cursor, "view_cursor_index":cursor, "canonical_cursor_index":cursor,
        "cutoff_timestamp":cutoff, "historical_view":false, "has_future_rows":future,
        "execution_view_status":"current",
        "payload_patch":{"execution":execution, "cursor_index":cursor, "status":p["status"], "timing":p["timing"]}
    });
    result.as_object_mut().unwrap().extend(identity.as_object().unwrap().clone());
    Ok(result)
}
fn asset_ready(p: &Value, m: &Value, bar: &Value) -> Result<(), ApiError> {
    if p["asset_states"].is_object()
        && integer(bar, "timestamp")? + integer(m, "timeframe_seconds")?
            < integer(p, "replay_clock_utc")?
    {
        return Err(bad(
            "asset has no newly closed bar at the shared replay clock",
        ));
    }
    Ok(())
}
fn add_elapsed(p: &mut Value, elapsed: i64) -> Result<(), ApiError> {
    if !p["timing"].is_object() {
        p["timing"] = timing(true)
    }
    let current = p["timing"]["historical_time_replayed_seconds"]
        .as_i64()
        .ok_or_else(|| internal("stored replay timing is invalid"))?;
    p["timing"]["historical_time_replayed_seconds"] = json!(
        current
            .checked_add(elapsed)
            .ok_or_else(|| internal("replay timing overflow"))?
    );
    Ok(())
}
async fn advance_many(
    state: &AppState,
    workspace: &str,
    snapshot: Value,
    rows: &[Value],
    start: i64,
) -> Result<Value, ApiError> {
    let mut steps = Vec::with_capacity(rows.len());
    for (i, bar) in rows.iter().enumerate() {
        let mut args = json!({"bar":bar,"cursor_index":start+i as i64});
        if snapshot["schema_version"] == "replay-execution-tick-v1" {
            let begin = integer(bar, "timestamp")? * 1000;
            let end = begin + integer(&snapshot, "timeframe_seconds")? * 1000;
            let w = workspace.to_owned();
            let tid = text(&snapshot, "tick_snapshot_id")?.to_owned();
            args["ticks"] =
                json!(read(state, move |r| r.tick_interval(&w, &tid, begin, end)).await?);
        }
        steps.push(args);
    }
    let mut request = json!({"action":"advance_many","args":{"steps":steps}});
    request["snapshot"] = snapshot;
    tokio::task::spawn_blocking(move || crate::replay_core::transform_owned(request))
        .await
        .map_err(|_| internal("execution_task_failed"))?
        .map_err(bad)
}
async fn step_portfolio(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    p: &mut Value,
    m: &Value,
    steps: i64,
    interval: Option<i64>,
) -> Result<Vec<Value>, ApiError> {
    let current = integer(p, "cursor_index")?;
    let bound = bounds(p)?;
    if let Some(bound) = &bound {
        if current < integer(bound, "start_cursor_index")?
            || current > integer(bound, "end_cursor_index")?
        {
            return Err(internal("stored replay cursor exceeds its session period"));
        }
        if integer(p, "replay_clock_utc")? >= integer(p, "replay_end_utc")? {
            return Err(bad("selected replay period is completed"));
        }
    }
    let limit = bound
        .as_ref()
        .map(|b| integer(b, "end_cursor_index"))
        .transpose()?
        .unwrap_or(integer(m, "row_count")? - 1);
    let (rows, _) = step_window(state, m, current, steps, interval, limit).await?;
    let exhausted = bound.is_some()
        && (current >= limit
            || interval.is_none() && current + steps > limit
            || interval.is_some_and(|i| {
                rows.last().unwrap()["timestamp"].as_i64().unwrap()
                    < (rows[0]["timestamp"].as_i64().unwrap() / i + 1) * i
            }));
    let end = integer(p, "replay_end_utc")?;
    let clock = if exhausted {
        end
    } else {
        (integer(rows.last().unwrap(), "timestamp")? + integer(m, "timeframe_seconds")?).min(end)
    };
    let mut events = vec![];
    let keys: Vec<_> = p["dataset_ids"]
        .as_array()
        .ok_or_else(|| bad("invalid portfolio datasets"))?
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_owned())
        .collect();
    for key in keys {
        let am = manifest(tx, workspace, &key).await?;
        let target = integer(
            &times(
                state,
                &am,
                0,
                Some(clock - integer(&am, "timeframe_seconds")?),
            )
            .await?,
            "cursor_index",
        )?;
        let mut state_entry = p["asset_states"][&key].clone();
        let old = integer(&state_entry, "cursor_index")?;
        if target < old {
            return Err(internal("portfolio replay clock moves backwards"));
        }
        if bound.is_some() {
            let mut a = p.clone();
            a["dataset_id"] = json!(key);
            if target > integer(&bounds(&a)?.unwrap(), "end_cursor_index")? {
                return Err(internal(
                    "portfolio replay clock exceeds its session period",
                ));
            }
        }
        let mut s = state_entry["execution"].clone();
        if !s.is_null() {
            if s["cursor_index"] != old {
                return Err(conflict("portfolio execution cursor is inconsistent"));
            }
            let mut begin = old + 1;
            while begin <= target {
                let window = slice(state, &am, begin, (begin + 1000).min(target + 1)).await?;
                let mut out = advance_many(state, workspace, s, &window, begin).await?;
                s = out["snapshot"].take();
                events.extend(
                    out["events"]
                        .as_array_mut()
                        .ok_or_else(|| internal("invalid execution result"))?
                        .drain(..),
                );
                begin += 1000;
            }
        }
        state_entry["cursor_index"] = json!(target);
        state_entry["execution"] = s;
        p["asset_states"][&key] = state_entry;
    }
    add_elapsed(p, (clock - integer(p, "replay_clock_utc")?).max(0))?;
    p["replay_clock_utc"] = json!(clock);
    p["status"] = json!(if clock >= end { "completed" } else { "paused" });
    let active = text(p, "dataset_id")?.to_owned();
    p["cursor_index"] = p["asset_states"][&active]["cursor_index"].clone();
    p["execution"] = p["asset_states"][&active]["execution"].clone();
    events.sort_by_key(|e| {
        (
            e["virtual_time_utc"].as_i64().unwrap_or(0),
            e["dataset_id"].as_str().unwrap_or("").to_owned(),
            e["sequence"].as_i64().unwrap_or(0),
        )
    });
    Ok(events)
}
async fn branch(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    record: Value,
    cursor: i64,
) -> Result<Value, ApiError> {
    let parent = text(&record, "record_id")?;
    let revision = integer(&record, "revision")?;
    let old = &record["payload"];
    let current = integer(old, "cursor_index")?;
    if cursor < 0 || cursor > current {
        return Err(bad("branch cursor cannot exceed current replay cursor"));
    }
    let bound = bounds(old)?;
    if bound.as_ref().is_some_and(|b| {
        b["start_cursor_index"]
            .as_i64()
            .is_some_and(|start| cursor < start)
    }) {
        return Err(bad("branch cursor is before the selected replay period"));
    }
    let child = uid();
    let branch = uid();
    let mut p;
    if old["asset_states"].is_object() {
        let cp = checkpoint_record(
            tx,
            state,
            workspace,
            record.clone(),
            Some(cursor),
            None,
            None,
        )
        .await?;
        p = cp["payload"].clone();
        if integer(&p, "replay_clock_utc")? < integer(&p, "replay_start_utc")? {
            return Err(bad(
                "portfolio branch must remain within the common replay period",
            ));
        }
        let mut sequences = Map::new();
        for (key, asset) in p["asset_states"].as_object_mut().unwrap() {
            sequences.insert(
                key.clone(),
                asset["execution"]
                    .get("event_sequence")
                    .cloned()
                    .unwrap_or(json!(0)),
            );
            if !asset["execution"].is_null() {
                asset["execution"] = engine_snapshot(
                    "fork",
                    &asset["execution"],
                    json!({"replay_session_id":child,"branch_id":branch}),
                )?;
            }
        }
        p["parent_asset_checkpoint_sequences"] = Value::Object(sequences);
        let active = text(&p, "dataset_id")?.to_owned();
        p["execution"] = p["asset_states"][&active]["execution"].clone();
    } else {
        p = json!({"dataset_id":old["dataset_id"],"cursor_index":cursor});
        for key in [
            "name",
            "description",
            "starting_balance",
            "starting_balance_ccy",
            "playbook_id",
            "playbook_revision",
            "chart_engine",
            "session_period",
        ] {
            if let Some(v) = old.get(key) {
                p[key] = v.clone();
            }
        }
        if !old["execution"].is_null() {
            let rows=tx.query("SELECT revision,payload_json FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision<=$3 AND NOT deleted ORDER BY revision DESC",&[&workspace,&parent,&(revision as i32)]).await.map_err(|_|ApiError::database())?;
            let mut found = None;
            for row in rows {
                let prior = crate::replay_storage::hydrate_payload(tx, workspace, &parent,
                    i64::from(row.get::<_, i32>(0)), row.get(1)).await.map_err(internal)?;
                let s = &prior["execution"];
                if prior["cursor_index"] == cursor && !s.is_null() {
                    if s["cursor_index"] != cursor {
                        return Err(internal(
                            "historical replay execution cursor is inconsistent with replay state",
                        ));
                    }
                    found = Some((s.clone(), row.get::<_, i32>(0) as i64, "record_revision"));
                    break;
                }
            }
            let (cp, cp_rev, source) = if let Some(cp) = found {
                cp
            } else {
                (
                    engine_snapshot(
                        "reconstruct",
                        &old["execution"],
                        json!({"cursor_index":cursor}),
                    )?,
                    revision,
                    "ledger_price_mark",
                )
            };
            lineage(&cp, &old["execution"])?;
            p["execution"] = engine_snapshot(
                "fork",
                &cp,
                json!({"replay_session_id":child,"branch_id":branch}),
            )?;
            p["parent_checkpoint_revision"] = json!(cp_rev);
            p["parent_checkpoint_event_sequence"] = cp["event_sequence"].clone();
            p["parent_checkpoint_source"] = json!(source);
        }
    }
    p["branch_id"] = json!(branch);
    p["parent_session_id"] = json!(parent);
    p["parent_revision"] = json!(revision);
    p["status"] = json!(if bound
        .as_ref()
        .is_some_and(|b| b["end_cursor_index"] == cursor)
        && !old["asset_states"].is_object()
        || p["asset_states"].is_object() && p["replay_clock_utc"] == p["replay_end_utc"]
    {
        "completed"
    } else {
        "paused"
    });
    p["timing"] = timing(false);
    let created = create_record(tx, workspace, &child, p).await?;
    view(tx, state, workspace, created, &HashMap::new()).await
}
async fn activity(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    b: &Value,
) -> Result<Value, ApiError> {
    // Activity changes no financial state. Keep the existing head lock/deletion
    // check without hydrating history while an order waits for that same lock.
    let head = tx.query_opt("SELECT current_revision FROM workspace_records WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 FOR UPDATE", &[&workspace, &id])
        .await.map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "replay_not_found"))?;
    let revision: i32 = head.get(0);
    let version = tx.query_opt("SELECT deleted FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3", &[&workspace, &id, &revision])
        .await.map_err(|_| ApiError::database())?
        .ok_or_else(|| internal("replay_revision_missing"))?;
    if version.get::<_, bool>(0) {
        return Err(ApiError::detail(StatusCode::NOT_FOUND, "replay_not_found"));
    }
    let event =
        Uuid::parse_str(text(b, "event_id")?).map_err(|_| bad("invalid activity event id"))?;
    let start = DateTime::parse_from_rfc3339(text(b, "started_at_utc")?)
        .map_err(|_| bad("invalid activity start time"))?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(text(b, "ended_at_utc")?)
        .map_err(|_| bad("invalid activity end time"))?
        .with_timezone(&Utc);
    let ms = (end - start).num_milliseconds();
    if !(1..=30000).contains(&ms) {
        return Err(bad(
            "activity interval must be positive and at most 30 seconds",
        ));
    }
    if end > Utc::now() + chrono::Duration::seconds(5) {
        return Err(bad("activity interval is in the future"));
    }
    if start < Utc::now() - chrono::Duration::hours(24) {
        return Err(bad("activity interval is older than 24 hours"));
    }
    let inserted=tx.query_opt("INSERT INTO replay_activity_intervals(workspace_id,session_id,event_id,started_at_utc,ended_at_utc) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING event_id",&[&workspace,&id,&event,&start,&end]).await.map_err(|_|ApiError::database())?.is_some();
    if !inserted {
        let row=tx.query_one("SELECT started_at_utc,ended_at_utc FROM replay_activity_intervals WHERE workspace_id=$1 AND session_id=$2 AND event_id=$3",&[&workspace,&id,&event]).await.map_err(|_|ApiError::database())?;
        if row.get::<_, DateTime<Utc>>(0) != start || row.get::<_, DateTime<Utc>>(1) != end {
            return Err(conflict("activity_event_id_conflict"));
        }
    }
    Ok(
        json!({"schema_version":"replay-activity-v1","session_id":id,"event_id":event.to_string(),"duplicate":!inserted,"accepted_seconds":ms as f64/1000.0}),
    )
}
async fn tick_options(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    record: &Value,
) -> Result<Value, ApiError> {
    let p = &record["payload"];
    if p["asset_states"].is_object() {
        return Ok(
            json!({"available":false,"execution_capability":false,"reason":"Phiên nhiều tài sản sử dụng nến OHLC."}),
        );
    }
    let m = manifest(tx, workspace, text(p, "dataset_id")?).await?;
    let t = times(state, &m, integer(p, "cursor_index")?, None).await?;
    let w = workspace.to_owned();
    let symbol = text(&m, "instrument_id")?.to_owned();
    let ticks = read(state, move |r| r.latest_ticks(&w, &symbol)).await?;
    let mut result = json!({"available":false,"execution_capability":false,"reason":"Tick chưa được tải cho asset này."});
    let Some(ticks) = ticks else {
        return Ok(result);
    };
    for key in [
        "snapshot_id",
        "row_count",
        "bytes",
        "first_tick_msc",
        "last_tick_msc",
        "quality",
    ] {
        result[key] = ticks[key].clone();
    }
    if m["source"]["provider"]
        != format!("{} / MT5", ticks["source"]["server"].as_str().unwrap_or(""))
    {
        result["reason"] = json!("Nguồn tick không khớp nguồn dataset.");
        return Ok(result);
    }
    let begin = integer(&t, "index_utc")? * 1000;
    let end = begin + integer(&m, "timeframe_seconds")? * 1000;
    let w = workspace.to_owned();
    let id = text(&ticks, "snapshot_id")?.to_owned();
    match read(state, move |r| r.tick_interval(&w, &id, begin, end)).await {
        Ok(rows) if !rows.is_empty() => {
            result["available"] = json!(true);
            result["reason"] = json!("Bid/Ask lịch sử; phí vẫn theo model đã chọn.")
        }
        Ok(_) => result["reason"] = json!("Broker không trả tick trong phút đang chọn."),
        Err(_) => result["reason"] = json!("Phút đang chọn nằm ngoài đoạn tick đã tải."),
    };
    Ok(result)
}

fn utc(seconds: i64) -> Result<String, ApiError> {
    Ok(DateTime::<Utc>::from_timestamp(seconds, 0)
        .ok_or_else(|| bad("replay virtual time out of range"))?
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}
fn prop_resume(prior: &Value, snapshot: &Value, event: &Value) -> Result<Value, ApiError> {
    let mut r = prior.clone();
    r.as_object_mut()
        .ok_or_else(|| bad("invalid Prop resume state"))?
        .remove("prop_lifecycle");
    r["cursor"] = json!({"bar_index":event["cursor_index"],"timestamp_utc":utc(integer(event,"virtual_time_utc")?)?});
    r["open_positions"] = if event["details"]["open_position"].is_null() {
        json!([])
    } else {
        json!([event["details"]["open_position"]])
    };
    r["pending_orders"] = if event["details"]["pending_market_order"].is_null() {
        json!([])
    } else {
        json!([event["details"]["pending_market_order"]])
    };
    r["replay_binding"] = json!({"replay_session_id":snapshot["replay_session_id"],"branch_id":snapshot["branch_id"],"dataset_id":snapshot["dataset_id"],"dataset_sha256":snapshot["dataset_sha256"],"last_replay_event_sequence":event["sequence"]});
    Ok(r)
}
async fn feed_prop(
    tx: &Transaction<'_>,
    workspace: &str,
    record: &Value,
    session: &str,
    attempt: &str,
    b: &Value,
    bounded_storage: bool,
) -> Result<Value, ApiError> {
    let p = &record["payload"];
    if p["asset_states"].is_object() {
        return Err(bad("multi-asset replay is not supported by Prop lifecycle"));
    }
    let s = &p["execution"];
    if s.is_null() {
        return Err(bad("replay execution is not initialized"));
    }
    let current = crate::prop_service::load_attempt(tx, workspace, session, attempt, true).await?;
    let binding = &current["resume_state"]["replay_binding"];
    let mut last = 0;
    if !binding.is_null() {
        if !binding.is_object() {
            return Err(bad("prop replay binding is invalid"));
        }
        for key in [
            "replay_session_id",
            "branch_id",
            "dataset_id",
            "dataset_sha256",
        ] {
            if binding[key] != s[key] {
                return Err(bad(
                    "prop attempt is already bound to a different replay lineage",
                ));
            }
        }
        last = binding["last_replay_event_sequence"].as_i64().unwrap_or(0);
    }
    let sequence = integer(b, "replay_event_sequence")?;
    let selected = if bounded_storage && bar_execution(s) {
        crate::replay_storage::load_prop_marks(tx, workspace, text(record, "record_id")?,
            integer(record, "revision")?, text(p, "dataset_id")?, sequence, last)
            .await.map_err(internal)?
    } else { None };
    let (event, next_sequence) = if let Some(selected) = selected {
        if !crate::replay_core::history::equivalent_json(s, selected.prefix.head())
            || p["cursor_index"] != s["cursor_index"] || p["branch_id"] != s["branch_id"] {
            return Err(internal("compact Prop source differs from its validated head"));
        }
        (selected.requested_event, selected.next_sequence)
    } else {
        crate::replay_core::validate(s).map_err(bad)?;
        let marks = s["ledger"].as_array().ok_or_else(|| bad("invalid execution ledger"))?
            .iter().filter(|event| matches!(event["kind"].as_str(),
                Some("price_mark" | "manual_close" | "order_cancel")));
        (marks.clone().find(|event| event["sequence"] == sequence).cloned(),
            marks.filter_map(|event| event["sequence"].as_i64()).filter(|value| *value > last).min())
    };
    crate::prop_core::validate_replay_prop_binding(s, &current["attempt"], &current["phase"])
        .map_err(bad)?;
    let event = event.ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "replay price_mark event not found"))?;
    let operation = crate::prop_core::replay_event_operation_id(
        text(s, "replay_session_id")?, text(s, "branch_id")?, sequence, session, attempt);
    let prior=tx.query_opt("SELECT v.phase_json,v.resume_json FROM prop_mutation_receipts r JOIN prop_attempt_revisions v ON v.workspace_id=r.workspace_id AND v.session_id=r.session_id AND v.attempt_id=r.attempt_id AND v.revision=r.entity_revision WHERE r.workspace_id=$1 AND r.session_id=$2 AND r.attempt_id=$3 AND r.operation_id=$4",&[&workspace,&session,&attempt,&operation]).await.map_err(|_|ApiError::database())?;
    if prior.is_none() {
        if sequence < last {
            return Err(bad("replay lifecycle events cannot move backwards"));
        }
        if sequence > last && next_sequence != Some(sequence)
        {
            return Err(bad(
                "replay price_mark events must feed prop lifecycle in order",
            ));
        }
        let expected = integer(b, "prop_event_sequence")?;
        let current = integer(&current["phase"], "last_event_sequence")?;
        if expected != current && expected != current + 1 {
            return Err(bad(
                "prop event sequence is not the next event or an exact retry",
            ));
        }
    }
    let (phase, resume) = if let Some(row) = prior {
        (row.get::<_, Value>(0), row.get::<_, Value>(1))
    } else {
        (current["phase"].clone(), current["resume_state"].clone())
    };
    let phase_index = integer(&phase, "phase_index")?;
    let spec = current["session"]["profile"]["phases"]
        .as_array()
        .and_then(|a| a.get((phase_index - 1) as usize))
        .ok_or_else(|| bad("prop phase index is outside the frozen profile"))?;
    let args = json!({"workspace_id":workspace,"prop_session_id":session,"prop_attempt_id":attempt,"profile_hash":current["attempt"]["profile_hash"],"expected_prop_revision":b["expected_prop_revision"],"prop_event_sequence":b["prop_event_sequence"]});
    let prop_event =
        crate::prop_core::replay_mark_to_prop_event(&args, spec, &event).map_err(bad)?;
    let resume = prop_resume(&resume, s, &event)?;
    let result =
        crate::prop_service::apply_lifecycle_event(tx, workspace, &prop_event, Some(&resume))
            .await?;
    Ok(
        json!({"replay_event":event,"prop_event":prop_event,"attempt":result["attempt"],"phase":result["phase"],"resume_state":result["resume_state"],"objectives":result["objectives"],"duplicate":result["duplicate"]}),
    )
}

pub async fn handle_bound_next_phase(
    tx: &Transaction<'_>,
    workspace: &str,
    intent: &Value,
    current: &Value,
) -> Result<Value, ApiError> {
    let id = text(
        &current["resume_state"]["replay_binding"],
        "replay_session_id",
    )?;
    let record = load_record(tx, workspace, id, true).await?;
    let mut p = record["payload"].clone();
    let s = &p["execution"];
    crate::replay_core::validate(s)
        .map_err(|_| conflict("canonical replay execution snapshot is invalid"))?;
    let fingerprint = crate::prop_core::intent_fingerprint(intent).map_err(bad)?;
    let operation = text(intent, "intent_id")?;
    let session = text(intent, "session_id")?;
    let attempt = text(intent, "attempt_id")?;
    if crate::prop_service::mutation_receipt(
        tx,
        workspace,
        session,
        attempt,
        operation,
        &fingerprint,
    )
    .await?
    .is_some()
    {
        let found =
            s["ledger"].as_array().unwrap().iter().find(|e| {
                e["kind"] == "phase_transition" && e["details"]["intent_id"] == operation
            });
        if found.is_none_or(|e| e["details"]["intent_fingerprint"] != fingerprint) {
            return Err(conflict(
                "idempotency receipt has no matching canonical replay transition event",
            ));
        }
        if current["session"]["status"] != current["attempt"]["status"] {
            return Err(conflict(
                "prop session and attempt lifecycle status diverged",
            ));
        }
        return Ok(
            json!({"session":current["session"],"attempt":current["attempt"],"phase":current["phase"],"resume_state":current["resume_state"],"duplicate":true,"replay_record":{"record_id":id,"revision":record["revision"],"payload":p}}),
        );
    }
    if current["attempt"]["revision"] != intent["expected_revision"] {
        return Err(conflict("prop attempt revision conflict"));
    }
    if current["session"]["status"] != current["attempt"]["status"] {
        return Err(conflict(
            "prop session and attempt lifecycle status diverged",
        ));
    }
    let m = manifest(tx, workspace, text(s, "dataset_id")?).await?;
    if m["artifact_sha256"] != s["dataset_sha256"] {
        return Err(conflict("canonical replay dataset sha256 changed"));
    }
    let ix = integer(&current["phase"], "phase_index")?;
    let spec = current["session"]["profile"]["phases"]
        .as_array()
        .and_then(|a| a.get((ix - 1) as usize))
        .ok_or_else(|| bad("unknown frozen phase"))?;
    crate::prop_core::validate_replay_prop_transition_boundary(
        s,
        &p,
        integer(&m, "row_count")?,
        &current["attempt"],
        &current["phase"],
        &current["resume_state"],
        spec,
    )
    .map_err(conflict)?;
    let mut result = crate::prop_core::apply_prop_lifecycle_command(
        &current["session"],
        &current["attempt"],
        &current["phase"],
        intent,
        &current["resume_state"],
        true,
    )
    .map_err(conflict)?;
    let time = DateTime::parse_from_rfc3339(text(&current["phase"], "virtual_time_utc")?)
        .map_err(|_| bad("invalid phase time"))?
        .timestamp();
    let next = engine_snapshot(
        "transition",
        s,
        json!({"intent_id":operation,"intent_fingerprint":result["intent_fingerprint"],"from_phase_index":ix,"to_phase_index":result["phase"]["phase_index"],"carry_policy":spec["carry_policy"],"position_policy":spec["position_policy"],"next_phase_initial_balance":result["phase"]["initial_balance"],"virtual_time_utc":time}),
    )?;
    for key in [
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
    ] {
        result["resume_state"]["replay_binding"][key] = next[key].clone();
    }
    result["resume_state"]["replay_binding"]["last_replay_event_sequence"] =
        next["event_sequence"].clone();
    result["resume_state"]["replay_binding"]["phase_index"] =
        result["phase"]["phase_index"].clone();
    crate::prop_core::validate_replay_prop_transition_result(
        &next,
        &result["attempt"],
        &result["phase"],
        &result["resume_state"],
    )
    .map_err(conflict)?;
    p["execution"] = next;
    let saved = save_record(tx, workspace, &record, p, false).await?;
    let mut persisted =
        crate::prop_service::persist_result(tx, current, &result, operation, &fingerprint).await?;
    persisted["replay_record"] =
        json!({"record_id":id,"revision":saved["revision"],"payload":saved["payload"]});
    Ok(persisted)
}

fn semantic(a: &Value, b: &Value) -> bool {
    if a == b {
        return true;
    }
    match (a, b) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|w| semantic(v, w)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| semantic(x, y))
        }
        (Value::String(a), Value::String(b)) => {
            if let (Ok(a), Ok(b)) = (BigDecimal::from_str(a), BigDecimal::from_str(b)) {
                return a == b;
            }
            if let (Ok(a), Ok(b)) = (
                DateTime::parse_from_rfc3339(a),
                DateTime::parse_from_rfc3339(b),
            ) {
                return a == b;
            }
            false
        }
        _ => false,
    }
}
fn terminal(a: &Value) -> bool {
    matches!(
        a["status"].as_str(),
        Some("completed_pass" | "failed_breach" | "expired" | "abandoned")
    )
}
async fn branch_prop(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    session: &str,
    parent_attempt: &str,
    b: &Value,
) -> Result<Value, ApiError> {
    use sha2::{Digest, Sha256};
    let preview = load_record(tx, workspace, id, false).await?;
    let mut keys = vec![id.to_owned()];
    if let Some(parent) = preview["payload"]["parent_session_id"].as_str() {
        keys.push(parent.to_owned())
    }
    keys.sort();
    keys.dedup();
    for key in keys {
        load_record(tx, workspace, &key, true).await?;
    }
    let operation = text(b, "operation_id")?;
    let identity = format!("{workspace}|{session}|{parent_attempt}|{operation}");
    let child_attempt = format!(
        "branch-{}",
        &format!("{:x}", Sha256::digest(identity.as_bytes()))[..40]
    );
    let input = json!({"replay_session_id":id,"prop_session_id":session,"parent_attempt_id":parent_attempt,"expected_replay_revision":b["expected_replay_revision"],"expected_parent_replay_revision":b["expected_parent_replay_revision"],"expected_parent_attempt_revision":b["expected_parent_attempt_revision"],"operation_id":operation});
    let fingerprint = crate::prop_core::intent_fingerprint(&input).map_err(bad)?;
    let current_session = crate::prop_service::load_session(tx, workspace, session, true).await?;
    if let Some(rev) = crate::prop_service::mutation_receipt(
        tx,
        workspace,
        session,
        &child_attempt,
        operation,
        &fingerprint,
    )
    .await?
    {
        let row=tx.query_opt("SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND revision=$4",&[&workspace,&session,&child_attempt,&rev]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("branch receipt points to a missing child attempt revision"))?;
        let receipt=tx.query_one("SELECT created_at_utc FROM prop_mutation_receipts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND operation_id=$4",&[&workspace,&session,&child_attempt,&operation]).await.map_err(|_|ApiError::database())?;
        let stamp: String = receipt.get(0);
        let sr=tx.query_opt("SELECT snapshot_json FROM prop_session_revisions WHERE workspace_id=$1 AND session_id=$2 AND created_at_utc<=$3 ORDER BY created_at_utc DESC,revision DESC LIMIT 1",&[&workspace,&session,&stamp]).await.map_err(|_|ApiError::database())?.ok_or_else(||conflict("branch receipt points before prop session history"))?;
        return Ok(
            json!({"session":sr.get::<_,Value>(0),"attempt":row.get::<_,Value>(0),"phase":row.get::<_,Value>(1),"resume_state":row.get::<_,Value>(2),"duplicate":true}),
        );
    }
    let child = load_record(tx, workspace, id, true).await?;
    let cp = &child["payload"];
    if cp["asset_states"].is_object() {
        return Err(bad("multi-asset replay is not supported by Prop lifecycle"));
    }
    if child["revision"] != b["expected_replay_revision"] {
        return Err(conflict("replay branch revision conflict"));
    }
    let parent_id = text(cp, "parent_session_id")
        .map_err(|_| bad("Replay session is not a canonical historical branch"))?;
    if cp["parent_revision"] != b["expected_parent_replay_revision"] {
        return Err(conflict(
            "Replay branch parent revision does not match request",
        ));
    }
    let parent = load_record(tx, workspace, parent_id, true).await?;
    if parent["revision"] != b["expected_parent_replay_revision"] {
        return Err(conflict("parent replay revision conflict"));
    }
    let bundle =
        crate::prop_service::load_attempt(tx, workspace, session, parent_attempt, true).await?;
    if bundle["attempt"]["revision"] != b["expected_parent_attempt_revision"] {
        return Err(conflict("parent prop attempt revision conflict"));
    }
    if !terminal(&bundle["attempt"]) {
        return Err(conflict(
            "parent prop attempt must be terminal before historical branch",
        ));
    }
    if bundle["attempt"]["branch_kind"] == "hindsight_exploratory" {
        return Err(conflict(
            "nested hindsight Prop attempt branching is not supported",
        ));
    }
    let cs = &cp["execution"];
    let ps = &parent["payload"]["execution"];
    crate::replay_core::validate(cs).map_err(bad)?;
    crate::replay_core::validate(ps).map_err(bad)?;
    if cs["replay_session_id"] != id {
        return Err(bad("Replay branch execution lineage is inconsistent"));
    }
    let attempts=tx.query("SELECT attempt_id,snapshot_json FROM prop_attempts WHERE workspace_id=$1 AND session_id=$2 FOR UPDATE",&[&workspace,&session]).await.map_err(|_|ApiError::database())?;
    for row in attempts {
        let a: Value = row.get(1);
        if row.get::<_, String>(0) != parent_attempt && !terminal(&a) {
            return Err(conflict("prop session already has an active attempt"));
        }
    }
    let event = cs["ledger"]
        .as_array()
        .and_then(|a| a.last())
        .ok_or_else(|| bad("Replay branch checkpoint event is invalid"))?;
    if event["sequence"] != cs["event_sequence"] {
        return Err(bad(
            "Replay branch checkpoint event sequence is inconsistent",
        ));
    }
    let parent_event = ps["ledger"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|e| e["sequence"] == event["sequence"])
        .ok_or_else(|| bad("parent Replay checkpoint event is missing"))?;
    let rows=tx.query("SELECT revision,snapshot_json,phase_json,resume_json FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 ORDER BY revision DESC",&[&workspace,&session,&parent_attempt]).await.map_err(|_|ApiError::database())?;
    let mut historical = None;
    for row in rows {
        let rev: i32 = row.get(0);
        let attempt: Value = row.get(1);
        let phase: Value = row.get(2);
        let resume: Value = row.get(3);
        if crate::prop_core::validate_replay_prop_branch_checkpoint(
            cs, cp, ps, &attempt, &phase, &resume,
        )
        .is_err()
        {
            continue;
        }
        let receipts=tx.query("SELECT operation_id,fingerprint FROM prop_mutation_receipts WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND entity_revision=$4",&[&workspace,&session,&parent_attempt,&rev]).await.map_err(|_|ApiError::database())?;
        let mut canonical = false;
        if event["kind"] == "price_mark" {
            if let Some(previous)=tx.query_opt("SELECT snapshot_json,phase_json,resume_json FROM prop_attempt_revisions WHERE workspace_id=$1 AND session_id=$2 AND attempt_id=$3 AND revision=$4",&[&workspace,&session,&parent_attempt,&(rev-1)]).await.map_err(|_|ApiError::database())?{let pa:Value=previous.get(0);let pp:Value=previous.get(1);let pr:Value=previous.get(2);let spec=current_session["profile"]["phases"].as_array().and_then(|a|a.get((integer(&pp,"phase_index").unwrap_or(0)-1)as usize));if let Some(spec)=spec{let args=json!({"workspace_id":workspace,"prop_session_id":session,"prop_attempt_id":parent_attempt,"profile_hash":pa["profile_hash"],"expected_prop_revision":pa["revision"],"prop_event_sequence":phase["last_event_sequence"]});if let Ok(pe)=crate::prop_core::replay_mark_to_prop_event(&args,spec,parent_event){let supplied=prop_resume(&pr,ps,parent_event)?;let fp=crate::prop_core::intent_fingerprint(&json!({"event":pe,"resume_state":supplied})).map_err(bad)?;let mut eval=supplied;if let Some(life)=pr.get("prop_lifecycle"){eval["prop_lifecycle"]=life.clone();}if let Ok(expected)=crate::prop_core::evaluate_prop_lifecycle_event(&current_session,&pa,&pp,&pe,&eval){canonical=receipts.iter().any(|r|r.get::<_,String>(0)==pe["operation_id"].as_str().unwrap_or("")&&r.get::<_,String>(1)==fp)&&semantic(&expected["attempt"],&attempt)&&semantic(&expected["phase"],&phase)&&semantic(&expected["resume_state"],&resume);}}}}
        } else if event["kind"] == "phase_transition" {
            let details = &event["details"];
            canonical = details["intent_id"].as_str().is_some_and(|s| !s.is_empty())
                && details["intent_fingerprint"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty())
                && receipts.iter().any(|r| {
                    r.get::<_, String>(0) == details["intent_id"].as_str().unwrap_or("")
                        && r.get::<_, String>(1)
                            == details["intent_fingerprint"].as_str().unwrap_or("")
                });
        }
        if canonical {
            historical = Some((rev, attempt, phase, resume));
            break;
        }
    }
    let (rev, mut attempt, mut phase, mut resume) = historical.ok_or_else(|| {
        bad("canonical historical Prop checkpoint was not found for Replay branch boundary")
    })?;
    attempt["attempt_id"] = json!(child_attempt);
    attempt["status"] = json!("paused");
    attempt["revision"] = json!(1);
    attempt["parent_attempt_id"] = json!(parent_attempt);
    attempt["branch_kind"] = json!("hindsight_exploratory");
    phase["attempt_id"] = json!(child_attempt);
    resume["replay_binding"] = json!({"replay_session_id":id,"branch_id":cs["branch_id"],"dataset_id":cs["dataset_id"],"dataset_sha256":cs["dataset_sha256"],"last_replay_event_sequence":cs["event_sequence"]});
    resume["branch_provenance"] = json!({"kind":"replay_prop_hindsight_branch_v1","parent_attempt_id":parent_attempt,"parent_attempt_revision":rev,"parent_replay_session_id":parent_id,"parent_replay_revision":b["expected_parent_replay_revision"],"parent_checkpoint_event_sequence":cs["event_sequence"]});
    crate::prop_core::validate_attempt_snapshot(&attempt).map_err(bad)?;
    crate::prop_core::validate_phase_snapshot(&phase).map_err(bad)?;
    let stamp = now();
    tx.execute("INSERT INTO prop_attempts(workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,resume_json,created_at_utc,updated_at_utc) VALUES($1,$2,$3,1,$4,$5,$6,$7,$7)",&[&workspace,&session,&child_attempt,&attempt,&phase,&resume,&stamp]).await.map_err(|_|ApiError::database())?;
    tx.execute("INSERT INTO prop_attempt_revisions(workspace_id,session_id,attempt_id,revision,snapshot_json,phase_json,resume_json,created_at_utc) VALUES($1,$2,$3,1,$4,$5,$6,$7)",&[&workspace,&session,&child_attempt,&attempt,&phase,&resume,&stamp]).await.map_err(|_|ApiError::database())?;
    let mut session_value = current_session;
    if session_value["status"] != "paused" {
        session_value["status"] = json!("paused");
        let rev = integer(&session_value, "revision")? + 1;
        session_value["revision"] = json!(rev);
        tx.execute("UPDATE prop_sessions SET current_revision=$3,snapshot_json=$4,updated_at_utc=$5 WHERE workspace_id=$1 AND session_id=$2",&[&workspace,&session,&(rev as i32),&session_value,&stamp]).await.map_err(|_|ApiError::database())?;
        tx.execute("INSERT INTO prop_session_revisions(workspace_id,session_id,revision,snapshot_json,created_at_utc) VALUES($1,$2,$3,$4,$5)",&[&workspace,&session,&(rev as i32),&session_value,&stamp]).await.map_err(|_|ApiError::database())?;
    }
    tx.execute("INSERT INTO prop_mutation_receipts(workspace_id,session_id,attempt_id,operation_id,fingerprint,entity_revision,created_at_utc) VALUES($1,$2,$3,$4,$5,1,$6)",&[&workspace,&session,&child_attempt,&operation,&fingerprint,&stamp]).await.map_err(|_|ApiError::database())?;
    Ok(
        json!({"session":session_value,"attempt":attempt,"phase":phase,"resume_state":resume,"duplicate":false}),
    )
}
