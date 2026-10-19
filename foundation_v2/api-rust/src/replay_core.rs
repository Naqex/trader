//! Pure replay state transitions. No I/O, worker dispatch, or floating point financial arithmetic.
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive, Zero};
use serde_json::{Value, json};
use std::str::FromStr;

#[path = "replay_core/tick.rs"]
mod tick;
#[path = "replay_core/history.rs"]
pub mod history;
#[path = "replay_core/slippage.rs"]
mod slippage;
use history::History;

type R<T> = Result<T, String>;
pub(super) fn zero() -> BigDecimal {
    BigDecimal::zero()
}
pub(super) fn d(v: &Value) -> R<BigDecimal> {
    let raw = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Err("value must be decimal".into()),
    };
    if raw.len() > 512 {
        return Err("decimal input exceeds supported bounds".into());
    }
    let n = BigDecimal::from_str(&raw).map_err(|_| "value must be finite decimal".to_string())?;
    let (_, scale) = n.as_bigint_and_exponent();
    if scale.unsigned_abs() > 512 {
        return Err("decimal exponent exceeds supported bounds".into());
    }
    Ok(n)
}
pub(super) fn dec(v: &Value, k: &str) -> R<BigDecimal> {
    d(&v[k]).map_err(|e| format!("{k}: {e}"))
}
pub(super) fn txt<'a>(v: &'a Value, k: &str) -> R<&'a str> {
    v[k].as_str().ok_or_else(|| format!("{k} must be text"))
}
pub(super) fn int(v: &Value, k: &str) -> R<i64> {
    v[k].as_i64()
        .filter(|x| *x >= 0)
        .ok_or_else(|| format!("{k} must be a nonnegative integer"))
}
pub(super) fn sval(n: BigDecimal) -> Value {
    Value::String(n.to_string())
}
fn positive(v: &Value, k: &str) -> R<BigDecimal> {
    let n = dec(v, k)?;
    if n <= zero() {
        return Err(format!("{k} must be positive"));
    }
    Ok(n)
}
fn opt_dec(v: &Value, k: &str) -> R<Option<BigDecimal>> {
    if v[k].is_null() {
        Ok(None)
    } else {
        Ok(Some(positive(v, k)?))
    }
}
fn bounded(v: &Value, k: &str) -> R<()> {
    let t = txt(v, k)?;
    if t.trim().is_empty() || t.len() > 128 {
        return Err(format!("{k} must be a bounded nonempty identifier"));
    }
    Ok(())
}
fn side(v: &Value) -> R<&str> {
    match txt(v, "side")? {
        "BUY" => Ok("BUY"),
        "SELL" => Ok("SELL"),
        _ => Err("side must be BUY or SELL".into()),
    }
}
fn py(n: BigDecimal) -> BigDecimal {
    n.with_prec(28)
}
fn div(a: BigDecimal, b: BigDecimal) -> BigDecimal {
    py(a / b)
}
fn qty(s: &Value, q: &BigDecimal) -> R<()> {
    let i = &s["instrument_spec"];
    let step = positive(i, "quantity_step")?;
    if q < &positive(i, "quantity_min")? {
        return Err("quantity is below instrument minimum".into());
    }
    if (q.clone() % step) != zero() {
        return Err("quantity does not align with instrument step".into());
    }
    Ok(())
}
fn fresh(s: &Value, id: &str) -> R<()> {
    if id.trim().is_empty() || id.len() > 128 {
        return Err("operation_id must be a bounded nonempty identifier".into());
    }
    if s["ledger"]
        .as_array()
        .ok_or("ledger must be array")?
        .iter()
        .any(|e| {
            ["operation_id", "command_operation_id"]
                .iter()
                .any(|k| e["details"][k].as_str() == Some(id))
        })
    {
        return Err("operation_id was already consumed".into());
    }
    Ok(())
}
fn tick_mode(s: &Value) -> bool {
    s["schema_version"] == "replay-execution-tick-v1"
}
fn v2(s: &Value) -> bool {
    s["schema_version"] != "replay-execution-v1"
}

pub(super) fn quote(s: &Value, mid: &BigDecimal) -> R<(BigDecimal, BigDecimal)> {
    let tick = positive(&s["instrument_spec"], "tick_size")?;
    let spread = dec(s, "spread_price")?;
    if mid <= &zero() || spread < zero() {
        return Err("mid must be positive and spread nonnegative".into());
    }
    if spread == zero() && matches!(s["cost_model"]["version"].as_str(),Some("session-cost-v1" | "session-cost-v2")) {
        return Ok((mid.clone(), mid.clone()));
    }
    let half = div(spread, BigDecimal::from(2));
    let bid = div(mid - &half, tick.clone()).with_scale_round(0, RoundingMode::Floor) * &tick;
    let ask = div(mid + half, tick.clone()).with_scale_round(0, RoundingMode::Ceiling) * tick;
    if bid <= zero() || ask < bid {
        return Err("derived bid/ask quote is invalid".into());
    }
    Ok((bid, ask))
}
pub(super) fn brackets(p: &Value, reference: &BigDecimal) -> R<bool> {
    let sl = opt_dec(p, "stop_loss")?;
    let tp = opt_dec(p, "take_profit")?;
    Ok(if side(p)? == "BUY" {
        sl.as_ref().is_none_or(|x| x < reference) && tp.as_ref().is_none_or(|x| x > reference)
    } else {
        sl.as_ref().is_none_or(|x| x > reference) && tp.as_ref().is_none_or(|x| x < reference)
    })
}
fn number(n: BigDecimal) -> R<Value> {
    let f = n
        .to_f64()
        .filter(|n| n.is_finite())
        .ok_or("cost output exceeds finite JSON number")?;
    Ok(json!(f))
}
pub(super) fn pnl(
    s: &Value,
    p: &Value,
    bid: &BigDecimal,
    ask: &BigDecimal,
) -> R<(BigDecimal, Value)> {
    if bid <= &zero() || ask < bid {
        return Err("ask must be >= positive bid".into());
    }
    let c = &s["cost_model"];
    let units = py(positive(p, "quantity")? * positive(&s["instrument_spec"], "contract_size")?);
    let (entry, exit, gross) = if side(p)? == "BUY" {
        let e = positive(p, if slippage::enabled(s) { "entry_fill" } else { "entry_ask" })?;
        (e.clone(), bid.clone(), py((bid - &e) * &units))
    } else {
        let e = positive(p, if slippage::enabled(s) { "entry_fill" } else { "entry_bid" })?;
        (e.clone(), ask.clone(), py((&e - ask) * &units))
    };
    let rate = positive(c, "quote_to_account_rate")?;
    let account = py(&gross * &rate);
    let slip = py(py(py(dec(c, "slippage_price_per_side")? * BigDecimal::from(2)) * units) * &rate);
    let comm = if matches!(c["version"].as_str(),Some("session-cost-v1" | "session-cost-v2")) {
        let sides = if c["commission_charge"] == "per_side" { 2 } else { 1 };
        py(py(dec(c, "commission_per_lot_account")? * positive(p, "quantity")?) * BigDecimal::from(sides))
    } else {
        std::cmp::max(py(dec(c, "commission_per_side_account")? * BigDecimal::from(2)), dec(c, "minimum_fee_account")?)
    };
    // Legacy fixed fees belong to the original position, not each closing slice.
    let ratio = if p.get("original_quantity").is_some() {
        div(positive(p, "quantity")?, positive(p, "original_quantity")?)
    } else { BigDecimal::from(1) };
    let comm = if matches!(c["version"].as_str(),Some("session-cost-v1" | "session-cost-v2")) { comm } else { py(comm * &ratio) };
    let finance = py(dec(c, "financing_account")? * ratio);
    let net = py(account.clone() - py(py(&comm + &slip) + &finance));
    let places = int(c, "rounding_decimals")?;
    let money = |n: BigDecimal| number(n.with_scale_round(places, RoundingMode::HalfUp));
    let net_json = money(net)?;
    let cost = json!({"cost_model_version":c["version"],"spread_basis":c["spread_basis"],"side":side(p)?,"entry_fill":number(entry)?,"exit_fill":number(exit)?,"gross_quote":number(gross)?,"gross_account":money(account)?,"spread_cost_account":0.0,"commission_account":money(comm)?,"slippage_account":money(slip)?,"financing_account":money(finance)?,"net_account":net_json,"account_ccy":c["account_ccy"],"quote_to_account_rate":number(rate)?,"rounding_decimals":places});
    Ok((d(&cost["net_account"])?, cost))
}

