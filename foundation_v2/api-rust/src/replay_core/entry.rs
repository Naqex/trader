//! Conditional entries share the existing single-order slot and durable ledger.
use super::*;

pub(super) fn kind(order: &Value) -> &str {
    order["order_type"].as_str().unwrap_or("market")
}
pub(super) fn conditional(order: &Value) -> bool {
    matches!(kind(order), "limit" | "stop")
}
pub(super) fn triggered(order: &Value, price: &BigDecimal) -> R<bool> {
    let level = positive(order, "entry_price")?;
    Ok(match (kind(order), side(order)?) {
        ("limit", "BUY") | ("stop", "SELL") => price <= &level,
        ("limit", "SELL") | ("stop", "BUY") => price >= &level,
        _ => return Err("unsupported pending entry type".into()),
    })
}
pub(super) fn validate_order(order: &Value) -> R<()> {
    if !conditional(order) {
        return Err("pending entry type must be limit or stop".into());
    }
    let level = positive(order, "entry_price")?;
    if !brackets(order, &level)? {
        return Err("pending protection must bracket its entry price".into());
    }
    Ok(())
}
pub(super) fn queue_market(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    if kind(a) != "market" || !a["entry_price"].is_null() {
        return Err("market submission cannot contain a conditional entry".into());
    }
    queue_history(s, a, history)
}
pub(super) fn queue(s: &mut Value, a: &Value, history: &mut History<'_>) -> R<()> {
    validate_order(a)?;
    let level = positive(a, "entry_price")?;
    if &level % positive(&s["instrument_spec"], "tick_size")? != zero() {
        return Err("entry price must align with instrument tick size".into());
    }
    let mid = positive(a, "mid_close")?;
    let (bid, ask) = if tick_mode(s) {
        latest_quote(s)?;
        (positive(s, "last_bid")?, positive(s, "last_ask")?)
    } else {
        quote(s, &mid)?
    };
    if triggered(a, if side(a)? == "BUY" { &ask } else { &bid })? {
        return Err("pending entry must be beyond the current executable quote".into());
    }
    let time = int(a, "virtual_time_utc")?;
    canonical_time_history(
        s,
        history,
        time,
        "pending submission must retain the canonical checkpoint time",
    )?;
    queue_history(s, a, history)?;
    s["pending_market_order"]["order_type"] = a["order_type"].clone();
    s["pending_market_order"]["entry_price"] = sval(level);
    let mut details = json!({"operation_id":a["operation_id"],"mid_close":sval(mid),
        "bid_close":sval(bid),"ask_close":sval(ask),"open_position":null,
        "pending_market_order":s["pending_market_order"]});
    if tick_mode(s) {
        merge(&mut details, provenance(s, false)?);
    }
    emit_history(
        s,
        history,
        "order_placed",
        int(s, "cursor_index")?,
        time,
        zero(),
        details,
    )
}

// OHLC cannot establish the time of an intrabar crossing. The candle end is
// the checkpoint; any potentially same-bar protective exit is rejected below.
pub(super) fn bar_quote(
    s: &Value,
    order: &Value,
    bar: &Value,
) -> R<Option<(BigDecimal, BigDecimal, bool)>> {
    let (bid, ask) = quote(s, &positive(bar, "open")?)?;
    let buy = side(order)? == "BUY";
    if triggered(order, if buy { &ask } else { &bid })? {
        return Ok(Some((bid, ask, true)));
    }
    let extreme = match (kind(order), buy) {
        ("limit", true) | ("stop", false) => "low",
        _ => "high",
    };
    let (low_bid, high_ask) = quote(s, &positive(bar, extreme)?)?;
    if !triggered(order, if buy { &high_ask } else { &low_bid })? {
        return Ok(None);
    }
    let level = positive(order, "entry_price")?;
    let spread = ask - bid;
    let (bid, ask) = if buy {
        (&level - &spread, level)
    } else {
        (level.clone(), level + spread)
    };
    if bid <= zero() {
        return Err("conditional entry produces a nonpositive bid".into());
    }
    Ok(Some((bid, ask, false)))
}

