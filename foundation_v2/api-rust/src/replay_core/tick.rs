use bigdecimal::BigDecimal;
use serde_json::{Value, json};

use super::{brackets, d, emit, margin, pnl, position, sval, zero};

fn number(v: &Value, key: &str) -> Result<i64, String> {
    v[key]
        .as_i64()
        .filter(|n| *n >= 0)
        .ok_or_else(|| format!("{key} must be a nonnegative integer"))
}

fn decimal(v: &Value, key: &str) -> Result<BigDecimal, String> {
    d(&v[key])
}

fn tick(v: &Value) -> Result<(i64, i64, BigDecimal, BigDecimal), String> {
    let time = number(v, "time_msc")?;
    let sequence = number(v, "sequence")?;
    let bid = decimal(v, "bid")?;
    let ask = decimal(v, "ask")?;
    if bid <= zero() || ask < bid {
        return Err("broker tick ask must be at least positive bid".into());
    }
    Ok((time, sequence, bid, ask))
}

fn provenance(s: &Value, t: &Value, start: i64, end: i64) -> Value {
    json!({"tick_snapshot_id": s["tick_snapshot_id"], "tick_snapshot_sha256": s["tick_snapshot_sha256"],
        "quote_source": s["quote_source"], "time_msc": t["time_msc"], "sequence": t["sequence"],
        "bid": t["bid"], "ask": t["ask"], "window_start_msc": start, "window_end_msc": end})
}

fn record(
    s: &mut Value,
    kind: &str,
    cursor: i64,
    time: i64,
    tick: &Value,
    window: (i64, i64),
    details: Value,
) -> Result<(), String> {
    let mut detail = provenance(s, tick, window.0, window.1);
    detail["open_position"] = s["position"].clone();
    detail["pending_market_order"] = s["pending_market_order"].clone();
    detail
        .as_object_mut()
        .ok_or("invalid details")?
        .extend(details.as_object().ok_or("invalid details")?.clone());
    let floating = if s["position"].is_null() {
        zero()
    } else {
        pnl(
            s,
            &s["position"],
            &decimal(tick, "bid")?,
            &decimal(tick, "ask")?,
        )?
        .0
    };
    emit(s, kind, cursor, time, floating, detail)
}

#[cfg(test)]
pub(super) fn advance(s: &mut Value, a: &Value) -> Result<(), String> {
    let mut next = s.clone();
    advance_inner(&mut next, a)?;
    validate(&next)?;
    *s = next;
    Ok(())
}

pub(super) fn advance_validated(s: &mut Value, a: &Value) -> Result<(), String> {
    advance_inner(s, a)
}

