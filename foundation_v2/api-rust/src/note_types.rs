//! Journal classification metadata; no broker effects. Four stable built-ins cannot be deleted.
use crate::{
    auth::{ApiError, Workspace},
    native_mutation,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};
use tokio_postgres::{GenericClient, Transaction};
use uuid::Uuid;

const BUILTINS: [&str; 4] = ["general", "daily_review", "weekly_review", "monthly_review"];
pub fn native(method: &str, path: &str) -> bool {
    path == "/api/v2/note-types" && ["GET", "POST"].contains(&method)
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v2/note-types", get(read).post(write))
}
fn invalid() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_note_types")
}
pub fn valid_id(id: &str) -> bool {
    BUILTINS.contains(&id)
        || id
            .strip_prefix("custom_")
            .is_some_and(|s| Uuid::parse_str(s).is_ok_and(|u| u.to_string() == s))
}
fn defaults() -> Value {
    json!([
        {"id":"general","name":"General","color":"green","archived":false},
        {"id":"daily_review","name":"Daily review","color":"orange","archived":false},
        {"id":"weekly_review","name":"Weekly review","color":"cyan","archived":false},
        {"id":"monthly_review","name":"Monthly review","color":"purple","archived":false}
    ])
}
pub async fn catalog<C: GenericClient + Sync>(db: &C, workspace: &str) -> Result<Value, ApiError> {
    let row = db
        .query_opt(
            "SELECT revision,items FROM note_type_catalogs WHERE workspace_id=$1",
            &[&workspace],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(row.map(|r|json!({"version":"note-types-v1","revision":r.get::<_,i32>(0),"items":r.get::<_,Value>(1)})).unwrap_or_else(||json!({"version":"note-types-v1","revision":0,"items":defaults()})))
}
async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let db = state.pool.get().await.map_err(|_| ApiError::database())?;
    Ok(Json(catalog(&**db, &scope.workspace_id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    expected_revision: i32,
    items: Vec<Item>,
}
#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Item {
    id: String,
    name: String,
    color: String,
    archived: bool,
}
fn validate(items: &[Item], previous: &Value) -> bool {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    (4..=100).contains(&items.len()) && items.iter().all(|i|valid_id(&i.id) && ids.insert(&i.id) && !i.name.trim().is_empty() && i.name==i.name.trim() && i.name.chars().count()<=64 && !i.name.chars().any(char::is_control) && ["green","blue","orange","red","purple","cyan","gray"].contains(&i.color.as_str()) && (i.archived || names.insert(i.name.to_lowercase())))
        && BUILTINS.iter().all(|id|items.iter().any(|i|i.id==*id && !i.archived))
        // Deletion is a tombstone: existing notes keep their type identity/name.
        && previous.as_array().is_some_and(|old|old.iter().all(|o|items.iter().any(|i|Some(i.id.as_str())==o["id"].as_str())))
}
async fn execute(tx: &Transaction<'_>, workspace: &str, body: Value) -> Result<Value, ApiError> {
    let draft: Draft = serde_json::from_value(body).map_err(|_| invalid())?;
    tx.query_one(
        "SELECT workspace_id FROM workspaces WHERE workspace_id=$1 FOR UPDATE",
        &[&workspace],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let current = catalog(tx, workspace).await?;
    if current["revision"].as_i64() != Some(i64::from(draft.expected_revision)) {
        return Err(ApiError::detail(
            StatusCode::CONFLICT,
            "note_type_revision_conflict",
        ));
    }
    if !validate(&draft.items, &current["items"]) {
        return Err(invalid());
    }
    let items = json!(draft.items);
    tx.execute("INSERT INTO note_type_catalogs(workspace_id,revision,items) VALUES($1,1,$2) ON CONFLICT(workspace_id) DO UPDATE SET revision=note_type_catalogs.revision+1,items=EXCLUDED.items",&[&workspace,&items]).await.map_err(|_|ApiError::database())?;
    catalog(tx, workspace).await
}
async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid())?;
    let mut db = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = db.transaction().await.map_err(|_| ApiError::database())?;
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
        native_mutation::MutationStart::Replay(r) => return Ok(r),
        native_mutation::MutationStart::New(m) => m,
    };
    tx.batch_execute("SAVEPOINT note_types_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(&tx, &scope.workspace_id, body).await {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT note_types_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, result).await?;
    native_mutation::commit(tx, response).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_undeletable_and_custom_ids_are_bounded() {
        let mut items: Vec<Item> = serde_json::from_value(defaults()).unwrap();
        assert!(validate(&items, &defaults()));
        items.remove(0);
        assert!(!validate(&items, &defaults()));
        let mut items: Vec<Item> = serde_json::from_value(defaults()).unwrap();
        items[0].archived = true;
        assert!(!validate(&items, &defaults()));
        assert!(!valid_id("made_up"));
        assert!(valid_id(&format!("custom_{}", Uuid::new_v4())));
    }
}
