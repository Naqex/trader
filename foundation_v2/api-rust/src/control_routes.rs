use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive, Zero};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{str::FromStr, sync::Arc};

mod learn;
pub mod notion;

pub fn native(method: &str, path: &str) -> bool {
    if crate::ai_assistant::native(method, path) { return true; }
    if notion::native(method, path) {
        return true;
    }
    match method {
        "GET" => matches!(
            path,
            "/api/v2/ai/status"
                | "/api/v2/learn/overview"
                | "/api/v2/learn/glossary"
                | "/api/v2/learn/resources/{resource_id}"
                | "/api/v2/research/engines"
        ),
        "POST" => matches!(
            path,
            "/api/v2/data/instruments/validate"
                | "/api/v2/data/cost-preview"
                | "/api/v2/data/news/visible"
                | "/api/v2/ai/request"
        ),
        _ => false,
    }
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .merge(notion::routes())
        .route("/api/v2/data/instruments/validate", post(instrument))
        .route("/api/v2/data/cost-preview", post(cost))
        .route("/api/v2/data/news/visible", post(news))
        .route("/api/v2/ai/status", get(ai_status_route))
        .route("/api/v2/ai/request", post(ai_request_route))
        .route("/api/v2/learn/overview", get(learn_overview))
        .route("/api/v2/learn/glossary", get(learn_glossary))
        .route("/api/v2/learn/resources/{resource_id}", get(learn_resource))
        .route("/api/v2/research/engines", get(research_engines))
}

fn invalid(message: &str) -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, message)
}

fn text(value: &Value, field: &str) -> Result<String, ApiError> {
    let raw = value.get(field).unwrap_or(&Value::Null);
    let s = match raw {
        Value::Null | Value::Bool(false) => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) if n.as_f64() == Some(0.0) => String::new(),
        Value::Bool(true) => "True".into(),
        _ => raw.to_string(),
    };
    let s = s.trim().to_owned();
    if s.is_empty() {
        Err(invalid(&format!("{field} is required")))
    } else {
        Ok(s)
    }
}

fn decimal(
    value: &Value,
    field: &str,
    default: Option<&str>,
    positive: bool,
    nonnegative: bool,
) -> Result<BigDecimal, ApiError> {
    let raw = value.get(field);
    let s = match raw {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => default.unwrap_or("null").to_owned(),
    };
    if matches!(
        s.to_lowercase().as_str(),
        "nan" | "infinity" | "-infinity" | "inf" | "-inf"
    ) {
        return Err(invalid(&format!("{field} must be finite")));
    }
    if s.len() > 512 {
        return Err(invalid(&format!("{field} exceeds supported decimal bounds")));
    }
    let n =
        BigDecimal::from_str(s.trim()).map_err(|_| invalid(&format!("{field} must be numeric")))?;
    if n.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err(invalid(&format!("{field} exceeds supported decimal bounds")));
    }
    if positive && n <= BigDecimal::zero() {
        return Err(invalid(&format!("{field} must be positive")));
    }
    if nonnegative && n < BigDecimal::zero() {
        return Err(invalid(&format!("{field} must be >= 0")));
    }
    Ok(n)
}

fn number(n: &BigDecimal) -> Result<Value, ApiError> {
    let f = n
        .to_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| invalid("numeric result must be finite"))?;
    Ok(json!(f))
}

pub fn validate_instrument(body: &Value) -> Result<Value, ApiError> {
    let input = &body["instrument"];
    let mut out = serde_json::Map::new();
    for key in [
        "instrument_id",
        "asset_class",
        "base_ccy",
        "quote_ccy",
        "account_ccy",
    ] {
        let mut s = text(input, key)?;
        if key.ends_with("ccy") {
            s = s.to_uppercase();
        }
        out.insert(key.into(), json!(s));
    }
    for key in [
        "tick_size",
        "pip_size",
        "contract_size",
        "quantity_min",
        "quantity_step",
    ] {
        out.insert(
            key.into(),
            number(&decimal(input, key, None, true, false)?)?,
        );
    }
    out.insert(
        "effective_from_utc".into(),
        json!(text(input, "effective_from_utc")?),
    );
    let end = input
        .get("effective_to_utc")
        .filter(|v| !v.is_null() && **v != json!(false) && **v != json!(0));
    out.insert(
        "effective_to_utc".into(),
        json!(
            end.map(|v| v
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string()))
                .unwrap_or_default()
                .trim()
        ),
    );
    Ok(Value::Object(out))
}

