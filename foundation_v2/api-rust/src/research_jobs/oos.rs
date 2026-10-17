//! Canonical OOS admission only. Row-dependent fold validation belongs to the worker.
use bigdecimal::{BigDecimal, RoundingMode, Zero};
use num_bigint::BigUint;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, num::NonZeroU64, str::FromStr};

const MULTIPLIERS: [&str; 5] = [
    "spread_price_multiplier",
    "commission_multiplier",
    "minimum_fee_multiplier",
    "slippage_multiplier",
    "financing_multiplier",
];
const WALK_FIELDS: [&str; 9] = [
    "train_bars",
    "oos_bars",
    "step_bars",
    "purge_bars",
    "embargo_bars",
    "overlap_bars",
    "expanding",
    "max_folds",
    "stress_scenarios",
];

pub fn canonical_oos_request(
    rules: &Value,
    walk_forward: &Value,
    parameter_space: &Value,
    max_trials: u64,
) -> Result<Value, String> {
    let walk = walk_forward
        .as_object()
        .ok_or("walk_forward must be structured")?;
    reject_unknown(walk, &WALK_FIELDS, "unsupported walk_forward fields")?;
    let space = parameter_space
        .as_object()
        .ok_or("parameter_space must be structured")?;
    let rules = rules
        .as_object()
        .ok_or("playbook rules must be structured")?;
    let mut unknown = space
        .keys()
        .filter(|key| !rules.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();
    unknown.sort();
    if !unknown.is_empty() {
        return Err(format!(
            "parameter sweep references unsupported playbook rules: {}",
            unknown.join(", ")
        ));
    }
    let sweep = bounded_sweep(space, max_trials)?;
    for trial in sweep["trials"].as_array().unwrap() {
        let mut merged = rules.clone();
        merged.extend(trial["parameters"].as_object().unwrap().clone());
        super::validate_rules(&Value::Object(merged))?;
    }
    let declared = walk.get("stress_scenarios").filter(|value| truthy(value));
    let stress = cost_fill_stress(declared)?;
    if sweep["trial_count"].as_u64().unwrap() * stress["scenario_count"].as_u64().unwrap() > 10_000
    {
        return Err("OOS trial/stress matrix exceeds 10000 combinations".into());
    }
    let stress_request = stress["scenarios"].as_array().unwrap()[1..].to_vec();
    // The shared serializer preserves Python's sorted keys, ensure_ascii and final LF.
    let stress_config_sha256 = format!("{:x}", Sha256::digest(super::canonical_py_json(&stress)?));
    let get = |key: &str, default: Value| walk.get(key).cloned().unwrap_or(default);
    let oos_bars = get("oos_bars", Value::Null);
    let max_folds = python_int(walk.get("max_folds").unwrap_or(&json!(20)))?;
    Ok(json!({
        "schema":"research-oos-validation-v1", "holdout_access":false,
        "selection":{"mode":"none","objective":null,"ranking":false,"winner":null,
            "automatic_selection":false,"reason":"objective_not_predeclared"},
        "walk_forward_request":{
            "train_bars":get("train_bars", Value::Null), "oos_bars":oos_bars,
            "step_bars":get("step_bars", get("oos_bars", Value::Null)),
            "purge_bars":get("purge_bars", json!(0)), "embargo_bars":get("embargo_bars", json!(0)),
            "overlap_bars":get("overlap_bars", json!(0)), "expanding":get("expanding", json!(true)),
            "max_folds":max_folds,
        },
        "stress_request":stress_request, "stress":stress, "stress_config_sha256":stress_config_sha256,
        "sweep_request":{"parameter_space":parameter_space, "max_trials":max_trials}, "sweep":sweep,
    }))
}

fn reject_unknown(map: &Map<String, Value>, allowed: &[&str], prefix: &str) -> Result<(), String> {
    let mut unknown = map
        .keys()
        .filter(|key| !allowed.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    unknown.sort();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(format!("{prefix}: {}", unknown.join(", ")))
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn bounded_sweep(space: &Map<String, Value>, max_trials: u64) -> Result<Value, String> {
    if max_trials < 1 {
        return Err("max_trials must be an integer >= 1".into());
    }
    if max_trials > 10_000 {
        return Err("max_trials must be <= 10000".into());
    }
    if space.is_empty() {
        return Err("parameter_space must not be empty".into());
    }
    if space.keys().any(String::is_empty) {
        return Err("parameter names must be non-empty strings".into());
    }
    let mut names = space.keys().collect::<Vec<_>>();
    names.sort();
    let mut options = Vec::new();
    let mut size = BigUint::from(1_u8);
    for name in &names {
        let values = space[*name]
            .as_array()
            .filter(|values| !values.is_empty())
            .ok_or_else(|| format!("parameter {name} must have at least one option"))?;
        size *= values.len();
        options.push(values);
    }
    let size_json: Value = serde_json::from_str(&size.to_string())
        .map_err(|_| "parameter search space exceeds exact native integer range")?;
    let count = size_json.as_u64().unwrap_or(u64::MAX).min(max_trials);
    let mut trials = Vec::with_capacity(count as usize);
    for index in 0..count {
        let mut remaining = index;
        let mut parameters = Map::new();
        for (name, values) in names.iter().zip(&options).rev() {
            parameters.insert(
                (*name).clone(),
                values[(remaining % values.len() as u64) as usize].clone(),
            );
            remaining /= values.len() as u64;
        }
        trials.push(json!({"trial_id":format!("trial-{:04}", index + 1), "parameters":parameters}));
    }
    Ok(
        json!({"schema":"bounded-parameter-sweep-v1", "selection":"deterministic-grid-prefix",
        "search_space_size":size_json, "max_trials":max_trials, "trial_count":count,
        "truncated":size > BigUint::from(count), "trials":trials}),
    )
}

fn cost_fill_stress(declared: Option<&Value>) -> Result<Value, String> {
    let empty = Vec::new();
    let declared = match declared {
        None | Some(Value::Null) => &empty,
        Some(value) => value.as_array().ok_or("stress_scenarios must be a list")?,
    };
    if declared.len() > 7 {
        return Err("stress_scenarios supports at most 7 declared scenarios".into());
    }
    let mut base = Map::new();
    base.insert("scenario_id".into(), json!("base"));
    for field in MULTIPLIERS {
        base.insert(field.into(), json!("1"));
    }
    let mut scenarios = vec![Value::Object(base)];
    let mut seen = HashSet::from(["base".to_owned()]);
    let mut allowed = vec!["scenario_id"];
    allowed.extend(MULTIPLIERS);
    for raw in declared {
        let raw = raw
            .as_object()
            .ok_or("stress scenario must be structured")?;
        reject_unknown(raw, &allowed, "unsupported stress scenario fields")?;
        let id = raw
            .get("scenario_id")
            .and_then(Value::as_str)
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id.as_bytes()[0].is_ascii_alphanumeric()
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            })
            .ok_or("stress scenario_id must use 1-64 letters, digits, dot, dash, or underscore")?;
        if !seen.insert(id.into()) {
            return Err("stress scenario_id values must be unique and cannot reuse base".into());
        }
        let mut normalized = Map::new();
        normalized.insert("scenario_id".into(), json!(id));
        for field in MULTIPLIERS {
            normalized.insert(
                field.into(),
                json!(bounded_multiplier(
                    raw.get(field).unwrap_or(&json!(1)),
                    &format!("{id}.{field}")
                )?),
            );
        }
        if MULTIPLIERS.iter().all(|field| normalized[*field] == "1") {
            return Err("declared stress scenario must change at least one multiplier".into());
        }
        scenarios.push(Value::Object(normalized));
    }
    Ok(
        json!({"schema":"bounded-cost-fill-stress-v1", "selection":"declared-order",
        "max_scenarios":8, "scenario_count":scenarios.len(), "scenarios":scenarios}),
    )
}

fn bounded_multiplier(value: &Value, name: &str) -> Result<String, String> {
    let invalid = || format!("{name} must be a finite multiplier between 0 and 10");
    let text = match value {
        Value::String(value) => python_numeric_text(
            value
                .trim_matches(|ch: char| ch.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&ch)),
        )
        .replace('_', ""),
        Value::Number(_) => String::from_utf8(super::canonical_py_json(value)?)
            .map_err(|_| invalid())?
            .trim()
            .to_owned(),
        _ => return Err(invalid()),
    };
    let parsed = BigDecimal::from_str(&text).map_err(|_| invalid())?;
    if parsed < BigDecimal::zero() || parsed > BigDecimal::from(10) {
        return Err(invalid());
    }
    let (_, scale) = parsed.as_bigint_and_exponent();
    let parsed = if scale > 1_000_026 && scale as i128 - parsed.digits() as i128 > 999_998 {
        // Python's default Decimal context also clamps subnormals at Etiny.
        // Round once at that boundary to avoid both double rounding and huge padding.
        parsed.with_scale_round(1_000_026, RoundingMode::HalfEven)
    } else {
        parsed.with_precision_round(NonZeroU64::new(28).unwrap(), RoundingMode::HalfEven)
    }
    .normalized();
    if parsed.is_zero() {
        return Ok(if text.starts_with('-') { "-0" } else { "0" }.into());
    }
    // Decimal.normalize() rounds with Python's default 28-digit half-even context.
    Ok(parsed.to_plain_string())
}

