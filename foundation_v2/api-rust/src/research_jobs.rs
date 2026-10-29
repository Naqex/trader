//! Durable research admission and cancellation. Computation remains isolated from HTTP.
use crate::{
    auth::{ApiError, Workspace},
    native_mutation::{self, MutationStart},
    state::AppState,
};
use axum::{
    Router,
    body::to_bytes,
    extract::{Path, Request, State},
    http::StatusCode,
    response::Response,
    routing::post,
};
use chrono::Utc;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio_postgres::Row;
pub mod adapter;
pub mod engine;
pub mod lifecycle;
pub(crate) mod oos;
#[cfg(test)]
#[path = "rust_runtime.rs"]
mod schema_runtime;

pub(crate) fn validate_rules(rules: &Value) -> Result<(), String> {
    let rules = rules.as_object().ok_or("unsupported rule fields")?;
    let allowed = [
        "engine",
        "lookback",
        "hold_bars",
        "quantity",
        "planned_stop_distance_price",
        "direction",
        "exit_mode",
        "stop_loss_distance_price",
        "take_profit_distance_price",
    ];
    if rules.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("unsupported rule fields".into());
    }
    if rules.get("engine").and_then(Value::as_str) != Some("bar-breakout-v1") {
        return Err("playbook rules must declare engine=bar-breakout-v1".into());
    }
    for name in ["lookback", "hold_bars"] {
        let value = rules.get(name).unwrap_or(&Value::Null);
        let text = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if !text
            .as_bytes()
            .first()
            .is_some_and(|b| matches!(b, b'1'..=b'9'))
            || !text.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(format!("rules.{name} must be a positive integer"));
        }
    }
    let positive = |name: &str| -> Result<f64, String> {
        let value = rules.get(name).unwrap_or(&Value::Null);
        let parsed = match value {
            Value::String(s) => s.trim().parse::<f64>().ok(),
            Value::Number(n) => n.as_f64(),
            _ => None,
        };
        parsed
            .filter(|n| n.is_finite() && *n > 0.0)
            .ok_or_else(|| format!("rules.{name} must be positive"))
    };
    positive("quantity")?;
    positive("planned_stop_distance_price")?;
    if !matches!(
        rules
            .get("direction")
            .map(|v| v.as_str().unwrap_or(""))
            .unwrap_or("both"),
        "long" | "short" | "both"
    ) {
        return Err("rules.direction must be long, short, or both".into());
    }
    match rules
        .get("exit_mode")
        .map(|v| v.as_str().unwrap_or(""))
        .unwrap_or("fixed_horizon")
    {
        "protective" => {
            let stop = positive("stop_loss_distance_price")?;
            positive("take_profit_distance_price")?;
            if (stop - positive("planned_stop_distance_price")?).abs() > 1e-12 {
                return Err(
                    "protective stop distance must equal planned_stop_distance_price".into(),
                );
            }
        }
        "fixed_horizon" => {
            if rules.contains_key("stop_loss_distance_price")
                || rules.contains_key("take_profit_distance_price")
            {
                return Err("protective distances require rules.exit_mode=protective".into());
            }
        }
        _ => return Err("rules.exit_mode must be fixed_horizon or protective".into()),
    }
    Ok(())
}

