//! Structural JSON request validation; domain validators remain owned by their modules.
use crate::auth::ApiError;
use axum::http::StatusCode;
use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use std::str::FromStr;
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
};

static SCHEMAS: LazyLock<HashMap<String, Value>> = LazyLock::new(|| {
    let contracts: Value = serde_json::from_str(include_str!(
        "../../trading_workspace_v2/command_contracts.json"
    ))
    .unwrap();
    contracts
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| {
            let schema = c["parameters"]["body"][0]["schema"].clone();
            if schema.is_null() {
                return None;
            }
            Some((c["handler"].as_str()?.to_owned(), schema))
        })
        .collect()
});
static VALIDATORS: LazyLock<Mutex<HashMap<String, Arc<jsonschema::Validator>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn resolved<'a>(schema: &'a Value, root: &'a Value) -> &'a Value {
    schema
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|s| s.strip_prefix('#'))
        .and_then(|s| root.pointer(s))
        .unwrap_or(schema)
}

// JSON Schema describes the constraints; Pydantic's defaults/coercions must also be applied.
fn normalize(value: &mut Value, schema: &Value, root: &Value, strict_int: bool) {
    let schema = resolved(schema, root);
    if let Some(choices) = schema["anyOf"].as_array() {
        if value.is_null() {
            return;
        }
        if choices.iter().any(|s| s["type"] == "number")
            && choices
                .iter()
                .any(|s| s["type"] == "string" && s.get("pattern").is_some())
        {
            let text = value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.is_number().then(|| value.to_string()));
            if let Some(number) = text
                .and_then(|text| BigDecimal::from_str(text.trim()).ok())
                .filter(|number| number.as_bigint_and_exponent().1.unsigned_abs() <= 10_000)
            {
                *value = json!(number.to_plain_string());
            }
            return;
        }
        let matches = |schema: &&Value| match resolved(schema, root)["type"].as_str() {
            Some("string") => value.is_string(),
            Some("number") => value.is_number(),
            Some("integer") => value.is_i64() || value.is_u64(),
            Some("object") => value.is_object(),
            Some("array") => value.is_array(),
            Some("boolean") => value.is_boolean(),
            _ => false,
        };
        if let Some(choice) = choices
            .iter()
            .find(matches)
            .or_else(|| choices.iter().find(|s| s["type"] != "null"))
        {
            normalize(value, choice, root, strict_int);
        }
        return;
    }
    match schema["type"].as_str() {
        Some("object") => {
            if let Some(map) = value.as_object_mut() {
                if let Some(properties) = schema["properties"].as_object() {
                    if schema.get("additionalProperties").is_none() {
                        map.retain(|key, _| properties.contains_key(key));
                    }
                    for (key, property) in properties {
                        let property = resolved(property, root);
                        if !map.contains_key(key) {
                            if schema["title"] == "StrategyEvaluationSpec"
                                && key == "required_metrics"
                            {
                                map.insert(
                                    key.clone(),
                                    json!([
                                        "trade_count",
                                        "net_pnl",
                                        "expectancy",
                                        "max_drawdown",
                                        "profit_factor"
                                    ]),
                                );
                            } else if schema["title"] == "DatasetManifest"
                                && key == "holdout_policy"
                            {
                                map.insert(key.clone(), json!({"mode":"none"}));
                            } else if let Some(default) = property.get("default") {
                                map.insert(key.clone(), default.clone());
                            } else if property["type"] == "array"
                                && !schema["required"]
                                    .as_array()
                                    .is_some_and(|r| r.contains(&json!(key)))
                            {
                                map.insert(key.clone(), json!([]));
                            } else if !schema["required"]
                                .as_array()
                                .is_some_and(|r| r.contains(&json!(key)))
                                && property["type"] == "object"
                            {
                                map.insert(key.clone(), json!({}));
                            }
                        }
                        if let Some(v) = map.get_mut(key) {
                            normalize(v, property, root, strict_int && key == "expected_revision");
                        }
                    }
                }
            }
        }
        Some("array") => {
            if let Some(items) = value.as_array_mut() {
                for item in items {
                    normalize(item, &schema["items"], root, false);
                }
            }
        }
        Some("integer") if !strict_int => {
            if value.is_number() && !value.to_string().contains(['.', 'e', 'E']) {
                return;
            }
            if let Some(text) = value.as_str() {
                if text.len() <= 10_000 && !text.contains(['e', 'E']) {
                    if let Ok(number) = BigDecimal::from_str(text.trim()) {
                        if number.as_bigint_and_exponent().1.unsigned_abs() <= 10_000
                            && number == number.with_scale(0)
                        {
                            if let Ok(integer) =
                                serde_json::from_str(&number.with_scale(0).to_plain_string())
                            {
                                *value = integer;
                            }
                        }
                    }
                }
                return;
            }
            let converted = if let Some(b) = value.as_bool() {
                Some(i64::from(b))
            } else {
                value
                    .as_f64()
                    .filter(|v| v.fract() == 0.0 && *v >= i64::MIN as f64 && *v < i64::MAX as f64)
                    .map(|v| v as i64)
            };
            if let Some(v) = converted {
                *value = json!(v);
            }
        }
        Some("number") => {
            let converted = value
                .as_str()
                .and_then(|s| s.trim().parse::<f64>().ok())
                .or_else(|| value.as_bool().map(|b| if b { 1.0 } else { 0.0 }));
            if let Some(number) = converted.filter(|v| v.is_finite()) {
                *value = json!(number);
            }
        }
        Some("boolean") => {
            let converted = value
                .as_str()
                .and_then(|s| match s.to_ascii_lowercase().as_str() {
                    "true" | "1" | "yes" | "y" | "on" | "t" => Some(true),
                    "false" | "0" | "no" | "n" | "off" | "f" => Some(false),
                    _ => None,
                })
                .or_else(|| {
                    value.as_i64().and_then(|v| match v {
                        0 => Some(false),
                        1 => Some(true),
                        _ => None,
                    })
                });
            if let Some(v) = converted {
                *value = json!(v);
            }
        }
        _ => (),
    }
}

