//! Read-only research and journal projections, bounded by the replay checkpoint.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use bigdecimal::{BigDecimal, ToPrimitive};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

type R<T> = Result<T, String>;
pub fn native(method: &str, path: &str) -> bool {
    method == "GET"
        && matches!(
            path,
            "/api/v2/research/jobs/{job_id}/analytics"
                | "/api/v2/research/jobs/{job_id}/analytics.csv"
                | "/api/v2/replay/sessions/{session_id}/analytics/experiments"
                | "/api/v2/journal/context"
        )
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/research/jobs/{job_id}/analytics", get(invoke))
        .route("/api/v2/research/jobs/{job_id}/analytics.csv", get(invoke))
        .route(
            "/api/v2/replay/sessions/{session_id}/analytics/experiments",
            get(invoke),
        )
        .route("/api/v2/journal/context", get(invoke))
}
fn error(status: StatusCode, s: &str) -> ApiError {
    ApiError::detail(status, s)
}
fn bad(s: &str) -> ApiError {
    error(StatusCode::UNPROCESSABLE_ENTITY, s)
}
fn filters(q: &HashMap<String, String>) -> Value {
    let mut f = json!({});
    for k in ["side", "outcome", "from_close_utc", "to_close_utc"] {
        if let Some(s) = q.get(k) {
            f[k] = json!(s)
        }
    }
    f
}
fn qint(q: &HashMap<String, String>, key: &str) -> Result<Option<i64>, ApiError> {
    q.get(key)
        .map(|s| {
            s.parse()
                .map_err(|_| bad("replay_experiment_invalid_source_or_config"))
        })
        .transpose()
}

fn research_projection(result: &Value, f: &Value) -> Result<Value, ApiError> {
    // Filter errors are request errors; malformed stored financial fields are a
    // source contract failure, preserving the original API distinction.
    crate::analytics::normalize_filters(Some(f)).map_err(|e| {
        let mut detail = e;
        for key in ["from_close_utc", "to_close_utc"] {
            if let Some(raw) = f[key].as_str().filter(|s| !s.is_empty()) {
                if crate::analytics::timestamp(&json!(raw)).is_err() {
                    detail = if chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S")
                        .is_ok()
                    {
                        format!("{key} must include a timezone")
                    } else {
                        format!("{key} must be an ISO-8601 timestamp")
                    };
                    break;
                }
            }
        }
        bad(&detail)
    })?;
    crate::analytics::build_analytics_view(result, Some(f)).map_err(|e| {
        if [
            "research result must be an object",
            "ledger entries must be objects",
            "starting_balance is required to recompute filtered metrics",
        ]
        .contains(&e.as_str())
        {
            bad(&e)
        } else {
            bad("analytics_source_invalid")
        }
    })
}

