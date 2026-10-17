//! Local CSV ingestion and exact-hash recovery. Provider catalogs stay with their owner.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{MatchedPath, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{delete, post},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub mod ingest;
mod legacy_codec;
mod lifecycle;

const PREVIEW: &str = "/api/v2/data/csv/preview";
const IMPORT: &str = "/api/v2/data/csv/import";
const REPAIR: &str = "/api/v2/data/datasets/{dataset_id}/repair";
const DELETE: &str = "/api/v2/data/datasets/{dataset_id}";
pub fn native(method: &str, path: &str) -> bool {
    (method == "POST" && [PREVIEW, IMPORT, REPAIR].contains(&path))
        || (method == "DELETE" && path == DELETE)
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(PREVIEW, post(invoke))
        .route(IMPORT, post(invoke))
        .route(REPAIR, post(repair))
        .route(DELETE, delete(remove))
}
fn invalid(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, detail)
}
fn io_error() -> ApiError {
    ApiError::detail(
        StatusCode::SERVICE_UNAVAILABLE,
        "dataset_publication_failed",
    )
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(raw) = body.map_err(|e| invalid(&e.body_text()))?;
    let route = matched.as_str().to_owned();
    let body = crate::native_contracts::validate_body(
        if route == PREVIEW {
            "preview_csv_payload"
        } else {
            "import_csv_payload"
        },
        raw.clone(),
    )?;
    // An HTTP cancellation must not release the lock while blocking file publication continues.
    // The bounded task owns the connection and its receipt through completion.
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| io_error())?;
    tokio::spawn(async move {
        let _permit=permit;
        let mut conn=deadpool_postgres::Client::take(state.pool.get().await.map_err(|_|ApiError::database())?);
        let tx=conn.transaction().await.map_err(|_|ApiError::database())?;
        tx.batch_execute("SET LOCAL idle_in_transaction_session_timeout='120s'").await.map_err(|_|ApiError::database())?;
        let mutation=match crate::native_mutation::begin(&tx,&scope,"POST",uri.path(),uri.query(),&headers,&raw).await? {
            crate::native_mutation::MutationStart::Replay(response)=>return Ok(response),
            crate::native_mutation::MutationStart::New(m)=>m,
        };
        tx.batch_execute("SAVEPOINT data_domain").await.map_err(|_|ApiError::database())?;
        let operation=async {
            let parsed=body.clone();
            let (preview,rows)=tokio::task::spawn_blocking(move||ingest::preview(&parsed)).await.map_err(|_|io_error())?.map_err(|e|invalid(&e))?;
            if route==PREVIEW {return Ok((StatusCode::OK,json!({"schema_version":"u2-data-desk-preview-view-v1","workspace_id":scope.workspace_id,"execution_capability":false,"preview":preview})));}
            if rows.len()<2{return Err(invalid("dataset requires at least two rows"));}
            provider_locks(&tx,&state.config.artifact_root).await?;
            let dataset=preview["dataset_id"].as_str().unwrap();
            tx.query_one("SELECT pg_advisory_xact_lock($1)",&[&lifecycle::lock_key(&scope.workspace_id,dataset)]).await.map_err(|_|ApiError::database())?;
            lifecycle::assert_not_removing(&state.config.artifact_root,&scope.workspace_id,dataset)?;
            if tx.query_opt("SELECT 1 FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",&[&scope.workspace_id,&dataset]).await.map_err(|_|ApiError::database())?.is_some(){return Err(invalid("dataset already exists; immutable import refuses overwrite"));}
            let root=state.config.artifact_root.clone(); let workspace=scope.workspace_id.clone(); let data=dataset.to_owned(); let source=body["csv_text"].as_str().unwrap().as_bytes().to_vec();
            let (raw_path,raw_sha,artifact_path,artifact_sha)=tokio::task::spawn_blocking(move||publish_import(&root,&workspace,&data,&source,&rows)).await.map_err(|_|io_error())??;
            let manifest=json!({"contract_version":"foundation-v2.1","dataset_id":dataset,"workspace_id":scope.workspace_id,"source":preview["source"],"instrument_id":preview["instrument"]["instrument_id"],"timeframe":format!("{}s",preview["timeframe_seconds"]),"row_count":preview["row_count"],"first_timestamp":preview["available_range"]["from_utc"],"last_timestamp":preview["available_range"]["to_utc"],"artifact_path":artifact_path,"artifact_sha256":artifact_sha,"raw_artifact_path":raw_path,"raw_sha256":raw_sha,"normalized_sha256":preview["normalized_sha256"],"instrument_spec":preview["instrument"],"timeframe_seconds":preview["timeframe_seconds"],"available_range":preview["available_range"],"quality":preview["quality"],"holdout_policy":preview["holdout_policy"],"transform_version":ingest::TRANSFORM,"created_at_utc":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,true)});
            tx.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES($1,$2,$3,$4,$5)",&[&scope.workspace_id,&dataset,&manifest,&artifact_sha,&manifest["created_at_utc"].as_str().unwrap()]).await.map_err(|_|ApiError::database())?;
            Ok((StatusCode::CREATED,json!({"schema_version":"u2-data-desk-import-view-v1","execution_capability":false,"dataset":manifest})))
        }.await;
        let(status,value)=match operation{Ok(v)=>v,Err(e)=>{tx.batch_execute("ROLLBACK TO SAVEPOINT data_domain").await.map_err(|_|ApiError::database())?;(e.0,e.1)}};
        let response=crate::native_mutation::finish(&tx,mutation,status,value).await?;
        crate::native_mutation::commit(tx,response).await
    }).await.map_err(|_|io_error())?
}

