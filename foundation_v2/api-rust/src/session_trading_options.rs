//! Frozen session assumptions, separate from historical market-data provenance.
use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use std::{collections::HashSet, str::FromStr};

pub const VERSION: &str = "session-trading-options-v1";
pub const COST_VERSION: &str = "session-cost-v1";
pub const VERSION_V2: &str = "session-trading-options-v2";
pub const COST_VERSION_V2: &str = "session-cost-v2";

fn decimal(value: &Value) -> Result<String, String> {
    let text = value.as_str().ok_or("trading option amounts must be decimal strings")?;
    // Bound precision before parsing, including exponent notation.
    if text.is_empty() || text.len() > 32 || !text.bytes().all(|c| c.is_ascii_digit() || c == b'.') {
        return Err("trading option amounts must be nonnegative plain decimals".into());
    }
    let number = BigDecimal::from_str(text).map_err(|_| "invalid trading option decimal")?;
    if number < BigDecimal::from(0) || number > BigDecimal::from(1_000_000)
        || number.as_bigint_and_exponent().1 > 12 {
        return Err("trading option amounts must be at most 1000000 with 12 decimal places".into());
    }
    Ok(number.normalized().to_plain_string())
}

pub fn normalize(value: &Value, datasets: &[String]) -> Result<Value, String> {
    let fields = value.as_object().ok_or("trading_options must be an object")?;
    let v2 = value["version"] == VERSION_V2;
    if fields.len() != 3 || (!v2 && value["version"] != VERSION) || !value["costs_enabled"].is_boolean() {
        return Err("invalid trading_options version or fields".into());
    }
    let assets = value["assets"].as_object().ok_or("trading_options assets must be an object")?;
    let expected: HashSet<_> = datasets.iter().map(String::as_str).collect();
    if datasets.is_empty() || datasets.len() > 12 || expected.len() != datasets.len()
        || assets.len() != expected.len() || assets.keys().any(|id| !expected.contains(id.as_str())) {
        return Err("trading_options assets must exactly match selected datasets".into());
    }
    let mut result = value.clone();
    for (id, asset) in assets {
        let fields = asset.as_object().ok_or("trading asset options must be an object")?;
        if fields.len() != 4 || !["round_trip", "per_side"].contains(&asset["commission_charge"].as_str().unwrap_or("")) {
            return Err("invalid trading asset options or commission charge".into());
        }
        for key in if v2 { vec!["spread_price", "commission_per_lot"] } else { vec!["spread_price", "commission_per_lot", "slippage_price"] } {
            result["assets"][id][key] = json!(decimal(&asset[key])?);
        }
        if v2 {
            let slippage = asset["slippage"].as_object().ok_or("slippage must be an object")?;
            let mode = asset["slippage"]["mode"].as_str().ok_or("slippage mode is required")?;
            if !["off", "light", "medium", "fixed"].contains(&mode)
                || slippage.len() != if mode == "fixed" { 2 } else { 1 }
                || (mode == "fixed" && !asset["slippage"]["fixed_steps"].as_u64().is_some_and(|n| (1..=20).contains(&n))) {
                return Err("slippage must use off/light/medium or fixed with 1 to 20 steps".into());
            }
        }
    }
    Ok(result)
}