async fn invoke(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    request: Request,
) -> Result<Response, ApiError> {
    let path = request.uri().path();
    let q: HashMap<String, String> =
        form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
    let activity_basis = match q.get("time_basis").map(String::as_str).unwrap_or("market") { "activity" => true, "market" => false, _ => return Err(bad("analytics_time_basis_invalid")) };
    let mut client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = client
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(|_| ApiError::database())?;
    let value = if path == "/api/v2/journal/context" {
        let id = q
            .get("session_id")
            .filter(|s| !s.is_empty() && s.chars().count() <= 128)
            .ok_or_else(|| bad("session_id must contain 1 to 128 characters"))?;
        crate::replay_service::load_record(&tx, &scope.workspace_id, id, false).await?;
        // Filter before transferring journal text; preserve current-head ordering and aliases.
        let rows=tx.query("SELECT v.payload_json FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='journal' AND NOT v.deleted AND (v.payload_json->'source'->>'session_id'=$2 OR v.payload_json->'source'->>'replay_session_id'=$2) ORDER BY r.updated_at_utc DESC,r.record_id",&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?;
        let records = rows
            .iter()
            .map(|r| json!({"payload":r.get::<_,Value>(0)}))
            .collect::<Vec<_>>();
        let mut context=journal_context(&records, &scope.workspace_id, id)
            .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE,"stored_contract_untrusted"))?;
        crate::trade_labels::project_context(&tx,&scope.workspace_id,id,&mut context).await?;
        context
    } else if path.starts_with("/api/v2/research/") {
        let id = path.split('/').nth(5).unwrap_or("");
        let row=tx.query_opt(crate::jobs::JOB_QUERY,&[&scope.workspace_id,&id]).await.map_err(|_|ApiError::database())?.ok_or_else(||error(StatusCode::NOT_FOUND,"job_not_found"))?;
        if row.get::<_, String>("status") != "completed" {
            return Err(error(
                StatusCode::CONFLICT,
                "analytics_requires_completed_job",
            ));
        }
        let (Some(relative), Some(hash)) = (
            row.get::<_, Option<String>>("result_path"),
            row.get::<_, Option<String>>("result_sha256"),
        ) else {
            return Err(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "analytics_result_unavailable",
            ));
        };
        let root = state.config.artifact_root.clone();
        let identity = crate::jobs::StoredResultIdentity::from_row(&row);
        let permit = state
            .artifact_reads
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "artifact_read_capacity_exceeded",
                )
            })?;
        let f = filters(&q);
        let view = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let result = crate::jobs::read_job_result(root, &relative, &hash, &identity).map_err(|e| {
                if e.1["detail"] == "stored_artifact_unavailable" {
                    e
                } else {
                    error(StatusCode::SERVICE_UNAVAILABLE, "stored_contract_untrusted")
                }
            })?;
            if activity_basis {
                let mut result=result;
                if let Some(rows)=result["ledger"].as_array_mut(){for row in rows {row["report_time_utc"]=Value::Null;row["close_recorded_at_utc"]=Value::Null;}}
                let mut view=research_projection(&result,&f)?;
                view["scope"]["time_basis"]=json!("activity");
                view["provenance"]["time_basis"]=json!("activity");
                view["scope"]["recording_coverage"]=json!({"known_close_count":0,"unknown_close_count":view["ledger"].as_array().map_or(0,Vec::len),"legacy_backfill":false});
                Ok(view)
            } else {research_projection(&result, &f)}
        })
        .await
        .map_err(|_| {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "analytics_result_unavailable",
            )
        })??;
        if path.ends_with(".csv") {
            let name = format!("attachment; filename=\"job-{id}-analytics-v1.csv\"");
            let disposition = axum::http::HeaderValue::from_str(&name)
                .map_err(|_| bad("invalid job identifier"))?;
            tx.commit().await.map_err(|_| ApiError::database())?;
            return Ok((
                [
                    (
                        header::CONTENT_TYPE,
                        axum::http::HeaderValue::from_static("text/csv; charset=utf-8"),
                    ),
                    (header::CONTENT_DISPOSITION, disposition),
                ],
                crate::analytics::analytics_csv(&view),
            )
                .into_response());
        }
        view
    } else {
        let id = path.split('/').nth(5).unwrap_or("");
        let record =
            crate::replay_service::load_record(&tx, &scope.workspace_id, id, false).await?;
        let mut record = crate::replay_service::checkpoint_record(
            &tx,
            &state,
            &scope.workspace_id,
            record,
            qint(&q, "cursor_index")?,
            qint(&q, "cutoff_timestamp")?,
            qint(&q, "event_sequence")?,
        )
        .await
        .map_err(|e| {
            if e.0 == StatusCode::UNPROCESSABLE_ENTITY {
                bad("replay_experiment_invalid_source_or_config")
            } else {
                e
            }
        })?;
        record["workspace_id"] = json!(scope.workspace_id);
        if record["payload"]["asset_states"]
            .as_object()
            .is_some_and(|s| !s.is_empty())
        {
            return Err(bad("replay_experiment_invalid_source_or_config"));
        }
        let dataset = record["payload"]["dataset_id"]
            .as_str()
            .ok_or_else(|| bad("replay_experiment_invalid_source_or_config"))?;
        let m: Value = tx
            .query_opt(
                "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",
                &[&scope.workspace_id, &dataset],
            )
            .await
            .map_err(|_| ApiError::database())?
            .ok_or_else(|| bad("replay_experiment_invalid_source_or_config"))?
            .get(0);
        let path = m["artifact_path"]
            .as_str()
            .ok_or_else(|| bad("replay_experiment_invalid_source_or_config"))?
            .to_owned();
        let sha = m["artifact_sha256"]
            .as_str()
            .ok_or_else(|| bad("replay_experiment_invalid_source_or_config"))?
            .to_owned();
        let end = record["payload"]["cursor_index"]
            .as_u64()
            .ok_or_else(|| bad("replay_experiment_invalid_source_or_config"))?
            as usize
            + 1;
        let reader = state.artifact_data.clone();
        let permit = state
            .artifact_reads
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "artifact_read_capacity_exceeded",
                )
            })?;
        let mut config = json!({});
        for (k, default) in [
            ("stop_distance_ticks", 20.0),
            ("stop_multiplier", 1.0),
            ("target_r", 2.0),
        ] {
            let n = q
                .get(k)
                .map(|s| s.parse::<f64>())
                .unwrap_or(Ok(default))
                .map_err(|_| bad("replay_experiment_invalid_source_or_config"))?;
            if !n.is_finite() {
                return Err(bad("replay_experiment_invalid_source_or_config"));
            }
            config[k] = json!(n)
        }
        let f = filters(&q);
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let bars = reader.indices(&path, &sha, 0, end)?;
            build_experiments_for_basis(&record, &bars, &sha, Some(&f), &config, activity_basis)
        })
        .await
        .map_err(|_| bad("replay_experiment_invalid_source_or_config"))?
        .map_err(|_| bad("replay_experiment_invalid_source_or_config"))?
    };
    tx.commit().await.map_err(|_| ApiError::database())?;
    Ok(Json(value).into_response())
}

