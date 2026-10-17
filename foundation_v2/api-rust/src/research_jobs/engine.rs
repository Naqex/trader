//! Pure engine admission: validates pinned metadata without reading data or probing runtimes.
use bigdecimal::{BigDecimal, Zero};
use num_bigint::BigInt;
use serde_json::{Map, Value, json};
use std::str::FromStr;

pub fn build_protocol(
    body: &Value,
    manifest: &Value,
    payload: &Value,
    engine_hash: &str,
    native_descriptor: Option<&Value>,
) -> Result<Value, String> {
    build_protocol_with_runtime(body, manifest, payload, engine_hash, || {
        Ok(native_descriptor.cloned())
    })
}

pub fn build_protocol_with_runtime(
    body: &Value,
    manifest: &Value,
    payload: &Value,
    engine_hash: &str,
    runtime: impl FnOnce() -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let disposition = manifest
        .pointer("/quality/disposition")
        .filter(|v| truthy(v))
        .map(py_str)
        .transpose()?
        .unwrap_or_default();
    if disposition != "pass" {
        return Err(format!(
            "dataset is not QA-approved: {}",
            if disposition.is_empty() {
                "unknown"
            } else {
                &disposition
            }
        ));
    }
    let spec = manifest.get("instrument_spec").filter(|v| !v.is_null());
    let timeframe = manifest.get("timeframe_seconds").filter(|v| !v.is_null());
    let (spec, timeframe) = match (spec, timeframe) {
        (Some(spec), Some(timeframe)) => (spec, timeframe),
        _ => {
            return Err(
                "dataset is missing instrument/timeframe snapshot required by engine".into(),
            );
        }
    };
    if payload.get("status").and_then(Value::as_str) != Some("frozen") {
        return Err("engine research requires an exact frozen playbook revision".into());
    }
    if payload.get("execution_capability").and_then(Value::as_str) != Some("engine-supported") {
        return Err("playbook revision is not engine-supported".into());
    }
    let empty_rules = json!({});
    let rules = payload
        .get("rules")
        .filter(|v| truthy(v))
        .unwrap_or(&empty_rules);
    super::validate_rules(rules)?;
    let leverage = body.get("research_leverage").filter(|v| !v.is_null());
    if rules.get("exit_mode").and_then(Value::as_str) == Some("protective") && leverage.is_none() {
        return Err("protective research requires research_leverage".into());
    }
    let from = integer(&body["data_from_utc"], "data_from_utc")?;
    let to = integer(&body["data_to_utc"], "data_to_utc")?;
    if to <= from {
        return Err("data_to_utc must be greater than data_from_utc".into());
    }
    let available_end = integer(&manifest["last_timestamp"], "last_timestamp")?
        + integer(timeframe, "timeframe_seconds")?;
    if from < integer(&manifest["first_timestamp"], "first_timestamp")? || to > available_end {
        return Err("requested research range exceeds dataset available range".into());
    }
    let holdout_default = json!({"mode":"none"});
    let holdout = manifest
        .get("holdout_policy")
        .filter(|v| truthy(v))
        .unwrap_or(&holdout_default);
    if holdout.get("mode").and_then(Value::as_str) != Some("none") {
        let boundary = holdout.get("from_utc").filter(|v| !v.is_null());
        if holdout.get("mode").and_then(Value::as_str) != Some("metadata_only")
            || boundary.is_none()
        {
            return Err("dataset holdout policy is invalid".into());
        }
        let boundary = integer(boundary.unwrap(), "holdout.from_utc")?;
        if to > boundary || available_end > boundary {
            return Err("requested research data reaches locked holdout data".into());
        }
    }
    let instrument = instrument(spec)?;
    let costs = body["cost_model"]
        .as_object()
        .ok_or("cost_model must be structured")?;
    let currency = cost_model(costs)?;
    if currency != instrument.account {
        return Err("cost model account currency does not match instrument snapshot".into());
    }
    let backend = body
        .get("engine_backend")
        .and_then(Value::as_str)
        .unwrap_or("nautilus");
    let mut engine =
        json!({"version":"bar-breakout-v1","code_sha256":engine_hash,"backend":backend});
    if backend == "nautilus" {
        let native_descriptor = runtime()?;
        let native = native_descriptor
            .as_ref()
            .ok_or("isolated Nautilus runtime is unavailable")?;
        if instrument.asset_class != "fx" || instrument.account != instrument.quote {
            return Err(
                "Nautilus FX adapter requires account currency equal to quote currency".into(),
            );
        }
        let adapter = native
            .get("adapter_sha256")
            .and_then(Value::as_str)
            .ok_or("isolated Nautilus runtime is unavailable")?;
        let identity = native
            .get("runtime_identity")
            .filter(|v| v.is_object())
            .ok_or("isolated Nautilus runtime is unavailable")?;
        let engine = engine.as_object_mut().unwrap();
        engine.insert("native_version".into(), json!("1.231.0"));
        engine.insert("adapter_version".into(), json!("nautilus-breakout-v1"));
        engine.insert("adapter_sha256".into(), json!(adapter));
        engine.insert("runtime_identity".into(), identity.clone());
        if let Some(dependencies) = native.get("dependency_sha256") {
            if !dependencies.as_str().is_some_and(|hash|hash.len()==64 && hash.bytes().all(|b|b.is_ascii_digit() || (b'a'..=b'f').contains(&b))) {
                return Err("scientific dependency manifest is invalid".into());
            }
            engine.insert("dependency_sha256".into(), dependencies.clone());
        }
    }
    let mut parameters = json!({"spread_price":float(body.get("spread_price").unwrap_or(&json!(0.0)), "spread_price")?,
        "cost_model":body["cost_model"]});
    if let Some(leverage) = leverage {
        parameters["research_margin"] = json!({"version":"fixed-starting-balance-leverage-v1", "leverage":float(leverage,"research_leverage")?});
    }
    let mut snapshot = Map::new();
    for key in [
        "dataset_id",
        "artifact_sha256",
        "normalized_sha256",
        "instrument_spec",
        "timeframe_seconds",
        "transform_version",
        "quality",
        "holdout_policy",
    ] {
        let fallback = match key {
            "quality" => json!({}),
            "holdout_policy" => json!({"mode":"none"}),
            _ => Value::Null,
        };
        snapshot.insert(key.into(), manifest.get(key).cloned().unwrap_or(fallback));
    }
    let mut source = Map::new();
    for key in [
        "source_id",
        "provider",
        "instrument_mapping",
        "license_use",
        "retrieved_at_utc",
        "export_settings",
    ] {
        source.insert(key.into(), manifest["source"][key].clone());
    }
    snapshot.insert("source".into(), Value::Object(source));
    let mut playbook = json!({"record_id":body["playbook_id"],"revision":body["playbook_revision"],
        "name":payload.get("name").cloned().unwrap_or(Value::Null),
        "execution_capability":payload["execution_capability"], "rules":rules});
    if let Some(strategy) = payload.get("strategy_spec").filter(|v| !v.is_null()) {
        playbook["strategy_spec"] = strategy.clone();
    }
    let mut protocol = json!({"schema_version":"research-protocol-v1","playbook":playbook,"dataset":snapshot,
        "range":{"from_utc":big_int_json(&from)?,"to_utc":big_int_json(&to)?},
        "split":body.get("split").cloned().unwrap_or(json!("baseline")),
        "starting_balance":float(&body["starting_balance"],"starting_balance")?,
        "seed":body.get("seed").cloned().unwrap_or(json!(0)), "parameters":parameters,"engine":engine,
        "budget":{"max_bars":body.get("max_bars").cloned().unwrap_or(json!(100_000)),
            "max_runtime_ms":body.get("max_runtime_ms").cloned().unwrap_or(json!(30_000)),
            "max_memory_mb":body.get("max_memory_mb").cloned().unwrap_or(json!(1024))}});
    if let Some(regime) = body.get("regime_partition").filter(|v| !v.is_null()) {
        let mut request = regime
            .as_object()
            .ok_or("regime_partition must be structured")?
            .clone();
        request.insert("schema".into(), json!("regime-partition-request-v1"));
        protocol["regime_partition"] = Value::Object(request);
    }
    let walk = body.get("walk_forward").filter(|v| !v.is_null());
    let space = body.get("parameter_space").filter(|v| !v.is_null());
    let trials = body.get("max_trials").filter(|v| !v.is_null());
    if walk.is_some() || space.is_some() || trials.is_some() {
        let (walk, space, trials) = match (walk, space, trials) {
            (Some(walk), Some(space), Some(trials)) => (walk, space, trials),
            _ => {
                return Err(
                    "walk_forward, parameter_space and max_trials must be provided together".into(),
                );
            }
        };
        if protocol["split"] != "validation" {
            return Err("OOS configuration requires split=validation".into());
        }
        protocol["validation"] = super::oos::canonical_oos_request(
            rules,
            walk,
            space,
            trials
                .as_u64()
                .ok_or("max_trials must be an integer >= 1")?,
        )?;
    }
    Ok(protocol)
}

