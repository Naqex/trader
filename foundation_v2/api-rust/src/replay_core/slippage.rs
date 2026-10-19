//! Versioned, deterministic adverse execution; quotes and mark-to-market stay unchanged.
use super::*;
use sha2::{Digest, Sha256};

pub(super) fn enabled(s: &Value) -> bool {
    s["cost_model"]["version"] == "session-cost-v2"
}

pub(super) fn validate_model(s: &Value) -> R<()> {
    let c = &s["cost_model"];
    if !enabled(s) {
        if !c["slippage_model"].is_null() {
            return Err("fill slippage requires session-cost-v2".into());
        }
        return Ok(());
    }
    let m = &c["slippage_model"];
    strict(
        m,
        &[
            "version",
            "mode",
            "fixed_steps",
            "unit",
            "unit_price",
            "seed",
        ],
    )?;
    if m["version"] != "deterministic-adverse-fill-v1"
        || !["off", "light", "medium", "fixed"].contains(&txt(m, "mode")?)
    {
        return Err("unsupported execution slippage model".into());
    }
    bounded(m, "seed")?;
    let fixed = m["mode"] == "fixed";
    if (fixed
        && !m["fixed_steps"]
            .as_u64()
            .is_some_and(|n| (1..=20).contains(&n)))
        || (!fixed && !m["fixed_steps"].is_null())
        || dec(c, "slippage_price_per_side")? != zero()
    {
        return Err(
            "fixed execution slippage must use 1 to 20 steps without cost-only slippage".into(),
        );
    }
    let i = &s["instrument_spec"];
    let fx = i["asset_class"].as_str().is_some_and(|class| {
        class.eq_ignore_ascii_case("fx") || class.eq_ignore_ascii_case("forex")
    });
    let unit = positive(i, if fx { "pip_size" } else { "tick_size" })?;
    let tick = positive(i, "tick_size")?;
    if m["unit"] != if fx { "pip" } else { "tick" }
        || positive(m, "unit_price")? != unit
        || (&unit % &tick) != zero()
        || div(unit * BigDecimal::from(20), tick) > BigDecimal::from(2_000_000)
    {
        return Err(
            "slippage unit must match the dataset pip/tick size with bounded whole ticks".into(),
        );
    }
    Ok(())
}

pub(super) fn fill(
    s: &Value,
    base: &BigDecimal,
    execution_side: &str,
    kind: &str,
    operation: &str,
    cursor: i64,
    time: i64,
) -> R<(BigDecimal, Value)> {
    if !enabled(s) {
        return Ok((base.clone(), Value::Null));
    }
    let m = &s["cost_model"]["slippage_model"];
    let mode = txt(m, "mode")?;
    let maximum = if kind == "limit" || mode == "off" {
        0
    } else if mode == "fixed" {
        int(m, "fixed_steps")?
    } else if mode == "light" {
        if kind == "stop" { 2 } else { 1 }
    } else if kind == "stop" {
        8
    } else {
        3
    };
    let tick = positive(&s["instrument_spec"], "tick_size")?;
    let maximum_ticks = div(
        positive(m, "unit_price")? * BigDecimal::from(maximum),
        tick.clone(),
    )
    .to_u64()
    .ok_or("slippage ticks exceed supported bounds")?;
    let key = json!([
        m["version"],
        m["seed"],
        s["dataset_id"],
        s["dataset_sha256"],
        operation,
        execution_side,
        kind,
        cursor,
        time
    ]);
    let digest = Sha256::digest(serde_json::to_vec(&key).map_err(|e| e.to_string())?);
    let sampled = u64::from_be_bytes(digest[..8].try_into().unwrap());
    let ticks = if mode == "fixed" {
        maximum_ticks
    } else {
        sampled % (maximum_ticks + 1)
    };
    let offset = tick * BigDecimal::from(ticks);
    let executed = if execution_side == "BUY" {
        base + &offset
    } else {
        base - &offset
    };
    if executed <= zero() {
        return Err("adverse slippage produced a nonpositive fill".into());
    }
    let provenance = json!({"version":m["version"],"mode":mode,"unit":m["unit"],"order_kind":kind,
        "execution_side":execution_side,"operation_id":operation,"cursor_index":cursor,"time_utc":time,
        "base_price":sval(base.clone()),"fill_price":sval(executed.clone()),"offset_ticks":ticks,
        "maximum_ticks":maximum_ticks,"seed_sha256":format!("{digest:x}")});
    Ok((executed, provenance))
}

pub(super) fn validate_fill(
    s: &Value,
    observed: &Value,
    base: &BigDecimal,
    side: &str,
    kind: &str,
    operation: &str,
    cursor: i64,
    time: i64,
) -> R<BigDecimal> {
    let (expected, metadata) = fill(s, base, side, kind, operation, cursor, time)?;
    if observed != &metadata {
        return Err("fill slippage provenance differs from frozen deterministic model".into());
    }
    Ok(expected)
}

pub(super) fn validate_position(s: &Value, p: &Value) -> R<()> {
    if p.is_null() {
        return Ok(());
    }
    let base = positive(
        p,
        if side(p)? == "BUY" {
            "entry_ask"
        } else {
            "entry_bid"
        },
    )?;
    let expected = validate_fill(
        s,
        &p["entry_slippage"],
        &base,
        side(p)?,
        p["entry_order_type"].as_str().unwrap_or("market"),
        txt(p, "source_operation_id")?,
        int(p, "opened_cursor_index")?,
        int(p, "opened_time_utc")?,
    )?;
    if enabled(s) && expected != positive(p, "entry_fill")? {
        return Err("position entry differs from its slippage execution".into());
    }
    Ok(())
}
