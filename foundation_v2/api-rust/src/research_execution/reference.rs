//! Deterministic closed-bar research computation; never broker execution.
#[path = "independent.rs"]
pub mod independent;
use crate::{replay_core, research_jobs};
use bigdecimal::{BigDecimal, RoundingMode, ToPrimitive, Zero};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    str::FromStr,
    time::{Duration, Instant},
};

type R<T> = Result<T, String>;
fn f(value: &Value, name: &str) -> R<f64> {
    if value.is_boolean() {
        return Err(format!("{name} must be positive"));
    }
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or_else(|| format!("{name} must be positive"))
}
fn integer(value: &Value, name: &str) -> R<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str()?.parse().ok())
        .ok_or_else(|| format!("{name} must be an integer"))
}
fn decimal(value: &Value) -> R<BigDecimal> {
    let text = if let Some(text) = value.as_str() {
        text.to_owned()
    } else {
        value.to_string()
    };
    if text.len() > 512 {
        return Err("research decimal exceeds safety budget".into());
    }
    let value = BigDecimal::from_str(&text).map_err(|_| "invalid research decimal")?;
    if value.as_bigint_and_exponent().1.unsigned_abs() > 512 {
        return Err("research decimal exceeds safety budget".into());
    }
    Ok(value)
}
fn dec_float(value: f64) -> R<BigDecimal> {
    BigDecimal::from_str(&research_jobs::python_float(value)?)
        .map_err(|_| "invalid research decimal".into())
}
fn num(value: BigDecimal) -> R<Value> {
    value
        .to_f64()
        .filter(|v| v.is_finite())
        .map(|v| json!(v))
        .ok_or("research output must be finite".into())
}
pub(super) fn cost_snapshot(raw: &Value) -> R<Value> {
    let mut cost = raw.clone();
    let object = cost
        .as_object_mut()
        .ok_or("cost_model must be structured")?;
    for name in [
        "commission_per_side_account",
        "minimum_fee_account",
        "slippage_price_per_side",
        "financing_account",
    ] {
        object.entry(name).or_insert(json!("0"));
    }
    object.entry("quote_to_account_rate").or_insert(json!("1"));
    object.entry("rounding_decimals").or_insert(json!(2));
    for name in ["version", "spread_basis", "account_ccy"] {
        let text = cost[name]
            .as_str()
            .ok_or_else(|| format!("{name} is required"))?
            .trim()
            .to_owned();
        cost[name] = json!(if name == "account_ccy" {
            text.to_uppercase()
        } else {
            text
        });
    }
    Ok(cost)
}

/// Validate a persisted reference artifact against immutable identity and source.
/// This is stricter than the retained approximate reconciliation: publication
/// accepts only the deterministic canonical output, while tests retain Python
/// as an independent implementation oracle.
pub fn reconcile_reference(
    result: &Value,
    rows: &[Value],
    engine_hash: &str,
    continue_check: impl Fn() -> R<()>,
) -> R<Value> {
    if result["artifact_schema_version"] != "research-engine-result-v1" {
        return Err("unsupported research engine artifact schema".into());
    }
    let protocol = &result["protocol"];
    if !protocol.is_object() || !result["ledger"].is_array() || !result["metrics"].is_object() {
        return Err("research engine artifact is incomplete".into());
    }
    if protocol["engine"]["backend"] != "reference" {
        return Err("native reference reconciliation requires backend=reference".into());
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(research_jobs::canonical_py_json(protocol)?)
    );
    if result["protocol_sha256"] != hash {
        return Err("protocol hash mismatch".into());
    }
    for (actual, expected) in [
        ("playbook_id", &protocol["playbook"]["record_id"]),
        ("playbook_revision", &protocol["playbook"]["revision"]),
        ("dataset_sha256", &protocol["dataset"]["artifact_sha256"]),
        ("engine_code_sha256", &protocol["engine"]["code_sha256"]),
        ("split", &protocol["split"]),
    ] {
        if &result[actual] != expected {
            return Err("result identity differs from protocol".into());
        }
    }
    if result["metrics"]["metric_schema_version"] != "metrics-v2" {
        return Err("unsupported metrics schema".into());
    }
    let expected = execute_breakout(rows, protocol, engine_hash, &continue_check)?;
    for field in ["assumptions", "signals", "ledger", "metrics"] {
        continue_check()?;
        if research_jobs::canonical_py_json(&result[field])?
            != research_jobs::canonical_py_json(&expected[field])?
        {
            return Err(format!(
                "reference {field} differs from immutable source execution"
            ));
        }
    }
    for field in ["from_utc", "to_utc", "bar_count"] {
        if result["observed_range"][field] != expected["observed_range"][field] {
            return Err("reference observed range differs from source".into());
        }
    }
    Ok(
        json!({"reconciled":true,"trade_count":result["ledger"].as_array().unwrap().len(),"metric_schema_version":"metrics-v2","oracle":"native-reference-source-v1","source_fills_verified":true}),
    )
}