pub fn journal_context(records: &[Value], workspace: &str, session: &str) -> R<Value> {
    let mut trades: Vec<Value> = vec![];
    let mut positions = HashMap::new();
    let mut count = 0;
    for r in records {
        if r.get("workspace_id").is_some_and(|w| w != workspace) {
            return Err("stored_contract_untrusted".into());
        }
        let p = &r["payload"];
        let s = &p["source"];
        if s["session_id"] != session && s["replay_session_id"] != session {
            continue;
        }
        count += 1;
        let mut seen = HashSet::new();
        for k in ["trade_id", "id"] {
            let Some(id) = s[k].as_str().filter(|s| !s.is_empty()) else {
                continue;
            };
            if !seen.insert(id) {
                continue;
            }
            let i = if let Some(i) = positions.get(id) {
                *i
            } else {
                trades.push(json!({"trade_id":id,"tags":[],"record_count":0,"has_notes":false}));
                positions.insert(id.to_owned(), trades.len() - 1);
                trades.len() - 1
            };
            let item = &mut trades[i];
            item["record_count"] = json!(item["record_count"].as_u64().unwrap() + 1);
            let note = if truth(&p["note"]) {
                &p["note"]
            } else {
                &p["notes"]
            };
            item["has_notes"] = json!(
                item["has_notes"] == true
                    || (!note.is_null() && truth(note) && !python_string(note).trim().is_empty())
            );
            if let Some(tags) = p["tags"].as_array() {
                for tag in tags {
                    if tag.is_string() && !item["tags"].as_array().unwrap().contains(tag) {
                        item["tags"].as_array_mut().unwrap().push(tag.clone())
                    }
                }
            }
        }
    }
    Ok(
        json!({"schema_version":"replay-journal-context-v1","workspace_id":workspace,"session_id":session,"record_count":count,"trades":trades}),
    )
}
fn truth(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
    }
}
fn python_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "True".into()
            } else {
                "False".into()
            }
        }
        _ => v.to_string(),
    }
}
fn number(n: BigDecimal) -> R<Value> {
    n.to_f64()
        .filter(|n| n.is_finite())
        .map(|n| json!(n))
        .ok_or("numeric output exceeds finite JSON".into())
}
fn unavailable(reason: &str) -> Value {
    json!({"status":"unsupported","reason":reason,"net_pnl":null,"exit_price":null})
}