// Same keys as the Python provider workers, including Windows' non-extended path spelling.
async fn provider_locks(
    tx: &tokio_postgres::Transaction<'_>,
    root: &std::path::Path,
) -> Result<(), ApiError> {
    for key in provider_keys(root)? {
        let locked: bool = tx
            .query_one("SELECT pg_try_advisory_xact_lock($1)", &[&key])
            .await
            .map_err(|_| ApiError::database())?
            .get(0);
        if !locked {
            return Err(ApiError::detail(StatusCode::CONFLICT, "download_busy"));
        }
    }
    Ok(())
}
fn provider_keys(root: &std::path::Path) -> Result<Vec<i64>, ApiError> {
    let root = std::fs::canonicalize(root).map_err(|_| io_error())?;
    Ok(["dukascopy", "qdm"]
        .into_iter()
        .map(|provider| {
            let path = root.join(provider).to_string_lossy().to_string();
            let path = path.strip_prefix(r"\\?\").unwrap_or(&path);
            let hash = Sha256::digest(path.as_bytes());
            i64::from_be_bytes(hash[..8].try_into().unwrap())
        })
        .collect())
}

pub(crate) fn publish_import(
    root: &std::path::Path,
    workspace: &str,
    dataset: &str,
    raw: &[u8],
    rows: &[Value],
) -> Result<(String, String, String, String), ApiError> {
    publish_import_with(root, workspace, dataset, |writer| {
        let (raw_path,raw_sha)=writer.write_raw_source_bytes(workspace,dataset,raw).map_err(|_|io_error())?;
        let (artifact_path,artifact_sha)=writer.write_dataset(workspace,dataset,rows).map_err(|_|io_error())?;
        Ok((raw_path,raw_sha,artifact_path,artifact_sha))
    })
}

pub(crate) fn publish_import_files(
    root: &std::path::Path, workspace: &str, dataset: &str,
    raw: &std::path::Path, rows: &std::path::Path,
) -> Result<(String,String,String,String),ApiError> {
    publish_import_with(root,workspace,dataset,|writer| {
        let raw=std::fs::File::open(raw).map_err(|_|io_error())?;
        let (raw_path,raw_sha)=writer.write_raw_source(workspace,dataset,raw).map_err(|_|io_error())?;
        let rows=std::io::BufReader::new(std::fs::File::open(rows).map_err(|_|io_error())?);
        let rows=serde_json::Deserializer::from_reader(rows).into_iter::<Value>().map(|row|row.map_err(|e|e.to_string()));
        let (artifact_path,artifact_sha)=writer.write_dataset_iter(workspace,dataset,rows).map_err(|_|io_error())?;
        Ok((raw_path,raw_sha,artifact_path,artifact_sha))
    })
}

fn publish_import_with(
    root: &std::path::Path, workspace: &str, dataset: &str,
    write: impl FnOnce(&crate::artifact_data::ArtifactData)->Result<(String,String,String,String),ApiError>,
) -> Result<(String,String,String,String),ApiError> {
    let staging = lifecycle::import_staging(root)?;
    let result = (|| {
        let writer = crate::artifact_data::ArtifactData::new(&staging).map_err(|_| io_error())?;
        let (raw_path,raw_sha,artifact_path,artifact_sha)=write(&writer)?;
        // A crash before the DB commit can leave these immutable bytes. A retry may
        // adopt only exact matching hashes, never overwrite another artifact.
        lifecycle::publish_candidate(root, &staging, &raw_path, &raw_sha)?;
        lifecycle::publish_candidate(root, &staging, &artifact_path, &artifact_sha)?;
        Ok((raw_path, raw_sha, artifact_path, artifact_sha))
    })();
    // Remove only files created by this attempt; never recursively traverse an artifact tree.
    for relative in [
        format!("{workspace}/raw/{dataset}/source.csv"),
        format!("{workspace}/datasets/{dataset}.parquet"),
    ] {
        let _ = std::fs::remove_file(staging.join(relative));
    }
    for relative in [
        format!("{workspace}/raw/{dataset}"),
        format!("{workspace}/raw"),
        format!("{workspace}/datasets"),
        workspace.to_owned(),
    ] {
        let _ = std::fs::remove_dir(staging.join(relative));
    }
    let _ = std::fs::remove_dir(staging);
    result
}

pub(crate) fn dataset_lock_key(workspace: &str, dataset: &str) -> i64 {
    lifecycle::lock_key(workspace, dataset)
}
pub(crate) fn assert_not_removing(
    root: &std::path::Path,
    workspace: &str,
    dataset: &str,
) -> Result<(), ApiError> {
    lifecycle::assert_not_removing(root, workspace, dataset)
}

async fn repair(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(dataset): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| io_error())?;
    tokio::spawn(async move {
        let _permit = permit;
        let mut conn = deadpool_postgres::Client::take(
            state.pool.get().await.map_err(|_| ApiError::database())?,
        );
        let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
        tx.batch_execute("SET LOCAL idle_in_transaction_session_timeout='120s'")
            .await
            .map_err(|_| ApiError::database())?;
        let m = match crate::native_mutation::begin(
            &tx,
            &scope,
            "POST",
            uri.path(),
            uri.query(),
            &headers,
            &Value::Null,
        )
        .await?
        {
            crate::native_mutation::MutationStart::Replay(r) => return Ok(r),
            crate::native_mutation::MutationStart::New(m) => m,
        };
        tx.batch_execute("SAVEPOINT data_domain")
            .await
            .map_err(|_| ApiError::database())?;
        let result = async {
            provider_locks(&tx, &state.config.artifact_root).await?;
            lifecycle::repair(&tx, &state, &scope.workspace_id, &dataset).await
        }
        .await;
        let (status, value) = match result {
            Ok(v) => (StatusCode::OK, v),
            Err(e) => {
                tx.batch_execute("ROLLBACK TO SAVEPOINT data_domain")
                    .await
                    .map_err(|_| ApiError::database())?;
                (e.0, e.1)
            }
        };
        let response = crate::native_mutation::finish(&tx, m, status, value).await?;
        crate::native_mutation::commit(tx, response).await
    })
    .await
    .map_err(|_| io_error())?
}

