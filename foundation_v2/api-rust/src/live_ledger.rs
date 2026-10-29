//! Workspace-owned manual account journal. No provider or execution side effects.
use crate::{
    auth::{ApiError, Workspace},
    native_mutation,
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{MatchedPath, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use bigdecimal::BigDecimal;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, str::FromStr, sync::Arc};
use tokio_postgres::{Row, Transaction};
use uuid::Uuid;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/live/records"),
    ("POST", "/api/v2/live/records"),
    ("POST", "/api/v2/live/records/{record_id}/revisions"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(ROUTES[0].1, get(list).post(write))
        .route(ROUTES[2].1, post(write))
}
fn invalid(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, detail)
}
fn conflict(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, detail)
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "live_record_not_found")
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Draft {
    kind: String,
    payload: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revision {
    expected_revision: i64,
    kind: String,
    payload: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Account {
    name: String,
    currency: String,
    opening_balance: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opening_at_utc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    archived: Option<bool>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Trade {
    account_id: String,
    symbol: String,
    side: String,
    quantity: String,
    opened_at_utc: String,
    closed_at_utc: String,
    entry_price: String,
    exit_price: String,
    gross_pnl: String,
    commission: String,
    swap: String,
    fee: String,
    #[serde(default)]
    playbook_id: Option<String>,
    #[serde(default)]
    playbook_revision: Option<i32>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    note: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Note {
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_id: Option<Uuid>,
    title: String,
    note: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    playbook_id: Option<String>,
    #[serde(default)]
    playbook_revision: Option<i32>,
}

fn text(value: &str, maximum: usize, required: bool, multiline: bool) -> bool {
    (!required || !value.trim().is_empty())
        && value.chars().count() <= maximum
        && !value
            .chars()
            .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\r' | '\t')))
}
fn decimal(value: &str, positive: bool) -> bool {
    let digits = value.strip_prefix('-').unwrap_or(value);
    !value.is_empty()
        && value.len() <= 32
        && !digits.is_empty()
        && digits.bytes().all(|c| c.is_ascii_digit() || c == b'.')
        && BigDecimal::from_str(value).ok().is_some_and(|n| {
            (!positive || n > BigDecimal::from(0))
                && n >= BigDecimal::from(-1_000_000_000_000_000_i64)
                && n <= BigDecimal::from(1_000_000_000_000_000_i64)
                && n.as_bigint_and_exponent().1 <= 12
        })
}
fn timestamp(value: &str) -> Option<DateTime<Utc>> {
    if value.len() > 40 {
        return None;
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .filter(|v| v.offset().local_minus_utc() == 0)
        .map(|v| v.with_timezone(&Utc))
}
fn tags(values: &[String]) -> bool {
    values.len() <= 20
        && values
            .iter()
            .all(|v| text(v, 64, true, false) && v == v.trim())
        && values
            .iter()
            .map(|v| v.to_lowercase())
            .collect::<HashSet<_>>()
            .len()
            == values.len()
}
fn strategy(id: Option<&str>, revision: Option<i32>) -> bool {
    match (id, revision) {
        (None, None) => true,
        (Some(id), Some(revision)) => text(id, 160, true, false) && revision > 0,
        _ => false,
    }
}
fn validate(kind: &str, payload: Value) -> Result<Value, ApiError> {
    let error = || invalid("invalid_live_payload");
    match kind {
        "account" => {
            let mut account: Account = serde_json::from_value(payload).map_err(|_| error())?;
            account.name = account.name.trim().to_owned();
            if !text(&account.name, 160, true, false)
                || account.currency.len() != 3
                || !account.currency.bytes().all(|c| c.is_ascii_uppercase())
                || !decimal(&account.opening_balance, false)
                || account.opening_balance.starts_with('-')
                || account
                    .account_type
                    .as_deref()
                    .is_some_and(|v| !["live", "demo", "prop"].contains(&v))
                || account
                    .opening_at_utc
                    .as_deref()
                    .is_some_and(|v| timestamp(v).is_none())
            {
                return Err(error());
            }
            Ok(json!(account))
        }
        "trade" => {
            let trade: Trade = serde_json::from_value(payload).map_err(|_| error())?;
            let opened = timestamp(&trade.opened_at_utc).ok_or_else(error)?;
            let closed = timestamp(&trade.closed_at_utc).ok_or_else(error)?;
            if Uuid::parse_str(&trade.account_id).is_err()
                || !text(&trade.symbol, 64, true, false)
                || trade.symbol != trade.symbol.trim()
                || !["BUY", "SELL"].contains(&trade.side.as_str())
                || ![&trade.quantity, &trade.entry_price, &trade.exit_price]
                    .iter()
                    .all(|v| decimal(v, true))
                || ![&trade.gross_pnl, &trade.commission, &trade.swap, &trade.fee]
                    .iter()
                    .all(|v| decimal(v, false))
                || closed < opened
                || !tags(&trade.tags)
                || !text(&trade.note, 20000, false, true)
                || !strategy(trade.playbook_id.as_deref(), trade.playbook_revision)
            {
                return Err(error());
            }
            Ok(json!(trade))
        }
        "note" => {
            let mut note: Note = serde_json::from_value(payload).map_err(|_| error())?;
            note.title = note.title.trim().to_owned();
            if (note.account_id.is_some() && note.connection_id.is_some())
                || note
                    .account_id
                    .as_deref()
                    .is_some_and(|id| Uuid::parse_str(id).is_err())
                || !text(&note.title, 160, true, false)
                || !text(&note.note, 20000, true, true)
                || !tags(&note.tags)
                || !strategy(note.playbook_id.as_deref(), note.playbook_revision)
            {
                return Err(error());
            }
            Ok(json!(note))
        }
        _ => Err(invalid("invalid_live_kind")),
    }
}
const SELECT: &str = "SELECT r.record_id,r.kind,r.current_revision,r.created_at_utc,r.updated_at_utc,v.payload_json FROM live_records r JOIN live_record_revisions v ON v.workspace_id=r.workspace_id AND v.record_id=r.record_id AND v.revision=r.current_revision";
fn item(row: &Row) -> Value {
    json!({"record_id":row.get::<_,String>("record_id"),"revision":row.get::<_,i64>("current_revision"),
        "kind":row.get::<_,String>("kind"),"payload":row.get::<_,Value>("payload_json"),
        "created_at_utc":row.get::<_,String>("created_at_utc"),"updated_at_utc":row.get::<_,String>("updated_at_utc")})
}
async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
) -> Result<Json<Value>, ApiError> {
    if uri.query().is_some() {
        return Err(invalid("invalid_live_query"));
    }
    let connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows = connection
        .query(
            &format!("{SELECT} WHERE r.workspace_id=$1 AND NOT COALESCE((v.payload_json->>'archived')::boolean,false) AND NOT EXISTS (SELECT 1 FROM live_records a JOIN live_record_revisions av ON av.workspace_id=a.workspace_id AND av.record_id=a.record_id AND av.revision=a.current_revision WHERE a.workspace_id=r.workspace_id AND a.record_id=v.payload_json->>'account_id' AND COALESCE((av.payload_json->>'archived')::boolean,false)) ORDER BY r.updated_at_utc DESC,r.record_id"),
            &[&scope.workspace_id],
        )
        .await
        .map_err(|_| ApiError::database())?;
    Ok(Json(
        json!({"version":"live-records-v1","items":rows.iter().map(item).collect::<Vec<_>>()}),
    ))
}
async fn write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    path: Option<Path<String>>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    let Json(body) = body.map_err(|_| invalid("invalid_live_body"))?;
    let mut connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = connection
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
    tx.batch_execute("SAVEPOINT live_domain")
        .await
        .map_err(|_| ApiError::database())?;
    let (status, result) = match execute(
        &tx,
        &scope,
        matched.as_str(),
        path.as_ref().map(|p| p.0.as_str()),
        uri.query(),
        body,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            tx.batch_execute("ROLLBACK TO SAVEPOINT live_domain")
                .await
                .map_err(|_| ApiError::database())?;
            (error.0, error.1)
        }
    };
    let response = native_mutation::finish(&tx, mutation, status, result).await?;
    native_mutation::commit(tx, response).await
}
async fn references(
    tx: &Transaction<'_>,
    workspace: &str,
    payload: &Value,
) -> Result<(), ApiError> {
    if let Some(connection) = payload["connection_id"].as_str() {
        let connection =
            Uuid::parse_str(connection).map_err(|_| invalid("invalid_live_payload"))?;
        let exists: bool = tx.query_one("SELECT EXISTS(SELECT 1 FROM mt5_connections WHERE workspace_id=$1 AND connection_id=$2)", &[&workspace,&connection]).await.map_err(|_|ApiError::database())?.get(0);
        if !exists {
            return Err(invalid("live_account_not_found"));
        }
    }
    if let Some(account) = payload["account_id"].as_str() {
        let exists: bool = tx.query_one("SELECT EXISTS(SELECT 1 FROM live_records a JOIN live_record_revisions v ON v.workspace_id=a.workspace_id AND v.record_id=a.record_id AND v.revision=a.current_revision WHERE a.workspace_id=$1 AND a.record_id=$2 AND a.kind='account' AND NOT COALESCE((v.payload_json->>'archived')::boolean,false))", &[&workspace, &account]).await.map_err(|_| ApiError::database())?.get(0);
        if !exists {
            return Err(invalid("live_account_not_found"));
        }
    }
    if let Some(playbook) = payload["playbook_id"].as_str() {
        let revision = payload["playbook_revision"].as_i64().unwrap() as i32;
        let exists: bool = tx.query_one("SELECT EXISTS(SELECT 1 FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=$3 JOIN workspace_record_revisions cur ON cur.workspace_id=r.workspace_id AND cur.kind=r.kind AND cur.record_id=r.record_id AND cur.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='playbook' AND r.record_id=$2 AND NOT v.deleted AND NOT cur.deleted)", &[&workspace, &playbook, &revision]).await.map_err(|_| ApiError::database())?.get(0);
        if !exists {
            return Err(invalid("live_playbook_revision_not_found"));
        }
    }
    Ok(())
}
async fn execute(
    tx: &Transaction<'_>,
    scope: &Workspace,
    route: &str,
    id: Option<&str>,
    query: Option<&str>,
    body: Value,
) -> Result<(StatusCode, Value), ApiError> {
    if query.is_some() {
        return Err(invalid("invalid_live_query"));
    }
    let (expected, kind, payload) = if route == ROUTES[1].1 {
        let draft: Draft =
            serde_json::from_value(body).map_err(|_| invalid("invalid_live_body"))?;
        (None, draft.kind, draft.payload)
    } else {
        let draft: Revision =
            serde_json::from_value(body).map_err(|_| invalid("invalid_live_body"))?;
        if draft.expected_revision < 1 {
            return Err(invalid("invalid_live_revision"));
        }
        (Some(draft.expected_revision), draft.kind, draft.payload)
    };
    let payload = validate(&kind, payload)?;
    // Serializes admission and parent checks within this small manual ledger.
    let digest = Sha256::digest(
        serde_json::to_vec(&json!(["live-records-v1", scope.workspace_id])).unwrap(),
    );
    let lock = i64::from_be_bytes(digest[..8].try_into().unwrap());
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| ApiError::database())?;
    let (id, revision, created) = if let Some(id) = id {
        if Uuid::parse_str(id).is_err() {
            return Err(missing());
        }
        let current = tx
            .query_opt(
                &format!("{SELECT} WHERE r.workspace_id=$1 AND r.record_id=$2 FOR UPDATE OF r"),
                &[&scope.workspace_id, &id],
            )
            .await
            .map_err(|_| ApiError::database())?
            .ok_or_else(missing)?;
        let current_kind: String = current.get("kind");
        let revision: i64 = current.get("current_revision");
        let old: Value = current.get("payload_json");
        if old["archived"] == true {
            return Err(conflict("live_account_archived"));
        }
        // A note cannot escape an archived account by changing its parent in a revision.
        references(
            tx,
            &scope.workspace_id,
            &json!({"account_id":old["account_id"]}),
        )
        .await?;
        if Some(revision) != expected {
            return Err(conflict("live_revision_conflict"));
        }
        if current_kind != kind {
            return Err(conflict("live_kind_immutable"));
        }
        if (kind == "trade" && old["account_id"] != payload["account_id"])
            || (kind == "account" && old["currency"] != payload["currency"])
        {
            return Err(conflict("live_account_identity_immutable"));
        }
        (
            id.to_owned(),
            revision + 1,
            current.get::<_, String>("created_at_utc"),
        )
    } else {
        let count: i64 = tx
            .query_one(
                "SELECT count(*) FROM live_records WHERE workspace_id=$1",
                &[&scope.workspace_id],
            )
            .await
            .map_err(|_| ApiError::database())?
            .get(0);
        if count >= 10000 {
            return Err(conflict("live_record_limit"));
        }
        (
            Uuid::new_v4().to_string(),
            1,
            Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
        )
    };
    references(tx, &scope.workspace_id, &payload).await?;
    let stamp = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    if expected.is_none() {
        tx.execute("INSERT INTO live_records(workspace_id,record_id,kind,current_revision,created_at_utc,updated_at_utc) VALUES($1,$2,$3,$4,$5,$6)", &[&scope.workspace_id, &id, &kind, &revision, &created, &stamp]).await.map_err(|_| ApiError::database())?;
    } else {
        tx.execute("UPDATE live_records SET current_revision=$3,updated_at_utc=$4 WHERE workspace_id=$1 AND record_id=$2", &[&scope.workspace_id, &id, &revision, &stamp]).await.map_err(|_| ApiError::database())?;
    }
    tx.execute("INSERT INTO live_record_revisions(workspace_id,record_id,revision,payload_json,created_at_utc) VALUES($1,$2,$3,$4,$5)", &[&scope.workspace_id, &id, &revision, &payload, &stamp]).await.map_err(|_| ApiError::database())?;
    Ok((
        if expected.is_none() {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({"record_id":id,"kind":kind,"revision":revision,"payload":payload,"created_at_utc":created,"updated_at_utc":stamp}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn trade() -> Value {
        json!({"account_id":Uuid::new_v4().to_string(),"symbol":"EURUSD","side":"BUY","quantity":"0.10","opened_at_utc":"2026-10-01T10:00:00Z","closed_at_utc":"2026-10-01T11:00:00Z","entry_price":"1.10","exit_price":"1.09","gross_pnl":"-100.00","commission":"-0.70","swap":"0","fee":"0"})
    }
    #[test]
    fn closed_trade_contract_is_exact_and_bounded() {
        let parsed = validate("trade", trade()).unwrap();
        assert_eq!(parsed["quantity"], "0.10");
        assert_eq!(parsed["commission"], "-0.70");
        for (field, wrong) in [
            ("quantity", json!("0")),
            ("quantity", json!(1)),
            ("gross_pnl", json!("NaN")),
            ("entry_price", json!("1e2")),
            ("fee", json!("0.0000000000001")),
            ("closed_at_utc", json!("2026-10-01T09:59:00Z")),
            ("opened_at_utc", json!("2026-10-01T10:00:00+07:00")),
            ("tags", json!(["setup", "SETUP"])),
            ("playbook_id", json!("strategy-a")),
            ("extra", json!(true)),
        ] {
            let mut value = trade();
            value[field] = wrong;
            assert!(validate("trade", value).is_err(), "{field}");
        }
    }
    #[test]
    fn accounts_notes_and_strategy_pairs_are_typed() {
        assert!(
            validate(
                "account",
                json!({"name":"  Account  ","currency":"USD","opening_balance":"0"})
            )
            .is_ok()
        );
        for bad in [
            json!({"name":"a","currency":"usd","opening_balance":"100"}),
            json!({"name":"a","currency":"USD","opening_balance":"-100"}),
            json!({"name":"","currency":"USD","opening_balance":"0"}),
            json!({"name":"a","currency":"USD","opening_balance":"0","account_type":"unknown"}),
            json!({"name":"a","currency":"USD","opening_balance":"0","opening_at_utc":"2026-01-01T00:00:00+07:00"}),
            json!({"name":"a","currency":"USD","opening_balance":"0","archived":"true"}),
        ] {
            assert!(validate("account", bad).is_err());
        }
        assert!(validate("account",json!({"name":"a","currency":"USD","opening_balance":"0","account_type":"prop","opening_at_utc":"2026-01-01T00:00:00Z"})).is_ok());
        assert!(validate("note",json!({"title":"Review","note":"Line 1\nLine 2","tags":["Trend"],"playbook_id":"strategy-a","playbook_revision":2})).is_ok());
        assert!(validate("note", json!({"title":"Review","note":"","tags":[]})).is_err());
        for invalid in ["", "-", ".", "1.2.3", "+1", "1e2", "1000000000000001"] {
            assert!(!decimal(invalid, false));
        }
    }
}