fn advance_inner(s: &mut Value, a: &Value) -> Result<(), String> {
    let cursor = number(a, "cursor_index")?;
    let old_cursor = s["cursor_index"]
        .as_i64()
        .ok_or("invalid execution cursor")?;
    if Some(cursor) != old_cursor.checked_add(1) {
        return Err("execution cursor must advance exactly one bar".into());
    }
    let bar = &a["bar"];
    let timestamp = number(bar, "timestamp")?;
    let o = decimal(bar, "open")?;
    let h = decimal(bar, "high")?;
    let l = decimal(bar, "low")?;
    let c = decimal(bar, "close")?;
    if l <= zero() || l > o || l > c || h < o || h < c || h < l {
        return Err("invalid OHLC bar".into());
    }
    if s["ledger"]
        .as_array()
        .and_then(|v| v.last())
        .and_then(|v| v["virtual_time_utc"].as_i64())
        .is_some_and(|t| timestamp < t)
    {
        return Err("tick bar precedes the canonical execution checkpoint".into());
    }
    let start = timestamp.checked_mul(1000).ok_or("tick window overflow")?;
    let end = timestamp
        .checked_add(number(s, "timeframe_seconds")?)
        .and_then(|v| v.checked_mul(1000))
        .ok_or("tick window overflow")?;
    if decimal(s, "spread_price")? != zero()
        || s["cost_model"]["spread_basis"] != "bid_ask_embedded"
    {
        return Err("tick execution requires embedded broker spread".into());
    }
    let grid = decimal(&s["instrument_spec"], "tick_size")?;
    if grid <= zero() {
        return Err("instrument tick size must be positive".into());
    }
    let ticks = a["ticks"].as_array().ok_or("ticks must be an array")?;
    let mut prior = None;
    let mut last = None;
    let mut exposure = !s["position"].is_null();
    for raw in ticks {
        let (time, sequence, bid, ask) = tick(raw)?;
        if !(start..end).contains(&time) {
            return Err("tick is outside the closed bar window; no future quotes allowed".into());
        }
        if prior.is_some_and(|k| (time, sequence) <= k) {
            return Err(
                "broker tick order must be strictly increasing, including same-ms sequence".into(),
            );
        }
        if &bid % &grid != zero() || &ask % &grid != zero() {
            return Err("broker tick price does not align with instrument tick size".into());
        }
        prior = Some((time, sequence));
        let raw = json!({"time_msc":time,"sequence":sequence,"bid":sval(bid.clone()),"ask":sval(ask.clone())});
        last = Some(raw.clone());
        if !s["pending_market_order"].is_null() {
            let order = s["pending_market_order"].clone();
            let fill = if order["side"] == "BUY" { &ask } else { &bid };
            if order["submitted_cursor_index"].as_i64() != Some(old_cursor) {
                return Err("tick order must be submitted at the previous closed bar".into());
            }
            if !brackets(&order, fill)? {
                return Err("tick market gap invalidates the submitted protection bracket".into());
            }
            let (admission, rejected) = margin(s, &order, fill)?;
            s["pending_market_order"] = Value::Null;
            let mut details = json!({"operation_id": order["operation_id"], "side": order["side"],
                "quantity": order["quantity"], "fill_price": sval(fill.clone()), "margin_admission": admission["margin_admission"]});
            if !rejected {
                s["position"] = position(s, &order, &bid, &ask, cursor, time / 1000)?;
                exposure = true;
                details["position_id"] = s["position"]["position_id"].clone();
                record(
                    s,
                    "market_fill",
                    cursor,
                    time / 1000,
                    &raw,
                    (start, end),
                    details,
                )?;
            } else {
                details["reason"] = json!("insufficient_research_margin");
                record(
                    s,
                    "order_rejected",
                    cursor,
                    time / 1000,
                    &raw,
                    (start, end),
                    details,
                )?;
            }
        }
        if !s["position"].is_null() {
            let closed = s["position"].clone();
            let buy = closed["side"] == "BUY";
            let quote = if buy { &bid } else { &ask };
            let stop = if closed["stop_loss"].is_null() {
                false
            } else {
                let price = decimal(&closed, "stop_loss")?;
                if buy {
                    quote <= &price
                } else {
                    quote >= &price
                }
            };
            let target = if closed["take_profit"].is_null() {
                false
            } else {
                let price = decimal(&closed, "take_profit")?;
                if buy {
                    quote >= &price
                } else {
                    quote <= &price
                }
            };
            if stop || target {
                let (net, cost) = pnl(s, &closed, &bid, &ask)?;
                s["balance"] = sval(super::py(decimal(s, "balance")? + &net));
                s["position"] = Value::Null;
                let details = json!({"operation_id": closed["source_operation_id"], "position_id": closed["position_id"],
                    "side": closed["side"], "quantity": closed["quantity"], "reason": if stop {"stop_loss"} else {"take_profit"},
                    "fill_price": sval(quote.clone()), "net_pnl": sval(net), "cost_model_version": cost["cost_model_version"],
                    "cost_breakdown": cost, "closed_position": closed});
                record(
                    s,
                    "protective_fill",
                    cursor,
                    time / 1000,
                    &raw,
                    (start, end),
                    details,
                )?;
            }
        }
    }
    let last = last.ok_or("tick coverage is empty; OHLC fallback is disabled")?;
    let bid = decimal(&last, "bid")?;
    let ask = decimal(&last, "ask")?;
    record(
        s,
        "price_mark",
        cursor,
        end / 1000,
        &last,
        (start, end),
        json!({
        "mid_close": sval(c), "quote_mid_close": sval((&bid + &ask) / BigDecimal::from(2)),
        "bid_close": sval(bid.clone()), "ask_close": sval(ask.clone()),
        "intrabar_equity_coverage": if exposure {"insufficient"} else {"complete"}}),
    )?;
    s["cursor_index"] = json!(cursor);
    s["last_bid"] = sval(bid);
    s["last_ask"] = sval(ask);
    Ok(())
}