pub(super) fn cost_matches(actual: &Value, expected: &Value) -> bool {
    let (Some(actual), Some(expected)) = (actual.as_object(), expected.as_object()) else {
        return false;
    };
    actual.len() == expected.len() && expected.iter().all(|(key, value)| {
        actual.get(key).is_some_and(|observed| {
            if observed.is_number() && value.is_number() {
                // Python treats signed zero and equivalent JSON number spellings equally.
                matches!((d(observed), d(value)), (Ok(a), Ok(b)) if a == b)
            } else {
                observed == value
            }
        })
    })
}
pub(super) fn margin(s: &Value, o: &Value, fill: &BigDecimal) -> R<(Value, bool)> {
    if !v2(s) {
        return Ok((json!({}), false));
    }
    let m = &s["research_margin"];
    let required = div(
        py(py(
            py(fill * positive(o, "quantity")?) * positive(&s["instrument_spec"], "contract_size")?
        ) * positive(&s["cost_model"], "quote_to_account_rate")?),
        positive(m, "leverage")?,
    );
    let reject = required > positive(s, "starting_balance")?;
    Ok((
        json!({"margin_admission":{"version":m["version"],"leverage":m["leverage"],"required_account":sval(required),"available_account":s["starting_balance"],"submitted_cursor_index":o["submitted_cursor_index"]}}),
        reject,
    ))
}
pub(super) fn position(
    s: &Value,
    o: &Value,
    bid: &BigDecimal,
    ask: &BigDecimal,
    cursor: i64,
    time: i64,
) -> R<Value> {
    let (fill, provenance) = slippage::fill(s,if side(o)? == "BUY" { ask } else { bid },side(o)?,"market",txt(o,"operation_id")?,cursor,time)?;
    let mut p = json!({"position_id":format!("replay-pos-{}",int(s,"event_sequence")?+1),"source_operation_id":o["operation_id"],"side":side(o)?,"quantity":o["quantity"],"entry_bid":sval(bid.clone()),"entry_ask":sval(ask.clone()),"entry_fill":sval(fill),"stop_loss":o["stop_loss"],"take_profit":o["take_profit"],"opened_cursor_index":cursor,"opened_time_utc":time});
    if slippage::enabled(s) { p["entry_slippage"] = provenance; }
    Ok(p)
}
pub(super) fn emit(
    s: &mut Value, kind: &str, cursor: i64, time: i64, fp: BigDecimal, details: Value,
) -> R<()> {
    emit_history(s, &mut History::Full, kind, cursor, time, fp, details)
}
fn emit_history(
    s: &mut Value,
    history: &mut History<'_>,
    kind: &str,
    cursor: i64,
    time: i64,
    fp: BigDecimal,
    details: Value,
) -> R<()> {
    let seq = int(s, "event_sequence")? + 1;
    let bal = dec(s, "balance")?;
    let eq = py(&bal + &fp);
    let mut e = json!({"sequence":seq,"kind":kind,"replay_session_id":s["replay_session_id"],"branch_id":s["branch_id"],"dataset_id":s["dataset_id"],"dataset_sha256":s["dataset_sha256"],"cursor_index":cursor,"virtual_time_utc":time,"balance":sval(bal),"floating_pl":sval(fp.clone()),"equity":sval(eq.clone()),"open_positions":if s["position"].is_null(){0}else{1},"pending_orders":if s["pending_market_order"].is_null(){0}else{1},"evaluation_quality":"full_for_declared_model","details":details});
    if v2(s) {
        e["schema_version"] = json!("replay-execution-event-v2");
    }
    history.append(s, e)?;
    s["event_sequence"] = json!(seq);
    s["floating_pl"] = sval(fp);
    s["equity"] = sval(eq);
    Ok(())
}
fn merge(a: &mut Value, b: Value) {
    if let (Some(a), Some(b)) = (a.as_object_mut(), b.as_object()) {
        a.extend(b.clone());
    }
}
fn coverage(s: &Value, default: &str) -> Value {
    s["ledger"]
        .as_array()
        .and_then(|a| a.iter().rev().find(|e| e["kind"] == "price_mark"))
        .map(|e| {
            e["details"]
                .get("intrabar_equity_coverage")
                .cloned()
                .unwrap_or(json!("insufficient"))
        })
        .unwrap_or(json!(default))
}
fn latest_quote(s: &Value) -> R<Value> {
    s["ledger"]
        .as_array()
        .and_then(|a| a.iter().rev().find(|e| e["details"].get("bid").is_some()))
        .map(|e| e["details"].clone())
        .ok_or("current broker quote is unavailable".into())
}
fn provenance(s: &Value, window: bool) -> R<Value> {
    // Manual actions retain the quote but omit its tick-window boundaries.
    let prior = if window {
        s["ledger"].as_array()
            .and_then(|events| events.iter().rev().find(|event| {
                event["details"].get("bid").is_some()
                    && event["details"].get("window_start_msc").is_some()
            }))
            .map(|event| event["details"].clone())
            .ok_or("current broker quote window is unavailable")?
    } else {
        latest_quote(s)?
    };
    let keys = if window {
        vec![
            "tick_snapshot_id",
            "tick_snapshot_sha256",
            "quote_source",
            "time_msc",
            "sequence",
            "bid",
            "ask",
            "window_start_msc",
            "window_end_msc",
        ]
    } else {
        vec![
            "tick_snapshot_id",
            "tick_snapshot_sha256",
            "quote_source",
            "time_msc",
            "sequence",
            "bid",
            "ask",
        ]
    };
    let mut out = json!({});
    for k in keys {
        out[k] = prior
            .get(k)
            .ok_or("broker quote provenance is incomplete")?
            .clone();
    }
    Ok(out)
}

fn validate_session_cost(c: &Value) -> R<()> {
    if !matches!(c["version"].as_str(),Some("session-cost-v1" | "session-cost-v2")) {
        if !c["commission_per_lot_account"].is_null() || !c["commission_charge"].is_null() {
            return Err("per-lot commission requires session-cost-v1".into());
        }
        return Ok(());
    }
    if !["round_trip", "per_side"].contains(&c["commission_charge"].as_str().unwrap_or(""))
        || dec(c, "commission_per_lot_account")? < zero()
        || dec(c, "commission_per_side_account")? != zero()
        || dec(c, "minimum_fee_account")? != zero()
        || dec(c, "financing_account")? != zero() {
        return Err("invalid session commission configuration; legacy fees cannot be combined".into());
    }
    Ok(())
}

