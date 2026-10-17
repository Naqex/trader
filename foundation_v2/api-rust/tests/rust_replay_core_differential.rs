use bigdecimal::BigDecimal;
use serde_json::Value;
use std::str::FromStr;
use trading_workspace_api::replay_core::transform;

fn compare(actual: &Value, expected: &Value, path: &str) -> Result<(), String> {
    if let (Some(a), Some(b)) = (actual.as_object(), expected.as_object()) {
        if a.len() != b.len() {
            return Err(format!("{path} keys: {:?} != {:?}", a.keys(), b.keys()));
        }
        for (k, v) in b {
            compare(
                a.get(k).ok_or(format!("{path}.{k} missing"))?,
                v,
                &format!("{path}.{k}"),
            )?;
        }
        return Ok(());
    }
    if let (Some(a), Some(b)) = (actual.as_array(), expected.as_array()) {
        if a.len() != b.len() {
            return Err(format!("{path} array length {} != {}", a.len(), b.len()));
        }
        for (n, (x, y)) in a.iter().zip(b).enumerate() {
            compare(x, y, &format!("{path}[{n}]"))?;
        }
        return Ok(());
    }
    if actual == expected {
        return Ok(());
    }
    if let (Some(a), Some(b)) = (actual.as_str(), expected.as_str()) {
        if let (Ok(x), Ok(y)) = (BigDecimal::from_str(a), BigDecimal::from_str(b)) {
            if x == y {
                return Ok(());
            }
        }
    }
    if let (Some(a), Some(b)) = (actual.as_f64(), expected.as_f64()) {
        if a == b {
            return Ok(());
        }
    }
    Err(format!("{path}: {actual} != {expected}"))
}

#[test]
fn python_oracle_differential() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/replay-core/oracle.json"
    ))
    .unwrap();
    let mut failures = vec![];
    for (n, case) in corpus.as_array().unwrap().iter().enumerate() {
        let result = transform(&case["request"]);
        if case.get("error").is_some() {
            if result.is_ok() {
                failures.push(format!(
                    "case {n} {} expected error {}",
                    case["request"]["action"], case["message"]
                ));
            }
        } else {
            match result {
                Ok(result) => {
                    if let Err(error) = compare(&result, &case["expected"], "$") {
                        failures.push(format!("case {n} {} {error}", case["request"]["action"]));
                    }
                }
                Err(e) => failures.push(format!(
                    "case {n} {} unexpected error: {e}",
                    case["request"]["action"]
                )),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures
            .iter()
            .take(40)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn current_quote_batch_matches_two_transitions() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/replay-core/oracle.json"
    )).unwrap();
    let mut checked = 0;
    for case in corpus.as_array().unwrap() {
        let request = &case["request"];
        let pending = &request["snapshot"]["pending_market_order"];
        if request["action"] != "fill_current_quote" || !pending.is_object()
            || pending["submitted_cursor_index"] != request["snapshot"]["cursor_index"]
            || !request["snapshot"]["position"].is_null() {
            continue;
        }
        let mut combined = request.clone();
        combined["action"] = serde_json::json!("queue_current_quote");
        combined["snapshot"]["pending_market_order"] = Value::Null;
        for key in ["operation_id", "side", "quantity", "stop_loss", "take_profit"] {
            combined["args"][key] = pending[key].clone();
        }
        let result = transform(&combined);
        let expected = transform(request);
        assert_eq!(result, expected, "combined current-quote case {checked}");
        assert_eq!(combined["snapshot"]["pending_market_order"], Value::Null);
        checked += 1;
    }
    assert!(checked >= 10, "expected valid and invalid oracle coverage, got {checked}");
}

#[test]
fn batched_advancement_matches_individual_transitions_and_fails_atomically() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/replay-core/oracle.json"
    ))
    .unwrap();
    let seed = corpus
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["request"]["action"] == "advance"
                && c["request"]["snapshot"]["schema_version"] == "replay-execution-v1"
                && c.get("expected").is_some()
        })
        .unwrap();
    let original = seed["request"]["snapshot"].clone();
    let mut state = original.clone();
    let mut steps = vec![];
    let mut events = vec![];
    for n in 0..120 {
        let cursor = state["cursor_index"].as_i64().unwrap() + 1;
        let args = serde_json::json!({"cursor_index":cursor,"bar":{"timestamp":60+n*60,"open":"1.1000","high":"1.1005","low":"1.0995","close":"1.1001"}});
        let result =
            transform(&serde_json::json!({"action":"advance","snapshot":state,"args":args}))
                .unwrap();
        state = result["snapshot"].clone();
        events.extend(result["events"].as_array().unwrap().clone());
        steps.push(args);
    }
    let request =
        serde_json::json!({"action":"advance_many","snapshot":original,"args":{"steps":steps}});
    let result = transform(&request).unwrap();
    assert_eq!(
        result,
        serde_json::json!({"snapshot":state,"events":events})
    );
    let mut bad = request.clone();
    bad["args"]["steps"][119]["cursor_index"] = serde_json::json!(0);
    assert!(transform(&bad).is_err());
    assert_eq!(request["snapshot"], original);
}
