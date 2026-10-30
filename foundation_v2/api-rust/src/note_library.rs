//! Private template library and workspace trade images. No broker operations.
use crate::{
    auth::{ApiError, Workspace},
    native_mutation,
    state::AppState,
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, OriginalUri, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Arc};
use tokio_postgres::{GenericClient, Transaction};
use uuid::Uuid;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/note-templates"),
    ("POST", "/api/v2/note-templates"),
    ("GET", "/api/v2/trade-media"),
    ("POST", "/api/v2/trade-media"),
    ("GET", "/api/v2/trade-media/{media_id}"),
];
const BUILTINS: &[&str] = &["beginner", "daily-report"];
const CONTEXTS: &[&str] = &["testing-trades", "live-trades", "live-notes"];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(ROUTES[0].1, get(templates).post(write))
        .route(
            ROUTES[2].1,
            get(media)
                .post(write)
                .layer(DefaultBodyLimit::max(8 * 1024 * 1024)),
        )
        .route(ROUTES[4].1, get(image))
}
fn invalid() -> ApiError {
    ApiError::detail(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_note_library_request",
    )
}
fn conflict() -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, "note_library_revision_conflict")
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "note_library_item_not_found")
}
fn name_ok(name: &str) -> bool {
    !name.trim().is_empty()
        && name == name.trim()
        && name.chars().count() <= 160
        && !name.chars().any(char::is_control)
}
fn document_ok(document: &Value) -> bool {
    fn inline_ok(content: &Value, depth: usize) -> bool {
        depth <= 12
            && (content.is_string()
                || content.as_array().is_some_and(|items| {
                    items.iter().all(|item| {
                        item.is_string()
                            || (item["type"] == "text" && item["text"].is_string())
                            || (item["type"] == "link"
                                && item["href"].is_string()
                                && inline_ok(&item["content"], depth + 1))
                    })
                }))
    }
    fn content_ok(block: &Value) -> bool {
        block.get("content").is_none_or(|content| {
            if block["type"] != "table" {
                return inline_ok(content, 0);
            }
            content["type"] == "tableContent"
                && content["rows"].as_array().is_some_and(|rows| {
                    rows.iter().all(|row| {
                        row["cells"].as_array().is_some_and(|cells| {
                            cells.iter().all(|cell| {
                                inline_ok(cell, 0)
                                    || (cell["type"] == "tableCell"
                                        && inline_ok(&cell["content"], 0))
                            })
                        })
                    })
                })
        })
    }
    fn blocks_ok(blocks: &Value, depth: usize, count: &mut usize) -> bool {
        depth <= 12
            && blocks.as_array().is_some_and(|blocks| {
                blocks.iter().all(|block| {
                    *count += 1;
                    *count <= 1000
                        && matches!(
                            block["type"].as_str(),
                            Some(
                                "paragraph"
                                    | "heading"
                                    | "quote"
                                    | "toggleListItem"
                                    | "numberedListItem"
                                    | "bulletListItem"
                                    | "checkListItem"
                                    | "codeBlock"
                                    | "divider"
                                    | "table"
                                    | "image"
                                    | "video"
                                    | "audio"
                                    | "file"
                            )
                        )
                        && content_ok(block)
                        && block
                            .get("children")
                            .is_none_or(|children| blocks_ok(children, depth + 1, count))
                })
            })
    }
    let valid_blocks = |blocks: &Value| {
        blocks
            .as_array()
            .is_some_and(|blocks| !blocks.is_empty() && blocks.len() <= 256)
    };
    document["format"] == "blocknote"
        && document["version"] == 1
        && valid_blocks(&document["blocks"])
        && document.to_string().len() <= 200000
        && blocks_ok(&document["blocks"], 0, &mut 0)
}
async fn catalog<C: GenericClient + Sync>(db: &C, scope: &Workspace) -> Result<Value, ApiError> {
    let rows=db.query("SELECT template_id,name,document,revision,updated_at_utc FROM note_templates WHERE workspace_id=$1 AND subject=$2 ORDER BY created_at_utc,template_id",&[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    let prefs=db.query_opt("SELECT revision,favorites,defaults FROM note_template_preferences WHERE workspace_id=$1 AND subject=$2",&[&scope.workspace_id,&scope.subject]).await.map_err(|_|ApiError::database())?;
    Ok(
        json!({"version":"note-templates-v1","items":rows.iter().map(|r|json!({"id":r.get::<_,Uuid>(0),"name":r.get::<_,String>(1),"document":r.get::<_,Value>(2),"revision":r.get::<_,i32>(3),"updated_at_utc":r.get::<_,chrono::DateTime<chrono::Utc>>(4)})).collect::<Vec<_>>(),"preferences":prefs.map(|r|json!({"revision":r.get::<_,i32>(0),"favorites":r.get::<_,Vec<String>>(1),"defaults":r.get::<_,Value>(2)})).unwrap_or_else(||json!({"revision":0,"favorites":["beginner","daily-report"],"defaults":{}}))}),
    )
}
async fn templates(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let db = state.pool.get().await.map_err(|_| ApiError::database())?;
    Ok(Json(catalog(&**db, &scope).await?))
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Draft {
    Create {
        name: String,
        document: Value,
    },
    Update {
        id: Uuid,
        expected_revision: i32,
        name: String,
        document: Value,
    },
    Delete {
        id: Uuid,
        expected_revision: i32,
    },
    Preferences {
        expected_revision: i32,
        favorites: Vec<String>,
        defaults: Value,
    },
    Upload {
        session_id: String,
        trade_id: String,
        name: String,
        mime_type: String,
        data: String,
    },
    RemoveMedia {
        id: Uuid,
    },
}
async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid())?;
    if uri.query().is_some() {
        return Err(invalid());
    }
    let mut db = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = db.transaction().await.map_err(|_| ApiError::database())?;
    let mutation =
        match native_mutation::begin(&tx, &scope, "POST", uri.path(), None, &headers, &body).await?
        {
            native_mutation::MutationStart::Replay(r) => return Ok(r),
            native_mutation::MutationStart::New(m) => m,
        };
    tx.batch_execute("SAVEPOINT note_library_domain")
        .await
        .map_err(|_| ApiError::database())?;
    // Serializes quota, preferences and deletion cleanup with template updates.
    tx.query_one(
        "SELECT workspace_id FROM workspaces WHERE workspace_id=$1 FOR UPDATE",
        &[&scope.workspace_id],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(&tx, &scope, uri.path(), body).await {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT note_library_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, result).await?;
    native_mutation::commit(tx, response).await
}
async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    path: &str,
    body: Value,
) -> Result<Value, ApiError> {
    let draft: Draft = serde_json::from_value(body).map_err(|_| invalid())?;
    let media_request = matches!(&draft, Draft::Upload { .. } | Draft::RemoveMedia { .. });
    if media_request != (path == "/api/v2/trade-media") {
        return Err(invalid());
    }
    let mut saved = None;
    match draft {
        Draft::Create { name, document } => {
            if !name_ok(&name) || !document_ok(&document) {
                return Err(invalid());
            }
            let count: i64 = tx
                .query_one(
                    "SELECT count(*) FROM note_templates WHERE workspace_id=$1 AND subject=$2",
                    &[&scope.workspace_id, &scope.subject],
                )
                .await
                .map_err(|_| ApiError::database())?
                .get(0);
            if count >= 200 {
                return Err(ApiError::detail(
                    StatusCode::CONFLICT,
                    "note_template_limit",
                ));
            }
            let id = Uuid::new_v4();
            tx.execute("INSERT INTO note_templates(workspace_id,subject,template_id,name,document,revision) VALUES($1,$2,$3,$4,$5,1)",&[&scope.workspace_id,&scope.subject,&id,&name,&document]).await.map_err(|_|ApiError::database())?;
            saved = Some(id);
        }
        Draft::Update {
            id,
            expected_revision,
            name,
            document,
        } => {
            if !name_ok(&name) || !document_ok(&document) {
                return Err(invalid());
            }
            if tx.execute("UPDATE note_templates SET name=$4,document=$5,revision=revision+1,updated_at_utc=CURRENT_TIMESTAMP WHERE workspace_id=$1 AND subject=$2 AND template_id=$3 AND revision=$6",&[&scope.workspace_id,&scope.subject,&id,&name,&document,&expected_revision]).await.map_err(|_|ApiError::database())?!=1{return Err(conflict())}
            saved = Some(id);
        }
        Draft::Delete {
            id,
            expected_revision,
        } => {
            if tx.execute("DELETE FROM note_templates WHERE workspace_id=$1 AND subject=$2 AND template_id=$3 AND revision=$4",&[&scope.workspace_id,&scope.subject,&id,&expected_revision]).await.map_err(|_|ApiError::database())?!=1{return Err(conflict())}
            tx.execute("UPDATE note_template_preferences SET favorites=array_remove(favorites,$3),defaults=(SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(defaults) WHERE value<>to_jsonb($3::text)),revision=revision+1 WHERE workspace_id=$1 AND subject=$2",&[&scope.workspace_id,&scope.subject,&id.to_string()]).await.map_err(|_|ApiError::database())?;
        }
        Draft::Preferences {
            expected_revision,
            favorites,
            defaults,
        } => {
            let current = catalog(tx, scope).await?;
            if current["preferences"]["revision"].as_i64() != Some(i64::from(expected_revision)) {
                return Err(conflict());
            }
            let known = |id: &str| {
                BUILTINS.contains(&id)
                    || current["items"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|v| v["id"] == id)
            };
            if favorites.len() > 202
                || favorites.iter().collect::<HashSet<_>>().len() != favorites.len()
                || favorites.iter().any(|id| !known(id))
                || !defaults.as_object().is_some_and(|d| {
                    d.iter().all(|(k, v)| {
                        CONTEXTS.contains(&k.as_str()) && v.as_str().is_some_and(known)
                    })
                })
            {
                return Err(invalid());
            }
            tx.execute("INSERT INTO note_template_preferences(workspace_id,subject,revision,favorites,defaults) VALUES($1,$2,1,$3,$4) ON CONFLICT(workspace_id,subject) DO UPDATE SET revision=note_template_preferences.revision+1,favorites=EXCLUDED.favorites,defaults=EXCLUDED.defaults",&[&scope.workspace_id,&scope.subject,&favorites,&defaults]).await.map_err(|_|ApiError::database())?;
        }
        Draft::Upload {
            session_id,
            trade_id,
            name,
            mime_type,
            data,
        } => {
            if !name_ok(&name) || data.len() > 7 * 1024 * 1024 {
                return Err(invalid());
            }
            crate::trade_labels::verify_trade(tx, &scope.workspace_id, &session_id, &trade_id)
                .await?;
            let bytes = STANDARD.decode(data).map_err(|_| invalid())?;
            if bytes.is_empty()
                || bytes.len() > 5 * 1024 * 1024
                || image_type(&bytes) != Some(mime_type.as_str())
            {
                return Err(invalid());
            }
            let sha = format!("{:x}", Sha256::digest(&bytes));
            if let Some(row)=tx.query_opt("SELECT media_id FROM trade_media WHERE workspace_id=$1 AND session_id=$2 AND trade_id=$3 AND sha256=$4",&[&scope.workspace_id,&session_id,&trade_id,&sha]).await.map_err(|_|ApiError::database())? {return Ok(json!({"id":row.get::<_,Uuid>(0)}))}
            let limits=tx.query_one("SELECT count(*) FILTER(WHERE session_id=$2 AND trade_id=$3),COALESCE(sum(octet_length(body)),0)::bigint FROM trade_media WHERE workspace_id=$1",&[&scope.workspace_id,&session_id,&trade_id]).await.map_err(|_|ApiError::database())?;
            if limits.get::<_, i64>(0) >= 50
                || limits.get::<_, i64>(1) + bytes.len() as i64 > 200 * 1024 * 1024
            {
                return Err(ApiError::detail(StatusCode::CONFLICT, "trade_media_limit"));
            }
            let id = Uuid::new_v4();
            tx.execute("INSERT INTO trade_media(workspace_id,session_id,trade_id,media_id,name,mime_type,sha256,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",&[&scope.workspace_id,&session_id,&trade_id,&id,&name,&mime_type,&sha,&bytes]).await.map_err(|_|ApiError::database())?;
            return Ok(json!({"id":id}));
        }
        Draft::RemoveMedia { id } => {
            if tx
                .execute(
                    "DELETE FROM trade_media WHERE workspace_id=$1 AND media_id=$2",
                    &[&scope.workspace_id, &id],
                )
                .await
                .map_err(|_| ApiError::database())?
                != 1
            {
                return Err(missing());
            }
            return Ok(json!({"removed_id":id}));
        }
    }
    let mut result = catalog(tx, scope).await?;
    if let Some(id) = saved {
        result["saved_id"] = json!(id)
    }
    Ok(result)
}
fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaScope {
    session_id: String,
    trade_id: String,
}
async fn media(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Query(target): Query<MediaScope>,
) -> Result<Json<Value>, ApiError> {
    let mut db = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = db.transaction().await.map_err(|_| ApiError::database())?;
    crate::trade_labels::verify_trade(
        &tx,
        &scope.workspace_id,
        &target.session_id,
        &target.trade_id,
    )
    .await?;
    let rows=tx.query("SELECT media_id,name,mime_type,octet_length(body),created_at_utc FROM trade_media WHERE workspace_id=$1 AND session_id=$2 AND trade_id=$3 ORDER BY created_at_utc,media_id",&[&scope.workspace_id,&target.session_id,&target.trade_id]).await.map_err(|_|ApiError::database())?;
    Ok(Json(
        json!({"items":rows.iter().map(|r|json!({"id":r.get::<_,Uuid>(0),"name":r.get::<_,String>(1),"mime_type":r.get::<_,String>(2),"bytes":r.get::<_,i32>(3),"created_at_utc":r.get::<_,chrono::DateTime<chrono::Utc>>(4)})).collect::<Vec<_>>()}),
    ))
}
async fn image(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let db = state.pool.get().await.map_err(|_| ApiError::database())?;
    let row = db
        .query_opt(
            "SELECT mime_type,body FROM trade_media WHERE workspace_id=$1 AND media_id=$2",
            &[&scope.workspace_id, &id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(missing)?;
    Ok((
        [
            (header::CONTENT_TYPE, row.get::<_, String>(0)),
            (header::CACHE_CONTROL, "private, no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; sandbox".into(),
            ),
        ],
        Body::from(row.get::<_, Vec<u8>>(1)),
    )
        .into_response())
}