// Research protocol hashes predate Rust. Keep Python JSON bytes (including ASCII
// escaping and exponent spelling) so queued protocols retain their identities.
pub(crate) fn canonical_py_json(value: &Value) -> Result<Vec<u8>, String> {
    let mut text = python_json(value, false)?;
    text.push('\n');
    Ok(text.into_bytes())
}
fn python_json(value: &Value, spaced: bool) -> Result<String, String> {
    let comma = if spaced { ", " } else { "," };
    let colon = if spaced { ": " } else { ":" };
    Ok(match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::String(s) => {
            let encoded = serde_json::to_string(s).map_err(|_| "invalid protocol text")?;
            let mut ascii = String::new();
            for ch in encoded.chars() {
                if ch.is_ascii() {
                    ascii.push(ch);
                } else {
                    let mut buffer = [0; 2];
                    for unit in ch.encode_utf16(&mut buffer) {
                        ascii.push_str(&format!("\\u{unit:04x}"));
                    }
                }
            }
            ascii
        }
        Value::Number(n) => {
            if n.is_f64() {
                python_float(n.as_f64().ok_or("invalid protocol number")?)?
            } else {
                n.to_string()
            }
        }
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(|v| python_json(v, spaced))
                .collect::<Result<Vec<_>, _>>()?
                .join(comma)
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| Ok(format!(
                        "{}{colon}{}",
                        python_json(&json!(key), spaced)?,
                        python_json(&values[*key], spaced)?
                    )))
                    .collect::<Result<Vec<_>, String>>()?
                    .join(comma)
            )
        }
    })
}
pub(crate) fn python_float(number: f64) -> Result<String, String> {
    if !number.is_finite() {
        return Err("protocol numbers must be finite".into());
    }
    if number == 0.0 {
        return Ok(if number.is_sign_negative() {
            "-0.0"
        } else {
            "0.0"
        }
        .into());
    }
    let text = serde_json::to_string(&number).map_err(|_| "invalid protocol number")?;
    let (negative, unsigned) = text
        .strip_prefix('-')
        .map(|s| (true, s))
        .unwrap_or((false, text.as_str()));
    let (coefficient, explicit_exp) = if let Some((a, b)) = unsigned.split_once(['e', 'E']) {
        (a, b.parse::<i32>().map_err(|_| "invalid float exponent")?)
    } else {
        (unsigned, 0)
    };
    let decimal = coefficient.find('.').unwrap_or(coefficient.len()) as i32;
    let all = coefficient.replace('.', "");
    let leading = all.bytes().take_while(|b| *b == b'0').count();
    let mut digits = all[leading..].trim_end_matches('0').to_owned();
    if digits.is_empty() {
        digits.push('0');
    }
    let exponent = explicit_exp + decimal - leading as i32 - 1;
    let sign = if negative { "-" } else { "" };
    if !(-4..16).contains(&exponent) {
        let fraction = if digits.len() > 1 {
            format!(".{}", &digits[1..])
        } else {
            String::new()
        };
        let exp_sign = if exponent < 0 { '-' } else { '+' };
        Ok(format!(
            "{sign}{}{fraction}e{exp_sign}{:02}",
            &digits[..1],
            exponent.abs()
        ))
    } else {
        let point = exponent + 1;
        let fixed = if point <= 0 {
            format!("0.{}{}", "0".repeat((-point) as usize), digits)
        } else if point as usize >= digits.len() {
            format!("{}{}.0", digits, "0".repeat(point as usize - digits.len()))
        } else {
            format!(
                "{}.{}",
                &digits[..point as usize],
                &digits[point as usize..]
            )
        };
        Ok(format!("{sign}{fixed}"))
    }
}

pub fn native(method: &str, path: &str) -> bool {
    method == "POST"
        && matches!(
            path,
            "/api/v2/research/jobs"
                | "/api/v2/research/engine-jobs"
                | "/api/v2/research/jobs/{job_id}/cancel"
        )
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/research/jobs", post(create))
        .route("/api/v2/research/engine-jobs", post(create))
        .route("/api/v2/research/jobs/{job_id}/cancel", post(cancel))
}

async fn create(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    request: Request,
) -> Result<Response, ApiError> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, state.config.max_body_bytes)
        .await
        .map_err(|_| ApiError::detail(StatusCode::PAYLOAD_TOO_LARGE, "request_body_too_large"))?;
    let raw: Value = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_json"))?;
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let mutation = match native_mutation::begin(
        &tx,
        &scope,
        "POST",
        parts.uri.path(),
        parts.uri.query(),
        &parts.headers,
        &raw,
    )
    .await?
    {
        MutationStart::Replay(response) => return Ok(response),
        MutationStart::New(mutation) => mutation,
    };
    tx.batch_execute("SAVEPOINT research_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let outcome = if parts.uri.path() == "/api/v2/research/engine-jobs" {
        create_engine_in_tx(&tx, &scope, &raw, &state.config.artifact_root).await
    } else {
        create_in_tx(&tx, &scope, &raw).await
    };
    let (status, value) = match outcome {
        Ok(value) => (StatusCode::ACCEPTED, value),
        Err(error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT research_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (error.0, error.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, value).await?;
    native_mutation::commit(tx, response).await
}

async fn create_in_tx(
    tx: &tokio_postgres::Transaction<'_>,
    scope: &Workspace,
    raw: &Value,
) -> Result<Value, ApiError> {
    let body = crate::native_contracts::validate_body("create_research_job", raw.clone())?;
    let dataset = body["dataset_id"].as_str().ok_or_else(invalid_request)?;
    let strategy = body["strategy_version"]
        .as_str()
        .unwrap_or("close-delta-v1");
    let balance = body["starting_balance"]
        .as_f64()
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or_else(invalid_request)?;
    if strategy != "close-delta-v1" {
        return Err(invalid_request());
    }
    let manifest = tx
        .query_opt(
            "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR SHARE",
            &[&scope.workspace_id, &dataset],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "dataset_not_found"))?;
    let manifest: Value = manifest.get(0);
    let disposition = manifest
        .pointer("/quality/disposition")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !disposition.is_empty() && disposition != "pass" {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            &format!("dataset is not QA-approved: {disposition}"),
        ));
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let row = tx.query_one("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc) VALUES($1,$2,$3,$4,$5,'queued',$6,$6) RETURNING *", &[&scope.workspace_id,&id,&dataset,&strategy,&balance,&now]).await.map_err(|_| ApiError::database())?;
    Ok(job_view(&row))
}

