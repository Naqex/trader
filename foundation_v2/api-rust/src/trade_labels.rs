//! Labels are workspace metadata. Replay execution snapshots remain immutable.
use crate::{
    auth::{ApiError, Workspace},
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
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::Arc};
use tokio_postgres::Transaction;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/trade-labels"),
    ("POST", "/api/v2/trade-labels"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v2/trade-labels", get(read).post(write))
}
const COLORS: &[&str] = &["green", "blue", "orange", "red", "purple", "cyan", "gray"];
fn invalid(s: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, s)
}
fn conflict() -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, "label_revision_conflict")
}
fn clean_name(s: &str) -> bool {
    !s.trim().is_empty()
        && s == s.trim()
        && s.chars().count() <= 64
        && !s.chars().any(char::is_control)
}
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
fn names(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn optional_group_change<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}
fn assignment_key(session: &str, trade: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(session, trade)).unwrap())
    )
}

pub async fn lock(tx: &Transaction<'_>, workspace: &str) -> Result<(), ApiError> {
    let hash = Sha256::digest(format!("trade-labels:{workspace}"));
    let id = i64::from_be_bytes(hash[..8].try_into().unwrap());
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&id])
        .await
        .map_err(|_| ApiError::database())?;
    Ok(())
}
pub async fn definitions(tx: &Transaction<'_>, workspace: &str) -> Result<Vec<Value>, ApiError> {
    tx.query("SELECT r.record_id,r.current_revision,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='trade_label' AND NOT v.deleted ORDER BY r.created_at_utc,r.record_id",&[&workspace]).await.map_err(|_|ApiError::database()).map(|rows|rows.iter().map(|r|json!({"record_id":r.get::<_,String>(0),"revision":r.get::<_,i32>(1),"payload":r.get::<_,Value>(2)})).collect())
}
fn catalog(defs: &[Value]) -> Value {
    json!({"schema_version":"trade-labels-v1",
        "groups":defs.iter().filter(|r|is_group(r) && r["payload"]["active"]!=false).map(|r|json!({"id":r["record_id"],"revision":r["revision"],"name":r["payload"]["name"],"archived":r["payload"]["archived"]==true})).collect::<Vec<_>>(),
        "items":defs.iter().filter(|r|!is_group(r) && r["payload"]["active"]!=false).map(|r|json!({"id":r["record_id"],"revision":r["revision"],"name":r["payload"]["name"],"color":r["payload"]["color"],"group_id":r["payload"]["group_id"],"archived":is_archived(r,defs)})).collect::<Vec<_>>()})
}
fn is_group(def: &Value) -> bool {
    def["payload"]["entity"] == "group"
}
fn is_archived(def: &Value, defs: &[Value]) -> bool {
    def["payload"]["archived"] == true
        || defs.iter().any(|group| {
            is_group(group)
                && group["record_id"] == def["payload"]["group_id"]
                && group["payload"]["archived"] == true
        })
}
fn validate_group(defs: &[Value], id: Option<&str>) -> Result<(), ApiError> {
    if id.is_some_and(|id| {
        !defs.iter().any(|r| {
            is_group(r)
                && text(r, "record_id") == id
                && r["payload"]["active"] != false
                && !is_archived(r, defs)
        })
    }) {
        return Err(invalid("invalid_label_group"));
    }
    Ok(())
}
async fn live_assignments(
    tx: &Transaction<'_>,
    workspace: &str,
    defs: &[Value],
) -> Result<Vec<Value>, ApiError> {
    let rows = tx.query("SELECT v.payload_json,r.current_revision FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='trade_label_assignment' AND NOT v.deleted AND v.payload_json->>'session_id' LIKE 'live:%' ORDER BY r.record_id", &[&workspace]).await.map_err(|_|ApiError::database())?;
    Ok(rows.iter().map(|r|{let p:Value=r.get(0);json!({"session_id":p["session_id"],"trade_id":p["trade_id"],"revision":r.get::<_,i32>(1),"tags":normalize(&names(&p["tags"]),defs)})}).collect())
}
async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    let defs = definitions(&tx, &scope.workspace_id).await?;
    let mut result = catalog(&defs);
    result["assignments"] = json!(live_assignments(&tx, &scope.workspace_id, &defs).await?);
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(Json(result))
}
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Draft {
    Create {
        name: String,
        color: String,
        #[serde(default)]
        group_id: Option<String>,
    },
    Update {
        id: String,
        expected_revision: i64,
        name: String,
        color: String,
        #[serde(default, deserialize_with = "optional_group_change")]
        group_id: Option<Option<String>>,
    },
    Delete {
        id: String,
        expected_revision: i64,
    },
    Archive {
        id: String,
        expected_revision: i64,
    },
    CreateGroup {
        name: String,
    },
    UpdateGroup {
        id: String,
        expected_revision: i64,
        name: String,
    },
    ArchiveGroup {
        id: String,
        expected_revision: i64,
    },
    Assign {
        session_id: String,
        trade_id: String,
        expected_revision: i64,
        tags: Vec<String>,
    },
}
async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid("invalid_label_request"))?;
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    let mutation = match crate::native_mutation::begin(
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
        crate::native_mutation::MutationStart::Replay(r) => return Ok(r),
        crate::native_mutation::MutationStart::New(m) => m,
    };
    tx.batch_execute("SAVEPOINT label_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(&tx, &scope, body).await {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT label_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = crate::native_mutation::finish(&tx, mutation, status, result).await?;
    crate::native_mutation::commit(tx, response).await
}
async fn execute(tx: &Transaction<'_>, scope: &Workspace, body: Value) -> Result<Value, ApiError> {
    let draft: Draft =
        serde_json::from_value(body).map_err(|_| invalid("invalid_label_request"))?;
    lock(tx, &scope.workspace_id).await?;
    let defs = definitions(tx, &scope.workspace_id).await?;
    let mut changed_assignment = None;
    match draft {
        Draft::CreateGroup { name } => {
            validate_group_name(&defs, None, &name)?;
            crate::metadata_mutations::create(
                tx,
                scope,
                "trade_label",
                json!({"entity":"group","name":name,"active":true,"archived":false}),
                None,
            )
            .await?;
        }
        Draft::UpdateGroup {
            id,
            expected_revision,
            name,
        } => {
            validate_group_name(&defs, Some(&id), &name)?;
            let current = crate::metadata_mutations::load(tx, scope, "trade_label", &id).await?;
            if !is_group(&current)
                || current["revision"] != expected_revision
                || is_archived(&current, &defs)
            {
                return Err(conflict());
            }
            let mut p = current["payload"].clone();
            p["name"] = json!(name);
            crate::metadata_mutations::update(tx, scope, "trade_label", current, p, false).await?;
        }
        Draft::ArchiveGroup {
            id,
            expected_revision,
        } => {
            let current = crate::metadata_mutations::load(tx, scope, "trade_label", &id).await?;
            if !is_group(&current)
                || current["revision"] != expected_revision
                || current["payload"]["active"] == false
            {
                return Err(conflict());
            }
            let mut p = current["payload"].clone();
            p["archived"] = json!(true);
            crate::metadata_mutations::update(tx, scope, "trade_label", current, p, false).await?;
        }
        Draft::Archive {
            id,
            expected_revision,
        } => {
            let current = crate::metadata_mutations::load(tx, scope, "trade_label", &id).await?;
            if is_group(&current)
                || current["revision"] != expected_revision
                || current["payload"]["active"] == false
            {
                return Err(conflict());
            }
            let mut p = current["payload"].clone();
            p["archived"] = json!(true);
            crate::metadata_mutations::update(tx, scope, "trade_label", current, p, false).await?;
        }
        Draft::Create {
            name,
            color,
            group_id,
        } => {
            validate_definition(&defs, None, &name, &color)?;
            validate_group(&defs, group_id.as_deref())?;
            crate::metadata_mutations::create(
                tx,
                scope,
                "trade_label",
                json!({"name":name,"color":color,"aliases":[name],"active":true,"group_id":group_id,"archived":false}),
                None,
            )
            .await?;
        }
        Draft::Update {
            id,
            expected_revision,
            name,
            color,
            group_id,
        } => {
            validate_definition(&defs, Some(&id), &name, &color)?;
            let current = crate::metadata_mutations::load(tx, scope, "trade_label", &id).await?;
            if is_group(&current)
                || current["revision"] != expected_revision
                || current["payload"]["active"] == false
            {
                return Err(conflict());
            }
            let mut p = current["payload"].clone();
            if let Some(group) = &group_id {
                validate_group(&defs, group.as_deref())?;
                p["group_id"] = json!(group);
            }
            let mut aliases = names(&p["aliases"]);
            if !aliases.contains(&name) {
                aliases.push(name.clone())
            }
            p["aliases"] = json!(aliases);
            p["name"] = json!(name);
            p["color"] = json!(color);
            crate::metadata_mutations::update(tx, scope, "trade_label", current, p, false).await?;
        }
        Draft::Delete {
            id,
            expected_revision,
        } => {
            let current = crate::metadata_mutations::load(tx, scope, "trade_label", &id).await?;
            if is_group(&current)
                || current["revision"] != expected_revision
                || current["payload"]["active"] == false
            {
                return Err(conflict());
            }
            let mut p = current["payload"].clone();
            p["active"] = json!(false);
            crate::metadata_mutations::update(tx, scope, "trade_label", current, p, false).await?;
        }
        Draft::Assign {
            session_id,
            trade_id,
            expected_revision,
            tags,
        } => {
            verify_trade(tx, &scope.workspace_id, &session_id, &trade_id).await?;
            if tags.len() > 32 || tags.iter().any(|tag| !clean_name(tag)) {
                return Err(invalid("invalid_trade_labels"));
            }
            let prior = assignment(tx, scope, &assignment_key(&session_id, &trade_id)).await?;
            let previous = prior
                .as_ref()
                .map(|r| normalize(&names(&r["payload"]["tags"]), &defs))
                .unwrap_or_default();
            let normalized = normalize(&tags, &defs);
            if normalized.iter().any(|tag| {
                !previous.contains(tag)
                    && defs.iter().any(|r| {
                        !is_group(r) && text(&r["payload"], "name") == tag && is_archived(r, &defs)
                    })
            }) {
                return Err(invalid("label_archived"));
            }
            assign(
                tx,
                scope,
                &defs,
                &session_id,
                &trade_id,
                Some(expected_revision),
                &normalized,
            )
            .await?;
            let saved = assignment(tx, scope, &assignment_key(&session_id, &trade_id))
                .await?
                .unwrap();
            changed_assignment = Some(
                json!({"session_id":session_id,"trade_id":trade_id,"revision":saved["revision"],"tags":normalize(&names(&saved["payload"]["tags"]),&defs)}),
            );
        }
    }
    let defs = definitions(tx, &scope.workspace_id).await?;
    let mut result = catalog(&defs);
    result["assignments"] = json!(live_assignments(tx, &scope.workspace_id, &defs).await?);
    if let Some(saved) = changed_assignment {
        result["assignment"] = saved;
    }
    Ok(result)
}
fn validate_definition(
    defs: &[Value],
    id: Option<&str>,
    name: &str,
    color: &str,
) -> Result<(), ApiError> {
    if !clean_name(name) || !COLORS.contains(&color) {
        return Err(invalid("invalid_label_definition"));
    }
    if defs.iter().any(|r| {
        !is_group(r)
            && Some(text(r, "record_id")) != id
            && (text(&r["payload"], "name").to_lowercase() == name.to_lowercase()
                || names(&r["payload"]["aliases"])
                    .iter()
                    .any(|a| a.to_lowercase() == name.to_lowercase()))
    }) {
        return Err(ApiError::detail(StatusCode::CONFLICT, "label_name_exists"));
    }
    Ok(())
}
fn validate_group_name(defs: &[Value], id: Option<&str>, name: &str) -> Result<(), ApiError> {
    if !clean_name(name) {
        return Err(invalid("invalid_label_group"));
    }
    if defs.iter().any(|r| {
        is_group(r)
            && Some(text(r, "record_id")) != id
            && text(&r["payload"], "name").to_lowercase() == name.to_lowercase()
    }) {
        return Err(ApiError::detail(
            StatusCode::CONFLICT,
            "label_group_name_exists",
        ));
    }
    Ok(())
}
pub(crate) async fn verify_trade(
    tx: &Transaction<'_>,
    workspace: &str,
    session: &str,
    trade: &str,
) -> Result<(), ApiError> {
    if session.is_empty() || session.len() > 128 || trade.is_empty() || trade.len() > 512 {
        return Err(invalid("invalid_label_trade"));
    }
    if session.starts_with("live:") {
        return verify_live_trade(tx, workspace, session, trade).await;
    }
    let mut record = crate::replay_service::load_record(tx, workspace, session, false).await?;
    record["workspace_id"] = json!(workspace);
    let view = crate::analytics::build_replay_analytics_view(&record, None)
        .map_err(|_| invalid("invalid_label_trade"))?;
    if !view["ledger"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|r| r["trade_id"] == trade))
    {
        return Err(ApiError::detail(
            StatusCode::NOT_FOUND,
            "label_trade_not_found",
        ));
    }
    Ok(())
}
async fn verify_live_trade(
    tx: &Transaction<'_>,
    workspace: &str,
    session: &str,
    trade: &str,
) -> Result<(), ApiError> {
    let id = session
        .strip_prefix("live:")
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .ok_or_else(|| invalid("invalid_label_trade"))?;
    let position = trade
        .strip_prefix("position:")
        .and_then(|id| id.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .ok_or_else(|| invalid("invalid_label_trade"))?;
    let snapshot = tx
        .query_opt(
            "SELECT snapshot FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",
            &[&workspace, &id],
        )
        .await
        .map_err(|_| ApiError::database())?
        .and_then(|r| r.get::<_, Option<Value>>(0));
    if !snapshot.is_some_and(|p| {
        p["deals"].as_array().is_some_and(|deals| {
            deals.iter().any(|d| {
                d["position_id"].as_u64() == Some(position)
                    && matches!(d["type"].as_i64(), Some(0 | 1))
            })
        }) || p["positions"].as_array().is_some_and(|rows| {
            rows.iter()
                .any(|r| r["identifier"].as_u64().or(r["ticket"].as_u64()) == Some(position))
        })
    }) {
        return Err(ApiError::detail(
            StatusCode::NOT_FOUND,
            "label_trade_not_found",
        ));
    }
    Ok(())
}
async fn assignment(
    tx: &Transaction<'_>,
    scope: &Workspace,
    key: &str,
) -> Result<Option<Value>, ApiError> {
    let row=tx.query_opt("SELECT record_id FROM workspace_records WHERE workspace_id=$1 AND kind='trade_label_assignment' AND source_key=$2",&[&scope.workspace_id,&key]).await.map_err(|_|ApiError::database())?;
    match row {
        Some(r) => Ok(Some(
            crate::metadata_mutations::load(
                tx,
                scope,
                "trade_label_assignment",
                &r.get::<_, String>(0),
            )
            .await?,
        )),
        None => Ok(None),
    }
}
async fn assign(
    tx: &Transaction<'_>,
    scope: &Workspace,
    defs: &[Value],
    session: &str,
    trade: &str,
    expected: Option<i64>,
    tags: &[String],
) -> Result<(), ApiError> {
    if tags.len() > 32
        || tags.iter().any(|s| !clean_name(s))
        || tags
            .iter()
            .map(|s| s.to_lowercase())
            .collect::<HashSet<_>>()
            .len()
            != tags.len()
    {
        return Err(invalid("invalid_trade_labels"));
    }
    let key = assignment_key(session, trade);
    let current = assignment(tx, scope, &key).await?;
    if expected.is_some_and(|v| {
        current
            .as_ref()
            .map(|r| r["revision"].as_i64().unwrap())
            .unwrap_or(0)
            != v
    }) {
        return Err(conflict());
    }
    // Import existing journal labels on first explicit edit; no fabricated rating defaults.
    for name in tags {
        if !defs.iter().any(|r| {
            !is_group(r) && r["payload"]["active"] != false && text(&r["payload"], "name") == name
        }) {
            validate_definition(defs, None, name, "gray")?;
            crate::metadata_mutations::create(
                tx,
                scope,
                "trade_label",
                json!({"name":name,"color":"gray","aliases":[name],"active":true}),
                None,
            )
            .await?;
        }
    }
    let p = json!({"session_id":session,"trade_id":trade,"tags":tags});
    match current {
        Some(r) => {
            crate::metadata_mutations::update(tx, scope, "trade_label_assignment", r, p, false)
                .await?;
        }
        None => {
            crate::metadata_mutations::create(tx, scope, "trade_label_assignment", p, Some(key))
                .await?;
        }
    }
    Ok(())
}
pub async fn journal_changed(
    tx: &Transaction<'_>,
    scope: &Workspace,
    p: &Value,
    previous: &Value,
) -> Result<(), ApiError> {
    let source = &p["source"];
    let session = source["session_id"]
        .as_str()
        .or(source["replay_session_id"].as_str());
    let trade = source["trade_id"].as_str();
    if let (Some(session), Some(trade)) = (session, trade) {
        let defs = definitions(tx, &scope.workspace_id).await?;
        let before = normalize(&names(&previous["tags"]), &defs);
        let after = normalize(&names(&p["tags"]), &defs);
        let mut merged = effective_tags(tx, scope, &defs, session, trade).await?;
        merged.retain(|tag| !before.contains(tag) || after.contains(tag));
        merged.extend(after.into_iter().filter(|tag| !before.contains(tag)));
        assign(
            tx,
            scope,
            &defs,
            session,
            trade,
            None,
            &normalize(&merged, &defs),
        )
        .await?;
    }
    Ok(())
}
pub async fn journal_created(
    tx: &Transaction<'_>,
    scope: &Workspace,
    p: &Value,
) -> Result<(), ApiError> {
    let source = &p["source"];
    let session = source["session_id"]
        .as_str()
        .or(source["replay_session_id"].as_str());
    let trade = source["trade_id"].as_str();
    let tags = names(&p["tags"]);
    if tags.is_empty() {
        return Ok(());
    }
    if let (Some(session), Some(trade)) = (session, trade) {
        let defs = definitions(tx, &scope.workspace_id).await?;
        let mut merged = effective_tags(tx, scope, &defs, session, trade).await?;
        merged.extend(tags);
        assign(
            tx,
            scope,
            &defs,
            session,
            trade,
            None,
            &normalize(&merged, &defs),
        )
        .await?;
    }
    Ok(())
}
async fn effective_tags(
    tx: &Transaction<'_>,
    scope: &Workspace,
    defs: &[Value],
    session: &str,
    trade: &str,
) -> Result<Vec<String>, ApiError> {
    let current = assignment(tx, scope, &assignment_key(session, trade)).await?;
    let merged = if let Some(current) = current {
        names(&current["payload"]["tags"])
    } else {
        let mut inherited = vec![];
        match crate::replay_service::load_record(tx, &scope.workspace_id, session, false).await {
            Ok(mut record) => {
                record["workspace_id"] = json!(scope.workspace_id);
                let view = crate::analytics::build_replay_analytics_view(&record, None)
                    .map_err(|_| invalid("invalid_label_trade"))?;
                if let Some(row) = view["ledger"]
                    .as_array()
                    .and_then(|rows| rows.iter().find(|r| r["trade_id"] == trade))
                {
                    inherited.extend(names(&row["tags"]));
                }
            }
            Err(error) if error.0 == StatusCode::NOT_FOUND => {}
            Err(error) => return Err(error),
        }
        let notes=tx.query("SELECT v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='journal' AND NOT v.deleted AND COALESCE(v.payload_json->'source'->>'session_id',v.payload_json->'source'->>'replay_session_id')=$2 AND COALESCE(v.payload_json->'source'->>'trade_id',v.payload_json->'source'->>'id')=$3",&[&scope.workspace_id,&session,&trade]).await.map_err(|_|ApiError::database())?;
        for note in notes {
            inherited.extend(names(&note.get::<_, Value>(0)["tags"]));
        }
        inherited
    };
    Ok(normalize(&merged, defs))
}
pub fn normalize(tags: &[String], defs: &[Value]) -> Vec<String> {
    let mut result = vec![];
    for tag in tags {
        let key = tag.to_lowercase();
        let def = defs.iter().find(|r| {
            !is_group(r)
                && (text(&r["payload"], "name").to_lowercase() == key
                    || names(&r["payload"]["aliases"])
                        .iter()
                        .any(|a| a.to_lowercase() == key))
        });
        let name = match def {
            Some(r) if r["payload"]["active"] == false => continue,
            Some(r) => text(&r["payload"], "name"),
            None => tag,
        };
        if !result.iter().any(|v| v == name) {
            result.push(name.to_owned())
        }
    }
    result
}
// Indexed lookups by assignment source key; do not load all historical assignments.
pub async fn project(
    tx: &Transaction<'_>,
    workspace: &str,
    rows: &mut [Value],
    session: Option<&str>,
) -> Result<(), ApiError> {
    let defs = definitions(tx, workspace).await?;
    let keys = rows
        .iter()
        .map(|r| {
            assignment_key(
                session.unwrap_or(text(r, "session_id")),
                text(r, "trade_id"),
            )
        })
        .collect::<Vec<_>>();
    let assignments=tx.query("SELECT r.source_key,r.current_revision,v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='trade_label_assignment' AND r.source_key=ANY($2) AND NOT v.deleted",&[&workspace,&keys]).await.map_err(|_|ApiError::database())?;
    for (r, key) in rows.iter_mut().zip(keys) {
        let assignment = assignments.iter().find(|a| a.get::<_, String>(0) == key);
        let raw = assignment
            .map(|a| a.get::<_, Value>(2)["tags"].clone())
            .unwrap_or_else(|| r["tags"].clone());
        r["tags"] = json!(normalize(&names(&raw), &defs));
        r["label_revision"] = json!(assignment.map(|a| a.get::<_, i32>(1)).unwrap_or(0));
        r["labels_authoritative"] = json!(true);
        r["label_aliases"] = json!(
            defs.iter()
                .filter(|d| !is_group(d)
                    && d["payload"]["active"] != false
                    && names(&r["tags"]).contains(&text(&d["payload"], "name").to_owned()))
                .flat_map(|d| names(&d["payload"]["aliases"]))
                .collect::<Vec<_>>()
        );
    }
    Ok(())
}
pub async fn project_context(
    tx: &Transaction<'_>,
    workspace: &str,
    session: &str,
    context: &mut Value,
) -> Result<(), ApiError> {
    context["label_definitions"] = json!(
        definitions(tx, workspace)
            .await?
            .iter()
            .filter(|r| !is_group(r))
            .map(|r| r["payload"].clone())
            .collect::<Vec<_>>()
    );
    let assignments=tx.query("SELECT v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='trade_label_assignment' AND NOT v.deleted AND v.payload_json->>'session_id'=$2",&[&workspace,&session]).await.map_err(|_|ApiError::database())?;
    let rows = context["trades"].as_array_mut().unwrap();
    for r in assignments {
        let p: Value = r.get(0);
        if !rows.iter().any(|r| r["trade_id"] == p["trade_id"]) {
            rows.push(
                json!({"trade_id":p["trade_id"],"tags":[],"record_count":0,"has_notes":false}),
            )
        }
    }
    project(tx, workspace, rows, Some(session)).await?;
    for row in rows {
        row["labels_authoritative"] = json!(row["label_revision"].as_i64().unwrap_or(0) > 0);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_and_deletion_do_not_change_execution() {
        let defs = vec![
            json!({"record_id":"a","payload":{"name":"Breakout","aliases":["old","Breakout"],"active":true}}),
            json!({"record_id":"b","payload":{"name":"bad","aliases":["bad"],"active":false}}),
        ];
        assert_eq!(
            normalize(
                &[
                    "old".into(),
                    "Breakout".into(),
                    "bad".into(),
                    "legacy".into()
                ],
                &defs
            ),
            vec!["Breakout", "legacy"]
        );
        assert!(validate_definition(&defs, None, "old", "green").is_err());
        assert!(validate_definition(&defs, Some("a"), "Breakout", "green").is_ok());
        assert!(validate_definition(&defs, None, "bad color", "#fff").is_err());
    }
    #[test]
    fn compound_assignment_identity_is_unambiguous() {
        assert_ne!(assignment_key("a:b", "c"), assignment_key("a", "b:c"));
        assert_ne!(assignment_key("a", "1"), assignment_key("b", "1"));
    }
    #[test]
    fn drafts_are_typed() {
        assert!(
            serde_json::from_value::<Draft>(
                json!({"action":"create","name":"A","color":"green","extra":1})
            )
            .is_err()
        );
        assert!(clean_name("Mô hình đẹp"));
        assert!(!clean_name("A\nB"));
    }
    #[test]
    fn groups_and_archived_labels_preserve_trade_history() {
        let defs = vec![
            json!({"record_id":"group","revision":1,"payload":{"entity":"group","name":"Rating","active":true,"archived":true}}),
            json!({"record_id":"label","revision":2,"payload":{"name":"Good","color":"green","aliases":["old"],"group_id":"group","active":true}}),
        ];
        let result = catalog(&defs);
        assert_eq!(result["groups"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"][0]["archived"], true);
        assert_eq!(normalize(&["old".into()], &defs), vec!["Good"]);
        assert!(validate_group(&defs, Some("group")).is_err());
        assert!(validate_definition(&defs, None, "Rating", "gray").is_ok());
        assert!(validate_group_name(&defs, None, "Rating").is_err());
    }
    #[test]
    fn update_distinguishes_retaining_and_clearing_a_group() {
        let update =
            json!({"action":"update","id":"a","expected_revision":1,"name":"A","color":"green"});
        let Draft::Update { group_id, .. } = serde_json::from_value(update.clone()).unwrap() else {
            panic!()
        };
        assert_eq!(group_id, None);
        let mut clear = update;
        clear["group_id"] = Value::Null;
        let Draft::Update { group_id, .. } = serde_json::from_value(clear).unwrap() else {
            panic!()
        };
        assert_eq!(group_id, Some(None));
    }
}