pub(super) fn validate(s: &Value) -> Result<(), String> {
    let id = s["tick_snapshot_id"]
        .as_str()
        .ok_or("tick snapshot id is required")?;
    let hash = s["tick_snapshot_sha256"]
        .as_str()
        .ok_or("tick snapshot hash is required")?;
    if id.is_empty()
        || id.len() > 128
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid tick snapshot pins".into());
    }
    if s["quote_source"] != "broker_bid_ask"
        || decimal(s, "spread_price")? != zero()
        || s["cost_model"]["spread_basis"] != "bid_ask_embedded"
    {
        return Err("tick execution uses embedded broker spread only".into());
    }
    if s["last_bid"].is_null() != s["last_ask"].is_null() {
        return Err("tick checkpoint requires both last quotes".into());
    }
    if !s["last_bid"].is_null()
        && (decimal(s, "last_bid")? <= zero() || decimal(s, "last_ask")? < decimal(s, "last_bid")?)
    {
        return Err("tick checkpoint ask must be at least positive bid".into());
    }
    let ledger = s["ledger"].as_array().ok_or("ledger must be an array")?;
    let mut prior_key = None;
    let mut prior_quote: Option<&Value> = None;
    let mut last_cursor = -1;
    let mut last_time = -1;
    for (index, event) in ledger.iter().enumerate() {
        let cursor = number(event, "cursor_index")?;
        let time = number(event, "virtual_time_utc")?;
        if number(event, "sequence")? != index as i64 + 1
            || cursor < last_cursor
            || cursor > number(s, "cursor_index")?
            || time < last_time
            || [
                "replay_session_id",
                "branch_id",
                "dataset_id",
                "dataset_sha256",
            ]
            .iter()
            .any(|key| event[*key] != s[*key])
        {
            return Err("tick execution ledger lineage/time is inconsistent".into());
        }
        last_cursor = cursor;
        last_time = time;
        if event["kind"] == "phase_transition" {
            continue;
        }
        let details = &event["details"];
        for key in ["tick_snapshot_id", "tick_snapshot_sha256", "quote_source"] {
            if details[key] != s[key] {
                return Err("tick event provenance differs from the frozen snapshot".into());
            }
        }
        let (msc, sequence, bid, ask) = tick(details)?;
        if prior_key.is_some_and(|key| (msc, sequence) < key) {
            return Err("tick ledger reverses broker quote order".into());
        }
        prior_key = Some((msc, sequence));
        let open = &details["open_position"];
        let pending = &details["pending_market_order"];
        if number(event, "open_positions")? != i64::from(!open.is_null())
            || number(event, "pending_orders")? != i64::from(!pending.is_null())
        {
            return Err("tick event checkpoint state is inconsistent".into());
        }
        let floating = if open.is_null() {
            zero()
        } else {
            pnl(s, open, &bid, &ask)?.0
        };
        if decimal(event, "floating_pl")? != floating {
            return Err("tick event floating pnl differs from its observed closeable quote".into());
        }
        let kind = event["kind"].as_str().ok_or("invalid event kind")?;
        if kind == "protection_change" {
            let target = if open.is_null() { pending } else { open };
            let reference = if target["side"] == "BUY" { &bid } else { &ask };
            if decimal(details, "closeable_quote")? != *reference {
                return Err("tick protection must use the observed closeable quote".into());
            }
        } else if kind == "manual_close"
            || kind == "order_cancel"
            || details["execution_timing"] == "current_quote"
        {
            let prior = prior_quote
                .ok_or("close/current fill requires a preceding canonical broker quote")?;
            let keys: &[&str] = if details["execution_timing"] == "current_quote" {
                if event["cursor_index"] != prior["cursor_index"]
                    || event["virtual_time_utc"] != prior["virtual_time_utc"]
                {
                    return Err(
                        "current fill must retain the preceding canonical broker quote".into(),
                    );
                }
                &[
                    "time_msc",
                    "sequence",
                    "bid",
                    "ask",
                    "window_start_msc",
                    "window_end_msc",
                ]
            } else {
                &["time_msc", "sequence", "bid", "ask"]
            };
            if keys
                .iter()
                .any(|key| details[*key] != prior["details"][*key])
            {
                return Err(
                    "close/current fill must retain the preceding canonical broker quote".into(),
                );
            }
            if kind == "manual_close"
                && (decimal(details, "bid_close")? != bid || decimal(details, "ask_close")? != ask)
            {
                return Err("manual close differs from the observed broker quote".into());
            }
        } else {
            let start = number(details, "window_start_msc")?;
            let end = number(details, "window_end_msc")?;
            if end.checked_sub(start) != number(s, "timeframe_seconds")?.checked_mul(1000)
                || !(start..end).contains(&msc)
            {
                return Err("tick event quote is outside its closed bar window".into());
            }
            if time
                != if kind == "price_mark" {
                    end / 1000
                } else {
                    msc / 1000
                }
            {
                return Err("tick event time differs from observed causal time".into());
            }
            if ["market_fill", "order_rejected", "protective_fill"].contains(&kind) {
                let side = details["side"]
                    .as_str()
                    .ok_or("tick fill lacks its position side")?;
                if side != "BUY" && side != "SELL" {
                    return Err("tick fill lacks its position side".into());
                }
                let quote = if (side == "BUY") != (kind == "protective_fill") {
                    &ask
                } else {
                    &bid
                };
                if decimal(details, "fill_price")? != *quote {
                    return Err("tick fill differs from its observed broker side".into());
                }
                if kind == "protective_fill" {
                    let closed = &details["closed_position"];
                    let buy = side == "BUY";
                    let stop = if closed["stop_loss"].is_null() {
                        false
                    } else {
                        let v = decimal(closed, "stop_loss")?;
                        if buy { quote <= &v } else { quote >= &v }
                    };
                    let target = if closed["take_profit"].is_null() {
                        false
                    } else {
                        let v = decimal(closed, "take_profit")?;
                        if buy { quote >= &v } else { quote <= &v }
                    };
                    let reason = if stop {
                        "stop_loss"
                    } else if target {
                        "take_profit"
                    } else {
                        ""
                    };
                    if reason.is_empty()
                        || closed["side"] != side
                        || closed["position_id"] != details["position_id"]
                        || closed["source_operation_id"] != details["operation_id"]
                        || details["reason"] != reason
                    {
                        return Err(
                            "tick closing fill does not match its observed protective trigger"
                                .into(),
                        );
                    }
                    let (realized, cost) = pnl(s, closed, &bid, &ask)?;
                    if decimal(details, "net_pnl")? != realized
                        || details["cost_model_version"] != cost["cost_model_version"]
                        || !super::cost_matches(&details["cost_breakdown"], &cost)
                    {
                        return Err(
                            "tick closing fill cost accounting differs from frozen assumptions"
                                .into(),
                        );
                    }
                }
            }
            if kind == "price_mark"
                && (decimal(details, "bid_close")? != bid
                    || decimal(details, "ask_close")? != ask
                    || decimal(details, "quote_mid_close")? != (&bid + &ask) / BigDecimal::from(2))
            {
                return Err("tick close mark differs from its observed broker quote".into());
            }
        }
        prior_quote = Some(event);
    }
    if number(s, "event_sequence")? != ledger.len() as i64 {
        return Err("tick execution ledger length differs from its event sequence".into());
    }
    if let Some(last) = prior_quote {
        if decimal(s, "last_bid")? != decimal(&last["details"], "bid")?
            || decimal(s, "last_ask")? != decimal(&last["details"], "ask")?
        {
            return Err("tick checkpoint quotes differ from its canonical ledger".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn initial() -> Value {
        super::super::initialize(&json!({"replay_session_id":"tick-session","branch_id":"tick-branch","dataset_id":"m1-dataset",
            "dataset_sha256":"d".repeat(64),"tick_snapshot_id":"tick-snapshot","tick_snapshot_sha256":"a".repeat(64),
            "instrument_spec":{"instrument_id":"EURUSDm","asset_class":"fx","base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD",
                "tick_size":"0.0001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2026-01-01T00:00:00Z"},
            "cost_model":{"version":"tick-fixture-cost-v1","spread_basis":"bid_ask_embedded","commission_per_side_account":"1","minimum_fee_account":"0",
                "slippage_price_per_side":"0","financing_account":"0","quote_to_account_rate":"1","account_ccy":"USD","rounding_decimals":2},
            "spread_price":"0","timeframe_seconds":60,"starting_balance":"100000","cursor_index":0,
            "research_margin":{"version":"fixed-starting-balance-leverage-v1","leverage":"100"}})).unwrap()
    }
    fn queued(side: &str) -> Value {
        let mut s = initial();
        super::super::queue(
            &mut s,
            &json!({"operation_id":"order-1","side":side,"quantity":"1",
            "stop_loss":if side=="BUY" {"1.0990"} else {"1.1020"},
            "take_profit":if side=="BUY" {"1.1020"} else {"1.0980"}}),
        )
        .unwrap();
        s
    }
    fn t(bid: &str, ask: &str, sequence: i64) -> Value {
        json!({"time_msc":1000000,"sequence":sequence,"bid":bid,"ask":ask})
    }
    fn args(ticks: Value) -> Value {
        json!({"cursor_index":1,"bar":{"timestamp":1000,"open":"1.1000","high":"1.1050","low":"1.0950","close":"1.1010"},"ticks":ticks})
    }
    #[test]
    fn first_touch_uses_correct_broker_side_and_same_ms_sequence() {
        let mut buy = queued("BUY");
        advance(
            &mut buy,
            &args(json!([
                t("1.1000", "1.1002", 0),
                t("1.1022", "1.1024", 1),
                t("1.0980", "1.0982", 2)
            ])),
        )
        .unwrap();
        assert_eq!(
            decimal(&buy, "balance").unwrap(),
            d(&json!("100198")).unwrap()
        );
        assert_eq!(buy["ledger"][1]["details"]["reason"], "take_profit");
        assert_eq!(buy["ledger"][1]["details"]["fill_price"], "1.1022");
        let mut sell = queued("SELL");
        advance(
            &mut sell,
            &args(json!([t("1.1000", "1.1002", 0), t("1.0976", "1.0978", 1)])),
        )
        .unwrap();
        assert_eq!(
            decimal(&sell, "balance").unwrap(),
            d(&json!("100218")).unwrap()
        );
        assert_eq!(sell["ledger"][1]["details"]["fill_price"], "1.0978");
    }
    #[test]
    fn wrong_side_quote_does_not_trigger_exit() {
        let mut buy = queued("BUY");
        advance(
            &mut buy,
            &args(json!([t("1.1000", "1.1002", 0), t("1.1019", "1.1021", 1)])),
        )
        .unwrap();
        assert!(!buy["position"].is_null());
        assert_eq!(
            decimal(&buy, "floating_pl").unwrap(),
            d(&json!("168")).unwrap()
        );
        let mut sell = queued("SELL");
        advance(
            &mut sell,
            &args(json!([t("1.1000", "1.1002", 0), t("1.0979", "1.0981", 1)])),
        )
        .unwrap();
        assert!(!sell["position"].is_null());
    }
    #[test]
    fn invalid_coverage_and_order_fail_atomically() {
        for ticks in [
            json!([]),
            json!([t("1.1000", "1.1002", 0), t("1.1000", "1.1002", 0)]),
            json!([t("1.10001", "1.1002", 0)]),
            json!([t("1.1030", "1.1032", 0)]),
        ] {
            let mut state = queued("BUY");
            let original = state.clone();
            assert!(advance(&mut state, &args(ticks)).is_err());
            assert_eq!(state, original);
        }
    }
    #[test]
    fn margin_rejection_retains_observed_quote_and_stays_flat() {
        let mut s = queued("BUY");
        s["starting_balance"] = json!("1000");
        s["balance"] = json!("1000");
        s["equity"] = json!("1000");
        s["research_margin"]["leverage"] = json!("1");
        s["pending_market_order"]["quantity"] = json!("0.01");
        advance(&mut s, &args(json!([t("1.1000", "1.1002", 0)]))).unwrap();
        assert_eq!(s["ledger"][0]["kind"], "order_rejected");
        assert!(s["position"].is_null());
        assert!(s["pending_market_order"].is_null());
        assert_eq!(
            decimal(
                &s["ledger"][0]["details"]["margin_admission"],
                "required_account"
            )
            .unwrap(),
            d(&json!("1100.2")).unwrap()
        );
    }
    #[test]
    fn tampered_provenance_quotes_costs_and_causal_order_are_rejected() {
        let mut s = queued("BUY");
        advance(
            &mut s,
            &args(json!([t("1.1000", "1.1002", 0), t("1.1020", "1.1022", 1)])),
        )
        .unwrap();
        for key in ["tick_snapshot_id", "fill_price", "time_msc", "net_pnl"] {
            let mut altered = s.clone();
            altered["ledger"][1]["details"][key] = if key == "time_msc" {
                json!(1060000)
            } else {
                json!("99999")
            };
            assert!(validate(&altered).is_err(), "{key}");
        }
        let mut altered = s.clone();
        altered["last_bid"] = json!("1.0999");
        assert!(validate(&altered).is_err());
        let mut altered = s.clone();
        altered["ledger"][0]["details"]["sequence"] = json!(2);
        assert!(validate(&altered).is_err());
    }
}
