//! Reversible journal grouping. Source fills, notes and analytics are never rewritten.
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
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc};
use tokio_postgres::{GenericClient, Transaction};

pub fn native(method: &str, path: &str) -> bool {
    path == "/api/v2/trade-groups" && ["GET", "POST"].contains(&method)
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v2/trade-groups", get(read).post(write))
}
fn invalid(reason: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, reason)
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "group_trade_not_found")
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
struct Member {
    kind: String,
    source_id: String,
    trade_id: String,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Draft {
    Merge {
        expected_revision: i32,
        members: Vec<Member>,
    },
    Split {
        expected_revision: i32,
        id: String,
    },
}
pub async fn catalog<C: GenericClient + Sync>(db: &C, workspace: &str) -> Result<Value, ApiError> {
    let row = db
        .query_opt(
            "SELECT revision,items FROM journal_trade_group_catalogs WHERE workspace_id=$1",
            &[&workspace],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(row.map(|r|json!({"version":"trade-groups-v1","revision":r.get::<_,i32>(0),"items":r.get::<_,Value>(1)})).unwrap_or_else(||json!({"version":"trade-groups-v1","revision":0,"items":[]})))
}
async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    let db = state.pool.get().await.map_err(|_| ApiError::database())?;
    Ok(Json(catalog(&**db, &scope.workspace_id).await?))
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
fn facts(row: &Value) -> Result<(String, String), ApiError> {
    let symbol = row["symbol"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("group_trade_incomplete"))?;
    let side = row["side"].as_str().unwrap_or("").to_uppercase();
    if !["BUY", "SELL"].contains(&side.as_str()) {
        return Err(invalid("group_trade_incomplete"));
    }
    Ok((symbol.to_owned(), side))
}
async fn member_facts(
    tx: &Transaction<'_>,
    workspace: &str,
    m: &Member,
    source: &mut Option<Value>,
) -> Result<(String, String), ApiError> {
    if m.source_id.is_empty()
        || m.source_id.len() > 160
        || m.trade_id.is_empty()
        || m.trade_id.len() > 512
    {
        return Err(invalid("invalid_group_member"));
    }
    match m.kind.as_str() {
        "testing" => {
            if source.is_none() {
                let mut record =
                    crate::replay_service::load_record(tx, workspace, &m.source_id, false).await?;
                record["workspace_id"] = json!(workspace);
                let mut view = crate::analytics::build_replay_analytics_view(&record, None)
                    .map_err(|_| invalid("group_trade_incomplete"))?;
                let Value::Array(rows) = view["ledger"].take() else {
                    return Err(invalid("group_trade_incomplete"));
                };
                let mut index = serde_json::Map::new();
                for row in rows {
                    if let Some(id) = row["trade_id"].as_str() {
                        index.insert(id.to_owned(), row);
                    }
                }
                *source = Some(Value::Object(index));
            }
            let view = source.as_ref().unwrap();
            let row = view.get(&m.trade_id).ok_or_else(missing)?;
            if row["status"] == "open" || row["close_time_utc"].is_null() {
                return Err(invalid("group_requires_closed_trades"));
            }
            facts(row)
        }
        "manual" => {
            let row=tx.query_opt("SELECT v.payload_json FROM live_records r JOIN live_record_revisions v ON v.workspace_id=r.workspace_id AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.record_id=$2 AND r.kind='trade' AND v.payload_json->>'account_id'=$3",&[&workspace,&m.trade_id,&m.source_id]).await.map_err(|_|ApiError::database())?.ok_or_else(missing)?;
            facts(&row.get::<_, Value>(0))
        }
        "broker" => {
            let id =
                uuid::Uuid::parse_str(&m.source_id).map_err(|_| invalid("invalid_group_member"))?;
            if m.source_id != id.to_string() {
                return Err(invalid("invalid_group_member"));
            }
            let position = m
                .trade_id
                .strip_prefix("position:")
                .and_then(|s| s.parse::<u64>().ok())
                .filter(|p| *p > 0 && m.trade_id == format!("position:{p}"))
                .ok_or_else(|| invalid("invalid_group_member"))?;
            if source.is_none() {
                let mut snapshot=tx.query_opt("SELECT snapshot FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2",&[&workspace,&id]).await.map_err(|_|ApiError::database())?.and_then(|r|r.get::<_,Option<Value>>(0)).ok_or_else(missing)?;
                let Value::Array(rows) = snapshot["deals"].take() else {
                    return Err(invalid("group_trade_incomplete"));
                };
                let mut index = serde_json::Map::new();
                let mut seen = HashSet::new();
                for row in rows {
                    if !matches!(row["type"].as_i64(), Some(0 | 1)) {
                        continue;
                    }
                    let Some(ticket) = row["ticket"].as_u64() else {
                        return Err(invalid("group_trade_incomplete"));
                    };
                    if !seen.insert(ticket) {
                        continue;
                    }
                    if let Some(id) = row["position_id"].as_u64() {
                        index
                            .entry(id.to_string())
                            .or_insert_with(|| json!([]))
                            .as_array_mut()
                            .unwrap()
                            .push(row);
                    }
                }
                snapshot["group_fills"] = Value::Object(index);
                *source = Some(snapshot);
            }
            let snapshot = source.as_ref().unwrap();
            let mut fills: Vec<&Value> = snapshot["group_fills"][position.to_string()]
                .as_array()
                .ok_or_else(missing)?
                .iter()
                .collect();
            if fills.is_empty() {
                return Err(missing());
            }
            fills.sort_by(|a, b| {
                number(&a["time_msc"])
                    .unwrap_or(f64::INFINITY)
                    .total_cmp(&number(&b["time_msc"]).unwrap_or(f64::INFINITY))
                    .then_with(|| a["ticket"].as_u64().cmp(&b["ticket"].as_u64()))
            });
            let first = fills[0];
            let side = first["type"].as_i64();
            let symbol = first["symbol"].as_str().unwrap_or("");
            let mut balance = 0.0;
            let mut entered = 0.0;
            for fill in fills {
                let quantity = number(&fill["volume"])
                    .filter(|q| *q > 0.0)
                    .ok_or_else(|| invalid("group_trade_incomplete"))?;
                if fill["symbol"] != symbol || number(&fill["time_msc"]).is_none() {
                    return Err(invalid("group_trade_incomplete"));
                }
                if fill["entry"] == 0 && fill["type"].as_i64() == side {
                    balance += quantity;
                    entered += quantity;
                } else if matches!(fill["entry"].as_i64(), Some(1 | 3))
                    && fill["type"].as_i64() != side
                {
                    balance -= quantity;
                } else {
                    return Err(invalid("group_trade_incomplete"));
                }
                if balance < -1e-8 {
                    return Err(invalid("group_trade_incomplete"));
                }
            }
            let positions = snapshot["positions"]
                .as_array()
                .ok_or_else(|| invalid("group_trade_incomplete"))?;
            if entered <= 0.0
                || balance.abs() > entered * 1e-8
                || positions
                    .iter()
                    .any(|r| r["identifier"].as_u64().or(r["ticket"].as_u64()) == Some(position))
            {
                return Err(invalid("group_requires_closed_trades"));
            }
            facts(&json!({"symbol":symbol,"side":if side==Some(0){"BUY"}else{"SELL"}}))
        }
        _ => Err(invalid("invalid_group_member")),
    }
}
async fn execute(tx: &Transaction<'_>, workspace: &str, body: Value) -> Result<Value, ApiError> {
    let draft: Draft = serde_json::from_value(body).map_err(|_| invalid("invalid_trade_group"))?;
    tx.query_one(
        "SELECT workspace_id FROM workspaces WHERE workspace_id=$1 FOR UPDATE",
        &[&workspace],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let current = catalog(tx, workspace).await?;
    let expected = match &draft {
        Draft::Merge {
            expected_revision, ..
        }
        | Draft::Split {
            expected_revision, ..
        } => *expected_revision,
    };
    if current["revision"].as_i64() != Some(i64::from(expected)) {
        return Err(ApiError::detail(
            StatusCode::CONFLICT,
            "group_revision_conflict",
        ));
    }
    let mut items = current["items"].as_array().cloned().unwrap();
    match draft {
        Draft::Merge { members, .. } => {
            if !(2..=500).contains(&members.len())
                || members.iter().collect::<HashSet<_>>().len() != members.len()
                || items.len() >= 1000
            {
                return Err(invalid("invalid_trade_group"));
            }
            let first = &members[0];
            if members
                .iter()
                .any(|m| m.kind != first.kind || m.source_id != first.source_id)
            {
                return Err(invalid("group_same_account_required"));
            }
            if items.iter().any(|g| {
                g["members"].as_array().is_some_and(|old| {
                    members.iter().any(|m| {
                        old.iter().any(|member| {
                            member == &json!(m)
                                || m.kind == "manual"
                                    && member["kind"] == "manual"
                                    && member["trade_id"] == m.trade_id
                        })
                    })
                })
            }) {
                return Err(ApiError::detail(
                    StatusCode::CONFLICT,
                    "group_member_already_grouped",
                ));
            }
            let mut source = None;
            let identity = member_facts(tx, workspace, first, &mut source).await?;
            for member in &members[1..] {
                let other = member_facts(tx, workspace, member, &mut source).await?;
                if other.0 != identity.0 {
                    return Err(invalid("group_same_symbol_required"));
                }
                if other.1 != identity.1 {
                    return Err(invalid("group_same_side_required"));
                }
            }
            items.push(json!({"id":uuid::Uuid::new_v4().to_string(),"symbol":identity.0,"side":identity.1,"members":members,"created_at_utc":chrono::Utc::now().to_rfc3339()}));
        }
        Draft::Split { id, .. } => {
            let before = items.len();
            items.retain(|g| g["id"] != id);
            if before == items.len() {
                return Err(ApiError::detail(
                    StatusCode::NOT_FOUND,
                    "trade_group_not_found",
                ));
            }
        }
    }
    tx.execute("INSERT INTO journal_trade_group_catalogs(workspace_id,revision,items) VALUES($1,1,$2) ON CONFLICT(workspace_id) DO UPDATE SET revision=journal_trade_group_catalogs.revision+1,items=EXCLUDED.items",&[&workspace,&json!(items)]).await.map_err(|_|ApiError::database())?;
    catalog(tx, workspace).await
}
async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid("invalid_trade_group"))?;
    if uri.query().is_some() {
        return Err(invalid("invalid_trade_group"));
    }
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
    tx.batch_execute("SAVEPOINT trade_groups_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(&tx, &scope.workspace_id, body).await {
        Ok(v) => (StatusCode::OK, v),
        Err(e) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT trade_groups_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (e.0, e.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, result).await?;
    native_mutation::commit(tx, response).await
}