pub fn preview_cost(body: &Value) -> Result<Value, ApiError> {
    let model = &body["cost_model"];
    let basis = text(model, "spread_basis")?;
    if basis != "bid_ask_embedded" {
        return Err(invalid("spread_basis must be bid_ask_embedded"));
    }
    let rounding = match model.get("rounding_decimals") {
        None => 2,
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map_err(|_| invalid("rounding_decimals must be an integer"))?,
        Some(Value::Bool(b)) => i64::from(*b),
        Some(n) => n
            .as_i64()
            .or_else(|| n.as_f64().filter(|n| n.is_finite()).map(|n| n as i64))
            .ok_or_else(|| invalid("rounding_decimals must be an integer"))?,
    };
    if !(0..=8).contains(&rounding) {
        return Err(invalid("rounding_decimals must be between 0 and 8"));
    }
    let version = text(model, "version")?;
    let commission = decimal(model, "commission_per_side_account", Some("0"), false, true)?;
    let minimum = decimal(model, "minimum_fee_account", Some("0"), false, true)?;
    let slippage = decimal(model, "slippage_price_per_side", Some("0"), false, true)?;
    let financing = decimal(model, "financing_account", Some("0"), false, false)?;
    let rate = decimal(model, "quote_to_account_rate", Some("1"), true, false)?;
    let ccy = text(model, "account_ccy")?.to_uppercase();
    let side = text(body, "side")?.to_uppercase();
    if side != "BUY" && side != "SELL" {
        return Err(invalid("side must be BUY or SELL"));
    }
    let qty = decimal(body, "quantity", None, true, false)?;
    let contract = decimal(body, "contract_size", None, true, false)?;
    let eb = decimal(body, "entry_bid", None, true, false)?;
    let ea = decimal(body, "entry_ask", None, true, false)?;
    let xb = decimal(body, "exit_bid", None, true, false)?;
    let xa = decimal(body, "exit_ask", None, true, false)?;
    if ea < eb || xa < xb {
        return Err(invalid("ask must be >= bid"));
    }
    let units = qty * contract;
    let (entry, exit, gross) = if side == "BUY" {
        (ea.clone(), xb.clone(), (xb - ea) * &units)
    } else {
        (eb.clone(), xa.clone(), (eb - xa) * &units)
    };
    let gross_account = &gross * &rate;
    let slippage_account = slippage * 2 * units * &rate;
    let commission_account = std::cmp::max(commission * 2, minimum);
    let net = &gross_account - &commission_account - &slippage_account - &financing;
    let money = |n: &BigDecimal| {
        let rounded = n.with_scale_round(rounding, RoundingMode::HalfUp);
        if rounded.is_zero() && n < &BigDecimal::zero() {
            Ok(json!(-0.0))
        } else {
            number(&rounded)
        }
    };
    Ok(
        json!({"cost_model_version":version,"spread_basis":basis,"side":side,"entry_fill":number(&entry)?,"exit_fill":number(&exit)?,"gross_quote":number(&gross)?,"gross_account":money(&gross_account)?,"spread_cost_account":0.0,"commission_account":money(&commission_account)?,"slippage_account":money(&slippage_account)?,"financing_account":money(&financing)?,"net_account":money(&net)?,"account_ccy":ccy,"quote_to_account_rate":number(&rate)?,"rounding_decimals":rounding}),
    )
}

fn integer(v: Option<&Value>, field: &str) -> Result<i64, ApiError> {
    match v {
        Some(Value::String(s)) => s
            .trim()
            .parse()
            .map_err(|_| invalid(&format!("{field} must be unix seconds"))),
        Some(Value::Bool(v)) => Ok(i64::from(*v)),
        Some(v) => v
            .as_i64()
            .or_else(|| {
                v.as_f64()
                    .filter(|f| f.is_finite() && *f >= i64::MIN as f64 && *f <= i64::MAX as f64)
                    .map(|f| f as i64)
            })
            .ok_or_else(|| invalid(&format!("{field} must be unix seconds"))),
        _ => Err(invalid(&format!("{field} must be unix seconds"))),
    }
}