async fn create_engine_in_tx(
    tx: &tokio_postgres::Transaction<'_>,
    scope: &Workspace,
    raw: &Value,
    artifact_root: &FsPath,
) -> Result<Value, ApiError> {
    use sha2::{Digest, Sha256};
    let body = crate::native_contracts::validate_body("create_engine_research_job", raw.clone())?;
    let dataset = body["dataset_id"].as_str().ok_or_else(invalid_request)?;
    let playbook = body["playbook_id"].as_str().ok_or_else(invalid_request)?;
    let revision = body["playbook_revision"]
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "playbook_revision_not_found"))?;
    // Dataset deletion and admission share this row lock. The immutable playbook
    // revision is read directly, rather than replacing it with the current head.
    let manifest: Value = tx
        .query_opt(
            "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR SHARE",
            &[&scope.workspace_id, &dataset],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "dataset_not_found"))?
        .get(0);
    let record=tx.query_opt("SELECT payload_json,deleted FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='playbook' AND record_id=$2 AND revision=$3",&[&scope.workspace_id,&playbook,&revision]).await.map_err(|_|ApiError::database())?
        .filter(|row|!row.get::<_,bool>("deleted")).ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,"playbook_revision_not_found"))?;
    let payload: Value = record.get(0);
    let needs_adapter = body
        .get("engine_backend")
        .and_then(Value::as_str)
        .unwrap_or("nautilus")
        == "nautilus";
    let descriptor = std::env::var_os("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY")
        .map(PathBuf::from)
        .unwrap_or_else(|| artifact_root.join(".runtime/scientific-adapter-capability.json"));
    let protocol_body = body.clone();
    let protocol = tokio::task::spawn_blocking(move || {
        let root = adapter::foundation_root();
        let hash = adapter::engine_code_hash(&root)?;
        engine::build_protocol_with_runtime(&protocol_body, &manifest, &payload, &hash, || {
            if needs_adapter {
                adapter::descriptor(&root, &descriptor, &hash).map(Some)
            } else {
                Ok(None)
            }
        })
    })
    .await
    .map_err(|_| {
        ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "research_adapter_inspection_failed",
        )
    })?
    .map_err(|error| {
        ApiError::detail(
            if matches!(
                error.as_str(),
                "dataset holdout policy is invalid"
                    | "requested research data reaches locked holdout data"
            ) {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            &error,
        )
    })?;
    let canonical = canonical_py_json(&protocol)
        .map_err(|error| ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, &error))?;
    let hash = format!("{:x}", Sha256::digest(&canonical));
    let balance = body["starting_balance"]
        .as_f64()
        .ok_or_else(invalid_request)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let row=tx.query_one("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,protocol_json,protocol_sha256,created_at_utc,updated_at_utc) VALUES($1,$2,$3,'bar-breakout-v1',$4,'queued',$5,$6,$7,$7) RETURNING *",&[&scope.workspace_id,&id,&dataset,&balance,&protocol,&hash,&now]).await.map_err(|_|ApiError::database())?;
    Ok(job_view(&row))
}

fn invalid_request() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_research_job")
}

pub(crate) fn job_view(row: &Row) -> Value {
    json!({"contract_version":crate::CONTRACT_VERSION,"job_id":row.get::<_,String>("job_id"),"workspace_id":row.get::<_,String>("workspace_id"),
        "dataset_id":row.get::<_,String>("dataset_id"),"strategy_version":row.get::<_,String>("strategy_version"),"starting_balance":row.get::<_,f64>("starting_balance"),
        "protocol_sha256":row.get::<_,Option<String>>("protocol_sha256"),"protocol":row.get::<_,Option<Value>>("protocol_json"),"status":row.get::<_,String>("status"),
        "cancel_requested":row.get::<_,bool>("cancel_requested"),"result_path":row.get::<_,Option<String>>("result_path"),"result_sha256":row.get::<_,Option<String>>("result_sha256"),
        "error_code":row.get::<_,Option<String>>("error_code"),"created_at_utc":row.get::<_,String>("created_at_utc"),"updated_at_utc":row.get::<_,String>("updated_at_utc")})
}

async fn cancel(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
    request: Request,
) -> Result<Response, ApiError> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, state.config.max_body_bytes)
        .await
        .map_err(|_| ApiError::detail(StatusCode::PAYLOAD_TOO_LARGE, "request_body_too_large"))?;
    let raw: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_json"))?
    };
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let mutation = match native_mutation::begin(
        &tx,
        &scope,
        "POST",
        parts.uri.path(),
        parts.uri.query(),
        &parts.headers,
        &raw,
    )
    .await?
    {
        MutationStart::Replay(response) => {
            tx.commit().await.map_err(|_| ApiError::database())?;
            return Ok(response);
        }
        MutationStart::New(mutation) => mutation,
    };
    tx.batch_execute("SAVEPOINT research_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let outcome = cancel_in_tx(&tx, &scope, &id).await;
    let (status, value) = match outcome {
        Ok(value) => (StatusCode::OK, value),
        Err(error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT research_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (error.0, error.1)
        }
    };
    let cleanup = value["status"] == "canceled";
    let response = native_mutation::finish(&tx, mutation, status, value).await?;
    let response = native_mutation::commit(tx, response).await?;
    drop(conn);
    if cleanup {
        let root = state.config.artifact_root.clone();
        let workspace = scope.workspace_id;
        // Cancellation is committed and irrevocably fences the worker. Cleanup is
        // idempotent maintenance; failure must not change the durable command outcome.
        if !matches!(
            tokio::task::spawn_blocking(move || quarantine_candidates(&root, &workspace, &id))
                .await,
            Ok(Ok(()))
        ) {
            tracing::warn!("research candidate cleanup deferred to recovery");
        }
    }
    Ok(response)
}

