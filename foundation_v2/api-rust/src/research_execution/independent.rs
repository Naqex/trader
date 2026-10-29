//! Publication oracle deliberately independent of replay, engine and analytics helpers.
//! Source fills, costs and closed-balance metrics are recomputed with Decimal arithmetic.
use bigdecimal::{BigDecimal as D, RoundingMode, ToPrimitive, Zero};
use serde_json::{Value, json};
use std::str::FromStr;
type R<T> = Result<T, String>;
fn d(v: &Value) -> R<D> {
    if v.is_boolean() {
        return Err("oracle numeric value is invalid".into());
    }
    let raw = v
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string());
    if raw.len() > 512 {
        return Err("oracle decimal exceeds safety budget".into());
    }
    let value = D::from_str(&raw).map_err(|_| "oracle numeric value is invalid")?;
    if value.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err("oracle decimal exceeds safety budget".into());
    }
    Ok(value)
}
fn constant(v: i64) -> D {
    D::from(v)
}
fn add(a: &D, b: &D) -> D {
    (a + b).with_prec(28)
}
fn sub(a: &D, b: &D) -> D {
    (a - b).with_prec(28)
}
fn mul(a: &D, b: &D) -> D {
    (a * b).with_prec(28)
}
fn div(a: &D, b: &D) -> R<D> {
    if b.is_zero() {
        return Err("oracle division by zero".into());
    }
    Ok((a / b).with_prec(28))
}
fn expect(v: &Value, e: &D, name: &str) -> R<()> {
    let actual = d(v)?.to_f64().ok_or("oracle value is not finite")?;
    let expected = e.to_f64().ok_or("oracle value is not finite")?;
    if !actual.is_finite()
        || !expected.is_finite()
        || (actual - expected).abs() > 1e-8_f64.max(1e-10 * actual.abs().max(expected.abs()))
    {
        return Err(format!("{name} does not match independent oracle"));
    }
    Ok(())
}
fn optional(v: &Value, e: Option<D>, name: &str) -> R<()> {
    match e {
        Some(e) => expect(v, &e, name),
        None if v.is_null() => Ok(()),
        None => Err(format!("{name} should be unavailable")),
    }
}
fn rounded(v: &D, tick: &D, up: bool) -> R<D> {
    Ok(mul(
        &div(v, tick)?.with_scale_round(
            0,
            if up {
                RoundingMode::Ceiling
            } else {
                RoundingMode::Floor
            },
        ),
        tick,
    ))
}
fn quote(v: &Value, spread: &D, tick: &D) -> R<(D, D)> {
    let p = d(v)?;
    let half = div(spread, &constant(2))?;
    let bid = rounded(&sub(&p, &half), tick, false)?;
    let ask = rounded(&add(&p, &half), tick, true)?;
    if bid <= D::zero() {
        return Err("source quote is nonpositive".into());
    }
    Ok((bid, ask))
}
fn fill(v: &Value, spread: &D, tick: &D, buy: bool, entry: bool) -> R<D> {
    let (bid, ask) = quote(v, spread, tick)?;
    Ok(if buy == entry { ask } else { bid })
}
fn time(v: &Value) -> R<i64> {
    v.as_i64().ok_or("oracle timestamp must be integer".into())
}
fn amount(v: &Value, key: &str, default: i64) -> R<D> {
    v.get(key).map(d).unwrap_or_else(|| Ok(constant(default)))
}
pub(in crate::research_execution) fn general(v: &D) -> R<String> {
    let value = v
        .to_f64()
        .filter(|v| v.is_finite())
        .ok_or("invalid leverage")?;
    let scientific = format!("{value:.5e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent: i32 = exponent.parse().unwrap();
    if (-4..6).contains(&exponent) {
        let text = format!("{:.*}", (5 - exponent).max(0) as usize, value);
        Ok(if text.contains('.') {
            text.trim_end_matches('0').trim_end_matches('.').to_owned()
        } else {
            text
        })
    } else {
        Ok(format!(
            "{}e{}{:02}",
            mantissa.trim_end_matches('0').trim_end_matches('.'),
            if exponent >= 0 { "+" } else { "-" },
            exponent.unsigned_abs()
        ))
    }
}
fn assumptions(result: &Value, protocol: &Value, protective: bool, native: bool) -> R<()> {
    let timing = if protective {
        "closed bar -> next open +1ns; protective boundary ticks only for unambiguous OHLC threshold hits; fixed horizon fallback"
    } else if native {
        "closed bar -> next open +1ns modeled ordering; fixed-horizon close"
    } else {
        "closed-bar signal; next-bar-open entry; fixed-horizon bar-close exit"
    };
    let protection = if protective {
        if native {
            "actual Nautilus market-entry bracket with stop-market + take-profit limit; same-bar dual-hit preflight fails closed; hold_bars is max horizon"
        } else {
            "stop-market + take-profit limit; same-bar dual-hit fails closed; hold_bars is max horizon"
        }
    } else {
        "disabled; planned stop distance is an R denominator only"
    };
    let margin = if protective {
        format!(
            "fixed starting-balance leverage {}:1; research assumption only, not broker evidence",
            general(&d(&protocol["parameters"]["research_margin"]["leverage"])?)?
        )
    } else {
        "disabled; not broker execution evidence".into()
    };
    for (key, expected) in [
        ("timing", timing),
        ("protective_orders", protection),
        ("margin_model", margin.as_str()),
    ] {
        if result["assumptions"][key] != expected {
            return Err(format!(
                "assumptions.{key} differs from protocol/backend contract"
            ));
        }
    }
    Ok(())
}

struct SourceTrade {
    decision: usize,
    entry: usize,
    exit: usize,
    buy: bool,
    entry_price: D,
    exit_price: D,
    stop: Option<D>,
    take: Option<D>,
    margin: Option<D>,
    reason: &'static str,
    closed: i64,
}

fn native_context(result: &Value, protocol: &Value, ledger: &[Value]) -> R<()> {
    let execution = &result["execution"];
    let fills = execution["fills"]
        .as_array()
        .ok_or("Nautilus execution evidence is missing")?;
    for (key, error) in [
        (
            "native_version",
            "Nautilus runtime identity differs from protocol",
        ),
        (
            "adapter_version",
            "Nautilus adapter identity differs from protocol",
        ),
        (
            "runtime_identity",
            "Nautilus runtime environment differs from protocol",
        ),
    ] {
        if execution.get(key).is_none() || execution[key] != protocol["engine"][key] {
            return Err(error.into());
        }
    }
    let isolation = &execution["isolation"];
    if isolation["worker_owned_job_object"] != true || isolation["active_process_limit"] != 1 {
        return Err("Nautilus process isolation evidence is incomplete".into());
    }
    if isolation["process_memory_limit_mb"] != protocol["budget"]["max_memory_mb"] {
        return Err("Nautilus memory isolation differs from protocol".into());
    }
    if execution["signals"] != result["signals"] {
        return Err("Nautilus signal evidence differs from result".into());
    }
    for key in ["from_utc", "to_utc", "bar_count"] {
        if execution["observed_range"][key] != result["observed_range"][key] {
            return Err("Nautilus observed range differs from result".into());
        }
    }
    if fills.len() != ledger.len() * 2 {
        return Err("Nautilus fill count does not match ledger".into());
    }
    for key in ["native_trade_id", "client_order_id"] {
        let mut seen = std::collections::HashSet::new();
        for fill in fills {
            let id = fill[key]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("Nautilus fill/order identities are missing or duplicated")?;
            if !seen.insert(id) {
                return Err("Nautilus fill/order identities are missing or duplicated".into());
            }
        }
    }
    Ok(())
}

fn native_trade(
    trade: &Value,
    entry: &Value,
    exit: &Value,
    units: &D,
    protective: bool,
    label: &str,
) -> R<()> {
    let link = json!({"entry_order_id":entry["client_order_id"],"exit_order_id":exit["client_order_id"],
        "entry_fill_id":entry["native_trade_id"],"exit_fill_id":exit["native_trade_id"],
        "entry_timestamp_ns":entry["timestamp_ns"],"exit_timestamp_ns":exit["timestamp_ns"]});
    if trade["execution_link"] != link {
        return Err(format!(
            "{label} Nautilus execution identity differs from raw fills"
        ));
    }
    if entry["role"] != "entry" || exit["role"] != "exit" {
        return Err(format!("{label} Nautilus fill roles are invalid"));
    }
    if entry["signal_time_utc"] != trade["signal_time_utc"]
        || exit["signal_time_utc"] != trade["signal_time_utc"]
    {
        return Err(format!("{label} Nautilus fill signal linkage is invalid"));
    }
    if entry["side"] != trade["side"] || exit["side"] == trade["side"] {
        return Err(format!("{label} Nautilus fill sides are invalid"));
    }
    for fill in [entry, exit] {
        expect(&fill["units"], units, &format!("{label}.native.units"))?;
    }
    expect(
        &entry["price"],
        &d(&trade["price_open"])?,
        &format!("{label}.native_entry.price"),
    )?;
    expect(
        &exit["price"],
        &d(&trade["price_close"])?,
        &format!("{label}.native_exit.price"),
    )?;
    let opened = time(&trade["open_time_utc"])?;
    let closed = time(&trade["close_time_utc"])?;
    let opened_ns = opened
        .checked_mul(1_000_000_000)
        .and_then(|n| n.checked_add(1))
        .ok_or("Nautilus timestamp exceeds supported range")?;
    let mut closed_ns = closed
        .checked_mul(1_000_000_000)
        .ok_or("Nautilus timestamp exceeds supported range")?;
    if time(&entry["timestamp_ns"])? != opened_ns || entry["order_type"] != "MARKET" {
        return Err(format!(
            "{label} Nautilus entry timing/type differs from next-open contract"
        ));
    }
    if protective {
        let reason = trade["exit_reason"]
            .as_str()
            .ok_or("protective exit reason is invalid")?;
        if exit["exit_reason"] != reason || exit["close_time_utc"] != closed {
            return Err(format!(
                "{label} Nautilus protective exit context differs from ledger"
            ));
        }
        let order_type = match reason {
            "stop_loss" | "stop_loss_gap" => "STOP_MARKET",
            "take_profit" | "take_profit_gap" => "LIMIT",
            "horizon" => "MARKET",
            _ => return Err(format!("{label} protective exit reason is invalid")),
        };
        if exit["order_type"] != order_type {
            return Err(format!(
                "{label} Nautilus protective order type differs from exit reason"
            ));
        }
        closed_ns = if reason.ends_with("_gap") {
            closed_ns.checked_add(1)
        } else if reason == "horizon" {
            Some(closed_ns)
        } else {
            closed_ns.checked_sub(1)
        }
        .ok_or("Nautilus timestamp exceeds supported range")?;
        if reason != "horizon"
            && (entry["order_list_id"].as_str().is_none_or(|s| s.is_empty())
                || entry["order_list_id"] != exit["order_list_id"])
        {
            return Err(format!(
                "{label} Nautilus protective fills are not linked to one bracket"
            ));
        }
    }
    if time(&exit["timestamp_ns"])? != closed_ns {
        return Err(format!(
            "{label} Nautilus fill timing differs from modeled event"
        ));
    }
    Ok(())
}

/// Separate source traversal; does not consume the execution engine's signals or trades.
fn source(
    rows: &[&Value],
    protocol: &Value,
    check: &impl Fn() -> R<()>,
) -> R<(Value, Vec<SourceTrade>)> {
    let rules = &protocol["playbook"]["rules"];
    let look = rules["lookback"]
        .as_u64()
        .ok_or("invalid oracle lookback")? as usize;
    let hold = rules["hold_bars"]
        .as_u64()
        .filter(|v| *v > 0)
        .ok_or("invalid oracle horizon")? as usize;
    let direction = rules["direction"].as_str().unwrap_or("both");
    let protective = rules["exit_mode"] == "protective";
    let instrument = &protocol["dataset"]["instrument_spec"];
    let model = &protocol["parameters"]["cost_model"];
    let tick = d(&instrument["tick_size"])?;
    let spread = amount(&protocol["parameters"], "spread_price", 0)?;
    let units = mul(&d(&rules["quantity"])?, &d(&instrument["contract_size"])?);
    let rate = amount(model, "quote_to_account_rate", 1)?;
    let tf = time(&protocol["dataset"]["timeframe_seconds"])?;
    if tick <= D::zero() || tf <= 0 {
        return Err("invalid oracle quote contract".into());
    }
    let mut signals = json!({"long":0,"short":0,"no_signal":0,"skipped_overlap":0});
    if protective {
        signals["skipped_margin"] = json!(0);
    }
    let mut trades = vec![];
    let mut free = look;
    for i in look..rows.len().saturating_sub(hold) {
        check()?;
        let close = d(&rows[i]["close"])?;
        let prior = &rows[i - look..i];
        if prior.is_empty() {
            return Err("invalid oracle lookback".into());
        }
        let high = prior
            .iter()
            .map(|r| d(&r["high"]))
            .collect::<R<Vec<_>>>()?
            .into_iter()
            .max()
            .unwrap();
        let low = prior
            .iter()
            .map(|r| d(&r["low"]))
            .collect::<R<Vec<_>>>()?
            .into_iter()
            .min()
            .unwrap();
        let buy = if close > high && matches!(direction, "both" | "long") {
            true
        } else if close < low && matches!(direction, "both" | "short") {
            false
        } else {
            signals["no_signal"] = json!(signals["no_signal"].as_u64().unwrap() + 1);
            continue;
        };
        let key = if buy { "long" } else { "short" };
        signals[key] = json!(signals[key].as_u64().unwrap() + 1);
        if i < free {
            signals["skipped_overlap"] = json!(signals["skipped_overlap"].as_u64().unwrap() + 1);
            continue;
        }
        let entry = i + 1;
        let mut exit = i + hold;
        let entry_price = fill(&rows[entry]["open"], &spread, &tick, buy, true)?;
        let mut exit_price = None;
        let mut closed = time(&rows[exit]["timestamp"])? + tf;
        let mut stop = None;
        let mut take = None;
        let mut margin = None;
        let mut reason = "horizon";
        if protective {
            let leverage = d(&protocol["parameters"]["research_margin"]["leverage"])?;
            if protocol["parameters"]["research_margin"]["version"]
                != "fixed-starting-balance-leverage-v1"
                || leverage <= D::zero()
            {
                return Err("protective result lacks immutable research margin assumptions".into());
            }
            let required = div(&mul(&mul(&entry_price, &units), &rate), &leverage)?;
            if required > d(&protocol["starting_balance"])? {
                signals["skipped_margin"] = json!(signals["skipped_margin"].as_u64().unwrap() + 1);
                continue;
            }
            let sd = d(&rules["stop_loss_distance_price"])?;
            let td = d(&rules["take_profit_distance_price"])?;
            let sl = rounded(
                &if buy {
                    sub(&entry_price, &sd)
                } else {
                    add(&entry_price, &sd)
                },
                &tick,
                !buy,
            )?;
            let tp = rounded(
                &if buy {
                    add(&entry_price, &td)
                } else {
                    sub(&entry_price, &td)
                },
                &tick,
                buy,
            )?;
            if sl <= D::zero() || tp <= D::zero() {
                return Err("protective levels are nonpositive".into());
            }
            for k in entry..=exit {
                check()?;
                let row = rows[k];
                if k > entry {
                    let open = fill(&row["open"], &spread, &tick, buy, false)?;
                    let stop_hit = if buy { open <= sl } else { open >= sl };
                    let take_hit = if buy { open >= tp } else { open <= tp };
                    if stop_hit || take_hit {
                        exit_price = Some(if stop_hit { open } else { tp.clone() });
                        reason = if stop_hit {
                            "stop_loss_gap"
                        } else {
                            "take_profit_gap"
                        };
                        closed = time(&row["timestamp"])?;
                        exit = k;
                        break;
                    }
                }
                let low = fill(&row["low"], &spread, &tick, buy, false)?;
                let high = fill(&row["high"], &spread, &tick, buy, false)?;
                let stop_hit = if buy { low <= sl } else { high >= sl };
                let take_hit = if buy { high >= tp } else { low <= tp };
                if stop_hit && take_hit {
                    return Err("source bar has ambiguous protective exit".into());
                }
                if stop_hit || take_hit {
                    exit_price = Some(if stop_hit { sl.clone() } else { tp.clone() });
                    reason = if stop_hit { "stop_loss" } else { "take_profit" };
                    closed = time(&row["timestamp"])? + tf;
                    exit = k;
                    break;
                }
            }
            stop = Some(sl);
            take = Some(tp);
            margin = Some(required);
        }
        let exit_price = match exit_price {
            Some(p) => p,
            None => fill(&rows[exit]["close"], &spread, &tick, buy, false)?,
        };
        free = exit;
        trades.push(SourceTrade {
            decision: i,
            entry,
            exit,
            buy,
            entry_price,
            exit_price,
            stop,
            take,
            margin,
            reason,
            closed,
        });
    }
    Ok((signals, trades))
}

/// Same public receipt contract as retained independent-decimal-v1, with a separate
/// Rust source/cost/balance oracle. Approximate comparison is retained only at the
/// publication boundary because artifacts deliberately serialize Decimal as float.
pub fn validate(result: &Value, rows: &[Value], check: impl Fn() -> R<()>) -> R<Value> {
    check()?;
    if result["artifact_schema_version"] != "research-engine-result-v1" {
        return Err("unsupported research engine artifact schema".into());
    }
    let protocol = &result["protocol"];
    let ledger = result["ledger"]
        .as_array()
        .ok_or("research engine artifact is incomplete")?;
    let metrics = &result["metrics"];
    if !protocol.is_object() || !metrics.is_object() {
        return Err("research engine artifact is incomplete".into());
    }
    use sha2::{Digest, Sha256};
    let hash = format!(
        "{:x}",
        Sha256::digest(crate::research_jobs::canonical_py_json(protocol)?)
    );
    if result["protocol_sha256"] != hash {
        return Err("protocol hash mismatch".into());
    }
    for (key, expected) in [
        ("playbook_id", &protocol["playbook"]["record_id"]),
        ("playbook_revision", &protocol["playbook"]["revision"]),
        ("dataset_sha256", &protocol["dataset"]["artifact_sha256"]),
        ("engine_code_sha256", &protocol["engine"]["code_sha256"]),
        ("split", &protocol["split"]),
    ] {
        if &result[key] != expected {
            return Err("result identity differs from protocol".into());
        }
    }
    if metrics["metric_schema_version"] != "metrics-v2" {
        return Err("unsupported metrics schema".into());
    }
    let native = match protocol["engine"]["backend"].as_str() {
        Some("reference") => false,
        Some("nautilus") => true,
        _ => return Err("independent source validation requires a supported backend".into()),
    };
    if native {
        native_context(result, protocol, ledger)?;
    }
    let rules = &protocol["playbook"]["rules"];
    let instrument = &protocol["dataset"]["instrument_spec"];
    let model = &protocol["parameters"]["cost_model"];
    let protective = rules["exit_mode"] == "protective";
    let tf = time(&protocol["dataset"]["timeframe_seconds"])?;
    let from = time(&protocol["range"]["from_utc"])?;
    let to = time(&protocol["range"]["to_utc"])?;
    assumptions(result, protocol, protective, native)?;
    let selected = rows
        .iter()
        .filter(|r| {
            r["timestamp"]
                .as_i64()
                .is_some_and(|t| t >= from && t.checked_add(tf).is_some_and(|t| t <= to))
        })
        .collect::<Vec<_>>();
    if selected
        .windows(2)
        .any(|w| w[0]["timestamp"].as_i64() >= w[1]["timestamp"].as_i64())
    {
        return Err("oracle source must be chronological".into());
    }
    let (signals, expected) = source(&selected, protocol, &check)?;
    if signals != result["signals"] {
        return Err("signal counters do not match independent source oracle".into());
    }
    if expected.len() != ledger.len() {
        return Err("ledger trade count differs from independent source oracle".into());
    }
    let quantity = d(&rules["quantity"])?;
    let units = mul(&quantity, &d(&instrument["contract_size"])?);
    let rate = amount(model, "quote_to_account_rate", 1)?;
    let risk = mul(
        &mul(&d(&rules["planned_stop_distance_price"])?, &units),
        &rate,
    );
    let tick = d(&instrument["tick_size"])?;
    let rounding = model["rounding_decimals"].as_i64().unwrap_or(2);
    let money = |v: &D| v.with_scale_round(rounding, RoundingMode::HalfUp);
    let mut nets = vec![];
    let mut grosses = vec![];
    let mut fees_all = vec![];
    let mut rs = vec![];
    let mut last = from;
    for (index, (trade, expected)) in ledger.iter().zip(expected).enumerate() {
        check()?;
        let label = format!("ledger[{index}]");
        let side = if expected.buy { "BUY" } else { "SELL" };
        if trade["side"] != side
            || trade["trade_id"] != format!("engine-{}", index + 1)
            || trade["symbol"] != instrument["instrument_id"]
            || trade["exit_model"]
                != if protective {
                    "protective_bracket"
                } else {
                    "fixed_horizon_bar_close"
                }
        {
            return Err(format!("{label} identity/execution model is invalid"));
        }
        if native {
            let fills = result["execution"]["fills"].as_array().unwrap();
            native_trade(
                trade,
                &fills[index * 2],
                &fills[index * 2 + 1],
                &units,
                protective,
                &label,
            )?;
        }
        let entry = d(&trade["price_open"])?;
        let exit = d(&trade["price_close"])?;
        if entry <= D::zero()
            || exit <= D::zero()
            || !(&entry % &tick).is_zero()
            || !(&exit % &tick).is_zero()
        {
            return Err(format!("{label} fill is off tick or nonpositive"));
        }
        let signal = time(&trade["signal_time_utc"])?;
        let open = time(&trade["open_time_utc"])?;
        let close = time(&trade["close_time_utc"])?;
        if !(last <= signal && signal <= open && open < close && close <= to)
            || signal != time(&selected[expected.decision]["timestamp"])? + tf
            || open != time(&selected[expected.entry]["timestamp"])?
            || close != expected.closed
        {
            return Err(format!("{label} timing differs from source oracle"));
        }
        last = close;
        expect(&trade["quantity"], &quantity, &label)?;
        expect(&trade["price_open"], &expected.entry_price, &label)?;
        expect(&trade["price_close"], &expected.exit_price, &label)?;
        if protective {
            expect(
                &trade["protective_stop_price"],
                expected.stop.as_ref().unwrap(),
                &label,
            )?;
            expect(
                &trade["protective_take_profit_price"],
                expected.take.as_ref().unwrap(),
                &label,
            )?;
            expect(
                &trade["research_margin_required_account"],
                expected.margin.as_ref().unwrap(),
                &label,
            )?;
            if trade["exit_reason"] != expected.reason {
                return Err(format!(
                    "{label} protective exit differs from source oracle"
                ));
            }
        }
        let gross_quote = mul(
            &mul(&sub(&exit, &entry), &units),
            &constant(if expected.buy { 1 } else { -1 }),
        );
        let raw = mul(&gross_quote, &rate);
        let commission = mul(
            &amount(model, "commission_per_side_account", 0)?,
            &constant(2),
        )
        .max(amount(model, "minimum_fee_account", 0)?);
        let slip = mul(
            &mul(
                &mul(&amount(model, "slippage_price_per_side", 0)?, &constant(2)),
                &units,
            ),
            &rate,
        );
        let financing = amount(model, "financing_account", 0)?;
        let gross = money(&raw);
        let fee = add(&add(&money(&commission), &money(&slip)), &money(&financing));
        let net = money(&sub(&sub(&sub(&raw, &commission), &slip), &financing));
        let realized = div(&net, &risk)?;
        for (key, value) in [
            ("entry_fill", entry),
            ("exit_fill", exit),
            ("gross_quote", gross_quote),
            ("gross_account", gross.clone()),
            ("commission_account", money(&commission)),
            ("slippage_account", money(&slip)),
            ("financing_account", money(&financing)),
            ("net_account", net.clone()),
        ] {
            expect(
                &trade["costs"][key],
                &value,
                &format!("{label}.costs.{key}"),
            )?;
        }
        for (key, value) in [
            ("gross_pnl", gross.clone()),
            ("fees", fee.clone()),
            ("net_pnl", net.clone()),
            ("rounding_adjustment", add(&sub(&net, &gross), &fee)),
            ("planned_risk_budget", risk.clone()),
            ("realized_r", realized.clone()),
        ] {
            expect(&trade[key], &value, &format!("{label}.{key}"))?;
        }
        let _ = expected.exit;
        nets.push(net);
        grosses.push(gross);
        fees_all.push(fee);
        rs.push(realized);
    }
    let sum = |values: &[D]| values.iter().fold(D::zero(), |a, v| add(&a, v));
    let count = nets.len();
    let n = constant(count as i64);
    let epsilon = D::from_str("1e-12").unwrap();
    let wins = nets
        .iter()
        .filter(|v| **v > epsilon)
        .cloned()
        .collect::<Vec<_>>();
    let losses = nets
        .iter()
        .filter(|v| **v < -&epsilon)
        .cloned()
        .collect::<Vec<_>>();
    let start = d(&protocol["starting_balance"])?;
    let mut balance = start.clone();
    let mut peak = start.clone();
    let mut max_dd = D::zero();
    let mut max_pct = D::zero();
    let mut streak = 0;
    let mut max_streak = 0;
    let mut balances = vec![start.clone()];
    let mut drawdowns = vec![(peak.clone(), D::zero(), D::zero())];
    for net in &nets {
        check()?;
        balance = add(&balance, net);
        peak = peak.max(balance.clone());
        let dd = sub(&peak, &balance);
        let pct = mul(&div(&dd, &peak)?, &constant(100));
        max_dd = max_dd.max(dd.clone());
        max_pct = max_pct.max(pct.clone());
        streak = if net < &(-&epsilon) { streak + 1 } else { 0 };
        max_streak = max_streak.max(streak);
        balances.push(balance.clone());
        drawdowns.push((peak.clone(), dd, pct));
    }
    for (key, value) in [
        ("starting_balance", start),
        ("closed_trade_count", n.clone()),
        ("wins", constant(wins.len() as i64)),
        ("losses", constant(losses.len() as i64)),
        (
            "breakeven",
            constant((count - wins.len() - losses.len()) as i64),
        ),
        ("gross_pnl", sum(&grosses)),
        ("fees", sum(&fees_all)),
        ("net_pnl", sum(&nets)),
        ("realized_r_known_count", n.clone()),
        ("gross_pnl_known_count", n.clone()),
        ("fees_known_count", n.clone()),
        ("closed_trade_balance_max_drawdown", max_dd),
        ("closed_trade_balance_max_drawdown_pct", max_pct),
        ("max_loss_streak", constant(max_streak)),
        ("ending_closed_trade_balance", balance),
    ] {
        expect(&metrics[key], &value, &format!("metrics.{key}"))?;
    }
    let ratio = |value: D| {
        if count == 0 {
            Ok(None)
        } else {
            div(&value, &n).map(Some)
        }
    };
    for (key, value) in [
        (
            "win_rate_pct",
            ratio(mul(&constant(wins.len() as i64), &constant(100)))?,
        ),
        (
            "loss_rate_pct",
            ratio(mul(&constant(losses.len() as i64), &constant(100)))?,
        ),
        ("expectancy_net_per_trade", ratio(sum(&nets))?),
        ("average_realized_r", ratio(sum(&rs))?),
        (
            "profit_factor_after_cost",
            if losses.is_empty() {
                None
            } else {
                Some(div(&sum(&wins), &(-sum(&losses)))?)
            },
        ),
        (
            "payoff_ratio_after_cost",
            if wins.is_empty() || losses.is_empty() {
                None
            } else {
                Some(div(
                    &div(&sum(&wins), &constant(wins.len() as i64))?,
                    &(-div(&sum(&losses), &constant(losses.len() as i64))?),
                )?)
            },
        ),
    ] {
        optional(&metrics[key], value, &format!("metrics.{key}"))?;
    }
    let curve = metrics["closed_trade_balance_curve"]
        .as_array()
        .ok_or("balance curve is missing")?;
    let dd = metrics["closed_trade_balance_drawdown_curve"]
        .as_array()
        .ok_or("drawdown curve is missing")?;
    if curve.len() != balances.len() || dd.len() != balances.len() {
        return Err("balance/drawdown curve length mismatch".into());
    }
    for (i, balance) in balances.iter().enumerate() {
        expect(&curve[i]["closed_trade_balance"], balance, "balance curve")?;
        if curve[i]["sequence"] != i
            || curve[i]["trade_id"]
                != if i == 0 {
                    Value::Null
                } else {
                    ledger[i - 1]["trade_id"].clone()
                }
        {
            return Err("balance curve trade linkage mismatch".into());
        }
        for (key, value) in [
            ("closed_trade_balance", balance),
            ("peak_closed_trade_balance", &drawdowns[i].0),
            ("drawdown", &drawdowns[i].1),
            ("drawdown_pct", &drawdowns[i].2),
        ] {
            expect(&dd[i][key], value, "drawdown curve")?;
        }
    }
    Ok(
        json!({"reconciled":true,"trade_count":count,"metric_schema_version":"metrics-v2","oracle":"independent-decimal-v1","source_fills_verified":true}),
    )
}