pub fn execute_breakout(
    rows: &[Value],
    protocol: &Value,
    engine_hash: &str,
    continue_check: impl Fn() -> R<()>,
) -> R<Value> {
    let milliseconds = integer(
        &protocol["budget"]["max_runtime_ms"],
        "budget.max_runtime_ms",
    )?;
    let deadline = Instant::now()
        + Duration::from_millis(
            u64::try_from(milliseconds).map_err(|_| "run exceeded budget.max_runtime_ms")?,
        );
    execute_breakout_until(rows, protocol, engine_hash, &continue_check, deadline)
}

pub fn execute_breakout_until(
    rows: &[Value],
    protocol: &Value,
    engine_hash: &str,
    continue_check: &impl Fn() -> R<()>,
    deadline: Instant,
) -> R<Value> {
    let check = || {
        if Instant::now() >= deadline {
            Err("run exceeded budget.max_runtime_ms".into())
        } else {
            continue_check()
        }
    };
    check()?;
    if protocol["engine"]["version"] != "bar-breakout-v1" {
        return Err("unsupported engine version".into());
    }
    if protocol["engine"]["code_sha256"] != engine_hash {
        return Err("engine code hash no longer matches queued protocol".into());
    }
    let rules = &protocol["playbook"]["rules"];
    research_jobs::validate_rules(rules)?;
    let lookback = usize::try_from(integer(&rules["lookback"], "rules.lookback")?)
        .map_err(|_| "rules.lookback must be a positive integer")?;
    let hold = usize::try_from(integer(&rules["hold_bars"], "rules.hold_bars")?)
        .map_err(|_| "rules.hold_bars must be a positive integer")?;
    let quantity = f(&rules["quantity"], "rules.quantity")?;
    let stop_distance = f(
        &rules["planned_stop_distance_price"],
        "rules.planned_stop_distance_price",
    )?;
    let direction = rules["direction"].as_str().unwrap_or("both");
    let protective = rules["exit_mode"].as_str() == Some("protective");
    let leverage = if protective {
        if protocol["parameters"]["research_margin"]["version"]
            != "fixed-starting-balance-leverage-v1"
        {
            return Err("protective research requires fixed research margin assumptions".into());
        }
        Some(dec_float(f(
            &protocol["parameters"]["research_margin"]["leverage"],
            "parameters.research_margin.leverage",
        )?)?)
    } else {
        None
    };
    let instrument = &protocol["dataset"]["instrument_spec"];
    let timeframe = integer(
        &protocol["dataset"]["timeframe_seconds"],
        "dataset.timeframe_seconds",
    )?;
    if timeframe <= 0 {
        return Err("dataset.timeframe_seconds must be a positive integer".into());
    }
    let minimum = f(&instrument["quantity_min"], "quantity_min")?;
    let step = f(&instrument["quantity_step"], "quantity_step")?;
    if quantity < minimum || (quantity / step - (quantity / step).round_ties_even()).abs() > 1e-9 {
        return Err("strategy quantity violates instrument minimum/step".into());
    }
    let from = integer(&protocol["range"]["from_utc"], "range.from_utc")?;
    let to = integer(&protocol["range"]["to_utc"], "range.to_utc")?;
    let max_bars = integer(&protocol["budget"]["max_bars"], "budget.max_bars")?;
    if rows.len() as i128 > max_bars as i128 {
        return Err("run exceeded budget.max_bars".into());
    }
    let mut bars = Vec::new();
    for row in rows {
        check()?;
        let timestamp = integer(&row["timestamp"], "timestamp")?;
        if timestamp >= from
            && timestamp
                .checked_add(timeframe)
                .is_some_and(|end| end <= to)
        {
            let o = f(&row["open"], "open")?;
            let h = f(&row["high"], "high")?;
            let l = f(&row["low"], "low")?;
            let c = f(&row["close"], "close")?;
            if !(l <= o.min(c) && o.max(c) <= h) {
                return Err("invalid OHLC bar".into());
            }
            bars.push(row);
        }
    }
    if bars.len() < lookback.saturating_add(hold).saturating_add(1) {
        return Err("dataset range is too short for playbook rules".into());
    }
    let mut previous = None;
    for row in &bars {
        let t = integer(&row["timestamp"], "timestamp")?;
        if let Some(previous) = previous {
            if t <= previous {
                return Err("engine requires strictly ordered unique bars".into());
            }
            if t - previous < timeframe {
                return Err(
                    "bars overlap the declared timeframe; closed-bar timing is unsafe".into(),
                );
            }
        }
        previous = Some(t);
    }
    let cost = cost_snapshot(&protocol["parameters"]["cost_model"])?;
    let spread = protocol["parameters"]
        .get("spread_price")
        .cloned()
        .unwrap_or(json!(0));
    let spread_decimal = decimal(&spread)?;
    if spread_decimal < BigDecimal::zero() {
        return Err("spread_price must be finite and nonnegative".into());
    }
    let state = json!({"instrument_spec":instrument,"spread_price":spread,"cost_model":cost});
    let tick = decimal(&instrument["tick_size"])?;
    let contract = f(&instrument["contract_size"], "contract_size")?;
    let rate = decimal(&cost["quote_to_account_rate"])?;
    let balance = f(&protocol["starting_balance"], "starting_balance")?;
    let mut ledger = Vec::new();
    let mut signals = json!({"long":0,"short":0,"no_signal":0,"skipped_overlap":0});
    if protective {
        signals["skipped_margin"] = json!(0);
    }
    let mut next_free = lookback;
    for i in lookback..bars.len() - hold {
        check()?;
        let signal = integer(&bars[i]["timestamp"], "timestamp")? + timeframe;
        if signal > to {
            break;
        }
        let high = bars[i - lookback..i]
            .iter()
            .map(|row| f(&row["high"], "high"))
            .collect::<R<Vec<_>>>()?
            .into_iter()
            .fold(f64::NEG_INFINITY, f64::max);
        let low = bars[i - lookback..i]
            .iter()
            .map(|row| f(&row["low"], "low"))
            .collect::<R<Vec<_>>>()?
            .into_iter()
            .fold(f64::INFINITY, f64::min);
        let close = f(&bars[i]["close"], "close")?;
        let side = if close > high && matches!(direction, "long" | "both") {
            "BUY"
        } else if close < low && matches!(direction, "short" | "both") {
            "SELL"
        } else {
            signals["no_signal"] = json!(signals["no_signal"].as_u64().unwrap() + 1);
            continue;
        };
        let key = if side == "BUY" { "long" } else { "short" };
        signals[key] = json!(signals[key].as_u64().unwrap() + 1);
        if i < next_free {
            signals["skipped_overlap"] = json!(signals["skipped_overlap"].as_u64().unwrap() + 1);
            continue;
        }
        let entry_index = i + 1;
        let exit_index = i + hold;
        let entry = bars[entry_index];
        let exit = bars[exit_index];
        let mut close_time = integer(&exit["timestamp"], "timestamp")? + timeframe;
        if close_time > to {
            break;
        }
        let (entry_bid, entry_ask) = replay_core::quote(&state, &decimal(&entry["open"])?)?;
        let mut actual_exit = exit_index;
        let mut exit_reason = "horizon";
        let mut stop = None;
        let mut take = None;
        let mut margin = None;
        let mut exit_quote = None;
        if protective {
            let fill = if side == "BUY" {
                &entry_ask
            } else {
                &entry_bid
            };
            let required = (fill
                * dec_float(quantity)?
                * decimal(&instrument["contract_size"])?
                * rate.clone()
                / leverage.as_ref().unwrap())
            .with_prec(28);
            if required > dec_float(balance)? {
                signals["skipped_margin"] = json!(signals["skipped_margin"].as_u64().unwrap() + 1);
                continue;
            }
            let sd = dec_float(f(
                &rules["stop_loss_distance_price"],
                "rules.stop_loss_distance_price",
            )?)?;
            let td = dec_float(f(
                &rules["take_profit_distance_price"],
                "rules.take_profit_distance_price",
            )?)?;
            let (sl, tp) = if side == "BUY" {
                (
                    ((fill - &sd) / &tick)
                        .with_prec(28)
                        .with_scale_round(0, RoundingMode::Floor)
                        * &tick,
                    ((fill + td) / &tick)
                        .with_prec(28)
                        .with_scale_round(0, RoundingMode::Ceiling)
                        * &tick,
                )
            } else {
                (
                    ((fill + sd) / &tick)
                        .with_prec(28)
                        .with_scale_round(0, RoundingMode::Ceiling)
                        * &tick,
                    ((fill - td) / &tick)
                        .with_prec(28)
                        .with_scale_round(0, RoundingMode::Floor)
                        * &tick,
                )
            };
            if sl <= BigDecimal::zero() || tp <= BigDecimal::zero() {
                return Err("protective levels must remain positive".into());
            }
            let position =
                json!({"side":side,"stop_loss":sl.to_string(),"take_profit":tp.to_string()});
            for index in entry_index..=exit_index {
                check()?;
                if let Some((price, reason, at_open)) =
                    replay_core::protective(&state, &position, bars[index], index > entry_index)?
                {
                    actual_exit = index;
                    close_time = integer(&bars[index]["timestamp"], "timestamp")?
                        + if at_open { 0 } else { timeframe };
                    exit_quote = Some((price.clone(), price));
                    exit_reason = reason;
                    break;
                }
            }
            stop = Some(sl);
            take = Some(tp);
            margin = Some(required);
        }
        let (exit_bid, exit_ask) = match exit_quote {
            Some(q) => q,
            None => replay_core::quote(&state, &decimal(&exit["close"])?)?,
        };
        let position = json!({"side":side,"quantity":research_jobs::python_float(quantity)?,"entry_bid":entry_bid.to_string(),"entry_ask":entry_ask.to_string()});
        // Retained research converts the contract size to float before cost input.
        let mut cost_state = state.clone();
        cost_state["instrument_spec"]["contract_size"] =
            json!(research_jobs::python_float(contract)?);
        let (_, costs) = replay_core::pnl(&cost_state, &position, &exit_bid, &exit_ask)?;
        let fees = decimal(&costs["commission_account"])?
            + decimal(&costs["slippage_account"])?
            + decimal(&costs["financing_account"])?;
        let adjustment =
            decimal(&costs["net_account"])? - decimal(&costs["gross_account"])? + &fees;
        let planned_risk =
            stop_distance * quantity * contract * rate.to_f64().ok_or("invalid conversion rate")?;
        let mut trade = json!({"trade_id":format!("engine-{}",ledger.len()+1),"signal_time_utc":signal,"open_time_utc":entry["timestamp"],"close_time_utc":close_time,
            "symbol":instrument["instrument_id"],"side":side,"quantity":quantity,"price_open":costs["entry_fill"],"price_close":costs["exit_fill"],
            "gross_pnl":costs["gross_account"],"fees":num(fees)?,"rounding_adjustment":num(adjustment)?,"net_pnl":costs["net_account"],
            "planned_risk_budget":planned_risk,"realized_r":costs["net_account"].as_f64().ok_or("invalid net output")?/planned_risk,"costs":costs,
            "exit_model":if protective{"protective_bracket"}else{"fixed_horizon_bar_close"}});
        if protective {
            trade["exit_reason"] = json!(exit_reason);
            trade["protective_stop_price"] = num(stop.unwrap())?;
            trade["protective_take_profit_price"] = num(take.unwrap())?;
            trade["research_margin_required_account"] = num(margin.unwrap())?;
        }
        ledger.push(trade);
        next_free = actual_exit;
    }
    check()?;
    let metrics = crate::analytics::compute_metrics_v2(&ledger, &json!(balance))?;
    check()?;
    let nonzero_cost = [
        "commission_per_side_account",
        "minimum_fee_account",
        "slippage_price_per_side",
        "financing_account",
    ]
    .iter()
    .any(|key| decimal(&cost[*key]).is_ok_and(|value| !value.is_zero()));
    let leverage_text = if let Some(leverage) = leverage {
        format!(
            "fixed starting-balance leverage {}:1; research assumption only, not broker evidence",
            leverage.normalized()
        )
    } else {
        "disabled; not broker execution evidence".into()
    };
    Ok(json!({"assumptions":{
        "timing":if protective{"closed bar -> next open +1ns; protective boundary ticks only for unambiguous OHLC threshold hits; fixed horizon fallback"}else{"closed-bar signal; next-bar-open entry; fixed-horizon bar-close exit"},
        "overlap":"single position; overlapping signals skipped","spread_price":num(spread_decimal.clone())?,"price_basis":"midpoint OHLC plus assumed constant spread; adverse tick rounding",
        "slippage_basis":"explicit round-trip monetary cost, not added to fill price","rounding":"U2 component/net rounding; explicit rounding_adjustment in ledger","cost_model_version":cost["version"],
        "cost_evidence":if !spread_decimal.is_zero()||nonzero_cost{"modeled costs; not broker-confirmed"}else{"hypothetical zero-cost scenario"},"planned_risk_model":"fixed_stop_distance_budget_v1",
        "protective_orders":if protective{"stop-market + take-profit limit; same-bar dual-hit fails closed; hold_bars is max horizon"}else{"disabled; planned stop distance is an R denominator only"},
        "margin_model":leverage_text,"data_quality":protocol["dataset"]["quality"],"data_source":protocol["dataset"]["source"]},
        "signals":signals,"ledger":ledger,"metrics":metrics,"observed_range":{"from_utc":bars[0]["timestamp"],"to_utc":to.min(integer(&bars.last().unwrap()["timestamp"],"timestamp")?+timeframe),"bar_count":bars.len()}}))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn artifact_reconciliation_rejects_each_tampered_boundary() {
        let path = format!(
            "{}/tests/fixtures/research_execution/reference.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        for case in cases
            .iter()
            .filter(|c| c["expected"]["canonical"].is_string())
        {
            let protocol = &case["protocol"];
            let expected: Value =
                serde_json::from_str(case["expected"]["canonical"].as_str().unwrap()).unwrap();
            let rows = case["rows"].as_array().unwrap();
            let mut artifact = expected;
            artifact["artifact_schema_version"] = json!("research-engine-result-v1");
            artifact["protocol"] = protocol.clone();
            artifact["protocol_sha256"] = json!(format!(
                "{:x}",
                Sha256::digest(research_jobs::canonical_py_json(protocol).unwrap())
            ));
            artifact["playbook_id"] = protocol["playbook"]["record_id"].clone();
            artifact["playbook_revision"] = protocol["playbook"]["revision"].clone();
            artifact["dataset_sha256"] = protocol["dataset"]["artifact_sha256"].clone();
            artifact["engine_code_sha256"] = protocol["engine"]["code_sha256"].clone();
            artifact["split"] = protocol["split"].clone();
            reconcile_reference(&artifact, rows, "engine-fixed-hash", || Ok(())).unwrap();
            independent::validate(&artifact, rows, || Ok(()))
                .unwrap_or_else(|e| panic!("independent {}: {e}", case["name"]));
            for pointer in [
                "/protocol_sha256",
                "/dataset_sha256",
                "/assumptions/timing",
                "/signals/long",
                "/metrics/net_pnl",
                "/observed_range/bar_count",
            ] {
                let mut changed = artifact.clone();
                *changed.pointer_mut(pointer).unwrap() = json!("tampered");
                assert!(
                    reconcile_reference(&changed, rows, "engine-fixed-hash", || Ok(())).is_err(),
                    "{pointer}"
                );
            }
            if !artifact["ledger"].as_array().unwrap().is_empty() {
                let mut changed = artifact.clone();
                changed["ledger"][0]["price_close"] = json!(999);
                assert!(
                    reconcile_reference(&changed, rows, "engine-fixed-hash", || Ok(())).is_err()
                );
            }
            assert!(
                reconcile_reference(&artifact, rows, "engine-fixed-hash", || Err(
                    "research_execution_interrupted".into()
                ))
                .is_err()
            );
        }
    }
    pub(crate) fn compare(actual: &Value, expected: &Value, path: &str) -> R<()> {
        if let (Some(a), Some(b)) = (actual.as_object(), expected.as_object()) {
            if a.len() != b.len() {
                return Err(format!("{path} keys differ"));
            }
            for (key, value) in b {
                compare(
                    a.get(key).unwrap_or(&Value::Null),
                    value,
                    &format!("{path}.{key}"),
                )?;
            }
            return Ok(());
        }
        if let (Some(a), Some(b)) = (actual.as_array(), expected.as_array()) {
            if a.len() != b.len() {
                return Err(format!("{path} len{} != {}", a.len(), b.len()));
            }
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}[{index}]"))?;
            }
            return Ok(());
        }
        let a = String::from_utf8(research_jobs::canonical_py_json(actual)?).unwrap();
        let b = String::from_utf8(research_jobs::canonical_py_json(expected)?).unwrap();
        if a != b {
            return Err(format!("{path}: {} != {}", a.trim(), b.trim()));
        }
        Ok(())
    }
    #[test]
    fn python_execution_oracle() {
        let fixture = std::env::var("TW_REFERENCE_ORACLE").unwrap_or_else(|_| {
            format!(
                "{}/tests/fixtures/research_execution/reference.json",
                env!("CARGO_MANIFEST_DIR")
            )
        });
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
        assert!(cases.len() >= 200);
        let mut failures = Vec::new();
        for (index, case) in cases.iter().enumerate() {
            let actual = execute_breakout(
                case["rows"].as_array().unwrap(),
                &case["protocol"],
                "engine-fixed-hash",
                || Ok(()),
            );
            match actual {
                Ok(value) => {
                    if let Some(text) = case["expected"]["canonical"].as_str() {
                        let expected: Value = serde_json::from_str(text).unwrap();
                        if let Err(error) = compare(&value, &expected, "") {
                            failures.push(format!("case {index}: {error}"));
                        }
                    } else {
                        failures.push(format!("case{index}: unexpected success"));
                    }
                }
                Err(error) => {
                    if json!(error) != case["expected"]["error"] {
                        failures.push(format!(
                            "case{index}: {error} != {}",
                            case["expected"]["error"]
                        ));
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures: {:?}",
            failures.len(),
            &failures[..failures.len().min(20)]
        );
    }
}