pub(super) fn fill_bar(
    s: &mut Value,
    bar: &Value,
    cursor: i64,
    history: &mut History<'_>,
) -> R<bool> {
    let order = s["pending_market_order"].clone();
    let Some((bid, ask, at_open)) = bar_quote(s, &order, bar)? else {
        return Ok(false);
    };
    let time = int(bar, "timestamp")?
        + if at_open {
            0
        } else {
            int(s, "timeframe_seconds")?
        };
    let base = if side(&order)? == "BUY" { &ask } else { &bid };
    if !brackets(&order, base)? {
        return Err("entry gap invalidates the submitted protection bracket".into());
    }
    let (fill, slip) = slippage::fill(
        s,
        base,
        side(&order)?,
        kind(&order),
        txt(&order, "operation_id")?,
        cursor,
        time,
    )?;
    let (admission, rejected) = margin(s, &order, &fill)?;
    let p = if rejected {
        Value::Null
    } else {
        position(s, &order, &bid, &ask, cursor, time)?
    };
    if !rejected && !at_open && protective(s, &p, bar, false)?.is_some() {
        return Err("pending entry and protective exit are intrabar ambiguous; lower-timeframe or tick ordering required".into());
    }
    s["pending_market_order"] = Value::Null;
    s["position"] = p;
    let mut details = json!({"operation_id":order["operation_id"],"side":order["side"],"quantity":order["quantity"],
        "fill_price":sval(fill),"entry_order":order,"entry_bar":bar,"fill_slippage":slip,
        "open_position":s["position"],"pending_market_order":null});
    merge(&mut details, admission);
    if rejected {
        details["reason"] = json!("insufficient_research_margin");
    } else {
        details["position_id"] = s["position"]["position_id"].clone();
    }
    let fp = if rejected {
        zero()
    } else {
        pnl(s, &s["position"], &bid, &ask)?.0
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
    Ok(!rejected)
}

pub(super) fn validate_event(s: &Value, event: &Value, previous: Option<&Value>) -> R<()> {
    let details = &event["details"];
    if event["kind"] == "order_placed" {
        let order = &details["pending_market_order"];
        order_valid(order, false)?;
        validate_order(order)?;
        if event["open_positions"] != 0
            || event["pending_orders"] != 1
            || dec(event, "floating_pl")? != zero()
            || !details["open_position"].is_null()
            || order["submitted_cursor_index"] != event["cursor_index"]
            || order["operation_id"] != details["operation_id"]
        {
            return Err("pending submission checkpoint is inconsistent".into());
        }
        let (bid, ask) = if tick_mode(s) {
            (positive(details, "bid")?, positive(details, "ask")?)
        } else {
            quote(s, &positive(details, "mid_close")?)?
        };
        if triggered(order, if side(order)? == "BUY" { &ask } else { &bid })? {
            return Err("submitted pending entry already crosses its executable quote".into());
        }
        if let Some(prev) = previous {
            if prev["cursor_index"] != event["cursor_index"]
                || prev["virtual_time_utc"] != event["virtual_time_utc"]
                || prev["balance"] != event["balance"]
                || prev["open_positions"] != 0
                || prev["pending_orders"] != 0
            {
                return Err("pending submission differs from its canonical checkpoint".into());
            }
        }
        return Ok(());
    }
    let order = &details["entry_order"];
    order_valid(order, false)?;
    validate_order(order)?;
    if previous.is_none_or(|prev| prev["details"]["pending_market_order"] != *order)
        || int(order, "submitted_cursor_index")? >= int(event, "cursor_index")?
    {
        return Err("conditional fill lacks its preceding pending order".into());
    }
    let (bid, ask) = if tick_mode(s) {
        let bid = positive(details, "bid")?;
        let ask = positive(details, "ask")?;
        if !triggered(order, if side(order)? == "BUY" { &ask } else { &bid })? {
            return Err("tick has not triggered its pending entry".into());
        }
        (bid, ask)
    } else {
        bar_valid(&details["entry_bar"])?;
        let (bid, ask, at_open) = bar_quote(s, order, &details["entry_bar"])?
            .ok_or("bar has not triggered its pending entry")?;
        let time = int(&details["entry_bar"], "timestamp")?
            + if at_open {
                0
            } else {
                int(s, "timeframe_seconds")?
            };
        if int(event, "virtual_time_utc")? != time {
            return Err("conditional fill time differs from its bar checkpoint".into());
        }
        (bid, ask)
    };
    let expected = slippage::validate_fill(
        s,
        &details["fill_slippage"],
        if side(order)? == "BUY" { &ask } else { &bid },
        side(order)?,
        kind(order),
        txt(order, "operation_id")?,
        int(event, "cursor_index")?,
        int(event, "virtual_time_utc")?,
    )?;
    if positive(details, "fill_price")? != expected
        || details["side"] != order["side"]
        || details["quantity"] != order["quantity"]
        || details["operation_id"] != order["operation_id"]
    {
        return Err("conditional execution differs from its submitted order/quote".into());
    }
    if event["kind"] == "market_fill" {
        let p = &details["open_position"];
        order_valid(p, true)?;
        slippage::validate_position(s, p)?;
        if positive(p, "entry_bid")? != bid
            || positive(p, "entry_ask")? != ask
            || positive(p, "entry_fill")? != expected
            || p["source_operation_id"] != order["operation_id"]
            || p["side"] != order["side"]
            || p["quantity"] != order["quantity"]
            || p["stop_loss"] != order["stop_loss"]
            || p["take_profit"] != order["take_profit"]
            || p["take_profits"] != order["take_profits"]
            || p["position_id"] != details["position_id"]
            || p["opened_cursor_index"] != event["cursor_index"]
            || p["opened_time_utc"] != event["virtual_time_utc"]
            || p["entry_order_type"] != order["order_type"]
            || pnl(s, p, &bid, &ask)?.0 != dec(event, "floating_pl")?
        {
            return Err("conditional position differs from its execution".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn initial(ticks: bool) -> Value {
        let mut args = json!({"replay_session_id":"pending-fixture","branch_id":"branch-fixture","dataset_id":"dataset-fixture","dataset_sha256":"d".repeat(64),
            "instrument_spec":{"instrument_id":"EURUSD","asset_class":"fx","base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD","tick_size":"0.0001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2026-01-01T00:00:00Z"},
            "cost_model":{"version":"fixture-cost-v1","spread_basis":"bid_ask_embedded","commission_per_side_account":"1","minimum_fee_account":"0","slippage_price_per_side":"0","financing_account":"0","quote_to_account_rate":"1","account_ccy":"USD","rounding_decimals":2},
            "spread_price":"0.0002","timeframe_seconds":60,"starting_balance":"100000","cursor_index":0,
            "research_margin":{"version":"fixed-starting-balance-leverage-v1","leverage":"100"}});
        if ticks {
            args["spread_price"] = json!("0");
            args["tick_snapshot_id"] = json!("ticks-fixture");
            args["tick_snapshot_sha256"] = json!("a".repeat(64));
        }
        run("initialize", Value::Null, args)
    }
    fn run(action: &str, snapshot: Value, args: Value) -> Value {
        transform(&json!({"action":action,"snapshot":snapshot,"args":args})).unwrap()["snapshot"]
            .clone()
    }
    fn bar(cursor: i64, open: &str, high: &str, low: &str) -> Value {
        json!({"cursor_index":cursor,"bar":{"timestamp":1000+(cursor-1)*60,"open":open,"high":high,"low":low,"close":open}})
    }
    fn pending(mut s: Value, side: &str, kind: &str, price: &str) -> Value {
        if int(&s, "cursor_index").unwrap() == 0 {
            s = run("advance", s, bar(1, "1.1000", "1.1002", "1.0998"));
        }
        let time = s["ledger"].as_array().unwrap().last().unwrap()["virtual_time_utc"].clone();
        run(
            "queue_entry",
            s,
            json!({"operation_id":"entry-1","side":side,"quantity":"0.01","order_type":kind,"entry_price":price,"mid_close":"1.1000","virtual_time_utc":time}),
        )
    }
    #[test]
    fn pending_entry_all_four_sides_wait_reload_and_fill_only_on_touch() {
        for (side, kind, price, high, low) in [
            ("BUY", "limit", "1.0990", "1.1000", "1.0989"),
            ("SELL", "limit", "1.1010", "1.1011", "1.1000"),
            ("BUY", "stop", "1.1010", "1.1009", "1.1000"),
            ("SELL", "stop", "1.0990", "1.1000", "1.0991"),
        ] {
            let s = pending(initial(false), side, kind, price);
            assert!(s["position"].is_null());
            let s = run("advance", s, bar(2, "1.1000", "1.1002", "1.0998"));
            assert!(s["position"].is_null());
            let restored = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
            let s = run("advance", restored, bar(3, "1.1000", high, low));
            assert!(s["pending_market_order"].is_null());
            assert_eq!(
                dec(&s["position"], "entry_fill").unwrap(),
                d(&json!(price)).unwrap()
            );
            assert_eq!(s["position"]["side"], side);
            assert_eq!(s["position"]["entry_order_type"], kind);
        }
    }
    #[test]
    fn pending_entry_gaps_improve_limits_and_slip_stops() {
        for (side, kind, price, open, fill) in [
            ("BUY", "limit", "1.0990", "1.0980", "1.0981"),
            ("SELL", "limit", "1.1010", "1.1020", "1.1019"),
            ("BUY", "stop", "1.1010", "1.1020", "1.1021"),
            ("SELL", "stop", "1.0990", "1.0980", "1.0979"),
        ] {
            let s = pending(initial(false), side, kind, price);
            let s = run("advance", s, bar(2, open, open, open));
            assert_eq!(
                dec(&s["position"], "entry_fill").unwrap(),
                d(&json!(fill)).unwrap()
            );
        }
    }
    #[test]
    fn pending_entry_rejects_wrong_side_grid_and_ambiguous_same_bar_exit() {
        let s = run(
            "advance",
            initial(false),
            bar(1, "1.1000", "1.1002", "1.0998"),
        );
        for (kind, price) in [
            ("limit", "1.1001"),
            ("stop", "1.1000"),
            ("limit", "1.09905"),
        ] {
            assert!(transform(&json!({"action":"queue_entry","snapshot":s,"args":{"operation_id":"invalid","side":"BUY","quantity":"0.01","order_type":kind,"entry_price":price,"mid_close":"1.1000","virtual_time_utc":1060}})).is_err());
        }
        let mut s = pending(s, "BUY", "stop", "1.1010");
        s = run(
            "protection",
            s,
            json!({"operation_id":"protection-1","target_id":"entry-1","stop_loss":"1.0995","mid_close":"1.1000","virtual_time_utc":1060}),
        );
        let result = transform(
            &json!({"action":"advance","snapshot":s,"args":bar(2,"1.1000","1.1012","1.0990")}),
        );
        assert!(result.unwrap_err().contains("ambiguous"));
        let queued = pending(initial(false), "BUY", "limit", "1.0990");
        assert!(transform(&json!({"action":"fill_current_quote","snapshot":queued,"args":{"virtual_time_utc":1060,"mid_close":"1.1000"}})).is_err());
        for action in ["queue", "queue_current_quote"] {
            assert!(transform(&json!({"action":action,"snapshot":initial(false),"args":{"operation_id":"wrong-route","side":"BUY","quantity":"0.01","order_type":"limit","entry_price":"1.0990"}})).is_err());
        }
    }
    #[test]
    fn pending_entry_margin_is_checked_on_fill_and_cannot_open_an_oversize_position() {
        let mut s = initial(false);
        s["starting_balance"] = json!("100");
        s["balance"] = json!("100");
        s["equity"] = json!("100");
        s["phase_initial_balance"] = json!("100");
        s["research_margin"]["leverage"] = json!("1");
        let s = pending(s, "BUY", "limit", "1.0990");
        let s = run("advance", s, bar(2, "1.1000", "1.1002", "1.0998"));
        let s = run("advance", s, bar(3, "1.1000", "1.1002", "1.0989"));
        assert!(s["position"].is_null());
        assert!(s["pending_market_order"].is_null());
        assert!(s["ledger"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "order_rejected"));
        assert_eq!(s["balance"], "100");
    }
    #[test]
    fn pending_entry_cancel_fork_and_receipt_integrity() {
        let s = pending(initial(false), "SELL", "limit", "1.1010");
        let s = run("advance", s, bar(2, "1.1000", "1.1002", "1.0998"));
        let branch = run("reconstruct", s.clone(), json!({"cursor_index":1}));
        assert_eq!(branch["pending_market_order"]["entry_price"], "1.1010");
        let cancelled = run(
            "close",
            s.clone(),
            json!({"operation_id":"cancel-1","target_id":"entry-1","mid_close":"1.1000","virtual_time_utc":1120}),
        );
        assert!(cancelled["pending_market_order"].is_null());
        assert_eq!(
            cancelled["ledger"].as_array().unwrap().last().unwrap()["kind"],
            "order_cancel"
        );
        let s = run("advance", s, bar(3, "1.1000", "1.1012", "1.1000"));
        let mut tampered = s.clone();
        let ledger = tampered["ledger"].as_array_mut().unwrap();
        let e = ledger
            .iter_mut()
            .find(|e| e["kind"] == "market_fill")
            .unwrap();
        e["details"]["entry_order"]["entry_price"] = json!("1.1011");
        assert!(validate(&tampered).is_err());
    }
    #[test]
    fn pending_entry_ticks_use_the_executable_side_and_remain_pending_across_bars() {
        let mut s = initial(true);
        let mut first = bar(1, "1.1000", "1.1002", "1.0998");
        first["ticks"] = json!([{"time_msc":1000000,"sequence":1,"bid":"1.0999","ask":"1.1001"}]);
        s = run("advance", s, first);
        s = pending(s, "BUY", "stop", "1.1010");
        let mut waiting = bar(2, "1.1000", "1.1012", "1.0998");
        waiting["ticks"] = json!([{"time_msc":1060000,"sequence":1,"bid":"1.1007","ask":"1.1009"}]);
        s = run("advance", s, waiting);
        assert!(s["position"].is_null());
        let mut crossing = bar(3, "1.1000", "1.1012", "1.0998");
        crossing["ticks"] =
            json!([{"time_msc":1120000,"sequence":1,"bid":"1.1008","ask":"1.1010"}]);
        s = run("advance", s, crossing);
        assert_eq!(s["position"]["entry_fill"], "1.1010");
        assert!(s["pending_market_order"].is_null());
    }
}