fn initialize(a: &Value) -> R<Value> {
    let mut i = a["instrument_spec"].clone();
    let mut c = a["cost_model"].clone();
    i.as_object_mut()
        .ok_or("instrument_spec must be structured")?
        .retain(|k, _| {
            [
                "instrument_id",
                "asset_class",
                "base_ccy",
                "quote_ccy",
                "account_ccy",
                "tick_size",
                "pip_size",
                "contract_size",
                "quantity_min",
                "quantity_step",
                "effective_from_utc",
                "effective_to_utc",
            ]
            .contains(&k.as_str())
        });
    c.as_object_mut()
        .ok_or("cost_model must be structured")?
        .retain(|k, _| {
            [
                "version",
                "spread_basis",
                "commission_per_side_account",
                "commission_per_lot_account",
                "commission_charge",
                "minimum_fee_account",
                "slippage_price_per_side",
                "slippage_model",
                "financing_account",
                "quote_to_account_rate",
                "account_ccy",
                "rounding_decimals",
            ]
            .contains(&k.as_str())
        });
    for k in [
        "instrument_id",
        "asset_class",
        "base_ccy",
        "quote_ccy",
        "account_ccy",
        "effective_from_utc",
    ] {
        let text = txt(&i, k)?.trim();
        if text.is_empty() {
            return Err(format!("{k} is required"));
        }
        i[k] = json!(if ["base_ccy", "quote_ccy", "account_ccy"].contains(&k) {
            text.to_uppercase()
        } else {
            text.to_owned()
        });
    }
    for k in [
        "tick_size",
        "pip_size",
        "contract_size",
        "quantity_min",
        "quantity_step",
    ] {
        i[k] = sval(positive(&i, k)?);
    }
    i["effective_to_utc"] = json!(i["effective_to_utc"].as_str().unwrap_or("").trim());
    for k in ["version", "account_ccy", "spread_basis"] {
        let t = txt(&c, k)?.trim();
        if t.is_empty() {
            return Err(format!("{k} is required"));
        }
        c[k] = json!(if k == "account_ccy" {
            t.to_uppercase()
        } else {
            t.to_owned()
        });
    }
    if c["spread_basis"] != "bid_ask_embedded" {
        return Err("spread_basis must be bid_ask_embedded".into());
    }
    for (k, default) in [
        ("commission_per_side_account", "0"),
        ("minimum_fee_account", "0"),
        ("slippage_price_per_side", "0"),
        ("financing_account", "0"),
        ("quote_to_account_rate", "1"),
    ] {
        if c[k].is_null() {
            c[k] = json!(default);
        }
        let n = dec(&c, k)?;
        if (k == "quote_to_account_rate" && n <= zero()) || (k != "financing_account" && n < zero())
        {
            return Err(format!("invalid {k}"));
        }
        c[k] = sval(n);
    }
    if c["rounding_decimals"].is_null() {
        c["rounding_decimals"] = json!(2);
    }
    if int(&c, "rounding_decimals")? > 8 {
        return Err("rounding_decimals must be between 0 and 8".into());
    }
    if i["account_ccy"] != c["account_ccy"] {
        return Err("instrument and cost model account currency mismatch".into());
    }
    validate_session_cost(&c)?;
    let balance = positive(a, "starting_balance")?;
    let spread = dec(a, "spread_price")?;
    if spread < zero() {
        return Err("spread_price must be nonnegative".into());
    }
    if int(a, "timeframe_seconds")? == 0 {
        return Err("timeframe_seconds must be positive".into());
    }
    let mut s = json!({"schema_version":"replay-execution-v1","replay_session_id":a["replay_session_id"],"branch_id":a["branch_id"],"dataset_id":a["dataset_id"],"dataset_sha256":a["dataset_sha256"],"instrument_spec":i,"cost_model":c,"spread_price":sval(spread),"timeframe_seconds":int(a,"timeframe_seconds")?,"starting_balance":sval(balance.clone()),"phase_index":1,"phase_initial_balance":sval(balance.clone()),"balance":sval(balance.clone()),"floating_pl":"0","equity":sval(balance),"cursor_index":int(a,"cursor_index")?,"event_sequence":0,"pending_market_order":null,"position":null,"ledger":[],"evaluation_quality":"full_for_declared_model"});
    if !a["research_margin"].is_null() {
        s["schema_version"] = json!("replay-execution-v2");
        s["research_margin"] = a["research_margin"].clone();
        s["research_margin"]["leverage"] = sval(positive(&a["research_margin"], "leverage")?);
    }
    if !a["tick_snapshot_id"].is_null() {
        if slippage::enabled(&s) { return Err("session fill slippage cannot be mixed with tick execution".into()); }
        if !v2(&s) {
            return Err("tick execution requires research_margin".into());
        }
        s["schema_version"] = json!("replay-execution-tick-v1");
        s["tick_snapshot_id"] = a["tick_snapshot_id"].clone();
        s["tick_snapshot_sha256"] = a["tick_snapshot_sha256"].clone();
        s["quote_source"] = json!("broker_bid_ask");
        s["last_bid"] = Value::Null;
        s["last_ask"] = Value::Null;
    }
    slippage::validate_model(&s)?;
    Ok(s)
}
#[cfg(test)]
fn queue(s: &mut Value, a: &Value) -> R<()> {
    queue_history(s, a, &mut History::Full)
}
fn queue_history(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    if !s["position"].is_null() || !s["pending_market_order"].is_null() {
        return Err("initial replay execution core supports one active or queued position".into());
    }
    let id = txt(a, "operation_id")?;
    history.fresh(s, id)?;
    let q = positive(a, "quantity")?;
    qty(s, &q)?;
    s["pending_market_order"] = json!({"operation_id":id,"side":side(a)?,"quantity":sval(q),"stop_loss":opt_dec(a,"stop_loss")?.map(sval),"take_profit":opt_dec(a,"take_profit")?.map(sval),"submitted_cursor_index":s["cursor_index"]});
    Ok(())
}
fn fill(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    let o = s["pending_market_order"].clone();
    let cursor = int(s, "cursor_index")?;
    let time = int(a, "virtual_time_utc")?;
    if o.is_null() || !s["position"].is_null() || int(&o, "submitted_cursor_index")? != cursor {
        return Err("current-quote fill requires a newly submitted market order".into());
    }
    canonical_time_history(
        s,
        history,
        time,
        "current quote must retain the canonical checkpoint time",
    )?;
    let mid = positive(a, "mid_close")?;
    let (bid, ask) = if tick_mode(s) {
        latest_quote(s)?;
        (positive(s, "last_bid")?, positive(s, "last_ask")?)
    } else {
        quote(s, &mid)?
    };
    let is_buy = side(&o)? == "BUY";
    if !brackets(&o, if is_buy { &bid } else { &ask })? {
        return Err("protection must bracket the current closeable quote".into());
    }
    let (fill, slip) = slippage::fill(s,if is_buy { &ask } else { &bid },side(&o)?,"market",txt(&o,"operation_id")?,cursor,time)?;
    let (m, rejected) = margin(s, &o, &fill)?;
    let mut details = json!({"operation_id":o["operation_id"],"side":o["side"],"quantity":o["quantity"],"fill_price":sval(fill.clone()),"execution_timing":"current_quote","mid_close":sval(mid),"bid_close":sval(bid.clone()),"ask_close":sval(ask.clone()),"quote_mid_close":sval(div(&bid+&ask,BigDecimal::from(2)))});
    if slippage::enabled(s) { details["fill_slippage"] = slip; }
    merge(&mut details, m);
    if tick_mode(s) {
        merge(&mut details, provenance(s, true)?);
    }
    let mut fp = zero();
    s["pending_market_order"] = Value::Null;
    if rejected {
        details["reason"] = json!("insufficient_research_margin");
    } else {
        s["position"] = position(s, &o, &bid, &ask, cursor, time)?;
        fp = pnl(s, &s["position"], &bid, &ask)?.0;
        details["position_id"] = s["position"]["position_id"].clone();
    }
    details["open_position"] = s["position"].clone();
    details["pending_market_order"] = Value::Null;
    details["intrabar_equity_coverage"] = history.coverage(s, "complete");
    emit_history(
        s,
        history,
        if rejected {
            "order_rejected"
        } else {
            "market_fill"
        },
        cursor,
        time,
        fp.clone(),
        details.clone(),
    )?;
    emit_history(s, history, "price_mark", cursor, time, fp, details)
}
fn canonical_time_history(s: &Value, history: &History<'_>, time: i64, error: &str) -> R<()> {
    if let Some(last) = history.last_event(s) {
        if int(last, "virtual_time_utc")? != time {
            return Err(error.into());
        }
    }
    Ok(())
}
fn active(s: &Value, a: &Value, history: &History<'_>) -> R<Value> {
    let p = if !s["position"].is_null() {
        &s["position"]
    } else {
        &s["pending_market_order"]
    };
    if p.is_null() {
        return Err("there is no active replay order or position".into());
    }
    let key = if !s["position"].is_null() {
        "position_id"
    } else {
        "operation_id"
    };
    if a["target_id"] != p[key] {
        return Err("target no longer matches the active replay order".into());
    }
    let id = txt(a, "operation_id")?;
    history.fresh(s, id)?;
    let source = if key == "position_id" {
        "source_operation_id"
    } else {
        "operation_id"
    };
    if p[source] == id {
        return Err("operation_id was already consumed".into());
    }
    Ok(p.clone())
}
fn protect(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    let mut p = active(s, a, history)?;
    let mid = positive(a, "mid_close")?;
    let time = int(a, "virtual_time_utc")?;
    let is_position = !s["position"].is_null();
    let reference = if tick_mode(s) {
        canonical_time_history(
            s,
            history,
            time,
            "protection amendment must stay at the current canonical checkpoint",
        )?;
        if side(&p)? == "BUY" {
            positive(s, "last_bid")?
        } else {
            positive(s, "last_ask")?
        }
    } else if is_position {
        let (bid, ask) = quote(s, &mid)?;
        if side(&p)? == "BUY" { bid } else { ask }
    } else {
        mid.clone()
    };
    let previous_stop = p["stop_loss"].clone();
    let previous_take = p["take_profit"].clone();
    p["stop_loss"] = opt_dec(a, "stop_loss")?.map(sval).unwrap_or(Value::Null);
    p["take_profit"] = opt_dec(a, "take_profit")?.map(sval).unwrap_or(Value::Null);
    if !brackets(&p, &reference)? {
        return Err("protection must bracket the current closeable quote".into());
    }
    let mut details = json!({"operation_id":a["operation_id"],"target_id":a["target_id"],"previous_stop_loss":previous_stop,"previous_take_profit":previous_take,"mid_close":a["mid_close"],"closeable_quote":sval(reference)});
    details["mid_close"] = sval(mid);
    if tick_mode(s) {
        merge(&mut details, provenance(s, false)?);
    }
    s[if is_position {
        "position"
    } else {
        "pending_market_order"
    }] = p;
    details["open_position"] = s["position"].clone();
    details["pending_market_order"] = s["pending_market_order"].clone();
    emit_history(
        s,
        history,
        "protection_change",
        int(s, "cursor_index")?,
        time,
        dec(s, "floating_pl")?,
        details,
    )
}
fn close(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    let p = active(s, a, history)?;
    let time = int(a, "virtual_time_utc")?;
    canonical_time_history(
        s,
        history,
        time,
        "close must stay at the current canonical checkpoint",
    )?;
    let is_position = !s["position"].is_null();
    let source = &p[if is_position {
        "source_operation_id"
    } else {
        "operation_id"
    }];
    let mut details = json!({"command_operation_id":a["operation_id"],"target_id":a["target_id"],"operation_id":source,"previous_balance":s["balance"],"net_pnl":"0","mid_close":sval(positive(a,"mid_close")?),"open_position":null,"pending_market_order":null,"intrabar_equity_coverage":history.coverage(s,if is_position{"insufficient"}else{"complete"})});
    let mut realized = zero();
    let mut floating = zero();
    let mut remaining = Value::Null;
    if is_position {
        let original = p.get("original_quantity").cloned().unwrap_or_else(|| p["quantity"].clone());
        let requested = if a["quantity"].is_null() { positive(&p,"quantity")? } else { positive(a,"quantity")? };
        let residual = positive(&p,"quantity")? - &requested;
        qty(s,&requested)?;
        if residual < zero() { return Err("close quantity exceeds remaining position".into()); }
        if residual > zero() { qty(s,&residual)?; }
        let mut closing = p.clone();
        closing["quantity"] = sval(requested);
        if residual > zero() || p.get("original_quantity").is_some() {
            closing["original_quantity"] = original.clone();
        }
        let (bid, ask) = if tick_mode(s) {
            (positive(s, "last_bid")?, positive(s, "last_ask")?)
        } else {
            let prior = history.last_event(s)
                .ok_or("manual close requires a canonical checkpoint")?;
            if dec(a, "mid_close")? != dec(&prior["details"], "mid_close")? {
                return Err("manual close must use the canonical checkpoint mid".into());
            }
            quote(s, &positive(a, "mid_close")?)?
        };
        let closing_side = if side(&p)? == "BUY" { "SELL" } else { "BUY" };
        let (executed, slip) = slippage::fill(s,if closing_side == "SELL" { &bid } else { &ask },closing_side,"market",txt(a,"operation_id")?,int(s,"cursor_index")?,time)?;
        let (net, cost) = if slippage::enabled(s) { pnl(s,&closing,&executed,&executed)? } else { pnl(s,&closing,&bid,&ask)? };
        if slippage::enabled(s) { details["fill_slippage"] = slip; }
        realized = net;
        merge(
            &mut details,
            json!({"position_id":p["position_id"],"side":p["side"],"quantity":closing["quantity"],"reason":"manual_close","fill_price":sval(executed),"bid_close":sval(bid.clone()),"ask_close":sval(ask.clone()),"net_pnl":sval(realized.clone()),"cost_model_version":cost["cost_model_version"],"cost_breakdown":cost,"closed_position":closing}),
        );
        if residual > zero() {
            remaining = p.clone();
            remaining["quantity"] = sval(residual);
            remaining["original_quantity"] = original;
            remaining["realized_pnl"] = sval(py(p.get("realized_pnl").map(d).transpose()?.unwrap_or_else(zero) + &realized));
            floating = pnl(s,&remaining,&bid,&ask)?.0;
            details["previous_position"] = p;
            details["open_position"] = remaining.clone();
        }
    } else {
        if !a["quantity"].is_null() { return Err("quantity is only valid for an open position".into()); }
        details["cancelled_order"] = p;
    }
    if tick_mode(s) {
        merge(&mut details, provenance(s, false)?);
    }
    s["balance"] = sval(py(dec(s, "balance")? + realized));
    s["position"] = remaining;
    s["pending_market_order"] = Value::Null;
    emit_history(
        s,
        history,
        if is_position {
            "manual_close"
        } else {
            "order_cancel"
        },
        int(s, "cursor_index")?,
        time,
        floating,
        details,
    )
}
pub(crate) fn bar_valid(b: &Value) -> R<()> {
    let o = positive(b, "open")?;
    let h = positive(b, "high")?;
    let l = positive(b, "low")?;
    let c = positive(b, "close")?;
    if l > std::cmp::min(o.clone(), c.clone()) || h < std::cmp::max(o, c) {
        return Err("invalid OHLC bar".into());
    }
    Ok(())
}
pub(crate) fn protective(
    s: &Value,
    p: &Value,
    b: &Value,
    gap: bool,
) -> R<Option<(BigDecimal, &'static str, bool)>> {
    let stop = opt_dec(p, "stop_loss")?;
    let take = opt_dec(p, "take_profit")?;
    let buy = side(p)? == "BUY";
    if let (Some(sl), Some(tp)) = (&stop, &take) {
        if (buy && sl >= tp) || (!buy && tp >= sl) {
            return Err("invalid protective stop/take ordering".into());
        }
    }
    let (bid, ask) = quote(s, &positive(b, "open")?)?;
    let open = if buy { bid } else { ask };
    if gap {
        if let Some(sl) = &stop {
            if (buy && open <= *sl) || (!buy && open >= *sl) {
                return Ok(Some((open, "stop_loss_gap", true)));
            }
        }
        if let Some(tp) = &take {
            if (buy && open >= *tp) || (!buy && open <= *tp) {
                return Ok(Some((tp.clone(), "take_profit_gap", true)));
            }
        }
    }
    let (lb, la) = quote(s, &positive(b, "low")?)?;
    let (hb, ha) = quote(s, &positive(b, "high")?)?;
    let sl = stop
        .as_ref()
        .is_some_and(|x| if buy { lb <= *x } else { ha >= *x });
    let tp = take
        .as_ref()
        .is_some_and(|x| if buy { hb >= *x } else { la <= *x });
    if sl && tp {
        return Err(
            "protective exit is intrabar ambiguous; lower-timeframe ordering required".into(),
        );
    }
    Ok(if sl {
        Some((stop.unwrap(), "stop_loss", false))
    } else if tp {
        Some((take.unwrap(), "take_profit", false))
    } else {
        None
    })
}
fn advance(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    let cursor = int(a, "cursor_index")?;
    if cursor != int(s, "cursor_index")? + 1 {
        return Err("execution cursor must advance exactly one bar".into());
    }
    let b = &a["bar"];
    bar_valid(b)?;
    let time = int(b, "timestamp")?;
    let end = time + int(s, "timeframe_seconds")?;
    let (mut opened, mut exposure) = (false, !s["position"].is_null());
    let (open_bid, open_ask) = quote(s, &positive(b, "open")?)?;
    if !s["pending_market_order"].is_null() {
        let o = s["pending_market_order"].clone();
        let base_fill = if side(&o)? == "BUY" {
            &open_ask
        } else {
            &open_bid
        };
        if !brackets(&o, base_fill)? {
            return Err(if side(&o)? == "BUY" {
                "BUY bracket must satisfy stop < fill < take-profit"
            } else {
                "SELL bracket must satisfy take-profit < fill < stop"
            }
            .into());
        }
        let (fill, slip) = slippage::fill(s,base_fill,side(&o)?,"market",txt(&o,"operation_id")?,cursor,time)?;
        let (m, rejected) = margin(s, &o, &fill)?;
        let mut details = json!({"operation_id":o["operation_id"],"side":o["side"],"quantity":o["quantity"],"fill_price":sval(fill.clone())});
        if slippage::enabled(s) {
            details["fill_slippage"] = slip;
            details["bid_open"] = sval(open_bid.clone()); details["ask_open"] = sval(open_ask.clone());
        }
        merge(&mut details, m);
        s["pending_market_order"] = Value::Null;
        let fp = if rejected {
            details["reason"] = json!("insufficient_research_margin");
            zero()
        } else {
            s["position"] = position(s, &o, &open_bid, &open_ask, cursor, time)?;
            if slippage::enabled(s) { details["open_position"] = s["position"].clone(); }
            details["position_id"] = s["position"]["position_id"].clone();
            opened = true;
            exposure = true;
            pnl(s, &s["position"], &open_bid, &open_ask)?.0
        };
        emit_history(
            s,
            history,
            if rejected {
                "order_rejected"
            } else {
                "market_fill"
            },
            cursor,
            time,
            fp,
            details,
        )?;
    }
    if !s["position"].is_null() {
        if let Some((base_exit, reason, at_open)) = protective(s, &s["position"], b, !opened)? {
            let p = s["position"].clone();
            let exit_time = if at_open { time } else { end };
            let closing_side = if side(&p)? == "BUY" { "SELL" } else { "BUY" };
            let kind = if reason.starts_with("stop_loss") { "stop" } else { "limit" };
            let (exit, slip) = slippage::fill(s,&base_exit,closing_side,kind,txt(&p,"source_operation_id")?,cursor,exit_time)?;
            let (net, cost) = pnl(s, &p, &exit, &exit)?;
            let previous_balance = s["balance"].clone();
            s["balance"] = sval(py(dec(s, "balance")? + &net));
            s["position"] = Value::Null;
            let mut details = json!({"operation_id":p["source_operation_id"],"position_id":p["position_id"],"reason":reason,"fill_price":sval(exit),"net_pnl":sval(net),"cost_model_version":cost["cost_model_version"]});
            if slippage::enabled(s) {
                details["fill_slippage"] = slip; details["closed_position"] = p;
                details["previous_balance"] = previous_balance; details["cost_breakdown"] = cost;
            }
            emit_history(
                s,
                history,
                "protective_fill",
                cursor,
                exit_time,
                zero(),
                details,
            )?;
        }
    }
    let fp = if s["position"].is_null() {
        zero()
    } else {
        let (bid, ask) = quote(s, &positive(b, "close")?)?;
        pnl(s, &s["position"], &bid, &ask)?.0
    };
    let details = json!({"mid_close":sval(positive(b,"close")?),"intrabar_equity_coverage":if exposure{"insufficient"}else{"complete"},"open_position":s["position"],"pending_market_order":s["pending_market_order"]});
    emit_history(s, history, "price_mark", cursor, end, fp, details)?;
    s["cursor_index"] = json!(cursor);
    s["evaluation_quality"] = json!("full_for_declared_model");
    Ok(())
}

