//! PostgreSQL is the scheduler authority; files are restart checkpoints only.
use super::{DownloadEngine, ProviderRuntime};
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json,
    extract::{Extension, MatchedPath, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{Days, NaiveDate, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, atomic::Ordering},
};
use tokio_postgres::Transaction;

pub(crate) fn provider(runtime: &ProviderRuntime) -> &'static str {
    match runtime.engine {
        DownloadEngine::Qdm { .. } => "QuantDataManager",
        _ => "Dukascopy",
    }
}
pub(crate) fn base(runtime: &ProviderRuntime) -> PathBuf {
    runtime
        .root
        .join(if provider(runtime) == "QuantDataManager" {
            "qdm"
        } else {
            "dukascopy"
        })
}
fn hash_key(text: &str) -> i64 {
    i64::from_be_bytes(Sha256::digest(text.as_bytes())[..8].try_into().unwrap())
}
fn spelling(path: &FsPath) -> String {
    let value = path.to_string_lossy();
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
}
pub(crate) fn source_key(runtime: &ProviderRuntime) -> Result<i64, ApiError> {
    let root =
        std::fs::canonicalize(&runtime.root).map_err(|_| unavailable("worker_unavailable"))?;
    Ok(hash_key(&spelling(&root.join(
        if provider(runtime) == "QuantDataManager" {
            "qdm"
        } else {
            "dukascopy"
        },
    ))))
}
pub(crate) fn folder(
    runtime: &ProviderRuntime,
    workspace: &str,
    id: &str,
) -> Result<PathBuf, ApiError> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid("download_not_found"));
    }
    let workspace_hash = format!("{:x}", Sha256::digest(workspace.as_bytes()));
    Ok(base(runtime).join(&workspace_hash[..16]).join(id))
}
pub(crate) fn job_key(
    runtime: &ProviderRuntime,
    workspace: &str,
    id: &str,
) -> Result<i64, ApiError> {
    let root =
        std::fs::canonicalize(&runtime.root).map_err(|_| unavailable("worker_unavailable"))?;
    let relative = folder(runtime, workspace, id)?
        .strip_prefix(&runtime.root)
        .map_err(|_| unavailable("worker_unavailable"))?
        .to_path_buf();
    Ok(hash_key(&spelling(&root.join(relative))))
}
fn invalid(detail: &str) -> ApiError {
    ApiError::detail(
        if detail == "download_not_found" {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::UNPROCESSABLE_ENTITY
        },
        detail,
    )
}
pub(crate) fn unavailable(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, detail)
}
fn conflict(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, detail)
}
pub(crate) fn public(job: &Value) -> Result<Value, ApiError> {
    const FIELDS: &[&str] = &[
        "job_id",
        "instrument_id",
        "from_date",
        "to_date",
        "status",
        "error",
        "completed_days",
        "total_days",
        "dataset_id",
        "transferred_bytes",
        "cached_bytes",
        "stage",
        "full_from_date",
        "parent_dataset_id",
        "created_at_utc",
        "revision",
        "provider_code",
        "catalog_sha256",
        "network_days",
        "buckets_sha256",
        "quality",
        "provider",
        "supports_pause",
        "supports_cancel",
        "data_source",
        "download_engine",
        "progress_scope",
        "progress_percent",
        "qdm_version",
        "qdm_retrieved_at_utc",
        "qdm_export_sha256",
    ];
    let mut result = json!({});
    for key in FIELDS {
        if let Some(value) = job.get(*key) {
            if value.is_array() || value.is_object() {
                return Err(unavailable("invalid_download_snapshot"));
            }
            result[*key] = value.clone();
        }
    }
    Ok(result)
}
pub(crate) fn snapshot(runtime: &ProviderRuntime, job: &Value) -> Result<Value, ApiError> {
    let mut job = public(job)?;
    if provider(runtime) == "QuantDataManager" {
        for (key, value) in [
            ("provider", json!("QuantDataManager")),
            ("supports_pause", json!(false)),
            ("supports_cancel", json!(false)),
            ("data_source", json!("Dukascopy")),
            ("download_engine", json!("QuantDataManager")),
            ("transferred_bytes", Value::Null),
            ("progress_scope", json!("phase")),
        ] {
            job[key] = value;
        }
    }
    Ok(job)
}
pub(crate) async fn save(
    tx: &Transaction<'_>,
    runtime: &ProviderRuntime,
    job: &mut Value,
) -> Result<(), ApiError> {
    let workspace = job["workspace_id"]
        .as_str()
        .ok_or_else(|| unavailable("invalid_download_snapshot"))?;
    let id = job["job_id"]
        .as_str()
        .ok_or_else(|| unavailable("invalid_download_snapshot"))?;
    let key = job_key(runtime, workspace, id)?;
    let view = snapshot(runtime, job)?;
    let mut payload = job.clone();
    payload.as_object_mut().unwrap().remove("revision");
    let revision=if let Some(revision)=job["revision"].as_i64(){
        tx.query_opt("UPDATE download_jobs SET payload=$4,public_snapshot=$5,revision=revision+1,updated_at_utc=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND provider=$2 AND job_id=$3 AND revision=$6 RETURNING revision",&[&workspace,&provider(runtime),&id,&payload,&view,&revision]).await.map_err(|_|ApiError::database())?
    }else{
        let stamp=job["created_at_utc"].as_str().ok_or_else(||unavailable("invalid_download_snapshot"))?;
        let stamp=chrono::DateTime::parse_from_rfc3339(stamp).map_err(|_|unavailable("invalid_download_snapshot"))?.with_timezone(&Utc);
        tx.query_opt("INSERT INTO download_jobs(workspace_id,provider,job_id,payload,public_snapshot,owner_lock_key,created_at_utc) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING revision",&[&workspace,&provider(runtime),&id,&payload,&view,&key,&stamp]).await.map_err(|_|ApiError::database())?
    }.ok_or_else(||conflict("download_revision_conflict"))?.get::<_,i64>(0);
    job["revision"] = json!(revision);
    Ok(())
}
pub(crate) async fn read(
    tx: &Transaction<'_>,
    runtime: &ProviderRuntime,
    workspace: &str,
    id: &str,
    lock: bool,
) -> Result<Value, ApiError> {
    folder(runtime, workspace, id)?;
    let suffix = if lock { " FOR UPDATE" } else { "" };
    let row=tx.query_opt(&format!("SELECT payload,revision FROM download_jobs WHERE workspace_id=$1 AND provider=$2 AND job_id=$3{suffix}"),&[&workspace,&provider(runtime),&id]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid("download_not_found"))?;
    let mut job: Value = row.get(0);
    job["revision"] = json!(row.get::<_, i64>(1));
    Ok(job)
}
async fn public_view(
    tx: &Transaction<'_>,
    runtime: &ProviderRuntime,
    workspace: &str,
    id: &str,
) -> Result<Value, ApiError> {
    tx.query_opt("SELECT snapshot FROM download_job_snapshots WHERE workspace_id=$1 AND provider=$2 AND job_id=$3",&[&workspace,&provider(runtime),&id]).await.map_err(|_|ApiError::database())?.map(|r|r.get(0)).ok_or_else(||invalid("download_not_found"))
}
pub(crate) fn policy(runtime: &ProviderRuntime) -> Result<Value, ApiError> {
    if provider(runtime) == "QuantDataManager" {
        return Ok(json!({"rate_limit_level":0,"until":0}));
    }
    let path = base(runtime).join("cooldown.json");
    let value = if path.exists() {
        use std::io::Read;
        let meta =
            std::fs::symlink_metadata(&path).map_err(|_| unavailable("invalid_source_policy"))?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(unavailable("invalid_source_policy"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(unavailable("invalid_source_policy"));
            }
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .map_err(|_| unavailable("invalid_source_policy"))?
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable("invalid_source_policy"))?;
        if bytes.len() > 4096 {
            return Err(unavailable("invalid_source_policy"));
        }
        serde_json::from_slice::<Value>(&bytes).map_err(|_| unavailable("invalid_source_policy"))?
    } else {
        json!({})
    };
    let level = value
        .get("rate_limit_level")
        .and_then(Value::as_u64)
        .unwrap_or(if value.get("until").is_some() { 1 } else { 0 });
    if level > 5
        || !value
            .get("until")
            .is_none_or(|v| v.as_f64().is_some_and(|v| v.is_finite() && v >= 0.))
    {
        return Err(unavailable("invalid_source_policy"));
    }
    Ok(json!({"rate_limit_level":level,"until":value.get("until").cloned().unwrap_or(json!(0))}))
}