async fn remove(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(dataset): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| io_error())?;
    tokio::spawn(async move{
        let _permit=permit;
        // Session locks span catalog commit and filesystem cleanup. Taking the
        // client out of the pool ensures even panic/cancellation closes its locks.
        let mut conn=deadpool_postgres::Client::take(state.pool.get().await.map_err(|_|ApiError::database())?);
        for key in provider_keys(&state.config.artifact_root)?{
            let locked:bool=conn.query_one("SELECT pg_try_advisory_lock($1)",&[&key]).await.map_err(|_|ApiError::database())?.get(0);
            if !locked{return Err(ApiError::detail(StatusCode::CONFLICT,"download_busy"));}
        }
        conn.query_one("SELECT pg_advisory_lock($1)",&[&lifecycle::lock_key(&scope.workspace_id,&dataset)]).await.map_err(|_|ApiError::database())?;
        let tx=conn.transaction().await.map_err(|_|ApiError::database())?;
        tx.batch_execute("SET LOCAL idle_in_transaction_session_timeout='120s'").await.map_err(|_|ApiError::database())?;
        let response=match crate::native_mutation::begin(&tx,&scope,"DELETE",uri.path(),uri.query(),&headers,&Value::Null).await?{
            crate::native_mutation::MutationStart::Replay(r)=>{tx.rollback().await.map_err(|_|ApiError::database())?;r},
            crate::native_mutation::MutationStart::New(m)=>{
                tx.batch_execute("SAVEPOINT data_domain").await.map_err(|_|ApiError::database())?;
                let result=lifecycle::delete(&tx,&state,&scope.workspace_id,&dataset).await;
                let(status,value)=match result{Ok(_)=>(StatusCode::SERVICE_UNAVAILABLE,json!({"detail":"dataset_cleanup_pending","dataset_id":dataset})),Err(e)=>{tx.batch_execute("ROLLBACK TO SAVEPOINT data_domain").await.map_err(|_|ApiError::database())?;(e.0,e.1)}};
                let r=crate::native_mutation::finish(&tx,m,status,value).await?;
                crate::native_mutation::commit(tx,r).await?
            },
        };
        let id=response.headers().get("x-command-id").and_then(|v|v.to_str().ok()).and_then(|v|uuid::Uuid::parse_str(v).ok()).ok_or_else(io_error)?;
        let pending=conn.query_opt("SELECT 1 FROM api_commands WHERE command_id=$1 AND workspace_id=$2 AND identity_id=$3 AND method='DELETE' AND path=$4 AND result_status=503 AND result_body->>'detail'='dataset_cleanup_pending'",&[&id,&scope.workspace_id,&scope.subject,&uri.path()]).await.map_err(|_|ApiError::database())?.is_some();
        if !pending{
            // Success may have committed just before process termination or a
            // journal sharing violation. Only remove that completed tombstone
            // when no catalog row has been republished under this dataset ID.
            let finished:bool=conn.query_one("SELECT EXISTS(SELECT 1 FROM api_commands WHERE command_id=$1 AND status='completed' AND result_status=200 AND result_body->>'dataset_id'=$2 AND result_body->>'deleted'='true') AND NOT EXISTS(SELECT 1 FROM datasets WHERE workspace_id=$3 AND dataset_id=$2)",&[&id,&dataset,&scope.workspace_id]).await.map_err(|_|ApiError::database())?.get(0);
            if finished{let _=lifecycle::clear_delete_journal(&state,&scope.workspace_id,&dataset).await;}
            return Ok(response);
        }
        if lifecycle::finish_delete(&state,&scope.workspace_id,&dataset).await.is_err(){return Ok(response);}
        let value=json!({"dataset_id":dataset,"deleted":true});
        // A retry with a new key may finish the same journal. Complete every
        // pending receipt for this removal before allowing the ID to be imported again.
        let count=conn.execute("UPDATE api_commands SET status='completed',result_status=200,result_body=$3,updated_at_utc=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND method='DELETE' AND result_body->>'dataset_id'=$2 AND result_status=503 AND result_body->>'detail'='dataset_cleanup_pending'",&[&scope.workspace_id,&dataset,&value]).await.map_err(|_|ApiError::database())?;
        if count==0{return Err(io_error());}
        // Once success is durable, a leftover journal is recoverable housekeeping.
        let _=lifecycle::clear_delete_journal(&state,&scope.workspace_id,&dataset).await;
        use axum::response::IntoResponse;
        let mut completed=Json(value).into_response();completed.headers_mut().insert("x-command-id",response.headers()["x-command-id"].clone());Ok(completed)
    }).await.map_err(|_|io_error())?
}