fn guard_decimal_input(value: &Value, schema: &Value, root: &Value) -> Result<(), ApiError> {
    let schema = resolved(schema, root);
    if value.is_number() && matches!(schema["type"].as_str(), Some("integer" | "number")) {
        let text = value.to_string();
        if text.len() > 10_000
            || !BigDecimal::from_str(&text)
                .is_ok_and(|number| number.as_bigint_and_exponent().1.unsigned_abs() <= 10_000)
        {
            return Err(ApiError::detail(
                StatusCode::UNPROCESSABLE_ENTITY,
                "numeric_input_outside_supported_precision",
            ));
        }
    }
    if let Some(choices) = schema["anyOf"].as_array() {
        if value.is_null() {
            return Ok(());
        }
        if choices.iter().any(|s| s["type"] == "number")
            && choices
                .iter()
                .any(|s| s["type"] == "string" && s.get("pattern").is_some())
        {
            let text = value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.is_number().then(|| value.to_string()));
            if let Some(text) = text {
                let bounded = text.len() <= 10_000
                    && BigDecimal::from_str(text.trim()).is_ok_and(|number| {
                        number.as_bigint_and_exponent().1.unsigned_abs() <= 10_000
                    });
                if !bounded {
                    return Err(ApiError::detail(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "decimal_input_outside_supported_precision",
                    ));
                }
            }
            return Ok(());
        }
        if let Some(choice) = choices.iter().find(|s| s["type"] != "null") {
            return guard_decimal_input(value, choice, root);
        }
    }
    if let (Some(map), Some(properties)) = (value.as_object(), schema["properties"].as_object()) {
        for (key, property) in properties {
            if let Some(value) = map.get(key) {
                guard_decimal_input(value, property, root)?;
            }
        }
    } else if let Some(items) = value.as_array() {
        for item in items {
            guard_decimal_input(item, &schema["items"], root)?;
        }
    }
    Ok(())
}

fn decimal_bounds(value: &Value, schema: &Value, root: &Value) -> Result<(), ApiError> {
    let schema = resolved(schema, root);
    if let Some(choices) = schema["anyOf"].as_array() {
        if value.is_null() {
            return Ok(());
        }
        if let Some(numeric) = choices.iter().find(|s| s["type"] == "number").filter(|_| {
            choices
                .iter()
                .any(|s| s["type"] == "string" && s.get("pattern").is_some())
        }) {
            if let Some(number) = value.as_str().and_then(|v| BigDecimal::from_str(v).ok()) {
                for key in ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] {
                    if let Some(limit) = numeric
                        .get(key)
                        .and_then(|v| BigDecimal::from_str(&v.to_string()).ok())
                    {
                        let valid = match key {
                            "minimum" => number >= limit,
                            "maximum" => number <= limit,
                            "exclusiveMinimum" => number > limit,
                            _ => number < limit,
                        };
                        if !valid {
                            return Err(ApiError::detail(
                                StatusCode::UNPROCESSABLE_ENTITY,
                                &format!("decimal value violates {key}"),
                            ));
                        }
                    }
                }
            }
            return Ok(());
        }
        if let Some(choice) = choices.iter().find(|s| s["type"] != "null") {
            decimal_bounds(value, choice, root)?;
        }
    }
    if let Some(map) = value.as_object() {
        if let Some(properties) = schema["properties"].as_object() {
            for (key, property) in properties {
                if let Some(value) = map.get(key) {
                    decimal_bounds(value, property, root)?;
                }
            }
        }
    } else if let Some(items) = value.as_array() {
        for item in items {
            decimal_bounds(item, &schema["items"], root)?;
        }
    }
    Ok(())
}

