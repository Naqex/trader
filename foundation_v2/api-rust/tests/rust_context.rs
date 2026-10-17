use serde_json::Value;
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