fn reconstruct(s: &mut Value, a: &Value) -> R<()> {
    let cursor = int(a, "cursor_index")?;
    if cursor > int(s, "cursor_index")? {
        return Err("checkpoint cursor cannot exceed the replay execution cursor".into());
    }
    let seq = if a["event_sequence"].is_null() {
        None
    } else {
        Some(int(a, "event_sequence")?)
    };
    if seq.is_some_and(|x| x > int(s, "event_sequence").unwrap_or(-1)) {
        return Err("checkpoint event_sequence is outside the canonical ledger".into());
    }
    if cursor == int(s, "cursor_index")? && seq.is_none() {
        return Ok(());
    }
    let mut prefix = vec![];
    let mut chosen = None;
    let mut phase = 1;
    let mut initial = s["starting_balance"].clone();
    for e in s["ledger"].as_array().unwrap() {
        if int(e, "cursor_index")? > cursor
            || seq.is_some_and(|x| int(e, "sequence").unwrap_or(i64::MAX) > x)
        {
            break;
        }
        prefix.push(e.clone());
        if e["kind"] == "phase_transition" {
            if int(&e["details"], "from_phase_index")? != phase
                || int(&e["details"], "to_phase_index")? != phase + 1
            {
                return Err("replay phase-transition ledger is inconsistent".into());
            }
            phase += 1;
            initial = sval(positive(&e["details"], "next_phase_initial_balance")?);
        }
        if [
            "price_mark",
            "phase_transition",
            "protection_change",
            "manual_close",
            "order_cancel",
        ]
        .contains(&txt(e, "kind")?)
            && int(e, "cursor_index")? == cursor
            && seq.is_none_or(|x| e["sequence"].as_i64() == Some(x))
        {
            chosen = Some(e.clone());
        }
    }
    let e = chosen.ok_or("execution branch cursor has no canonical checkpoint")?;
    s["phase_index"] = json!(phase);
    s["phase_initial_balance"] = initial;
    for k in ["balance", "floating_pl", "equity"] {
        s[k] = e[k].clone();
    }
    s["cursor_index"] = json!(cursor);
    s["event_sequence"] = e["sequence"].clone();
    s["position"] = e["details"]["open_position"].clone();
    s["pending_market_order"] = e["details"]["pending_market_order"].clone();
    s["ledger"] = json!(prefix);
    if tick_mode(s) {
        let quote = latest_quote(s)?;
        s["last_bid"] = quote["bid"].clone();
        s["last_ask"] = quote["ask"].clone();
    }
    Ok(())
}
fn fork(s: &mut Value, a: &Value) -> R<()> {
    bounded(a, "replay_session_id")?;
    bounded(a, "branch_id")?;
    s["replay_session_id"] = a["replay_session_id"].clone();
    s["branch_id"] = a["branch_id"].clone();
    for e in s["ledger"].as_array_mut().unwrap() {
        e["replay_session_id"] = a["replay_session_id"].clone();
        e["branch_id"] = a["branch_id"].clone();
    }
    Ok(())
}
fn transition(s: &mut Value, a: &Value) -> R<()> {
    if !s["pending_market_order"].is_null() {
        return Err("phase transition requires zero pending replay orders".into());
    }
    let from = int(a, "from_phase_index")?;
    let to = int(a, "to_phase_index")?;
    if int(s, "phase_index")? != from {
        return Err("replay phase transition does not match the canonical replay phase".into());
    }
    if to != from + 1 {
        return Err("replay phase transition must advance exactly one phase".into());
    }
    let carry = txt(a, "carry_policy")?;
    let policy = txt(a, "position_policy")?;
    if !["reset", "carry_balance", "carry_all"].contains(&carry)
        || !["must_be_flat", "carry", "close_by_simulator"].contains(&policy)
    {
        return Err("unknown phase carry or position policy".into());
    }
    if !s["position"].is_null() {
        if policy == "close_by_simulator" {
            return Err(
                "close_by_simulator with an open replay position is not supported yet".into(),
            );
        }
        if carry != "carry_all" || policy != "carry" {
            return Err(
                "open replay position is incompatible with the frozen phase carry policy".into(),
            );
        }
    }
    let initial = positive(a, "next_phase_initial_balance")?;
    let bal = if carry == "reset" {
        initial.clone()
    } else {
        dec(s, "balance")?
    };
    let fp = if carry == "carry_all" {
        dec(s, "floating_pl")?
    } else {
        zero()
    };
    let details = json!({"intent_id":a["intent_id"],"intent_fingerprint":a["intent_fingerprint"],"from_phase_index":from,"to_phase_index":to,"carry_policy":carry,"position_policy":policy,"next_phase_initial_balance":sval(initial.clone()),"from_balance":s["balance"],"from_floating_pl":s["floating_pl"],"from_equity":s["equity"],"to_balance":sval(bal.clone()),"to_floating_pl":sval(fp.clone()),"to_equity":sval(py(&bal+&fp)),"open_position":s["position"]});
    s["balance"] = sval(bal);
    emit(
        s,
        "phase_transition",
        int(s, "cursor_index")?,
        int(a, "virtual_time_utc")?,
        fp,
        details,
    )?;
    s["phase_index"] = json!(to);
    s["phase_initial_balance"] = sval(initial);
    Ok(())
}
fn strict(v: &Value, keys: &[&str]) -> R<()> {
    let map = v.as_object().ok_or("structured object required")?;
    for k in map.keys() {
        if !keys.contains(&k.as_str()) {
            return Err(format!("unexpected field: {k}"));
        }
    }
    Ok(())
}
fn order_valid(p: &Value, position: bool) -> R<()> {
    if p.is_null() {
        return Ok(());
    }
    let keys = if position {
        vec![
            "position_id",
            "source_operation_id",
            "side",
            "quantity",
            "entry_bid",
            "entry_ask",
            "entry_fill",
            "stop_loss",
            "take_profit",
            "opened_cursor_index",
            "opened_time_utc",
            "entry_slippage",
            "original_quantity",
            "realized_pnl",
        ]
    } else {
        vec![
            "operation_id",
            "side",
            "quantity",
            "stop_loss",
            "take_profit",
            "submitted_cursor_index",
        ]
    };
    strict(p, &keys)?;
    side(p)?;
    positive(p, "quantity")?;
    if p.get("original_quantity").is_some() && positive(p,"original_quantity")? < positive(p,"quantity")? {
        return Err("original quantity is below remaining quantity".into());
    }
    if p.get("realized_pnl").is_some() { dec(p,"realized_pnl")?; }
    opt_dec(p, "stop_loss")?;
    opt_dec(p, "take_profit")?;
    if position {
        bounded(p, "position_id")?;
        bounded(p, "source_operation_id")?;
        for k in ["entry_bid", "entry_ask", "entry_fill"] {
            positive(p, k)?;
        }
        int(p, "opened_cursor_index")?;
        int(p, "opened_time_utc")?;
    } else {
        bounded(p, "operation_id")?;
        int(p, "submitted_cursor_index")?;
    }
    Ok(())
}
fn validate_head(s: &Value) -> R<()> {
    let version = txt(s, "schema_version")?;
    if ![
        "replay-execution-v1",
        "replay-execution-v2",
        "replay-execution-tick-v1",
    ]
    .contains(&version)
    {
        return Err("unsupported replay execution snapshot version".into());
    }
    let mut fields = vec![
        "schema_version",
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
        "instrument_spec",
        "cost_model",
        "spread_price",
        "timeframe_seconds",
        "starting_balance",
        "phase_index",
        "phase_initial_balance",
        "balance",
        "floating_pl",
        "equity",
        "cursor_index",
        "event_sequence",
        "pending_market_order",
        "position",
        "evaluation_quality",
    ];
    if s.get("ledger").is_some() { fields.push("ledger"); }
    if v2(s) {
        fields.push("research_margin");
    }
    if tick_mode(s) {
        fields.extend([
            "tick_snapshot_id",
            "tick_snapshot_sha256",
            "quote_source",
            "last_bid",
            "last_ask",
        ]);
    }
    strict(s, &fields)?;
    for k in ["replay_session_id", "branch_id", "dataset_id"] {
        bounded(s, k)?;
    }
    let hash = txt(s, "dataset_sha256")?;
    if hash.len() < 8 || hash.len() > 128 {
        return Err("dataset_sha256 must have 8 to 128 characters".into());
    }
    let i = &s["instrument_spec"];
    let c = &s["cost_model"];
    for k in [
        "tick_size",
        "pip_size",
        "contract_size",
        "quantity_min",
        "quantity_step",
    ] {
        positive(i, k)?;
    }
    for k in [
        "instrument_id",
        "asset_class",
        "base_ccy",
        "quote_ccy",
        "account_ccy",
        "effective_from_utc",
    ] {
        if txt(i, k)?.trim().is_empty() {
            return Err(format!("{k} is required"));
        }
    }
    if c["spread_basis"] != "bid_ask_embedded" || c["account_ccy"] != i["account_ccy"] {
        return Err("cost basis/currency mismatch".into());
    }
    if txt(c, "version")?.is_empty() {
        return Err("cost model version is required".into());
    }
    validate_session_cost(c)?;
    positive(c, "quote_to_account_rate")?;
    dec(c, "financing_account")?;
    for k in [
        "commission_per_side_account",
        "minimum_fee_account",
        "slippage_price_per_side",
    ] {
        if dec(c, k)? < zero() {
            return Err(format!("{k} must be nonnegative"));
        }
    }
    if int(c, "rounding_decimals")? > 8 {
        return Err("rounding_decimals must be between 0 and 8".into());
    }
    if dec(s, "spread_price")? < zero() {
        return Err("spread_price must be nonnegative".into());
    }
    positive(s, "starting_balance")?;
    if !s["phase_initial_balance"].is_null() {
        positive(s, "phase_initial_balance")?;
    }
    if int(s, "timeframe_seconds")? == 0 || int(s, "phase_index")? == 0 {
        return Err("timeframe and phase index must be positive".into());
    }
    int(s, "cursor_index")?;
    int(s, "event_sequence")?;
    if dec(s, "equity")? != py(dec(s, "balance")? + dec(s, "floating_pl")?) {
        return Err("equity must equal balance plus floating_pl".into());
    }
    if !["full_for_declared_model", "insufficient"].contains(&txt(s, "evaluation_quality")?) {
        return Err("invalid evaluation quality".into());
    }
    order_valid(&s["position"], true)?;
    slippage::validate_model(s)?;
    slippage::validate_position(s,&s["position"])?;
    order_valid(&s["pending_market_order"], false)?;
    if v2(s) {
        let m = &s["research_margin"];
        strict(m, &["version", "leverage"])?;
        if m["version"] != "fixed-starting-balance-leverage-v1" {
            return Err("unsupported research margin version".into());
        }
        let lev = positive(m, "leverage")?;
        if lev < BigDecimal::from(1) || lev > BigDecimal::from(1000) {
            return Err("research leverage must be between 1 and 1000".into());
        }
    }
    Ok(())
}
pub fn validate(s: &Value) -> R<()> {
    validate_head(s)?;
    let cursor = int(s, "cursor_index")?;
    let sequence = int(s, "event_sequence")?;
    let ledger = s["ledger"].as_array().ok_or("ledger must be array")?;
    if sequence as usize != ledger.len() {
        return Err("replay execution ledger length does not match event_sequence".into());
    }
    for (n, e) in ledger.iter().enumerate() {
        if int(e, "sequence")? != n as i64 + 1 {
            return Err("replay execution ledger sequence is not contiguous".into());
        }
        for k in [
            "replay_session_id",
            "branch_id",
            "dataset_id",
            "dataset_sha256",
        ] {
            if e[k] != s[k] {
                return Err("replay execution ledger lineage is inconsistent".into());
            }
        }
        if int(e, "cursor_index")? > cursor {
            return Err("replay execution ledger cursor exceeds the snapshot cursor".into());
        }
        int(e, "virtual_time_utc")?;
        if dec(e, "equity")? != py(dec(e, "balance")? + dec(e, "floating_pl")?) {
            return Err("event equity must equal balance plus floating_pl".into());
        }
        if int(e, "open_positions")? > 1 || int(e, "pending_orders")? > 1 {
            return Err("invalid event position count".into());
        }
        if v2(s) && e["schema_version"] != "replay-execution-event-v2" {
            return Err("v2 replay requires explicitly versioned v2 events".into());
        }
        validate_event(s, e)?;
    }
    if tick_mode(s) {
        tick::validate(s)?;
    }
    Ok(())
}
pub fn validate_event(s: &Value, e: &Value) -> R<()> {
    validate_event_with_previous(s, e, preceding_event(s, e))
}
pub(crate) fn validate_event_with_previous(s: &Value, e: &Value, previous: Option<&Value>) -> R<()> {
    let mut fields = vec![
        "sequence",
        "kind",
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
        "cursor_index",
        "virtual_time_utc",
        "balance",
        "floating_pl",
        "equity",
        "open_positions",
        "pending_orders",
        "evaluation_quality",
        "details",
    ];
    if v2(s) {
        fields.push("schema_version");
    }
    strict(e, &fields)?;
    if int(e, "sequence")? == 0
        || int(e, "open_positions")? > 1
        || int(e, "pending_orders")? > 1
        || e["evaluation_quality"] != "full_for_declared_model"
    {
        return Err("invalid execution event counts or evaluation quality".into());
    }
    int(e, "cursor_index")?;
    int(e, "virtual_time_utc")?;
    for k in ["replay_session_id", "branch_id", "dataset_id"] {
        bounded(e, k)?;
    }
    if !e["details"].is_object() {
        return Err("event details must be structured".into());
    }
    if dec(e, "equity")? != py(dec(e, "balance")? + dec(e, "floating_pl")?) {
        return Err("event equity must equal balance plus floating_pl".into());
    }
    let kind = txt(e, "kind")?;
    let d = &e["details"];
    if kind == "market_fill" && (d["open_position"].get("original_quantity").is_some()
        || d["open_position"].get("realized_pnl").is_some()) {
        return Err("opening fill cannot contain partial-close accounting".into());
    }
    if ![
        "market_fill",
        "order_rejected",
        "protective_fill",
        "price_mark",
        "phase_transition",
        "protection_change",
        "manual_close",
        "order_cancel",
    ]
    .contains(&kind)
        || (!v2(s) && kind == "order_rejected")
    {
        return Err("unsupported replay event kind".into());
    }
    let current = d["execution_timing"] == "current_quote";
    if current {
        if kind == "price_mark" {
            let prev = previous
                .ok_or("current quote mark lacks immediate fill checkpoint")?;
            if !["market_fill", "order_rejected"].contains(&txt(prev, "kind")?)
                || prev["details"] != *d
                || [
                    "cursor_index",
                    "virtual_time_utc",
                    "balance",
                    "floating_pl",
                    "equity",
                    "open_positions",
                    "pending_orders",
                ]
                .iter()
                .any(|k| prev[k] != e[k])
            {
                return Err("current quote mark differs from its immediate fill checkpoint".into());
            }
        } else if ["market_fill", "order_rejected"].contains(&kind) {
            let (bid, ask) = if tick_mode(s) {
                (positive(d, "bid")?, positive(d, "ask")?)
            } else {
                quote(s, &positive(d, "mid_close")?)?
            };
            let base = if side(d)? == "BUY" { &ask } else { &bid };
            let fill = slippage::validate_fill(s,&d["fill_slippage"],base,side(d)?,"market",txt(d,"operation_id")?,int(e,"cursor_index")?,int(e,"virtual_time_utc")?)?;
            if positive(d, "fill_price")? != fill {
                return Err("current fill differs from its cutoff quote".into());
            }
            if kind == "market_fill" {
                let p = &d["open_position"];
                order_valid(p, true)?;
                slippage::validate_position(s,p)?;
                if positive(p, "entry_bid")? != bid
                    || positive(p, "entry_ask")? != ask
                    || positive(p, "entry_fill")? != fill
                    || p["side"] != d["side"]
                    || dec(p, "quantity")? != dec(d, "quantity")?
                    || p["position_id"] != d["position_id"]
                    || p["source_operation_id"] != d["operation_id"]
                    || p["opened_cursor_index"] != e["cursor_index"]
                    || p["opened_time_utc"] != e["virtual_time_utc"]
                {
                    return Err("current fill position differs from its execution".into());
                }
                if pnl(s, p, &bid, &ask)?.0 != dec(e, "floating_pl")? {
                    return Err("current fill pnl differs from its closeable quote".into());
                }
            }
        } else {
            return Err("unsupported current quote event".into());
        }
    }
    if slippage::enabled(s) && !current && matches!(kind,"market_fill" | "order_rejected") {
        let bid = positive(d,"bid_open")?;
        let ask = positive(d,"ask_open")?;
        let base = if side(d)? == "BUY" { &ask } else { &bid };
        let expected = slippage::validate_fill(s,&d["fill_slippage"],base,side(d)?,"market",txt(d,"operation_id")?,int(e,"cursor_index")?,int(e,"virtual_time_utc")?)?;
        if expected != positive(d,"fill_price")? { return Err("next-bar fill differs from declared quote/slippage".into()); }
        if kind == "market_fill" {
            let p = &d["open_position"];
            order_valid(p,true)?;
            slippage::validate_position(s,p)?;
            if p["source_operation_id"] != d["operation_id"] || p["position_id"] != d["position_id"]
                || p["side"] != d["side"] || dec(p,"quantity")? != dec(d,"quantity")?
                || positive(p,"entry_bid")? != bid || positive(p,"entry_ask")? != ask
                || positive(p,"entry_fill")? != expected || pnl(s,p,&bid,&ask)?.0 != dec(e,"floating_pl")? {
                return Err("next-bar position differs from executed fill".into());
            }
        }
    }
    if v2(s) && ["market_fill", "order_rejected"].contains(&kind) {
        let m = &d["margin_admission"];
        strict(
            m,
            &[
                "version",
                "leverage",
                "required_account",
                "available_account",
                "submitted_cursor_index",
            ],
        )?;
        bounded(d, "operation_id")?;
        side(d)?;
        let q = positive(d, "quantity")?;
        qty(s, &q)?;
        let fill = positive(d, "fill_price")?;
        let cursor = int(e, "cursor_index")?;
        if int(m, "submitted_cursor_index")? != cursor - if current { 0 } else { 1 } {
            return Err("margin outcome lacks a prior closed-bar order".into());
        }
        let o = json!({"quantity":sval(q),"submitted_cursor_index":m["submitted_cursor_index"]});
        let (expected, rejected) = margin(s, &o, &fill)?;
        let expected = &expected["margin_admission"];
        if m["version"] != expected["version"]
            || ["leverage", "required_account", "available_account"]
                .iter()
                .any(|k| dec(m, k).ok() != dec(expected, k).ok())
        {
            return Err("margin outcome differs from frozen assumption/calculation".into());
        }
        if rejected != (kind == "order_rejected") {
            return Err("margin admission outcome differs from its threshold".into());
        }
        if rejected {
            if d["reason"] != "insufficient_research_margin"
                || !d["position_id"].is_null()
                || int(e, "open_positions")? != 0
                || int(e, "pending_orders")? != 0
                || dec(e, "floating_pl")? != zero()
            {
                return Err("margin rejection account state/reason is inconsistent".into());
            }
        } else if d["position_id"].as_str().is_none_or(|p| p.is_empty())
            || int(e, "open_positions")? != 1
            || int(e, "pending_orders")? != 0
            || !d["reason"].is_null()
        {
            return Err("margin opening fill account state is inconsistent".into());
        }
    }
    if kind == "protection_change" {
        let p = &d["open_position"];
        let o = &d["pending_market_order"];
        if p.is_null() == o.is_null() {
            return Err("protection checkpoint must have one active target".into());
        }
        order_valid(p, true)?;
        order_valid(o, false)?;
        let target = if !p.is_null() {
            &p["position_id"]
        } else {
            &o["operation_id"]
        };
        bounded(d, "operation_id")?;
        if d["target_id"] != *target
            || int(e, "open_positions")? != i64::from(!p.is_null())
            || int(e, "pending_orders")? != i64::from(!o.is_null())
        {
            return Err("protection checkpoint target is inconsistent".into());
        }
        for k in [
            "previous_stop_loss",
            "previous_take_profit",
            "mid_close",
            "closeable_quote",
        ] {
            if d.get(k).is_none() {
                return Err("protection checkpoint lacks previous levels/quote".into());
            }
            opt_dec(d, k)?;
        }
        if !brackets(
            if !p.is_null() { p } else { o },
            &positive(d, "closeable_quote")?,
        )? {
            return Err("protection checkpoint must bracket its current quote".into());
        }
    }
    if ["manual_close", "order_cancel"].contains(&kind) {
        let partial = kind == "manual_close" && !d["open_position"].is_null();
        let p = &d[if kind == "manual_close" {
            "closed_position"
        } else {
            "cancelled_order"
        }];
        order_valid(p, kind == "manual_close")?;
        let target = &p[if kind == "manual_close" {
            "position_id"
        } else {
            "operation_id"
        }];
        bounded(d, "command_operation_id")?;
        if d["target_id"] != *target
            || int(e, "open_positions")? != i64::from(partial)
            || int(e, "pending_orders")? != 0
            || (!partial && dec(e, "floating_pl")? != zero())
            || !d["pending_market_order"].is_null()
        {
            return Err("close/cancel checkpoint is inconsistent".into());
        }
        let realized = dec(d, "net_pnl")?;
        if dec(e, "balance")? != py(dec(d, "previous_balance")? + &realized)
            || (kind == "order_cancel" && realized != zero())
        {
            return Err("close/cancel balance is inconsistent".into());
        }
        if kind == "manual_close" {
            if d["position_id"] != *target
                || d["operation_id"] != p["source_operation_id"]
                || d["side"] != p["side"]
                || dec(d, "quantity")? != dec(p, "quantity")?
                || d["reason"] != "manual_close"
            {
                return Err("closing fill does not match its position".into());
            }
            let prev =
                previous.ok_or("manual close lacks canonical position checkpoint")?;
            let prior = &prev["details"]["open_position"];
            if prev["cursor_index"] != e["cursor_index"]
                || prev["virtual_time_utc"] != e["virtual_time_utc"]
                || (!partial && *prior != *p)
                || dec(prev, "balance")? != dec(d, "previous_balance")?
            {
                return Err("manual close differs from its canonical position checkpoint".into());
            }
            if partial {
                order_valid(&d["open_position"],true)?;
                let closed = positive(p,"quantity")?;
                let residual = positive(prior,"quantity")? - &closed;
                qty(s,&closed)?;
                qty(s,&residual)?;
                let original = prior.get("original_quantity").cloned().unwrap_or_else(||prior["quantity"].clone());
                let mut expected_close = prior.clone();
                expected_close["quantity"] = p["quantity"].clone();
                expected_close["original_quantity"] = original.clone();
                let mut expected_open = prior.clone();
                expected_open["quantity"] = sval(residual);
                expected_open["original_quantity"] = original;
                expected_open["realized_pnl"] = sval(py(prior.get("realized_pnl").map(self::d).transpose()?.unwrap_or_else(zero) + &realized));
                if d["previous_position"] != *prior || *p != expected_close || d["open_position"] != expected_open {
                    return Err("partial close differs from its canonical position checkpoint".into());
                }
            } else if !d["previous_position"].is_null() {
                return Err("full close cannot retain a partial position checkpoint".into());
            }
            let bid = positive(d, "bid_close")?;
            let ask = positive(d, "ask_close")?;
            if partial && dec(e,"floating_pl")? != pnl(s,&d["open_position"],&bid,&ask)?.0 {
                return Err("partial close floating pnl differs from remaining position".into());
            }
            if !tick_mode(s) {
                if positive(d, "mid_close")? != positive(&prev["details"], "mid_close")? {
                    return Err("manual close must use the canonical checkpoint mid".into());
                }
                let expected = quote(s, &positive(d, "mid_close")?)?;
                if (bid.clone(), ask.clone()) != expected {
                    return Err("manual close quote differs from the declared mid/spread".into());
                }
            }
            slippage::validate_position(s,p)?;
            let closing_side = if side(p)? == "BUY" { "SELL" } else { "BUY" };
            let executed = slippage::validate_fill(s,&d["fill_slippage"],if closing_side == "SELL" { &bid } else { &ask },closing_side,"market",txt(d,"command_operation_id")?,int(e,"cursor_index")?,int(e,"virtual_time_utc")?)?;
            let (net, cost) = if slippage::enabled(s) { pnl(s,p,&executed,&executed)? } else { pnl(s,p,&bid,&ask)? };
            if realized != net
                || !cost_matches(&d["cost_breakdown"], &cost)
                || d["cost_model_version"] != cost["cost_model_version"]
                || positive(d, "fill_price")? != executed
            {
                return Err("manual close differs from frozen quote/cost accounting".into());
            }
        }
    }
    if slippage::enabled(s) && kind == "protective_fill" {
        let p = &d["closed_position"];
        order_valid(p,true)?; slippage::validate_position(s,p)?;
        let prior = previous.ok_or("protective execution lacks a canonical position checkpoint")?;
        if prior["details"]["open_position"] != *p || dec(prior,"balance")? != dec(d,"previous_balance")? {
            return Err("protective execution differs from its canonical position checkpoint".into());
        }
        let reason = txt(d,"reason")?;
        let base = positive(&d["fill_slippage"],"base_price")?;
        let stop = reason == "stop_loss" || reason == "stop_loss_gap";
        if !stop && !["take_profit","take_profit_gap"].contains(&reason) { return Err("unsupported protective execution reason".into()); }
        if (reason == "stop_loss" && base != positive(p,"stop_loss")?)
            || (!stop && base != positive(p,"take_profit")?)
            || (reason == "stop_loss_gap" && if side(p)? == "BUY" { base > positive(p,"stop_loss")? } else { base < positive(p,"stop_loss")? }) {
            return Err("protective base price differs from stop/limit semantics".into());
        }
        let closing_side = if side(p)? == "BUY" { "SELL" } else { "BUY" };
        let executed = slippage::validate_fill(s,&d["fill_slippage"],&base,closing_side,if stop { "stop" } else { "limit" },txt(p,"source_operation_id")?,int(e,"cursor_index")?,int(e,"virtual_time_utc")?)?;
        let (net,cost) = pnl(s,p,&executed,&executed)?;
        if d["operation_id"] != p["source_operation_id"] || d["position_id"] != p["position_id"]
            || executed != positive(d,"fill_price")? || net != dec(d,"net_pnl")?
            || !cost_matches(&d["cost_breakdown"],&cost) || d["cost_model_version"] != cost["cost_model_version"]
            || dec(e,"balance")? != py(dec(d,"previous_balance")? + net)
            || int(e,"open_positions")? != 0 || dec(e,"floating_pl")? != zero() {
            return Err("protective execution differs from frozen slippage/cost accounting".into());
        }
    }
    Ok(())
}