/// Applies structural constraints, scalar coercions and model defaults from the frozen contract.
/// Custom Pydantic field/model validators must be ported by each domain caller.
pub fn validate_body(handler_name: &str, mut value: Value) -> Result<Value, ApiError> {
    let schema = SCHEMAS.get(handler_name).ok_or_else(|| {
        ApiError::detail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "request_contract_missing",
        )
    })?;
    let validator = {
        let mut cache = VALIDATORS.lock().map_err(|_| ApiError::database())?;
        cache
            .entry(handler_name.to_owned())
            .or_insert_with(|| {
                Arc::new(jsonschema::draft202012::new(schema).expect("frozen command schema"))
            })
            .clone()
    };
    let strict = handler_name == "delete_annotation" || handler_name == "delete_replay_session";
    if strict && !value["expected_revision"].is_i64() {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"detail":[{"type":"int_type","loc":["body","expected_revision"],"msg":"Input should be a valid integer","input":value["expected_revision"]}]}),
        ));
    }
    guard_decimal_input(&value, schema, schema)?;
    normalize(&mut value, schema, schema, strict);
    decimal_bounds(&value, schema, schema)?;
    if let Err(e) = validator.validate(&value) {
        let mut location = vec![json!("body")];
        for token in e.instance_path().to_string().split('/').skip(1) {
            location.push(
                token
                    .parse::<u64>()
                    .map(|n| json!(n))
                    .unwrap_or_else(|_| json!(token.replace("~1", "/").replace("~0", "~"))),
            );
        }
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"detail":[{"type":"value_error","loc":location,"msg":e.to_string(),"input":e.instance()}]}),
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expands_nested_strategy_defaults() {
        let value = validate_body("create_playbook", json!({"name":"test","execution_capability":"manual-only","rules":{},"strategy_spec":{"family":"ict","label":"test","methodology_version":"1","hypothesis":"h","entry_definition":"e","exit_definition":"x","invalidation_definition":"i"}})).unwrap();
        assert_eq!(value["status"], "draft");
        assert_eq!(
            value["strategy_spec"]["evaluation"]["holdout_access"],
            false
        );
        assert_eq!(
            value["strategy_spec"]["evaluation"]["required_metrics"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        assert_eq!(value["strategy_spec"]["signal_features"], json!([]));
    }
    #[test]
    fn coercion_and_strict_delete_contract() {
        assert_eq!(
            validate_body("freeze_playbook", json!({"expected_revision":"1"})).unwrap()["expected_revision"],
            1
        );
        for value in [json!(true), json!(1.0), json!("1"), Value::Null, json!(0)] {
            assert!(
                validate_body("delete_annotation", json!({"expected_revision":value})).is_err()
            );
        }
        assert!(validate_body("delete_annotation", json!({"expected_revision":1})).is_ok());
        assert!(
            validate_body("freeze_playbook", json!({"expected_revision":1,"extra":0})).is_err()
        );
    }
    #[test]
    fn exact_integers_and_bounded_decimals() {
        for integer in [
            json!(9007199254740993_i64),
            json!("9007199254740993"),
            json!("9007199254740993.0"),
        ] {
            assert_eq!(
                validate_body("freeze_playbook", json!({"expected_revision":integer})).unwrap()["expected_revision"],
                json!(9007199254740993_i64)
            );
        }
        for quantity in [json!("1e1000000000"), json!("1e-1000000000")] {
            assert!(validate_body("quick_replay_market_order", json!({"expected_revision":1,"operation_id":"test","side":"SELL","quantity":quantity})).is_err());
        }
        let value = validate_body(
            "quick_replay_market_order",
            json!({"expected_revision":1,"operation_id":"test","side":"SELL","quantity":"1e-2"}),
        )
        .unwrap();
        assert_eq!(value["quantity"], "0.01");
        assert!(
            validate_body(
                "quick_replay_market_order",
                json!({"expected_revision":1,"operation_id":"test","side":"SELL","quantity":"-1"})
            )
            .is_err()
        );
    }
    #[test]
    fn malformed_shapes_reject_without_panicking() {
        for name in [
            "create_playbook",
            "create_journal",
            "create_annotation",
            "quick_replay_market_order",
            "delete_annotation",
        ] {
            for value in [
                Value::Null,
                json!(true),
                json!(1),
                json!("body"),
                json!([]),
                json!({}),
                json!({"expected_revision":[]}),
            ] {
                assert!(validate_body(name, value).is_err(), "{name}");
            }
        }
    }
}