fn initial_position<'a>(s: &'a Value, t: &Value) -> R<Option<&'a Value>> {
    use crate::replay_core::dec;
    let ledger = s["ledger"].as_array().ok_or("invalid ledger")?;
    for (index, event) in ledger.iter().enumerate() {
        let detail = &event["details"];
        if event["kind"] != "market_fill" || detail["position_id"] != t["source_position_id"] {
            continue;
        }
        let mut p = &detail["open_position"];
        // A synchronous bar mark precedes user amendments; later marks do not
        // prove the initial SL, even when they still refer to the same position.
        if p.is_null() {
            if let Some(following) = ledger.get(index + 1).filter(|next|
                next["kind"] == "price_mark" && next["cursor_index"] == event["cursor_index"]) {
                p = &following["details"]["open_position"];
            }
        }
        if p.is_null() { return Ok(None); }
        if p["position_id"] != detail["position_id"] || p["source_operation_id"] != detail["operation_id"]
            || p["side"] != t["side"] || dec(p,"entry_fill")? != dec(detail,"fill_price")?
            || p["opened_cursor_index"] != event["cursor_index"] || p["opened_time_utc"] != event["virtual_time_utc"] {
            return Err("initial risk checkpoint disagrees with opening fill".into());
        }
        return Ok(Some(p));
    }
    Ok(None)
}

fn ideal_week(t: &Value, bars: &[Value], s: &Value, position: &Value, risk: Option<&BigDecimal>) -> R<Value> {
    use crate::replay_core::{dec, int, pnl, quote};
    let start=int(t,"open_time_utc")?;
    let end=start.checked_add(7*24*60*60).ok_or("invalid ideal window")?;
    let mut out=json!({"status":"unsupported","reason":"original_stop_unavailable","value_r":null,"max_net_pnl":null,"could_have_profit_or_breakeven":null,"observed_from_utc":start,"observed_to_utc":null,"window_end_utc":end,"basis":"max_costed_closeable_profit / initial_gross_risk; recorded OHLC; ignores subsequent SL/TP"});
    let Some(risk)=risk.filter(|risk| **risk>BigDecimal::from(0)) else { return Ok(out); };
    let timeframe=int(s,"timeframe_seconds")?;
    let observed_end=bars.last().map(|bar| int(bar,"timestamp")).transpose()?.unwrap_or(start)+timeframe;
    out["observed_to_utc"]=json!(end.min(observed_end));
    if observed_end<end {out["status"]=json!("partial_week");out["reason"]=json!("week_not_observed_at_cutoff");return Ok(out);}
    let mut prices=Vec::new();
    for bar in bars.iter().skip(usize::try_from(int(t,"open_cursor_index")?).map_err(|_|"invalid exposure")?) {
        let timestamp=int(bar,"timestamp")?;
        if timestamp>=end {break;}
        crate::replay_core::bar_valid(bar)?;
        if timestamp+timeframe>end {out["status"]=json!("partial_week");out["reason"]=json!("week_boundary_inside_candle");return Ok(out);}
        let (bid,ask)=quote(s,&dec(bar,if t["side"]=="BUY"{"high"}else{"low"})?)?;
        prices.push(if t["side"]=="BUY"{bid}else{ask});
    }
    let Some(price)=(if t["side"]=="BUY"{prices.into_iter().max()}else{prices.into_iter().min()}) else {out["reason"]=json!("week_has_no_complete_candle");return Ok(out);};
    let (net,_)=pnl(s,position,&price,&price)?;
    out["status"]=json!("complete_week");out["reason"]=Value::Null;
    out["value_r"]=number((&net/risk).with_prec(28))?;
    out["max_net_pnl"]=number(net.clone())?;
    out["could_have_profit_or_breakeven"]=json!(net>=BigDecimal::from(0));
    Ok(out)
}