async fn cancel_in_tx(
    tx: &tokio_postgres::Transaction<'_>,
    scope: &Workspace,
    id: &str,
) -> Result<Value, ApiError> {
    let row = tx
        .query_opt(
            "SELECT * FROM research_jobs WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "job_not_found"))?;
    let status: String = row.get("status");
    let row = if matches!(status.as_str(), "queued" | "running") {
        let protocol: Option<Value> = row.get("protocol_json");
        let checkpoint: Option<Value> = row.get("checkpoint_json");
        let (checkpoint, progress) = cancellation_state(
            protocol.as_ref(),
            checkpoint.as_ref(),
            row.get("attempt_no"),
        )
        .map(|(a, b)| (Some(a), Some(b)))
        .unwrap_or((None, None));
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
        tx.query_one("UPDATE research_jobs SET status='canceled',cancel_requested=true,result_path=CASE WHEN status='running' THEN NULL ELSE result_path END,result_sha256=CASE WHEN status='running' THEN NULL ELSE result_sha256 END,checkpoint_json=COALESCE($3,checkpoint_json),progress_json=COALESCE($4,progress_json),lease_owner=CASE WHEN status='running' THEN NULL ELSE lease_owner END,lease_token=CASE WHEN status='running' THEN NULL ELSE lease_token END,lease_expires_at_utc=CASE WHEN status='running' THEN NULL ELSE lease_expires_at_utc END,updated_at_utc=$5 WHERE workspace_id=$1 AND job_id=$2 RETURNING *",&[&scope.workspace_id,&id,&checkpoint,&progress,&now]).await.map_err(|_| ApiError::database())?
    } else {
        row
    };
    Ok(job_view(&row))
}

fn cancellation_state(
    protocol: Option<&Value>,
    checkpoint: Option<&Value>,
    attempt: i32,
) -> Option<(Value, Value)> {
    let validation = protocol?.get("validation")?;
    if validation.get("schema")?.as_str()? != "research-oos-validation-v1" {
        return None;
    }
    let trials = validation.pointer("/sweep/trials")?.as_array()?;
    if trials.is_empty() {
        return None;
    }
    let planned = trials
        .iter()
        .map(|v| v.get("trial_id")?.as_str().filter(|s| !s.trim().is_empty()))
        .collect::<Option<Vec<_>>>()?;
    let ids: HashSet<_> = planned.iter().copied().collect();
    if ids.len() != planned.len() {
        return None;
    }
    let partial = checkpoint
        .filter(|v| v.get("attempt_no").and_then(Value::as_i64) == Some(attempt as i64))
        .and_then(|v| v.get("trial_outcomes"))
        .and_then(Value::as_array);
    let mut observed = HashMap::new();
    for value in partial.into_iter().flatten() {
        let id = value.get("trial_id")?.as_str()?;
        let status = value.get("status")?.as_str()?;
        if !ids.contains(id)
            || !matches!(status, "completed" | "failed" | "canceled")
            || observed.insert(id, status).is_some()
        {
            return None;
        }
    }
    let observed_count = observed.len();
    let mut counts = json!({"canceled":0,"completed":0,"failed":0});
    let outcomes: Vec<_> = planned
        .iter()
        .map(|id| {
            let status = observed.get(id).copied().unwrap_or("canceled");
            counts[status] = json!(counts[status].as_u64().unwrap() + 1);
            json!({"trial_id":id,"status":status})
        })
        .collect();
    Some((
        json!({"schema":"research-job-checkpoint-v1","phase":"oos-sweep-canceled","attempt_no":attempt,"validation_schema":"research-oos-validation-v1","trial_outcomes":outcomes,"trial_status_counts":counts,"trial_count":planned.len(),"fully_accounted":true}),
        json!({"phase_index":3,"phase_count":5,"trial_index":observed_count,"trial_count":planned.len()}),
    ))
}

fn safe_component(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    !value.is_empty()
        && !matches!(value, "." | "..")
        && !value.ends_with(['.', ' '])
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
        && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !(1..=9).any(|n| stem == format!("COM{n}") || stem == format!("LPT{n}"))
}
fn checked_directory(
    root: &FsPath,
    components: &[&str],
    create: bool,
) -> Result<Option<PathBuf>, ApiError> {
    let mut path = root.canonicalize().map_err(|_| cleanup_error())?;
    for component in components {
        if !safe_component(component) {
            return Err(cleanup_error());
        }
        path.push(component);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !create {
                    return Ok(None);
                }
                match std::fs::create_dir(&path) {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(_) => return Err(cleanup_error()),
                }
                std::fs::symlink_metadata(&path).map_err(|_| cleanup_error())?
            }
            Err(_) => return Err(cleanup_error()),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() || reparse(&metadata) {
            return Err(cleanup_error());
        }
    }
    Ok(Some(path))
}
fn reparse(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}
fn cleanup_error() -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "candidate_cleanup_failed")
}
fn quarantine_candidates(root: &FsPath, workspace: &str, id: &str) -> Result<(), ApiError> {
    let Some(source) = checked_directory(root, &[workspace, "results", id], false)? else {
        return Ok(());
    };
    let target = checked_directory(root, &[workspace, "quarantine", "results", id], true)?
        .ok_or_else(cleanup_error)?;
    for entry in std::fs::read_dir(&source).map_err(|_| cleanup_error())? {
        let entry = entry.map_err(|_| cleanup_error())?;
        let name = entry.file_name();
        let text = name.to_string_lossy();
        if !text.starts_with("attempt-") || !text.ends_with(".json") {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| cleanup_error())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || reparse(&metadata) {
            return Err(cleanup_error());
        }
        let destination = target.join(&name);
        // hard_link is create-only and cannot overwrite a completed quarantine candidate.
        match std::fs::hard_link(entry.path(), &destination) {
            Ok(()) => (),
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists
                    && crate::artifact_data::same_file(&entry.path(), &destination) =>
            {
                ()
            }
            Err(_) => return Err(cleanup_error()),
        }
        std::fs::remove_file(entry.path()).map_err(|_| cleanup_error())?;
    }
    let _ = std::fs::remove_dir(source);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires owned disposable PostgreSQL runner rust_engine_admission_parity.py"]
    async fn postgres_engine_admission_differential() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").expect("disposable test DSN required");
        assert_eq!(
            std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let (mut client, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
            .await
            .unwrap();
        tokio::spawn(async move {
            connection.await.unwrap();
        });
        let identity = client
            .query_one("SELECT current_user,current_database()", &[])
            .await
            .unwrap();
        assert_eq!(identity.get::<_, String>(0), "rust_runtime_fixture");
        assert_eq!(identity.get::<_, String>(1), "rust_runtime_fixture");
        schema_runtime::apply_migrations(&mut client, false)
            .await
            .unwrap();
        client
            .execute(
                "INSERT INTO workspaces VALUES('tenant-a','now'),('tenant-b','now')",
                &[],
            )
            .await
            .unwrap();
        let fixture: Value = serde_json::from_slice(
            &std::fs::read(std::env::var("TW_RUST_ENGINE_PG_ORACLE").unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            adapter::engine_code_hash(&adapter::foundation_root()).unwrap(),
            fixture["engine_code_sha256"]
        );
        let cases = fixture["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 350);
        let first = &cases[0]["input"];
        client
            .execute(
                "INSERT INTO datasets VALUES('tenant-a','dataset-1',$1,'hash','now')",
                &[&first["manifest"]],
            )
            .await
            .unwrap();
        client.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES('tenant-a','playbook','playbook-1',3,'now','now')",&[]).await.unwrap();
        client.execute("INSERT INTO workspace_record_revisions VALUES('tenant-a','playbook','playbook-1',3,$1,false,'now')",&[&first["payload"]]).await.unwrap();
        let mut config = crate::tests::fixture(1000).config.clone();
        config.database_url = dsn;
        config.pool_size = 8;
        config.max_concurrency = 16;
        config.max_body_bytes = 2 * 1024 * 1024;
        config.request_timeout = std::time::Duration::from_secs(30);
        config.pool_timeout = std::time::Duration::from_secs(3);
        config.artifact_root =
            PathBuf::from(std::env::var("TW_RUST_RUNTIME_TEST_ARTIFACTS").unwrap());
        config.local_workspaces = Some(vec!["tenant-a".into(), "tenant-b".into()]);
        let state = AppState::connect(config).await.unwrap();
        let app = crate::router(state.clone(), crate::domain_routes());
        async fn call(
            app: axum::Router,
            workspace: &str,
            key: &str,
            body: Value,
        ) -> (StatusCode, Value) {
            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/v2/research/engine-jobs")
                        .header("x-workspace-id", workspace)
                        .header("content-type", "application/json")
                        .header("idempotency-key", key)
                        .body(Body::from(serde_json::to_vec(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
            (status, serde_json::from_slice(&bytes).unwrap())
        }
        let mut success = 0_i64;
        let mut first_response = None;
        for (index, case) in cases.iter().enumerate() {
            let input = &case["input"];
            let expected = &case["expected"];
            client.execute("UPDATE datasets SET manifest_json=$1 WHERE workspace_id='tenant-a' AND dataset_id='dataset-1'",&[&input["manifest"]]).await.unwrap();
            client.execute("UPDATE workspace_record_revisions SET payload_json=$1 WHERE workspace_id='tenant-a' AND record_id='playbook-1'",&[&input["payload"]]).await.unwrap();
            let (status, actual) = call(
                app.clone(),
                "tenant-a",
                &format!("case-{index}"),
                input["body"].clone(),
            )
            .await;
            if let Some(error) = expected.get("error") {
                assert_eq!(
                    status.as_u16(),
                    expected["status"].as_u64().unwrap() as u16,
                    "case {index}: {actual}"
                );
                assert_eq!(&actual["detail"], error, "case {index}");
            } else {
                assert_eq!(status, StatusCode::ACCEPTED, "case {index}: {actual}");
                assert_eq!(actual["status"], "queued");
                assert_eq!(actual["strategy_version"], "bar-breakout-v1");
                assert_eq!(
                    actual["protocol_sha256"], expected["protocol_sha256"],
                    "case {index}"
                );
                assert_eq!(
                    String::from_utf8(canonical_py_json(&actual["protocol"]).unwrap()).unwrap(),
                    expected["canonical"].as_str().unwrap(),
                    "case {index}"
                );
                success += 1;
            }
            if index == 0 {
                first_response = Some(actual);
            }
        }
        let count: i64 = client
            .query_one("SELECT count(*) FROM research_jobs", &[])
            .await
            .unwrap()
            .get(0);
        assert_eq!(count, success);
        let retry = call(app.clone(), "tenant-a", "case-0", first["body"].clone()).await;
        assert_eq!(retry.0, StatusCode::ACCEPTED);
        assert_eq!(retry.1, first_response.unwrap());
        let mut changed = first["body"].clone();
        changed["starting_balance"] = json!(20000.0);
        assert_eq!(
            call(app.clone(), "tenant-a", "case-0", changed).await.0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(
                app.clone(),
                "tenant-b",
                "workspace-isolation",
                first["body"].clone()
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        let mut missing = first["body"].clone();
        missing["playbook_revision"] = json!(999);
        assert_eq!(
            call(app.clone(), "tenant-a", "missing-revision", missing)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        client.execute("UPDATE datasets SET manifest_json=$1 WHERE workspace_id='tenant-a' AND dataset_id='dataset-1'",&[&first["manifest"]]).await.unwrap();
        client.execute("UPDATE workspace_record_revisions SET payload_json=$1,deleted=true WHERE workspace_id='tenant-a' AND record_id='playbook-1'",&[&first["payload"]]).await.unwrap();
        assert_eq!(
            call(
                app.clone(),
                "tenant-a",
                "deleted-revision",
                first["body"].clone()
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        client.execute("UPDATE workspace_record_revisions SET deleted=false WHERE workspace_id='tenant-a' AND record_id='playbook-1'",&[]).await.unwrap();
        let mut concurrent = tokio::task::JoinSet::new();
        for _ in 0..8 {
            let app = app.clone();
            let body = first["body"].clone();
            concurrent
                .spawn(async move { call(app, "tenant-a", "concurrent-admission", body).await });
        }
        let mut id = None;
        while let Some(result) = concurrent.join_next().await {
            let (status, value) = result.unwrap();
            assert_eq!(status, StatusCode::ACCEPTED, "{value}");
            if let Some(ref id) = id {
                assert_eq!(&value["job_id"], id);
            } else {
                id = Some(value["job_id"].clone());
            }
        }
        assert_eq!(
            client
                .query_one("SELECT count(*) FROM research_jobs", &[])
                .await
                .unwrap()
                .get::<_, i64>(0),
            count + 1
        );
        assert_eq!(
            client
                .query_one(
                    "SELECT count(*) FROM api_commands WHERE status IN ('queued','running')",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, i64>(0),
            0
        );
        let capability =
            PathBuf::from(std::env::var("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY").unwrap());
        let original = std::fs::read(&capability).unwrap();
        let mut stale: Value = serde_json::from_slice(&original).unwrap();
        stale["engine_code_sha256"] = json!("stale");
        std::fs::write(&capability, serde_json::to_vec(&stale).unwrap()).unwrap();
        let mut nautilus = first["body"].clone();
        nautilus["engine_backend"] = json!("nautilus");
        let stale_result = call(app.clone(), "tenant-a", "stale-adapter", nautilus.clone()).await;
        std::fs::write(&capability, original).unwrap();
        assert_eq!(stale_result.0, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            stale_result.1["detail"],
            "scientific adapter capability is stale"
        );
        assert_eq!(
            call(app.clone(), "tenant-a", "stale-adapter", nautilus.clone()).await,
            stale_result
        );
        assert_eq!(
            call(app.clone(), "tenant-a", "restored-adapter", nautilus)
                .await
                .0,
            StatusCode::ACCEPTED
        );
        assert_eq!(
            call(app.clone(), "tenant-a", "invalid-request", json!({}))
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let tx = client.transaction().await.unwrap();
        assert!(
            lifecycle::claim_close_delta(&tx, "native", 30, 1)
                .await
                .unwrap()
                .is_none()
        );
        tx.commit().await.unwrap();
        client.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc) VALUES('tenant-a','supported-simple','dataset-1','close-delta-v1',10000,'queued','now','now')",&[]).await.unwrap();
        let tx = client.transaction().await.unwrap();
        let claim = lifecycle::claim_close_delta(&tx, "native", 30, 1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(claim.job_id, "supported-simple");
        tx.commit().await.unwrap();
        state.pool.close();
    }
    #[tokio::test]
    #[ignore = "requires disposable PostgreSQL runner rust_runtime_parity.py"]
    async fn postgres_admission_cancel_and_schema() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").expect("disposable test DSN required");
        assert_eq!(
            std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let (mut client, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
            .await
            .unwrap();
        tokio::spawn(async move {
            connection.await.unwrap();
        });
        let identity = client
            .query_one("SELECT current_user,current_database()", &[])
            .await
            .unwrap();
        assert_eq!(identity.get::<_, String>(0), "rust_runtime_fixture");
        assert_eq!(identity.get::<_, String>(1), "rust_runtime_fixture");
        assert_eq!(
            schema_runtime::apply_migrations(&mut client, false)
                .await
                .unwrap()
                .len(),
            4
        );
        assert!(
            schema_runtime::apply_migrations(&mut client, false)
                .await
                .unwrap()
                .is_empty()
        );
        client
            .execute(
                "INSERT INTO workspaces VALUES('tenant-a','now'),('tenant-b','now')",
                &[],
            )
            .await
            .unwrap();
        let manifest = json!({"dataset_id":"fixture","workspace_id":"tenant-a","quality":{"disposition":"pass"}});
        client
            .execute(
                "INSERT INTO datasets VALUES('tenant-a','fixture',$1,'hash','now')",
                &[&manifest],
            )
            .await
            .unwrap();
        let mut config = crate::tests::fixture(1000).config.clone();
        config.database_url = dsn;
        config.request_timeout = std::time::Duration::from_secs(30);
        config.pool_timeout = std::time::Duration::from_secs(3);
        config.artifact_root =
            PathBuf::from(std::env::var("TW_RUST_RUNTIME_TEST_ARTIFACTS").unwrap());
        config.local_workspaces = Some(vec!["tenant-a".into(), "tenant-b".into()]);
        let state = AppState::connect(config).await.unwrap();
        let app = crate::router(state.clone(), routes());
        async fn call(
            app: axum::Router,
            path: &str,
            workspace: &str,
            key: &str,
            body: Value,
        ) -> (StatusCode, Value) {
            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(path)
                        .header("x-workspace-id", workspace)
                        .header("content-type", "application/json")
                        .header("idempotency-key", key)
                        .body(Body::from(serde_json::to_vec(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
            (status, serde_json::from_slice(&bytes).unwrap())
        }
        let body = json!({"dataset_id":"fixture","starting_balance":10000.0});
        let (status, created) = call(
            app.clone(),
            "/api/v2/research/jobs",
            "tenant-a",
            "create",
            body.clone(),
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(created["status"], "queued");
        let (status, again) = call(
            app.clone(),
            "/api/v2/research/jobs",
            "tenant-a",
            "create",
            body.clone(),
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(created, again);
        assert_eq!(
            call(
                app.clone(),
                "/api/v2/research/jobs",
                "tenant-a",
                "create",
                json!({"dataset_id":"fixture","starting_balance":20000.0})
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(
                app.clone(),
                "/api/v2/research/jobs",
                "tenant-b",
                "other",
                body.clone()
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        let id = created["job_id"].as_str().unwrap();
        let path = format!("/api/v2/research/jobs/{id}/cancel");
        let (_, canceled) = call(app.clone(), &path, "tenant-a", "cancel", Value::Null).await;
        assert_eq!(canceled["status"], "canceled");
        assert_eq!(canceled["cancel_requested"], true);
        assert_eq!(
            call(app.clone(), &path, "tenant-b", "cancel-other", Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        let (_, running) = call(
            app.clone(),
            "/api/v2/research/jobs",
            "tenant-a",
            "create-running",
            body,
        )
        .await;
        let id = running["job_id"].as_str().unwrap();
        let protocol = json!({"validation":{"schema":"research-oos-validation-v1","sweep":{"trials":[{"trial_id":"a"},{"trial_id":"b"}]}}});
        let checkpoint =
            json!({"attempt_no":1,"trial_outcomes":[{"trial_id":"a","status":"completed"}]});
        client.execute("UPDATE research_jobs SET status='running',attempt_no=1,lease_owner='fixture',lease_token='token',lease_expires_at_utc=CURRENT_TIMESTAMP+interval '30 seconds',protocol_json=$2,checkpoint_json=$3 WHERE job_id=$1",&[&id,&protocol,&checkpoint]).await.unwrap();
        let candidate = state.config.artifact_root.join("tenant-a/results").join(id);
        std::fs::create_dir_all(&candidate).unwrap();
        std::fs::write(candidate.join("attempt-000001-test.json"), b"{}").unwrap();
        let (status, canceled) = call(
            app.clone(),
            &format!("/api/v2/research/jobs/{id}/cancel"),
            "tenant-a",
            "cancel-running",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(canceled["status"], "canceled");
        assert!(!candidate.exists());
        let row=client.query_one("SELECT lease_token,checkpoint_json,progress_json FROM research_jobs WHERE job_id=$1",&[&id]).await.unwrap();
        assert!(row.get::<_, Option<String>>(0).is_none());
        assert_eq!(
            row.get::<_, Value>(1)["trial_status_counts"],
            json!({"completed":1,"failed":0,"canceled":1})
        );
        let row = client
            .query_one(
                "SELECT count(*) FROM api_commands WHERE status='queued' OR status='running'",
                &[],
            )
            .await
            .unwrap();
        assert_eq!(row.get::<_, i64>(0), 0);
        let (_, job) = call(
            app.clone(),
            "/api/v2/research/jobs",
            "tenant-a",
            "lease-job",
            json!({"dataset_id":"fixture","starting_balance":10000.0}),
        )
        .await;
        let id = job["job_id"].as_str().unwrap();
        let tx = client.transaction().await.unwrap();
        let lease = lifecycle::claim(&tx, "native", 30, 1)
            .await
            .unwrap()
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(lease.job_id, id);
        let tx = client.transaction().await.unwrap();
        assert!(
            lifecycle::claim(&tx, "other", 30, 1)
                .await
                .unwrap()
                .is_none()
        );
        assert!(lifecycle::renew(&tx, &lease, 30).await.unwrap());
        assert!(lifecycle::checkpoint(&tx,&lease,json!({"schema":"research-job-checkpoint-v1","phase":"dataset-loaded","attempt_no":lease.attempt_no,"row_count":2}),Some(json!({"phase_index":2,"phase_count":4}))).await.unwrap());
        assert!(
            lifecycle::complete(&tx, &lease, "tenant-a/results/test.json", "checksum")
                .await
                .unwrap()
        );
        tx.commit().await.unwrap();
        let tx = client.transaction().await.unwrap();
        assert!(!lifecycle::renew(&tx, &lease, 30).await.unwrap());
        assert!(
            lifecycle::complete(&tx, &lease, "other", "checksum")
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();
        client
            .execute(
                "UPDATE tw_schema_migrations SET sha256='wrong' WHERE version='0001_baseline.sql'",
                &[],
            )
            .await
            .unwrap();
        assert!(
            schema_runtime::apply_migrations(&mut client, true)
                .await
                .is_err()
        );
        state.pool.close();
    }
    #[test]
    fn cancellation_accounts_for_every_trial_and_fences_attempts() {
        let protocol = json!({"validation":{"schema":"research-oos-validation-v1","sweep":{"trials":[{"trial_id":"a"},{"trial_id":"b"}]}}});
        let checkpoint =
            json!({"attempt_no":2,"trial_outcomes":[{"trial_id":"a","status":"completed"}]});
        let (state, progress) = cancellation_state(Some(&protocol), Some(&checkpoint), 2).unwrap();
        assert_eq!(
            state["trial_status_counts"],
            json!({"completed":1,"failed":0,"canceled":1})
        );
        assert_eq!(progress["trial_index"], 1);
        assert_eq!(
            cancellation_state(Some(&protocol), Some(&checkpoint), 3)
                .unwrap()
                .0["trial_status_counts"]["canceled"],
            2
        );
        let malformed =
            json!({"attempt_no":2,"trial_outcomes":[{"trial_id":"outside","status":"completed"}]});
        assert!(cancellation_state(Some(&protocol), Some(&malformed), 2).is_none());
    }
    #[test]
    fn quarantines_without_overwriting_or_escaping() {
        let root =
            std::env::temp_dir().join(format!("rust-runtime-research-{}", uuid::Uuid::new_v4()));
        let source = root.join("tenant/results/job");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("attempt-000001-test.json"), b"{}").unwrap();
        quarantine_candidates(&root, "tenant", "job").unwrap();
        assert!(
            root.join("tenant/quarantine/results/job/attempt-000001-test.json")
                .is_file()
        );
        assert!(!source.exists());
        assert!(quarantine_candidates(&root, "..", "job").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