pub(super) fn python_numeric_text(value: &str) -> String {
    // Unicode 15 Nd blocks match the Python 3.12 oracle, including mixed scripts.
    const ZEROS: [u32; 68] = [
        0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66,
        0xDE6, 0xE50, 0xED0, 0xF20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90,
        0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0,
        0xFF10, 0x104A0, 0x10D30, 0x11066, 0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0,
        0x11650, 0x116C0, 0x11730, 0x118E0, 0x11950, 0x11C50, 0x11D50, 0x11DA0, 0x11F50, 0x16A60,
        0x16AC0, 0x16B50, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6, 0x1E140, 0x1E2F0, 0x1E4F0,
        0x1E950, 0x1FBF0,
    ];
    value
        .trim()
        .chars()
        .map(|ch| {
            ZEROS
                .iter()
                .find_map(|zero| {
                    let code = ch as u32;
                    (code >= *zero && code < *zero + 10)
                        .then(|| char::from(b'0' + (code - zero) as u8))
                })
                .unwrap_or(ch)
        })
        .collect()
}

fn python_int(value: &Value) -> Result<Value, String> {
    let invalid = || "max_folds cannot be converted to an integer".to_owned();
    match value {
        Value::Bool(value) => Ok(json!(u8::from(*value))),
        Value::Number(value) if !value.to_string().contains(['.', 'e', 'E']) => {
            Ok(Value::Number(value.clone()))
        }
        Value::Number(value) => {
            let number = value.as_f64().ok_or_else(invalid)?.trunc();
            // The decimal conversion must use the exact truncated binary float, as int(float) does.
            serde_json::from_str(&format!("{number:.0}")).map_err(|_| invalid())
        }
        Value::String(value) => {
            let text = python_numeric_text(value);
            let text = text.as_str();
            let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
            if digits.is_empty()
                || !digits.as_bytes()[0].is_ascii_digit()
                || !digits.as_bytes()[digits.len() - 1].is_ascii_digit()
                || digits.contains("__")
                || !digits.bytes().all(|b| b.is_ascii_digit() || b == b'_')
            {
                return Err(invalid());
            }
            let text = text.replace('_', "");
            let number = BigDecimal::from_str(&text).map_err(|_| invalid())?;
            serde_json::from_str(&number.normalized().to_plain_string()).map_err(|_| invalid())
        }
        _ => Err(invalid()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Value {
        json!({"engine":"bar-breakout-v1","lookback":2,"hold_bars":3,
        "quantity":1,"planned_stop_distance_price":10})
    }

    #[test]
    fn grid_is_sorted_and_changes_last_parameter_first() {
        let result = canonical_oos_request(
            &rules(),
            &json!({"train_bars":5,"oos_bars":2}),
            &json!({"lookback":[2,4],"hold_bars":[3,5]}),
            3,
        )
        .unwrap();
        assert_eq!(
            result["sweep"]["trials"][1]["parameters"],
            json!({"hold_bars":3,"lookback":4})
        );
        assert_eq!(result["sweep"]["search_space_size"], 4);
        assert_eq!(result["sweep"]["truncated"], true);
        assert_eq!(result["walk_forward_request"]["step_bars"], 2);
        assert_eq!(result["stress_request"], json!([]));
    }

    #[test]
    fn validates_every_merged_trial_even_when_base_is_valid() {
        assert_eq!(
            canonical_oos_request(&rules(), &json!({}), &json!({"lookback":[2,0]}), 2).unwrap_err(),
            "rules.lookback must be a positive integer"
        );
    }

    #[test]
    fn normalizes_decimal_context_and_signed_zero() {
        assert_eq!(
            bounded_multiplier(&json!("1.23456789012345678901234567895"), "x").unwrap(),
            "1.234567890123456789012345679"
        );
        assert_eq!(bounded_multiplier(&json!("-0.00"), "x").unwrap(), "-0");
        assert_eq!(bounded_multiplier(&json!(1e-7), "x").unwrap(), "0.0000001");
        assert!(bounded_multiplier(&json!(true), "x").is_err());
        assert_eq!(
            bounded_multiplier(&json!("1e-1000000000"), "x").unwrap(),
            "0"
        );
        assert_eq!(
            bounded_multiplier(&json!("-0e-1000000000"), "x").unwrap(),
            "-0"
        );
    }

    #[test]
    fn preserves_admission_only_walk_fields_and_falsey_stress() {
        let result = canonical_oos_request(
            &rules(),
            &json!({"train_bars":null,"max_folds":"+00_20", "stress_scenarios":false}),
            &json!({"lookback":[2]}),
            1,
        )
        .unwrap();
        assert_eq!(result["walk_forward_request"]["train_bars"], Value::Null);
        assert_eq!(result["walk_forward_request"]["max_folds"], 20);
        assert_eq!(result["stress"]["scenario_count"], 1);
    }
}