pub fn build_experiments(
    record: &Value,
    bars: &[Value],
    sha: &str,
    filters: Option<&Value>,
    raw: &Value,
) -> R<Value> {
    build_experiments_for_basis(record,bars,sha,filters,raw,false)
}
fn build_experiments_for_basis(record:&Value,bars:&[Value],sha:&str,filters:Option<&Value>,raw:&Value,activity_basis:bool)->R<Value>{
    use crate::replay_core::d;
    let mut config = json!({});
    for (k, default, max) in [
        ("stop_distance_ticks", 20, 1000000),
        ("stop_multiplier", 1, 100),
        ("target_r", 2, 100),
    ] {
        let n = if raw[k].is_null() {
            BigDecimal::from(default)
        } else {
            d(&raw[k])?
        };
        if n <= BigDecimal::from(0) || n > BigDecimal::from(max) {
            return Err(format!("invalid {k}"));
        }
        config[k] = json!(n.to_string())
    }
    let a = if activity_basis { crate::analytics::build_replay_activity_view(record,filters,chrono_tz::UTC)? } else { crate::analytics::build_replay_analytics_view(record, filters)? };
    let mut out = json!({"schema_version":"replay-analytics-experiments-v1","read_only":true,"config":{},"provenance":a["provenance"],"scope":a["scope"],"account_currency":a["account_currency"],"rows":[],"bounds":"selected closed trades; original close; no future bars","risk_basis":"stop_loss: user_configured_distance; risk_reward: initial_stop_distance","scenario_risk_basis":{"stop_loss":"user_configured_distance","risk_reward":"initial_stop_distance"},"ideal_bounds":"entry through seven elapsed days; only complete observed candles at or before selected cutoff","blocked_by_data":a["blocked_by_data"]});
    for k in ["stop_distance_ticks", "stop_multiplier", "target_r"] {
        out["config"][k] = number(d(&config[k])?)?
    }
    if a["analytics_available"] != true {
        return Ok(out);
    }
    let s = &record["payload"]["execution"];
    crate::replay_core::validate(s)?;
    if s["dataset_sha256"] != sha {
        return Err("experiment dataset hash disagrees with execution".into());
    }
    if s["instrument_spec"]["account_ccy"] != s["cost_model"]["account_ccy"] {
        return Err("experiment instrument and cost currency disagree".into());
    }
    let visible = usize::try_from(crate::replay_core::int(s, "cursor_index")? + 1)
        .map_err(|_| "invalid cursor")?;
    let bars = &bars[..bars.len().min(visible)];
    let rows = a["ledger"]
        .as_array()
        .ok_or("invalid ledger")?
        .iter()
        .map(|t| trade_experiment(t, bars, s, &config))
        .collect::<R<Vec<_>>>()?;
    let mut summary = json!({});
    for name in ["stop_loss", "risk_reward"] {
        let ready = rows
            .iter()
            .filter(|r| r[name]["status"] == "ready")
            .collect::<Vec<_>>();
        let mut sum = crate::analytics::PythonSum::default();
        for row in &ready {
            sum.add(row[name]["net_pnl"].as_f64().unwrap());
        }
        let sum = sum.value();
        summary[name] = json!({"selected_trade_count":rows.len(),"supported_trade_count":ready.len(),"ambiguous_trade_count":rows.iter().filter(|r|r[name]["status"]=="ambiguous").count(),"unsupported_trade_count":rows.iter().filter(|r|r[name]["status"]=="unsupported").count(),"net_pnl":if ready.len()==rows.len(){Some(sum)}else{None},"supported_subset_net_pnl":if ready.is_empty(){None}else{Some(sum)}})
    }
    out["rows"] = json!(rows);
    out["summary"] = summary;
    Ok(out)
}

