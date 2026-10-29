use serde_json::{Value, json};
use trading_workspace_api::context_routes::{build_experiments, journal_context};
fn parity(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!(
                (a - b).abs() <= 1e-11 * a.abs().max(b.abs()).max(1.0),
                "{path}: {a} != {b}"
            )
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                parity(a, b, &format!("{path}/{i}"))
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (k, a) in a {
                parity(a, &b[k], &format!("{path}/{k}"))
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}
#[test]
fn python_context_oracles() {
    let fixtures: Value = serde_json::from_str(include_str!("rust_context/oracle.json")).unwrap();
    for (i, c) in fixtures.as_array().unwrap().iter().enumerate() {
        let actual = if c["kind"] == "journal" {
            journal_context(c["records"].as_array().unwrap(), "tenant-a", "s")
        } else {
            build_experiments(
                &c["record"],
                c["bars"].as_array().unwrap(),
                c["sha"].as_str().unwrap(),
                c.get("filters"),
                &c["config"],
            )
        };
        if c["error"] == true {
            assert!(actual.is_err(), "case {i}");
        } else {
            parity(
                &actual.unwrap_or_else(|e| panic!("case {i}: {e}")),
                &c["expected"],
                &format!("case/{i}"),
            )
        }
    }
}

#[test]
fn rr_preserves_original_stop_and_is_independent_of_sl_simulator_configuration() {
    let fixtures: Value = serde_json::from_str(include_str!("rust_context/oracle.json")).unwrap();
    let case = &fixtures[0];
    let run = |config: &Value| {
        build_experiments(
            &case["record"],
            case["bars"].as_array().unwrap(),
            case["sha"].as_str().unwrap(),
            None,
            config,
        )
        .unwrap()
    };
    let first = run(&json!({"target_r":0.1}));
    let other = run(&json!({"target_r":0.1,"stop_distance_ticks":80,"stop_multiplier":2}));
    assert_eq!(
        first["rows"][0]["risk_reward"],
        other["rows"][0]["risk_reward"]
    );
    let row = &first["rows"][0];
    assert_eq!(row["risk_reward"]["status"], "ready");
    assert!((row["risk_reward"]["stop_price"].as_f64().unwrap() - 1.09).abs() < 1e-12);
    assert!((row["risk_reward"]["net_pnl"].as_f64().unwrap() - 8.1).abs() < 1e-12);
    assert_eq!(row["excursion"]["r_basis"], "initial_stop_distance");
    assert!((row["excursion"]["mae_r"].as_f64().unwrap() - 0.0012 / 0.0101).abs() < 1e-12);
}

#[test]
fn rr_does_not_use_a_stop_added_after_entry_or_a_later_checkpoint() {
    let fixtures: Value = serde_json::from_str(include_str!("rust_context/oracle.json")).unwrap();
    let case = &fixtures[0];
    for remove_checkpoint in [false, true] {
        let mut record = case["record"].clone();
        let position = &mut record["payload"]["execution"]["ledger"][1]["details"]["open_position"];
        if remove_checkpoint {
            *position = Value::Null;
        } else {
            position["stop_loss"] = Value::Null;
        }
        let result = build_experiments(
            &record,
            case["bars"].as_array().unwrap(),
            case["sha"].as_str().unwrap(),
            None,
            &json!({"target_r":0.1}),
        )
        .unwrap();
        assert_eq!(
            result["rows"][0]["risk_reward"]["reason"],
            "original_stop_unavailable"
        );
        assert!(result["rows"][0]["excursion"]["mae_r"].is_null());
        assert!(result["rows"][0]["realized_r"].is_null());
    }
}
