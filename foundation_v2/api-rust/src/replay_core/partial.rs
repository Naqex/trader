//! Partial targets use absolute quantities, in trigger order. The scalar TP is
//! the next outstanding target, preserving older chart/read-only consumers.
use super::*;

pub(super) fn has(p: &Value) -> bool {
    p.get("take_profits").is_some()
}

pub(super) fn validate(p: &Value) -> R<()> {
    if !has(p) {
        return Ok(());
    }
    let targets = p["take_profits"]
        .as_array()
        .ok_or("take_profits must be an array")?;
    if targets.is_empty() || targets.len() > 8 {
        return Err("take_profits requires 1 to 8 targets".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut sum = zero();
    let mut previous = None;
    for t in targets {
        strict(t, &["target_id", "price", "quantity"])?;
        bounded(t, "target_id")?;
        if !ids.insert(txt(t, "target_id")?) {
            return Err("duplicate take-profit target id".into());
        }
        let price = positive(t, "price")?;
        if previous.as_ref().is_some_and(|prev| {
            if p["side"] == "BUY" {
                &price <= prev
            } else {
                &price >= prev
            }
        }) {
            return Err("take-profit targets must be ordered from nearest to farthest".into());
        }
        sum += positive(t, "quantity")?;
        previous = Some(price);
    }
    if sum != positive(p, "quantity")?
        || positive(p, "take_profit")? != positive(&targets[0], "price")?
    {
        return Err("take-profit quantities must cover the remaining position and scalar TP must match the next target".into());
    }
    Ok(())
}

pub(super) fn grid(s: &Value, p: &Value) -> R<()> {
    validate(p)?;
    if !has(p) {
        return Ok(());
    }
    let tick = positive(&s["instrument_spec"], "tick_size")?;
    for t in p["take_profits"].as_array().unwrap() {
        qty(s, &positive(t, "quantity")?)?;
        if positive(t, "price")? % &tick != zero() {
            return Err("take-profit price must align to tick size".into());
        }
    }
    Ok(())
}

pub(super) fn assign(s: &Value, p: &mut Value, a: &Value) -> R<()> {
    if let Some(targets) = a.get("take_profits") {
        p.as_object_mut().unwrap().remove("take_profits");
        if !targets.is_null() && targets.as_array().is_none_or(|v| !v.is_empty()) {
            p["take_profits"] = targets.clone();
            p["take_profit"] = targets[0]["price"].clone();
        }
    } else {
        p.as_object_mut().unwrap().remove("take_profits");
    }
    grid(s, p)
}

// Manual closes consume the farthest allocations first. Keep nearer targets
// intact, and merge a sub-minimum tail into its preceding allocation.
pub(super) fn resize(s: &Value, p: &mut Value) -> R<()> {
    if !has(p) {
        return Ok(());
    }
    let mut budget = positive(p, "quantity")?;
    let minimum = positive(&s["instrument_spec"], "quantity_min")?;
    let mut targets = vec![];
    for mut t in p["take_profits"].as_array().unwrap().clone() {
        let mut q = std::cmp::min(positive(&t, "quantity")?, budget.clone());
        if &budget - &q > zero() && &budget - &q < minimum {
            q = budget.clone();
        }
        t["quantity"] = sval(q.clone());
        targets.push(t);
        budget -= q;
        if budget == zero() {
            break;
        }
    }
    p["take_profit"] = targets[0]["price"].clone();
    p["take_profits"] = json!(targets);
    grid(s, p)
}

pub(super) fn split(s: &Value, p: &Value, stop: bool) -> R<(Value, Value, Value)> {
    let target = if stop {
        Value::Null
    } else {
        p["take_profits"][0].clone()
    };
    let q = if stop {
        positive(p, "quantity")?
    } else {
        positive(&target, "quantity")?
    };
    qty(s, &q)?;
    let residual = positive(p, "quantity")? - &q;
    let original = p
        .get("original_quantity")
        .cloned()
        .unwrap_or_else(|| p["quantity"].clone());
    let mut closed = p.clone();
    closed.as_object_mut().unwrap().remove("take_profits");
    closed["quantity"] = sval(q);
    closed["original_quantity"] = original.clone();
    let mut remaining = Value::Null;
    if residual > zero() {
        qty(s, &residual)?;
        remaining = p.clone();
        remaining["quantity"] = sval(residual);
        remaining["original_quantity"] = original;
        remaining["take_profits"].as_array_mut().unwrap().remove(0);
        remaining["take_profit"] = remaining["take_profits"][0]["price"].clone();
        grid(s, &remaining)?;
    }
    Ok((closed, remaining, target))
}

pub(super) fn settle(
    s: &mut Value,
    p: &Value,
    stop: bool,
    bid: &BigDecimal,
    ask: &BigDecimal,
    exit: &BigDecimal,
    reason: &str,
) -> R<Value> {
    let (closed, mut remaining, target) = split(s, p, stop)?;
    let (net, cost) = pnl(s, &closed, bid, ask)?;
    let previous_balance = s["balance"].clone();
    s["balance"] = sval(py(dec(s, "balance")? + &net));
    if !remaining.is_null() {
        remaining["realized_pnl"] = sval(py(p
            .get("realized_pnl")
            .map(d)
            .transpose()?
            .unwrap_or_else(zero)
            + &net));
    }
    s["position"] = remaining.clone();
    Ok(
        json!({"operation_id":p["source_operation_id"],"position_id":p["position_id"],"side":p["side"],
        "quantity":closed["quantity"],"reason":reason,"fill_price":sval(exit.clone()),"net_pnl":sval(net),
        "cost_model_version":cost["cost_model_version"],"cost_breakdown":cost,"closed_position":closed,
        "previous_position":p,"previous_balance":previous_balance,"take_profit_target":target,
        "open_position":remaining,"pending_market_order":null}),
    )
}

pub(super) fn validate_fill(s: &Value, e: &Value, previous: Option<&Value>) -> R<()> {
    let details = &e["details"];
    let p = &details["previous_position"];
    order_valid(p, true)?;
    grid(s, p)?;
    slippage::validate_position(s, p)?;
    let prior = previous.ok_or("partial target fill lacks prior checkpoint")?;
    if prior["details"]["open_position"] != *p || prior["balance"] != details["previous_balance"] {
        return Err("partial target fill differs from prior checkpoint".into());
    }
    let reason = txt(details, "reason")?;
    if ![
        "stop_loss",
        "stop_loss_gap",
        "take_profit",
        "take_profit_gap",
    ]
    .contains(&reason)
    {
        return Err("invalid partial target exit reason".into());
    }
    let stop = reason.starts_with("stop_loss");
    let (closed, mut remaining, target) = split(s, p, stop)?;
    let exit = positive(details, "fill_price")?;
    if !tick_mode(s) {
        let base = if slippage::enabled(s) {
            positive(&details["fill_slippage"], "base_price")?
        } else {
            exit.clone()
        };
        let level = positive(p, if stop { "stop_loss" } else { "take_profit" })?;
        if (!reason.ends_with("_gap") || !stop) && base != level {
            return Err("partial target exit differs from its protective level".into());
        }
        if reason == "stop_loss_gap"
            && if side(p)? == "BUY" {
                base > level
            } else {
                base < level
            }
        {
            return Err("partial target gap violates stop semantics".into());
        }
        let closing_side = if side(p)? == "BUY" { "SELL" } else { "BUY" };
        let executed = slippage::validate_fill(
            s,
            &details["fill_slippage"],
            &base,
            closing_side,
            if stop { "stop" } else { "limit" },
            txt(p, "source_operation_id")?,
            int(e, "cursor_index")?,
            int(e, "virtual_time_utc")?,
        )?;
        if exit != executed {
            return Err("partial target slippage differs".into());
        }
    }
    let (net, cost) = pnl(s, &closed, &exit, &exit)?;
    if !remaining.is_null() {
        remaining["realized_pnl"] = sval(py(p
            .get("realized_pnl")
            .map(d)
            .transpose()?
            .unwrap_or_else(zero)
            + &net));
    }
    let floating = if remaining.is_null() {
        zero()
    } else if tick_mode(s) {
        pnl(
            s,
            &remaining,
            &positive(details, "bid")?,
            &positive(details, "ask")?,
        )?
        .0
    } else {
        pnl(s, &remaining, &exit, &exit)?.0
    };
    if details["closed_position"] != closed
        || details["open_position"] != remaining
        || details["take_profit_target"] != target
        || details["quantity"] != closed["quantity"]
        || details["side"] != p["side"]
        || details["position_id"] != p["position_id"]
        || details["operation_id"] != p["source_operation_id"]
        || dec(details, "net_pnl")? != net
        || !cost_matches(&details["cost_breakdown"], &cost)
        || details["cost_model_version"] != cost["cost_model_version"]
        || dec(e, "balance")? != py(dec(prior, "balance")? + net)
        || int(e, "open_positions")? != i64::from(!remaining.is_null())
        || dec(e, "floating_pl")? != floating
    {
        return Err("partial target fill differs from quantity/cost accounting".into());
    }
    Ok(())
}
