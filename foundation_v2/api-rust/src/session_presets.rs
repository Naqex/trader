//! Workspace-owned reusable drafts; changing a preset never revises a replay.
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
use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, str::FromStr, sync::Arc};
use tokio_postgres::{Row, Transaction};
use uuid::Uuid;

pub const ROUTES: &[(&str, &str)] = &[
    ("GET", "/api/v2/session-presets"),
    ("POST", "/api/v2/session-presets"),
    ("POST", "/api/v2/session-presets/{preset_id}/revisions"),
    ("POST", "/api/v2/session-presets/{preset_id}/delete"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(ROUTES[0].1, get(list).post(write))
        .route(ROUTES[2].1, post(write))
        .route(ROUTES[3].1, post(write))
}
fn invalid(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, detail)
}
fn conflict(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::CONFLICT, detail)
}
fn missing() -> ApiError {
    ApiError::detail(StatusCode::NOT_FOUND, "session_preset_not_found")
}

fn mode(query: Option<&str>, body: Option<&str>) -> Result<String, ApiError> {
    let mut supplied = None;
    for (key, value) in form_urlencoded::parse(query.unwrap_or("").as_bytes()) {
        if key != "mode" || supplied.is_some() {
            return Err(invalid("invalid_session_preset_query"));
        }
        supplied = Some(value.into_owned());
    }
    if supplied
        .as_deref()
        .zip(body)
        .is_some_and(|(left, right)| left != right)
    {
        return Err(invalid("invalid_session_preset_mode"));
    }
    let result = body
        .or(supplied.as_deref())
        .ok_or_else(|| invalid("invalid_session_preset_mode"))?;
    if !["backtest", "prop"].contains(&result) {
        return Err(invalid("invalid_session_preset_mode"));
    }
    Ok(result.to_owned())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PresetConfig {
    balance: String,
    datasets: Vec<String>,
    strategy: String,
    prop_draft: PropDraft,
    trading_options: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PropDraft {
    profile_kind: String,
    target_percent: String,
    daily_loss: String,
    overall_loss: String,
    duration_days: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    mode: Option<String>,
    name: String,
    config: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revise {
    mode: Option<String>,
    expected_revision: i64,
    name: String,
    config: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Delete {
    mode: Option<String>,
    expected_revision: i64,
}

fn name(value: &str) -> Result<String, ApiError> {
    let result = value.trim();
    if result.is_empty() || result.chars().count() > 160 || result.chars().any(char::is_control) {
        return Err(invalid("invalid_session_preset_name"));
    }
    Ok(result.to_owned())
}
fn decimal(value: &str, minimum: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().all(|c| c.is_ascii_digit() || c == b'.')
        && BigDecimal::from_str(value).ok().is_some_and(|number| {
            number >= BigDecimal::from_str(minimum).unwrap()
                && number <= BigDecimal::from(1_000_000_000_000_000_i64)
                && number.as_bigint_and_exponent().1 <= 12
        })
}
fn config(value: Value, mode: &str) -> Result<Value, ApiError> {
    let parsed: PresetConfig = serde_json::from_value(value.clone())
        .map_err(|_| invalid("invalid_session_preset_config"))?;
    let unique: HashSet<_> = parsed.datasets.iter().collect();
    if !decimal(&parsed.balance, "0.000000000001")
        || parsed.datasets.is_empty()
        || parsed.datasets.len() > 12
        || unique.len() != parsed.datasets.len()
        || parsed.datasets.iter().any(|id| {
            id.is_empty()
                || id.len() > 160
                || !id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        || parsed.strategy.len() > 160
        || parsed.strategy.chars().any(char::is_control)
        || parsed.prop_draft.profile_kind.is_empty()
        || parsed.prop_draft.profile_kind.len() > 64
        || parsed.prop_draft.profile_kind.chars().any(char::is_control)
        || [
            &parsed.prop_draft.target_percent,
            &parsed.prop_draft.daily_loss,
            &parsed.prop_draft.overall_loss,
        ]
        .iter()
        .any(|v| v.len() > 32 || v.chars().any(char::is_control))
        || (!parsed.prop_draft.duration_days.is_empty()
            && !parsed
                .prop_draft
                .duration_days
                .parse::<u32>()
                .ok()
                .is_some_and(|n| (1..=36500).contains(&n)))
        || parsed.trading_options["version"] != crate::session_trading_options::VERSION_V2
    {
        return Err(invalid("invalid_session_preset_config"));
    }
    if mode == "prop"
        && (!decimal(&parsed.prop_draft.target_percent, "0.1")
            || !decimal(&parsed.prop_draft.daily_loss, "1")
            || !decimal(&parsed.prop_draft.overall_loss, "1"))
    {
        return Err(invalid("invalid_session_preset_prop_config"));
    }
    crate::session_trading_options::normalize(&parsed.trading_options, &parsed.datasets)
        .map_err(|_| invalid("invalid_session_preset_trading_options"))?;
    // Presets are reusable drafts; retain decimal formatting for exact import/reuse.
    Ok(value)
}
fn item(row: &Row) -> Value {
    json!({"id":row.get::<_,String>("preset_id"),"mode":row.get::<_,String>("mode"),
        "revision":row.get::<_,i64>("revision"),"name":row.get::<_,String>("name"),
        "config":row.get::<_,Value>("config_json"),"created_at_utc":row.get::<_,String>("created_at_utc"),
        "updated_at_utc":row.get::<_,String>("updated_at_utc")})
}
async fn list(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    OriginalUri(uri): OriginalUri,
) -> Result<Json<Value>, ApiError> {
    let mode = mode(uri.query(), None)?;
    let connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows = connection.query("SELECT * FROM session_presets WHERE workspace_id=$1 AND mode=$2 AND NOT deleted ORDER BY created_at_utc,preset_id LIMIT 50",
        &[&scope.workspace_id, &mode]).await.map_err(|_| ApiError::database())?;
    Ok(Json(
        json!({"version":"session-presets-v1","items":rows.iter().map(item).collect::<Vec<_>>()}),
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
    let Json(body) = body.map_err(|_| invalid("invalid_session_preset_body"))?;
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
    tx.batch_execute("SAVEPOINT preset_domain")
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
            tx.batch_execute("ROLLBACK TO SAVEPOINT preset_domain")
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
    route: &str,
    id: Option<&str>,
    query: Option<&str>,
    body: Value,
) -> Result<(StatusCode, Value), ApiError> {
    let (mode, expected, draft) = if route == ROUTES[1].1 {
        let body: Create =
            serde_json::from_value(body).map_err(|_| invalid("invalid_session_preset_body"))?;
        let mode = mode(query, body.mode.as_deref())?;
        let draft = (name(&body.name)?, config(body.config, &mode)?);
        (mode, None, Some(draft))
    } else if route == ROUTES[2].1 {
        let body: Revise =
            serde_json::from_value(body).map_err(|_| invalid("invalid_session_preset_body"))?;
        let mode = mode(query, body.mode.as_deref())?;
        let draft = (name(&body.name)?, config(body.config, &mode)?);
        (mode, Some(body.expected_revision), Some(draft))
    } else {
        let body: Delete =
            serde_json::from_value(body).map_err(|_| invalid("invalid_session_preset_body"))?;
        (
            mode(query, body.mode.as_deref())?,
            Some(body.expected_revision),
            None,
        )
    };
    if expected.is_some_and(|revision| revision <= 0) {
        return Err(invalid("invalid_session_preset_revision"));
    }
    // A single scope lock serializes count/name admission, including concurrent creates.
    let digest = Sha256::digest(
        serde_json::to_vec(&json!(["session-presets-v1", scope.workspace_id, mode])).unwrap(),
    );
    let lock = i64::from_be_bytes(digest[..8].try_into().unwrap());
    tx.query_one("SELECT pg_advisory_xact_lock($1)", &[&lock])
        .await
        .map_err(|_| ApiError::database())?;
    let id = if let Some(id) = id {
        if Uuid::parse_str(id).is_err() {
            return Err(missing());
        }
        let row = tx.query_opt("SELECT revision FROM session_presets WHERE workspace_id=$1 AND mode=$2 AND preset_id=$3 AND NOT deleted FOR UPDATE",
            &[&scope.workspace_id, &mode, &id]).await.map_err(|_| ApiError::database())?.ok_or_else(missing)?;
        if Some(row.get::<_, i64>(0)) != expected {
            return Err(conflict("session_preset_revision_conflict"));
        }
        id.to_owned()
    } else {
        Uuid::new_v4().to_string()
    };
    let stamp = Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true);
    if let Some((name, config)) = draft {
        let key = name.to_lowercase();
        let duplicate: bool = tx.query_one("SELECT EXISTS(SELECT 1 FROM session_presets WHERE workspace_id=$1 AND mode=$2 AND name_key=$3 AND preset_id<>$4 AND NOT deleted)",
            &[&scope.workspace_id, &mode, &key, &id]).await.map_err(|_| ApiError::database())?.get(0);
        if duplicate {
            return Err(conflict("session_preset_name_exists"));
        }
        let row = if expected.is_none() {
            let count: i64 = tx.query_one("SELECT count(*) FROM session_presets WHERE workspace_id=$1 AND mode=$2 AND NOT deleted",
                &[&scope.workspace_id, &mode]).await.map_err(|_| ApiError::database())?.get(0);
            if count >= 50 {
                return Err(conflict("session_preset_limit"));
            }
            tx.query_one("INSERT INTO session_presets(workspace_id,mode,preset_id,revision,name,name_key,config_json,created_at_utc,updated_at_utc) VALUES($1,$2,$3,1,$4,$5,$6,$7,$7) RETURNING *",
                &[&scope.workspace_id,&mode,&id,&name,&key,&config,&stamp]).await.map_err(|_| ApiError::database())?
        } else {
            tx.query_one("UPDATE session_presets SET revision=revision+1,name=$4,name_key=$5,config_json=$6,updated_at_utc=$7 WHERE workspace_id=$1 AND mode=$2 AND preset_id=$3 RETURNING *",
                &[&scope.workspace_id,&mode,&id,&name,&key,&config,&stamp]).await.map_err(|_| ApiError::database())?
        };
        Ok((
            if expected.is_none() {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            item(&row),
        ))
    } else {
        let row = tx.query_one("UPDATE session_presets SET revision=revision+1,deleted=true,updated_at_utc=$4 WHERE workspace_id=$1 AND mode=$2 AND preset_id=$3 RETURNING revision",
            &[&scope.workspace_id,&mode,&id,&stamp]).await.map_err(|_| ApiError::database())?;
        Ok((
            StatusCode::OK,
            json!({"id":id,"mode":mode,"revision":row.get::<_,i64>(0),"deleted":true}),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> Value {
        json!({"balance":"100000","datasets":["dataset-a"],"strategy":"",
        "propDraft":{"profileKind":"generic","targetPercent":"10","dailyLoss":"500","overallLoss":"1000","durationDays":""},
        "tradingOptions":{"version":"session-trading-options-v2","costs_enabled":true,"assets":{"dataset-a":{"spread_price":"0.00020","commission_per_lot":"7","commission_charge":"round_trip","slippage":{"mode":"fixed","fixed_steps":2}}}}})
    }
    #[test]
    fn exact_config_and_costs_are_typed_and_bounded() {
        let value = config(draft(), "prop").unwrap();
        assert_eq!(
            value["tradingOptions"]["assets"]["dataset-a"]["spread_price"],
            "0.00020"
        );
        for (field, wrong) in [
            ("balance", json!("NaN")),
            ("balance", json!(true)),
            ("datasets", json!(["dataset-a", "dataset-a"])),
            ("strategy", json!(null)),
            ("extra", json!(true)),
        ] {
            let mut value = draft();
            value[field] = wrong;
            assert!(config(value, "backtest").is_err(), "{field}");
        }
        for wrong in [json!(0), json!(21), json!(1.5), json!("2")] {
            let mut value = draft();
            value["tradingOptions"]["assets"]["dataset-a"]["slippage"]["fixed_steps"] = wrong;
            assert!(config(value, "prop").is_err());
        }
        let mut value = draft();
        value["propDraft"]["targetPercent"] = json!("0");
        assert!(config(value.clone(), "prop").is_err());
        assert!(config(value, "backtest").is_ok());
    }
    #[test]
    fn names_modes_and_query_are_explicit() {
        assert_eq!(name("  Phiên ĐẸP  ").unwrap(), "Phiên ĐẸP");
        assert!(name(&"a".repeat(161)).is_err());
        assert!(name("a\n").is_ok());
        assert!(name("a\nb").is_err());
        assert!(name("   ").is_err());
        assert_eq!(mode(Some("mode=prop"), Some("prop")).unwrap(), "prop");
        for query in [
            None,
            Some("mode=oops"),
            Some("mode=prop&mode=prop"),
            Some("mode=prop&extra=1"),
        ] {
            assert!(mode(query, None).is_err());
        }
        assert!(mode(Some("mode=prop"), Some("backtest")).is_err());
    }
}