fn preceding_event<'a>(s: &'a Value, e: &Value) -> Option<&'a Value> {
    let sequence = e["sequence"].as_u64()?;
    let index = usize::try_from(sequence.checked_sub(2)?).ok()?;
    let prior = s["ledger"].as_array()?.get(index)?;
    (prior["sequence"].as_u64() == sequence.checked_sub(1)).then_some(prior)
}

/// JSON boundary shared by native API handlers and differential tests.
/// Every successful action returns `{snapshot, events}`; errors never mutate caller state.
pub fn transform(request: &Value) -> R<Value> {
    transform_owned(request.clone())
}

/// Moves the snapshot into the transition instead of cloning a potentially long ledger.
pub fn transform_owned(mut request: Value) -> R<Value> {
    let action = txt(&request, "action")?.to_owned();
    let args = request["args"].take();
    let a = &args;
    let mut s = if action == "initialize" {
        initialize(a)?
    } else {
        request["snapshot"].take()
    };
    if action != "initialize" {
        validate(&s)?;
    }
    let old_len = s["ledger"].as_array().ok_or("ledger must be array")?.len();
    let mut history = History::Full;
    match action.as_str() {
        "initialize" => {}
        "validate" => {}
        "queue" => queue_history(&mut s, a, &mut history)?,
        "queue_current_quote" => {
            queue_history(&mut s, a, &mut history)?;
            fill(&mut s, a, &mut history)?;
        }
        "fill_current_quote" => fill(&mut s, a, &mut history)?,
        "protection" => protect(&mut s, a, &mut history)?,
        "close" => close(&mut s, a, &mut history)?,
        "advance" => {
            if tick_mode(&s) {
                tick::advance_validated(&mut s, a)?
            } else {
                advance(&mut s, a, &mut history)?
            }
        }
        "advance_many" => {
            let steps = a["steps"].as_array().ok_or("steps must be an array")?;
            if steps.is_empty() || steps.len() > 10000 {
                return Err("batch must contain 1 to 10000 replay steps".into());
            }
            for step in steps {
                if tick_mode(&s) {
                    tick::advance_validated(&mut s, step)?;
                } else {
                    advance(&mut s, step, &mut history)?;
                }
            }
        }
        "reconstruct" => reconstruct(&mut s, a)?,
        "fork" => fork(&mut s, a)?,
        "transition" => transition(&mut s, a)?,
        _ => return Err(format!("unsupported replay core action: {action}")),
    }
    validate(&s)?;
    let ledger = s["ledger"].as_array().unwrap();
    let events = if ["fork", "reconstruct", "validate"].contains(&action.as_str()) {
        vec![]
    } else {
        ledger[old_len.min(ledger.len())..].to_vec()
    };
    let mut result = json!({"events":events});
    result["snapshot"] = s;
    Ok(result)
}