#[cfg(test)]
mod tests;
async fn admission(
    tx: &Transaction<'_>,
    runtime: &ProviderRuntime,
    workspace: &str,
) -> Result<(), ApiError> {
    let key = source_key(runtime)?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&hash_key(&format!("{key}:{workspace}:admission"))],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let available: bool = tx
        .query_one("SELECT pg_try_advisory_xact_lock($1)", &[&key])
        .await
        .map_err(|_| ApiError::database())?
        .get(0);
    if !available {
        return Err(conflict("download_busy"));
    }
    Ok(())
}
fn date(value: &Value) -> Result<NaiveDate, ApiError> {
    value
        .as_str()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .ok_or_else(|| invalid("invalid_date_range"))
}

pub async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Extension(runtime): Extension<Arc<ProviderRuntime>>,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    path: Option<Path<HashMap<String, String>>>,
    body: Option<Json<Value>>,
) -> Result<Response, ApiError> {
    let raw = body.map(|v| v.0).unwrap_or(Value::Null);
    let route = matched.as_str();
    let handler = match route {
        "/api/v2/data/downloads" => Some("request_offline_download"),
        "/api/v2/data/downloads/full" => Some("request_full_offline_download"),
        _ => None,
    };
    let normalized = match handler {
        Some(h) => crate::native_contracts::validate_body(h, raw.clone())?,
        None => raw.clone(),
    };
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let receipt = match crate::native_mutation::begin(
        &tx,
        &scope,
        "POST",
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
    tx.batch_execute("SAVEPOINT provider_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let id = path
        .as_ref()
        .and_then(|p| p.get("job_id"))
        .map(String::as_str);
    let result = execute(&tx, &runtime, &scope.workspace_id, route, id, &normalized).await;
    let (status, value) = match result {
        Ok(v) => (
            if route.ends_with("/cancel") {
                StatusCode::OK
            } else {
                StatusCode::ACCEPTED
            },
            v,
        ),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT provider_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = crate::native_mutation::finish(&tx, receipt, status, value).await?;
    let response = crate::native_mutation::commit(tx, response).await?;
    runtime.wake.notify_one();
    Ok(response)
}
pub(crate) async fn execute(
    tx: &Transaction<'_>,
    runtime: &ProviderRuntime,
    workspace: &str,
    route: &str,
    id: Option<&str>,
    body: &Value,
) -> Result<Value, ApiError> {
    let qdm = provider(runtime) == "QuantDataManager";
    if qdm && (route.ends_with("/pause") || route.ends_with("/cancel")) {
        return Err(unavailable("qdm_control_unsupported"));
    }
    if let Some(id) = id {
        let mut job = read(tx, runtime, workspace, id, true).await?;
        let status = job["status"].as_str().unwrap_or("");
        if route.ends_with("/resume") {
            if status == "completed" {
                return public_view(tx, runtime, workspace, id).await;
            }
            if status == "cancelled" {
                return Err(invalid("download_cancelled"));
            }
            admission(tx, runtime, workspace).await?;
            if !runtime.worker.load(Ordering::Acquire) {
                return Err(unavailable("worker_unavailable"));
            }
            let retry = job["retry_at"]
                .as_f64()
                .unwrap_or(0.)
                .max(policy(runtime)?["until"].as_f64().unwrap_or(0.));
            if retry > Utc::now().timestamp() as f64 {
                return Err(conflict("download_cooldown"));
            }
            job["status"] = json!("queued");
            job["error"] = Value::Null;
        } else {
            let terminal = if route.ends_with("/cancel") {
                ["completed", "cancelled"].as_slice()
            } else {
                ["completed", "cancelled", "paused", "failed"].as_slice()
            };
            if terminal.contains(&status) {
                return public_view(tx, runtime, workspace, id).await;
            }
            let key = job_key(runtime, workspace, id)?;
            let remote:bool=tx.query_one("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=(($1::bigint>>32)&4294967295)::oid AND objid=($1::bigint&4294967295)::oid)",&[&key]).await.map_err(|_|ApiError::database())?.get(0);
            // The Rust worker polls this durable state between bounded adapter events.
            job["status"] = json!(if route.ends_with("/cancel") {
                "cancelled"
            } else if remote {
                "pausing"
            } else {
                "paused"
            });
            job["error"] = Value::Null;
            job.as_object_mut().unwrap().remove("retry_at");
        }
        save(tx, runtime, &mut job).await?;
        return public_view(tx, runtime, workspace, id).await;
    }
    let availability = runtime.download_state();
    if availability["available"] != json!(true) {
        let error = if qdm {
            availability["error"]
                .as_str()
                .unwrap_or("qdm_not_configured")
        } else {
            "worker_unavailable"
        };
        return Err(unavailable(error));
    }
    if !runtime.worker.load(Ordering::Acquire) {
        return Err(unavailable("worker_unavailable"));
    }
    let symbol = body["instrument_id"]
        .as_str()
        .ok_or_else(|| invalid("instrument_not_supported"))?
        .trim()
        .to_uppercase();
    let meta = runtime
        .catalog
        .read()
        .map_err(|_| unavailable("catalog_state_unavailable"))?
        .metadata_for(&symbol)
        .ok_or_else(|| invalid("instrument_not_supported"))?;
    let catalog_item = runtime
        .instruments()
        .into_iter()
        .find(|i| i["instrument_id"] == json!(symbol))
        .ok_or_else(|| invalid("instrument_not_supported"))?;
    if catalog_item["provider_code"] != meta["code"] {
        return Err(invalid("instrument_not_supported"));
    }
    let earliest = date(&json!(
        meta["startDayForMinuteCandles"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(10)
            .collect::<String>()
    ))?;
    let full = route.ends_with("/full");
    let mut parent = Value::Null;
    let (mut start, end) = if full {
        (earliest, Utc::now().date_naive().pred_opt().unwrap())
    } else {
        (date(&body["from_date"])?, date(&body["to_date"])?)
    };
    if full && !body["dataset_id"].is_null() {
        let row=tx.query_opt("SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR KEY SHARE",&[&workspace,&body["dataset_id"].as_str().ok_or_else(||invalid("dataset_not_supported"))?]).await.map_err(|_|ApiError::database())?.ok_or_else(||invalid("dataset_not_supported"))?;
        let manifest: Value = row.get(0);
        let (saved_start, saved_end) = dataset_scope(runtime, workspace, &manifest, &symbol)?;
        if saved_start == earliest {
            start = saved_end
                .checked_add_days(Days::new(1))
                .ok_or_else(|| invalid("invalid_date_range"))?;
            parent = body["dataset_id"].clone();
        }
        if start > end {
            return Err(invalid("already_current"));
        }
    }
    let days = (end - start).num_days() + 1;
    if days < 1 || (!full && days > 366) || end >= Utc::now().date_naive() || start < earliest {
        return Err(invalid("invalid_date_range"));
    }
    admission(tx, runtime, workspace).await?;
    let old=tx.query("SELECT snapshot FROM download_job_snapshots WHERE workspace_id=$1 AND provider=$2 AND snapshot->>'instrument_id'=$3 AND snapshot->>'from_date'=$4 AND snapshot->>'to_date'=$5 AND snapshot->>'parent_dataset_id' IS NOT DISTINCT FROM $6 AND snapshot->>'full_from_date' IS NOT DISTINCT FROM $7 AND snapshot->>'status' NOT IN ('cancelled','failed') ORDER BY created_at_utc DESC,job_id DESC",&[&workspace,&provider(runtime),&symbol,&start.to_string(),&end.to_string(),&parent.as_str(),&full.then(||earliest.to_string())]).await.map_err(|_|ApiError::database())?;
    for row in old {
        let old: Value = row.get(0);
        if old["status"] == json!("completed")
            && tx
                .query_opt(
                    "SELECT 1 FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",
                    &[&workspace, &old["dataset_id"].as_str()],
                )
                .await
                .map_err(|_| ApiError::database())?
                .is_none()
        {
            continue;
        }
        if old["status"] == json!("paused") {
            let id = old["job_id"].as_str().unwrap();
            let mut job = read(tx, runtime, workspace, id, true).await?;
            let retry = job["retry_at"]
                .as_f64()
                .unwrap_or(0.)
                .max(policy(runtime)?["until"].as_f64().unwrap_or(0.));
            if retry > Utc::now().timestamp() as f64 {
                return Err(conflict("download_cooldown"));
            }
            job["status"] = json!("queued");
            job["error"] = Value::Null;
            save(tx, runtime, &mut job).await?;
            return public_view(tx, runtime, workspace, id).await;
        }
        return Ok(old);
    }
    let active:bool=tx.query_one("SELECT EXISTS(SELECT 1 FROM download_job_snapshots WHERE provider=$1 AND snapshot->>'status' IN ('queued','running','pausing'))",&[&provider(runtime)]).await.map_err(|_|ApiError::database())?.get(0);
    if active {
        return Err(conflict("download_busy"));
    }
    if policy(runtime)?["until"].as_f64().unwrap_or(0.) > Utc::now().timestamp() as f64 {
        return Err(conflict("download_cooldown"));
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let mut job = json!({"job_id":id,"workspace_id":workspace,"instrument_id":symbol,"from_date":start.to_string(),"to_date":end.to_string(),"status":"queued","error":null,"completed_days":0,"total_days":days,"dataset_id":null,"transferred_bytes":0,"cached_bytes":0,"stage":"downloading","full_from_date":full.then(||earliest.to_string()),"parent_dataset_id":parent,"created_at_utc":Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,false)});
    if qdm {
        job["provider_code"] = meta["code"].clone();
        job["catalog_sha256"] = runtime.catalog_state()["source_sha256"].clone();
    }
    save(tx, runtime, &mut job).await?;
    public_view(tx, runtime, workspace, &id).await
}
pub(crate) fn dataset_scope(
    runtime: &ProviderRuntime,
    workspace: &str,
    manifest: &Value,
    symbol: &str,
) -> Result<(NaiveDate, NaiveDate), ApiError> {
    if manifest["workspace_id"] != json!(workspace)
        || manifest["instrument_id"] != json!(symbol)
        || !manifest["source"]["provider"]
            .as_str()
            .is_some_and(|s| s.eq_ignore_ascii_case(provider(runtime)))
        || manifest["timeframe_seconds"] != json!(60)
        || manifest["holdout_policy"]
            .get("mode")
            .unwrap_or(&json!("none"))
            != &json!("none")
    {
        return Err(invalid("dataset_not_supported"));
    }
    let settings: Value = manifest["source"]["export_settings"]
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or_else(|| invalid("dataset_not_supported"))?;
    let (lib, price) = if provider(runtime) == "QuantDataManager" {
        ("qdm-cli-v1", "provider_default")
    } else {
        ("dukascopy-node@1.50.0", "bid")
    };
    if settings["library"] != json!(lib)
        || settings["price"] != json!(price)
        || settings["timeframe"] != json!("m1")
    {
        return Err(invalid("dataset_not_supported"));
    }
    let start = date(&settings["requested_from"]).map_err(|_| invalid("dataset_not_supported"))?;
    let end = date(&settings["requested_to"]).map_err(|_| invalid("dataset_not_supported"))?;
    if start > end {
        return Err(invalid("dataset_not_supported"));
    }
    Ok((start, end))
}