/// Override caller-supplied costs with the immutable per-dataset session config.
pub fn initialization(payload: &Value, manifest: &Value, request: &Value) -> Result<Value, String> {
    if payload["trading_options"].is_null() {
        return Ok(request.clone());
    }
    if !request["tick_snapshot_id"].is_null() {
        return Err("session trading options model raw bar prices; tick Bid/Ask cannot be mixed".into());
    }
    let dataset = payload["dataset_id"].as_str().ok_or("dataset_id is required")?;
    let options = &payload["trading_options"];
    let asset = &options["assets"][dataset];
    if !asset.is_object() { return Err("frozen trading options are missing for this dataset".into()); }
    let currency = manifest["instrument_spec"]["account_ccy"].as_str().ok_or("dataset account currency is required")?;
    let enabled = options["costs_enabled"] == true;
    let mut args = request.clone();
    args["spread_price"] = if enabled { asset["spread_price"].clone() } else { json!("0") };
    args["cost_model"] = json!({
        "version":if options["version"] == VERSION_V2 { COST_VERSION_V2 } else { COST_VERSION },"spread_basis":"bid_ask_embedded","account_ccy":currency,
        "commission_per_side_account":"0","minimum_fee_account":"0","financing_account":"0",
        "commission_per_lot_account":if enabled { asset["commission_per_lot"].clone() } else { json!("0") },
        "commission_charge":asset["commission_charge"],"slippage_price_per_side":if options["version"] == VERSION_V2 { json!("0") } else { asset["slippage_price"].clone() },
        "quote_to_account_rate":"1","rounding_decimals":2
    });
    if options["version"] == VERSION_V2 {
        let seed = payload["trading_options_seed"].as_str().ok_or("frozen slippage seed is required")?;
        let instrument = &manifest["instrument_spec"];
        let forex = instrument["asset_class"].as_str().is_some_and(|class| class.eq_ignore_ascii_case("fx") || class.eq_ignore_ascii_case("forex"));
        let (unit, amount) = if forex { ("pip", &instrument["pip_size"]) } else { ("tick", &instrument["tick_size"]) };
        args["cost_model"]["slippage_model"] = json!({"version":"deterministic-adverse-fill-v1","mode":asset["slippage"]["mode"],"fixed_steps":asset["slippage"].get("fixed_steps").cloned().unwrap_or(Value::Null),"unit":unit,"unit_price":amount,"seed":seed});
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options() -> Value { json!({"version":VERSION,"costs_enabled":false,"assets":{"one":{"spread_price":"0.00020","commission_per_lot":"7","commission_charge":"round_trip","slippage_price":"0"}}}) }
    #[test]
    fn validates_exact_asset_set_and_bounded_decimals() {
        let valid = normalize(&options(), &["one".into()]).unwrap();
        assert_eq!(valid["assets"]["one"]["spread_price"], "0.0002");
        assert!(normalize(&valid, &["two".into()]).is_err());
        for invalid in ["NaN", "-1", "1e999999", "1000001", "0.0000000000001"] {
            let mut value = options(); value["assets"]["one"]["spread_price"] = json!(invalid);
            assert!(normalize(&value, &["one".into()]).is_err(), "{invalid}");
        }
    }
    #[test]
    fn frozen_config_overrides_hidden_request_defaults_and_rejects_tick_mix() {
        let payload = json!({"dataset_id":"one","trading_options":options()});
        let manifest = json!({"instrument_spec":{"account_ccy":"USD"}});
        let request = json!({"spread_price":"0.0002","cost_model":{"version":"fixture"}});
        let args = initialization(&payload,&manifest,&request).unwrap();
        assert_eq!(args["spread_price"], "0");
        assert_eq!(args["cost_model"]["commission_per_lot_account"], "0");
        assert_eq!(args["cost_model"]["version"], COST_VERSION);
        let mut tick = request.clone(); tick["tick_snapshot_id"] = json!("ticks-test");
        assert!(initialization(&payload,&manifest,&tick).is_err());
        assert_eq!(initialization(&json!({}),&manifest,&request).unwrap(),request);
    }
    #[test]
    fn v2_slippage_is_explicit_bounded_and_seeded_by_the_server() {
        let mut value = options(); value["version"] = json!(VERSION_V2);
        value["assets"]["one"].as_object_mut().unwrap().remove("slippage_price");
        for mode in ["off","light","medium","fixed"] {
            value["assets"]["one"]["slippage"] = json!({"mode":mode});
            if mode == "fixed" { value["assets"]["one"]["slippage"]["fixed_steps"] = json!(20); }
            assert!(normalize(&value,&["one".into()]).is_ok());
        }
        for bad in [json!({"mode":"fixed","fixed_steps":0}),json!({"mode":"fixed","fixed_steps":21}),json!({"mode":"fixed","fixed_steps":1.5}),json!({"mode":"light","fixed_steps":1}),json!({"mode":"random"})] {
            value["assets"]["one"]["slippage"] = bad;
            assert!(normalize(&value,&["one".into()]).is_err());
        }
        value["assets"]["one"]["slippage"] = json!({"mode":"off"});
        assert!(initialization(&json!({"dataset_id":"one","trading_options":value}),&json!({"instrument_spec":{"account_ccy":"USD"}}),&json!({})).is_err());
    }
}
