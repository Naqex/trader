//! Workspace note folders; no account or broker mutation.
use crate::{
    auth::{ApiError, Workspace},
    native_mutation,
    state::AppState,
};
use axum::{
    Json,
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};
use tokio_postgres::{GenericClient, Transaction};

fn invalid(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, detail)
}

async fn catalog<C: GenericClient + Sync>(db: &C, workspace: &str) -> Result<Value, ApiError> {
    let rows = db.query("SELECT f.folder_id,f.name,COALESCE(array_agg(m.record_id ORDER BY m.record_id) FILTER (WHERE m.record_id IS NOT NULL),ARRAY[]::text[]) FROM live_note_folders f LEFT JOIN live_note_folder_members m USING(workspace_id,folder_id) WHERE f.workspace_id=$1 GROUP BY f.workspace_id,f.folder_id ORDER BY f.created_at_utc,f.folder_id", &[&workspace]).await.map_err(|_|ApiError::database())?;
    Ok(
        json!({"version":"live-note-folders-v1","items":rows.iter().map(|r|json!({"id":r.get::<_,String>(0),"name":r.get::<_,String>(1),"note_ids":r.get::<_,Vec<String>>(2)})).collect::<Vec<_>>()}),
    )
}
pub async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    Ok(Json(catalog(&**client, &scope.workspace_id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    name: String,
    note_ids: Vec<String>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid("invalid_note_folder"))?;
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    let mutation = match native_mutation::begin(
        &tx,
        &scope,
        "POST",
        uri.path(),
        uri.query(),
        &headers,
        &body,
    )
    .await?
    {
        native_mutation::MutationStart::Replay(response) => return Ok(response),
        native_mutation::MutationStart::New(mutation) => mutation,
    };
    tx.batch_execute("SAVEPOINT note_folder_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(&tx, &scope, body, uri.query()).await {
        Ok(result) => (StatusCode::CREATED, result),
        Err(error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT note_folder_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (error.0, error.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, result).await?;
    native_mutation::commit(tx, response).await
}
async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    body: Value,
    query: Option<&str>,
) -> Result<Value, ApiError> {
    if query.is_some() {
        return Err(invalid("invalid_note_folder"));
    }
    let draft: Draft = serde_json::from_value(body).map_err(|_| invalid("invalid_note_folder"))?;
    if draft.name.trim() != draft.name
        || draft.name.is_empty()
        || draft.name.chars().count() > 80
        || draft.name.chars().any(char::is_control)
        || draft.note_ids.len() > 10000
        || draft.note_ids.iter().collect::<HashSet<_>>().len() != draft.note_ids.len()
    {
        return Err(invalid("invalid_note_folder"));
    }
    tx.execute(
        "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2) ON CONFLICT DO NOTHING",
        &[&scope.workspace_id, &chrono::Utc::now().to_rfc3339()],
    )
    .await
    .map_err(|_| ApiError::database())?;
    tx.query_one(
        "SELECT workspace_id FROM workspaces WHERE workspace_id=$1 FOR UPDATE",
        &[&scope.workspace_id],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let count: i64 = tx
        .query_one(
            "SELECT count(*) FROM live_note_folders WHERE workspace_id=$1",
            &[&scope.workspace_id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .get(0);
    if count >= 200 {
        return Err(invalid("note_folder_limit"));
    }
    let found:i64=tx.query_one("SELECT count(*) FROM live_records WHERE workspace_id=$1 AND kind='note' AND record_id=ANY($2)", &[&scope.workspace_id,&draft.note_ids]).await.map_err(|_|ApiError::database())?.get(0);
    if found as usize != draft.note_ids.len() {
        return Err(invalid("note_folder_notes_unavailable"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let stamp = chrono::Utc::now().to_rfc3339();
    tx.execute("INSERT INTO live_note_folders(workspace_id,folder_id,name,created_at_utc) VALUES($1,$2,$3,$4)", &[&scope.workspace_id,&id,&draft.name,&stamp]).await.map_err(|e|if e.code()==Some(&tokio_postgres::error::SqlState::UNIQUE_VIOLATION) {ApiError::detail(StatusCode::CONFLICT,"note_folder_name_exists")}else{ApiError::database()})?;
    for note in &draft.note_ids {
        attach(tx, &scope.workspace_id, &id, note).await?;
    }
    let mut result = catalog(tx, &scope.workspace_id).await?;
    result["created_id"] = json!(id);
    Ok(result)
}
pub async fn attach(
    tx: &Transaction<'_>,
    workspace: &str,
    folder: &str,
    note: &str,
) -> Result<(), ApiError> {
    if tx
        .query_opt(
            "SELECT folder_id FROM live_note_folders WHERE workspace_id=$1 AND folder_id=$2",
            &[&workspace, &folder],
        )
        .await
        .map_err(|_| ApiError::database())?
        .is_none()
    {
        return Err(invalid("note_folder_not_found"));
    }
    tx.execute(
        "INSERT INTO live_note_folder_members(workspace_id,folder_id,record_id) VALUES($1,$2,$3)",
        &[&workspace, &folder, &note],
    )
    .await
    .map_err(|_| ApiError::database())?;
    Ok(())
}