struct Instrument {
    asset_class: String,
    quote: String,
    account: String,
}

fn instrument(spec: &Value) -> Result<Instrument, String> {
    text(spec.get("instrument_id"), "instrument_id")?;
    let asset_class = text(spec.get("asset_class"), "asset_class")?;
    text(spec.get("base_ccy"), "base_ccy")?;
    let quote = text(spec.get("quote_ccy"), "quote_ccy")?.to_uppercase();
    let account = text(spec.get("account_ccy"), "account_ccy")?.to_uppercase();
    for field in [
        "tick_size",
        "pip_size",
        "contract_size",
        "quantity_min",
        "quantity_step",
    ] {
        decimal(spec.get(field), field, true, false)?;
    }
    text(spec.get("effective_from_utc"), "effective_from_utc")?;
    Ok(Instrument {
        asset_class,
        quote,
        account,
    })
}

fn cost_model(costs: &Map<String, Value>) -> Result<String, String> {
    let fields = [
        "version",
        "spread_basis",
        "commission_per_side_account",
        "minimum_fee_account",
        "slippage_price_per_side",
        "financing_account",
        "quote_to_account_rate",
        "account_ccy",
        "rounding_decimals",
    ];
    if costs.keys().any(|field| !fields.contains(&field.as_str())) {
        return Err("unsupported cost model fields".into());
    }
    let rounding = costs.get("rounding_decimals").cloned().unwrap_or(json!(2));
    if !rounding.is_number() || rounding.to_string().contains(['.', 'e', 'E']) {
        return Err("cost rounding_decimals must be an integer".into());
    }
    if text(costs.get("spread_basis"), "spread_basis")? != "bid_ask_embedded" {
        return Err("spread_basis must be bid_ask_embedded".into());
    }
    let rounding = integer(&rounding, "rounding_decimals")?;
    if rounding < BigInt::from(0) || rounding > BigInt::from(8) {
        return Err("rounding_decimals must be between 0 and 8".into());
    }
    text(costs.get("version"), "version")?;
    for field in [
        "commission_per_side_account",
        "minimum_fee_account",
        "slippage_price_per_side",
    ] {
        decimal(costs.get(field).or(Some(&json!(0))), field, false, true)?;
    }
    decimal(
        costs.get("financing_account").or(Some(&json!(0))),
        "financing_account",
        false,
        false,
    )?;
    decimal(
        costs.get("quote_to_account_rate").or(Some(&json!(1))),
        "quote_to_account_rate",
        true,
        false,
    )?;
    Ok(text(costs.get("account_ccy"), "account_ccy")?.to_uppercase())
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(v) => v.as_f64() != Some(0.0),
        Value::String(v) => !v.is_empty(),
        Value::Array(v) => !v.is_empty(),
        Value::Object(v) => !v.is_empty(),
    }
}
fn py_str(value: &Value) -> Result<String, String> {
    Ok(match value {
        Value::String(v) => v.clone(),
        Value::Bool(v) => if *v { "True" } else { "False" }.into(),
        Value::Null => "None".into(),
        _ => String::from_utf8(super::canonical_py_json(value)?)
            .map_err(|_| "invalid text")?
            .trim()
            .into(),
    })
}
fn text(value: Option<&Value>, name: &str) -> Result<String, String> {
    let text = value
        .filter(|v| truthy(v))
        .map(py_str)
        .transpose()?
        .unwrap_or_default();
    let text =
        text.trim_matches(|ch: char| ch.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&ch));
    if text.is_empty() {
        Err(format!("{name} is required"))
    } else {
        Ok(text.into())
    }
}
fn decimal(
    value: Option<&Value>,
    name: &str,
    positive: bool,
    nonnegative: bool,
) -> Result<BigDecimal, String> {
    let text = py_str(value.unwrap_or(&Value::Null))?;
    let text = super::oos::python_numeric_text(
        text.trim_matches(|ch: char| ch.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&ch)),
    )
    .replace('_', "");
    let finite = text.trim_start_matches(['+', '-']).to_ascii_lowercase();
    if finite
        .strip_prefix("nan")
        .or_else(|| finite.strip_prefix("snan"))
        .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
        || matches!(finite.as_str(), "inf" | "infinity")
    {
        return Err(format!("{name} must be finite"));
    }
    let parsed = BigDecimal::from_str(&text).map_err(|_| format!("{name} must be numeric"))?;
    if positive && parsed <= BigDecimal::zero() {
        return Err(format!("{name} must be positive"));
    }
    if nonnegative && parsed < BigDecimal::zero() {
        return Err(format!("{name} must be >= 0"));
    }
    Ok(parsed)
}
fn integer(value: &Value, name: &str) -> Result<BigInt, String> {
    let error = || format!("{name} must be an integer");
    let text = match value {
        Value::Bool(value) => u8::from(*value).to_string(),
        Value::Number(value) if value.to_string().contains(['.', 'e', 'E']) => {
            format!("{:.0}", value.as_f64().ok_or_else(error)?.trunc())
        }
        _ => super::oos::python_numeric_text(&py_str(value)?).replace('_', ""),
    };
    BigInt::from_str(&text).map_err(|_| error())
}
fn big_int_json(value: &BigInt) -> Result<Value, String> {
    serde_json::from_str(&value.to_string()).map_err(|_| "integer cannot be serialized".into())
}
fn float(value: &Value, name: &str) -> Result<Value, String> {
    value
        .as_f64()
        .filter(|n| n.is_finite())
        .map(|n| json!(n))
        .ok_or_else(|| format!("{name} must be finite"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn python_oracle_differential() {
        let corpus: Vec<Value> = serde_json::from_str(include_str!(
            "../../../evidence/rust-native-20261017/runtime/engine-integrated/oracle.json"
        ))
        .unwrap();
        assert!(corpus.len() >= 350);
        for (index, case) in corpus.iter().enumerate() {
            let input = &case["input"];
            let expected = &case["expected"];
            let actual = build_protocol(
                &input["body"],
                &input["manifest"],
                &input["payload"],
                "engine-fixed-hash",
                input.get("native").filter(|v| !v.is_null()),
            );
            match actual {
                Ok(value) => assert_eq!(
                    String::from_utf8(super::super::canonical_py_json(&value).unwrap()).unwrap(),
                    expected["canonical"].as_str().unwrap(),
                    "case {index}"
                ),
                Err(error) => assert_eq!(json!(error), expected["error"], "case {index}"),
            }
        }
    }
    #[test]
    fn decimal_constraints_match_retained_contracts() {
        assert!(decimal(Some(&json!(true)), "x", false, false).is_err());
        assert!(decimal(Some(&json!("-0")), "x", true, false).is_err());
        assert!(decimal(Some(&json!("-0")), "x", false, true).is_ok());
        assert_eq!(
            decimal(Some(&json!("١.٥")), "x", true, false).unwrap(),
            BigDecimal::from_str("1.5").unwrap()
        );
    }
    #[test]
    fn protocol_identity_pins_the_installed_dependencies() {
        let corpus:Vec<Value>=serde_json::from_str(include_str!("../../../evidence/rust-native-20261017/runtime/engine-integrated/oracle.json")).unwrap();
        let input=&corpus.iter().find(|case|case["expected"]["canonical"].as_str().and_then(|s|serde_json::from_str::<Value>(s).ok()).is_some_and(|v|v["engine"]["backend"]=="nautilus")).unwrap()["input"];
        let mut descriptor=input["native"].clone();
        let mut build=|hash:&str| {
            descriptor["dependency_sha256"]=json!(hash);
            build_protocol(&input["body"],&input["manifest"],&input["payload"],"engine-fixed-hash",Some(&descriptor))
        };
        let first=build(&"a".repeat(64)).unwrap();
        let second=build(&"b".repeat(64)).unwrap();
        assert_eq!(first["engine"]["dependency_sha256"],"a".repeat(64));
        assert_ne!(super::super::canonical_py_json(&first).unwrap(),super::super::canonical_py_json(&second).unwrap());
        assert_eq!(build("invalid").unwrap_err(),"scientific dependency manifest is invalid");
    }
}
