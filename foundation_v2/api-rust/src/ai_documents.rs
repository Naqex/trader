//! Source files are separate from agent configuration and bounded inference snapshots.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json,
    body::{Body, to_bytes},
    extract::{Path, Query, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, sync::Arc};
use tokio_postgres::Transaction;
use uuid::Uuid;

const FILE_LIMIT: usize = 10 * 1024 * 1024;
const SNAPSHOT_LIMIT: usize = 24576;
const DOCUMENT_LOCK: i64 = 0x54574149444F43;
fn invalid() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_ai_document")
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "ai_document_not_found")
}
fn metadata(row: &tokio_postgres::Row) -> Value {
    json!({"id":row.get::<_,Uuid>(0),"name":row.get::<_,String>(1),"sha256":row.get::<_,String>(2),"bytes":row.get::<_,i32>(3)})
}
fn chunks(source: &str) -> Vec<String> {
    let mut remaining = source;
    let mut result = Vec::new();
    while !remaining.is_empty() {
        let mut end = remaining.len().min(4096);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        result.push(remaining[..end].to_owned());
        remaining = &remaining[end..];
    }
    result
}
fn query(text: &str) -> String {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| s.chars().count() > 1)
        .map(|s| s.chars().take(64).collect::<String>().to_lowercase())
        .take(40)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(" OR ")
}
#[derive(Deserialize)]
pub(crate) struct Upload {
    name: String,
}
pub(crate) async fn upload(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Query(file): Query<Upload>,
    request: Request,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if file.name.len() > 180
        || file.name.is_empty()
        || file
            .name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\'))
        || ![".txt", ".md"]
            .iter()
            .any(|ext| file.name.to_lowercase().ends_with(ext))
    {
        return Err(invalid());
    }
    let _permit = state
        .artifact_reads
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::detail(StatusCode::TOO_MANY_REQUESTS, "ai_document_capacity"))?;
    let bytes = to_bytes(request.into_body(), FILE_LIMIT)
        .await
        .map_err(|_| ApiError::detail(StatusCode::PAYLOAD_TOO_LARGE, "ai_document_too_large"))?;
    let (sha, parts, size) = tokio::task::spawn_blocking(move || {
        let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
        if text.trim().is_empty() || text.contains('\0') {
            return Err(invalid());
        }
        Ok::<_, ApiError>((
            format!("{:x}", Sha256::digest(&bytes)),
            chunks(text),
            bytes.len() as i32,
        ))
    })
    .await
    .map_err(|_| invalid())??;
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&DOCUMENT_LOCK])
        .await
        .map_err(|_| ApiError::database())?;
    if let Some(row)=tx.query_opt("SELECT document_id,name,sha256,byte_size FROM ai_documents WHERE workspace_id=$1 AND subject=$2 AND name=$3 AND sha256=$4",&[&scope.workspace_id,&scope.subject,&file.name,&sha]).await.map_err(|_|ApiError::database())? { return Ok((StatusCode::OK,Json(metadata(&row)))); }
    let quota=tx.query_one("SELECT count(*),COALESCE(sum(byte_size),0)::bigint FROM ai_documents WHERE workspace_id=$1 AND subject=$2",&[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    if quota.get::<_, i64>(0) >= 100 || quota.get::<_, i64>(1) + i64::from(size) > 200 * 1024 * 1024
    {
        return Err(ApiError::detail(
            StatusCode::CONFLICT,
            "ai_document_storage_full",
        ));
    }
    let id = Uuid::new_v4();
    let row=tx.query_one("INSERT INTO ai_documents(workspace_id,subject,document_id,name,sha256,byte_size) VALUES($1,$2,$3,$4,$5,$6) RETURNING document_id,name,sha256,byte_size",&[&scope.workspace_id,&scope.subject,&id,&file.name,&sha,&size]).await.map_err(|_|ApiError::database())?;
    tx.execute("INSERT INTO ai_document_chunks(workspace_id,subject,document_id,chunk_index,body) SELECT $1,$2,$3,(ordinality-1)::integer,body FROM unnest($4::text[]) WITH ORDINALITY AS chunks(body,ordinality)",&[&scope.workspace_id,&scope.subject,&id,&parts]).await.map_err(|_|ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok((StatusCode::CREATED, Json(metadata(&row))))
}
pub(crate) async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=conn.query("SELECT document_id,name,sha256,byte_size FROM ai_documents WHERE workspace_id=$1 AND subject=$2 ORDER BY created_at DESC,document_id LIMIT 100",&[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    Ok(Json(
        json!({"items":rows.iter().map(metadata).collect::<Vec<_>>(),"max_file_bytes":FILE_LIMIT}),
    ))
}
pub(crate) async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let _permit = state
        .artifact_reads
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::detail(StatusCode::TOO_MANY_REQUESTS, "ai_document_capacity"))?;
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row=conn.query_opt("SELECT string_agg(c.body,'' ORDER BY c.chunk_index) FROM ai_documents d JOIN ai_document_chunks c USING(workspace_id,subject,document_id) WHERE d.workspace_id=$1 AND d.subject=$2 AND d.document_id=$3 GROUP BY d.document_id",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=knowledge.txt",
            ),
        ],
        Body::from(row.get::<_, String>(0)),
    )
        .into_response())
}
pub(crate) async fn delete(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let mut conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = conn.transaction().await.map_err(|_| ApiError::database())?;
    let row=tx.query_opt("SELECT document_id FROM ai_documents WHERE workspace_id=$1 AND subject=$2 AND document_id=$3 FOR UPDATE",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
    drop(row);
    let referenced=tx.query_opt("SELECT 1 FROM ai_agents WHERE workspace_id=$1 AND subject=$2 AND config->'knowledge' @> $3::jsonb LIMIT 1",&[&scope.workspace_id,&scope.subject,&json!([{"id":id}])]).await.map_err(|_|ApiError::database())?.is_some();
    if referenced {
        return Err(ApiError::detail(StatusCode::CONFLICT, "ai_document_in_use"));
    }
    tx.execute(
        "DELETE FROM ai_documents WHERE workspace_id=$1 AND subject=$2 AND document_id=$3",
        &[&scope.workspace_id, &scope.subject, &id],
    )
    .await
    .map_err(|_| ApiError::database())?;
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn references(
    tx: &Transaction<'_>,
    scope: &Workspace,
    files: &Value,
) -> Result<Value, ApiError> {
    let mut result = Vec::new();
    for file in files.as_array().ok_or_else(invalid)? {
        if let Some(id) = file["id"].as_str() {
            let id = Uuid::parse_str(id).map_err(|_| invalid())?;
            let row=tx.query_opt("SELECT document_id,name,sha256,byte_size FROM ai_documents WHERE workspace_id=$1 AND subject=$2 AND document_id=$3 FOR SHARE",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
            if result.iter().any(|v: &Value| v["id"] == json!(id)) {
                return Err(invalid());
            }
            result.push(metadata(&row));
        } else {
            result.push(file.clone());
        }
    }
    Ok(json!(result))
}
pub(crate) async fn ground(
    tx: &Transaction<'_>,
    scope: &Workspace,
    files: &Value,
    prompt: &str,
) -> Result<Value, ApiError> {
    let mut result = Vec::new();
    let mut budget = SNAPSHOT_LIMIT;
    let search = query(prompt);
    // Snapshot excerpts at admission: edits/deletes cannot change the evidence of an admitted run.
    for file in files.as_array().ok_or_else(invalid)? {
        if budget == 0 {
            break;
        }
        if let Some(id) = file["id"].as_str() {
            let id = Uuid::parse_str(id).map_err(|_| invalid())?;
            let mut rows = if search.is_empty() {
                vec![]
            } else {
                tx.query("SELECT chunk_index,body FROM ai_document_chunks WHERE workspace_id=$1 AND subject=$2 AND document_id=$3 AND search @@ websearch_to_tsquery('simple',$4) ORDER BY ts_rank_cd(search,websearch_to_tsquery('simple',$4)) DESC,chunk_index LIMIT 3",&[&scope.workspace_id,&scope.subject,&id,&search]).await.map_err(|_|ApiError::database())?
            };
            let matched = !rows.is_empty();
            if !matched {
                rows=tx.query("SELECT chunk_index,body FROM ai_document_chunks WHERE workspace_id=$1 AND subject=$2 AND document_id=$3 ORDER BY chunk_index LIMIT 1",&[&scope.workspace_id,&scope.subject,&id]).await.map_err(|_|ApiError::database())?;
            }
            for row in rows {
                if budget == 0 {
                    break;
                }
                let body: String = row.get(1);
                let text = bounded(&body, budget);
                budget -= text.len();
                result.push(json!({"id":id,"name":file["name"],"sha256":file["sha256"],"chunk":row.get::<_,i32>(0),"text":text,"retrieval":if matched {"keyword-match"}else{"document-intro"}}));
            }
        } else {
            let text = bounded(file["text"].as_str().ok_or_else(invalid)?, budget);
            budget -= text.len();
            result.push(json!({"name":file["name"],"text":text,"retrieval":"legacy-inline"}));
        }
    }
    Ok(json!(result))
}
fn bounded(text: &str, budget: usize) -> &str {
    let mut end = text.len().min(budget);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_unicode_source_is_lossless_but_context_is_bounded() {
        let source = "Quản trị rủi ro và chiến lược.\n".repeat(100000);
        let parts = chunks(&source);
        assert_eq!(parts.concat(), source);
        assert!(parts.iter().all(|p| p.len() <= 4096));
        assert!(bounded(&source, SNAPSHOT_LIMIT).len() <= SNAPSHOT_LIMIT);
        assert!(!query("'); DROP TABLE ai_runs; -- rủi ro?").contains(';'));
    }
}