fn trade_experiment(t: &Value, bars: &[Value], s: &Value, config: &Value) -> R<Value> {
    use crate::replay_core::{d, dec, int, pnl, quote};
    let start = usize::try_from(int(t, "open_cursor_index")?).map_err(|_| "invalid exposure")?;
    let end = usize::try_from(int(t, "close_cursor_index")?).map_err(|_| "invalid exposure")?;
    if start > end || end >= bars.len() {
        return Err("trade exposure outside observed dataset".into());
    }
    let path = &bars[start..=end];
    for b in path {
        crate::replay_core::bar_valid(b)?
    }
    let timestamp = int(path.last().unwrap(), "timestamp")?;
    if int(&path[0], "timestamp")? != int(t, "open_time_utc")?
        || ![timestamp, timestamp + int(s, "timeframe_seconds")?]
            .contains(&int(t, "close_time_utc")?)
    {
        return Err("trade timestamps disagree with dataset".into());
    }
    let entry = dec(t, "price_open")?;
    let close = dec(t, "price_close")?;
    let buy = t["side"] == "BUY";
    let direction = BigDecimal::from(if buy { 1 } else { -1 });
    let (eb, ea) = quote(s, &dec(&path[0], "open")?)?;
    let mut base = json!({"trade_id":t["trade_id"],"original_net_pnl":t["net_pnl"]});
    let unsupported = |mut base: Value, reason: &str| {
        base["excursion"] = json!({"status":"unsupported","reason":reason});
        base["stop_loss"] = unavailable(reason);
        base["risk_reward"] = unavailable(reason);
        base
    };
    if entry != if buy { ea.clone() } else { eb.clone() } {
        return Ok(unsupported(base, "entry_quote_mismatch"));
    }
    let position = json!({"side":t["side"],"quantity":t["quantity"],"entry_bid":eb.to_string(),"entry_ask":ea.to_string()});
    let (_, original) = pnl(s, &position, &close, &close)?;
    let seq = int(t, "close_event_sequence")?;
    let event = s["ledger"]
        .as_array()
        .and_then(|l| seq.checked_sub(1).and_then(|i| l.get(i as usize)))
        .ok_or("invalid close event")?;
    if event["details"]["cost_model_version"] != s["cost_model"]["version"]
        || d(&original["net_account"])? != dec(t, "net_pnl")?
    {
        return Ok(unsupported(base, "original_cost_model_mismatch"));
    }
    let distance = (dec(config, "stop_distance_ticks")? * dec(&s["instrument_spec"], "tick_size")?)
        .with_prec(28);
    let distance = (distance * dec(config, "stop_multiplier")?).with_prec(28);
    // A final closing snapshot can contain a moved SL. The opening checkpoint is
    // the only evidence of the stop that existed when the trade was executed.
    let original = initial_position(s, t)?;
    let original_stop = original.filter(|p| !p["stop_loss"].is_null())
        .map(|p| dec(p, "stop_loss")).transpose()?;
    if original_stop.as_ref().is_some_and(|stop| *stop <= BigDecimal::from(0)) {
        return Err("initial stop must be finite and positive".into());
    }
    let original_distance = original_stop.as_ref().map(|stop| ((&entry - stop) * &direction).with_prec(28))
        .filter(|distance| *distance > BigDecimal::from(0));
    let original_stop = original_stop.filter(|_| original_distance.is_some());
    let risk_account = if let Some(stop) = &original_stop {
        let (_, cost) = pnl(s, &position, stop, stop)?;
        let risk = d(&cost["gross_account"])?;
        let risk = if risk < BigDecimal::from(0) { -risk } else { risk };
        (risk > BigDecimal::from(0)).then_some(risk)
    } else { None };
    base["realized_r"] = risk_account.as_ref().map(|risk| number((dec(t,"net_pnl")? / risk).with_prec(28))).transpose()?.unwrap_or(Value::Null);
    base["ideal"]=ideal_week(t,bars,s,&position,risk_account.as_ref())?;
    let gap = ["stop_loss_gap", "take_profit_gap"]
        .iter()
        .any(|x| t["exit_reason"] == *x);
    let mut observations = vec![entry.clone(), close.clone()];
    for (i, b) in path.iter().enumerate() {
        for k in if i == path.len() - 1 {
            vec!["open"]
        } else {
            vec!["high", "low"]
        } {
            let (bid, ask) = quote(s, &dec(b, k)?)?;
            observations.push(if buy { bid } else { ask });
        }
    }
    let changes = observations
        .into_iter()
        .map(|p| ((p - &entry).with_prec(28) * &direction).with_prec(28))
        .collect::<Vec<_>>();
    let zero = BigDecimal::from(0);
    let mae = zero.clone().max(-changes.iter().min().unwrap().clone());
    let mfe = zero.clone().max(changes.iter().max().unwrap().clone());
    base["excursion"] = json!({"status":if gap{"observed"}else{"lower_bound"},"basis":"closeable_bid_ask_price; terminal intrabar extrema excluded","mae_price":number(mae.clone())?,"mfe_price":number(mfe.clone())?,"mae_r":original_distance.as_ref().map(|d|number((&mae/d).with_prec(28))).transpose()?,"mfe_r":original_distance.as_ref().map(|d|number((&mfe/d).with_prec(28))).transpose()?,"configured_mae_r":number((&mae/&distance).with_prec(28))?,"configured_mfe_r":number((&mfe/&distance).with_prec(28))?,"r_basis":if original_distance.is_some(){"initial_stop_distance"}else{"unavailable"},"original_stop_price":original_stop.clone().map(number).transpose()?,"initial_risk_distance":original_distance.clone().map(number).transpose()?,"ideal_r":base["ideal"]["value_r"],"excluded_terminal_bar":!gap});
    for (name, stop_only) in [("stop_loss", true), ("risk_reward", false)] {
        let scenario_distance = if stop_only { &distance } else if let Some(distance) = &original_distance { distance } else {
            base[name] = unavailable("original_stop_unavailable");
            continue;
        };
        let stop = (&entry - (&direction * scenario_distance).with_prec(28)).with_prec(28);
        let take = (&entry + ((&direction * scenario_distance).with_prec(28) * dec(config, "target_r")?).with_prec(28)).with_prec(28);
        if stop <= zero || (!stop_only && take <= zero) {
            base[name] = unavailable("configured_bracket_nonpositive");
            continue;
        }
        let limit = if buy {
            let high = path
                .iter()
                .map(|b| dec(b, "high"))
                .collect::<R<Vec<_>>>()?
                .into_iter()
                .max()
                .unwrap();
            ((high + dec(s, "spread_price")?).with_prec(28)
                + dec(&s["instrument_spec"], "tick_size")?)
            .with_prec(28)
        } else {
            (dec(&s["instrument_spec"], "tick_size")? / BigDecimal::from(2)).with_prec(28)
        };
        let mut bracket = position.clone();
        bracket["stop_loss"] = json!(stop.to_string());
        bracket["take_profit"] = json!(if stop_only {
            limit.to_string()
        } else {
            take.to_string()
        });
        let mut chosen = None;
        let mut early = None;
        for (i, b) in path.iter().enumerate() {
            let terminal = i == path.len() - 1;
            let mut b = b.clone();
            if terminal && gap {
                for k in ["high", "low", "close"] {
                    b[k] = b["open"].clone()
                }
            }
            match crate::replay_core::protective(s, &bracket, &b, i > 0) {
                Err(e) if e.contains("intrabar ambiguous") => {
                    early = Some(
                        json!({"status":"ambiguous","reason":"intrabar_order_unknown","net_pnl":null,"exit_price":null}),
                    );
                    break;
                }
                Err(e) => return Err(e),
                Ok(Some((price, reason, at_open))) => {
                    if terminal && !at_open {
                        early = Some(unavailable(
                            "original_exit_precedes_unknown_terminal_extrema",
                        ));
                    } else {
                        chosen = Some((price, reason, start + i));
                    }
                    break;
                }
                Ok(None) => {
                    if terminal && gap {
                        break;
                    }
                }
            }
        }
        if let Some(value) = early {
            base[name] = value;
            continue;
        }
        let (price, reason, cursor) = chosen.unwrap_or((close.clone(), "original_close", end));
        let (_, cost) = pnl(s, &position, &price, &price)?;
        base[name] = json!({"status":"ready","reason":reason,"exit_cursor_index":cursor,"exit_price":number(price)?,"net_pnl":cost["net_account"],"gross_pnl":cost["gross_account"],"cost_model_version":s["cost_model"]["version"],"stop_price":number(stop.clone())?,"target_price":if stop_only{Value::Null}else{number(take.clone())?}});
    }
    Ok(base)
}