pub fn visible_news(body: &Value) -> Result<Value, ApiError> {
    let cutoff = integer(body.get("decision_time_utc"), "decision_time_utc")?;
    let proxy = body["allow_archive_proxy"].as_bool().unwrap_or(false);
    let mut items = Vec::new();
    for event in body["events"]
        .as_array()
        .ok_or_else(|| invalid("events must be an array"))?
    {
        let scheduled = integer(event.get("scheduled_time_utc"), "scheduled_time_utc")?;
        let known = match event.get("known_at_utc") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s.is_empty() => None,
            value => Some(integer(value, "known_at_utc")?),
        };
        let mut item = serde_json::Map::new();
        for key in [
            "event_id",
            "currency",
            "event_type",
            "impact_source",
            "time_precision",
            "revision_source",
        ] {
            let mut value = text(event, key)?;
            if key == "currency" {
                value = value.to_uppercase();
            }
            item.insert(key.into(), json!(value));
        }
        let status = match known {
            Some(k) if k <= cutoff => "point_in_time",
            None if proxy && scheduled <= cutoff => "archive_proxy",
            _ => continue,
        };
        item.insert("scheduled_time_utc".into(), json!(scheduled));
        item.insert("known_at_utc".into(), json!(known));
        item.insert("point_in_time_status".into(), json!(status));
        items.push(Value::Object(item));
    }
    items.sort_by(|a, b| {
        a["scheduled_time_utc"]
            .as_i64()
            .cmp(&b["scheduled_time_utc"].as_i64())
            .then_with(|| a["event_id"].as_str().cmp(&b["event_id"].as_str()))
    });
    Ok(
        json!({"decision_time_utc":cutoff,"allow_archive_proxy":proxy,"point_in_time_warning":items.iter().any(|i|i["point_in_time_status"]=="archive_proxy"),"items":items}),
    )
}

pub fn ai_status() -> Value {
    json!({"provider":"offline","model":null,"provider_health":{"available":false,"reason":"AI provider is disabled"},"enabled_jobs":[],"capabilities":{"playbook_search":false,"research_rule_draft":false,"journal_review":false,"chart_overlay":false,"broker_actions":false},"limits":{"max_payload_bytes":16384,"max_input_items":64},"execution_capability":false})
}

fn ascii_json(value: &Value, out: &mut String) {
    canonical_json(value, out, true);
}
pub(crate) fn canonical_json(value: &Value, out: &mut String, ensure_ascii: bool) {
    match value {
        Value::String(s) => {
            out.push('"');
            for c in s.chars() {
                match c {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    '\u{8}' => out.push_str("\\b"),
                    '\u{c}' => out.push_str("\\f"),
                    c if c < ' ' || (ensure_ascii && !(' '..='~').contains(&c)) => {
                        let mut buf = [0u16; 2];
                        for u in c.encode_utf16(&mut buf) {
                            out.push_str(&format!("\\u{u:04x}"));
                        }
                    }
                    c => out.push(c),
                }
            }
            out.push('"');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, v) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical_json(v, out, ensure_ascii);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort();
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical_json(&json!(k), out, ensure_ascii);
                out.push(':');
                canonical_json(&map[*k], out, ensure_ascii);
            }
            out.push('}');
        }
        Value::Number(n) if n.is_f64() => {
            out.push_str(&crate::research_jobs::python_float(n.as_f64().expect("finite float"))
                .expect("finite JSON number"));
        }
        Value::Number(n) if n.to_string() == "-0" => out.push('0'),
        _ => out.push_str(&value.to_string()),
    }
}

pub fn ai_request(body: &Value) -> Result<Value, ApiError> {
    let job = text(body, "job")?;
    if ![
        "playbook_search",
        "research_rule_draft",
        "journal_review",
        "chart_overlay",
    ]
    .contains(&job.as_str())
    {
        return Err(invalid("job is unsupported"));
    }
    let context = text(body, "context_version")?;
    let state = body
        .get("state")
        .filter(|v| v.is_object())
        .ok_or_else(|| invalid("state must be an object"))?;
    let mut pending = vec![("state".to_owned(), state)];
    while let Some((path, value)) = pending.pop() {
        match value {
            Value::Object(map) => {
                for (k, v) in map {
                    let norm = k.trim().to_lowercase().replace('-', "_");
                    if [
                        "api_key",
                        "access_token",
                        "authorization",
                        "broker_credentials",
                        "holdout_bars",
                        "holdout_content",
                        "password",
                        "private_key",
                        "secret",
                    ]
                    .contains(&norm.as_str())
                    {
                        return Err(invalid(
                            "state contains forbidden sensitive or holdout fields",
                        ));
                    }
                    pending.push((format!("{path}.{k}"), v));
                }
            }
            Value::Array(items) => {
                if items.len() > 64 {
                    return Err(invalid(&format!("{path} exceeds max_input_items")));
                }
                for (i, v) in items.iter().enumerate() {
                    pending.push((format!("{path}[{i}]"), v));
                }
            }
            Value::Number(n) if n.to_string().contains(['.', 'e', 'E']) && n.as_f64().is_none() => {
                return Err(invalid("AI state must be JSON serializable"));
            }
            _ => {}
        }
    }
    let canonical = json!({"job":job,"context_version":context,"state":state});
    let mut encoded = String::new();
    ascii_json(&canonical, &mut encoded);
    if encoded.len() > 16384 {
        return Err(invalid("AI request exceeds max_payload_bytes"));
    }
    let hash = format!("{:x}", Sha256::digest(encoded.as_bytes()));
    let supplied = body["context_hash"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    Ok(
        json!({"status":if !supplied.is_empty() && supplied != hash {"invalid_context"}else{"unavailable"},"provider":"offline","model":null,"context_hash":hash,"result":{},"usage":null,"latency_ms":0.0}),
    )
}

async fn instrument(_scope: Workspace, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let body = crate::native_contracts::validate_body("validate_instrument", body)?;
    validate_instrument(&body).map(Json)
}
async fn cost(_scope: Workspace, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let body = crate::native_contracts::validate_body("preview_cost", body)?;
    preview_cost(&body).map(Json)
}
async fn news(_scope: Workspace, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    let body = crate::native_contracts::validate_body("get_visible_news", body)?;
    visible_news(&body).map(Json)
}
async fn ai_status_route(_scope: Workspace) -> Json<Value> {
    Json(ai_status())
}
async fn ai_request_route(
    _scope: Workspace,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let body = crate::native_contracts::validate_body("ai_request", body)?;
    ai_request(&body).map(Json)
}
async fn learn_overview(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    learn::dispatch(state, scope, "overview".into(), None)
        .await
        .map(Json)
}
async fn learn_glossary(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Json<Value>, ApiError> {
    learn::dispatch(state, scope, "glossary".into(), None)
        .await
        .map(Json)
}
async fn learn_resource(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    learn::dispatch(state, scope, "resource".into(), Some(id))
        .await
        .map(Json)
}
async fn research_engines(_scope: Workspace) -> Json<Value> {
    let runtime = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../engine_runtime");
    let available = cfg!(windows)
        && runtime.join(".venv/Scripts/python.exe").is_file()
        && runtime.join("uv.lock").is_file();
    Json(
        json!({"primary":"nautilus","items":[{"id":"nautilus","version":"1.231.0","available":available,"scope":"fx quote/account currency match; modeled open/close quotes; fixed-horizon; no broker"},{"id":"reference","version":"bar-breakout-v1","available":true,"scope":"deterministic oracle/reference; not the primary engine"}]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn controls_obey_workspace_and_schema_without_worker() {
        let app = crate::router(crate::tests::fixture(100), routes());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v2/ai/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v2/ai/status")
                    .header("x-workspace-id", "other")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v2/ai/status")
                    .header("x-workspace-id", "a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 65536).await.unwrap())
                .unwrap(),
            ai_status()
        );
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v2/data/news/visible")
                    .header("x-workspace-id", "a")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"events":[],"decision_time_utc":100}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            serde_json::from_slice::<Value>(&to_bytes(response.into_body(), 65536).await.unwrap())
                .unwrap(),
            json!({"items":[],"allow_archive_proxy":false,"decision_time_utc":100,"point_in_time_warning":false})
        );
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v2/data/instruments/validate")
                    .header("x-workspace-id", "a")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"instrument":{},"extra":true}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65536).await.unwrap()).unwrap();
        assert!(body["detail"].is_array());
    }
}
