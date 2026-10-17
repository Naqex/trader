use serde_json::Value;
use trading_workspace_api::control_routes;

fn normalize(value: Value) -> Value {
    match value {
        Value::Number(n) if n.is_f64() => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.into_iter().map(normalize).collect()),
        Value::Object(m) => Value::Object(m.into_iter().map(|(k, v)| (k, normalize(v))).collect()),
        v => v,
    }
}

#[test]
fn python_domain_differential() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("rust_control/oracle.json")).unwrap();
    for (i, case) in cases.iter().enumerate() {
        let body = case
            .get("raw_body")
            .and_then(Value::as_str)
            .map(|s| serde_json::from_str(s).unwrap())
            .unwrap_or_else(|| case["body"].clone());
        let result = match case["kind"].as_str().unwrap() {
            "instrument" => control_routes::validate_instrument(&body),
            "cost" => control_routes::preview_cost(&body),
            "news" => control_routes::visible_news(&body),
            "ai" => control_routes::ai_request(&body),
            "notion_connection" => control_routes::notion::connection_request("tenant-a", &body),
            "notion_intent" => control_routes::notion::intent_request("tenant-a", &body),
            _ => panic!("unknown fixture"),
        };
        if let Some(error) = case.get("error") {
            let actual = result.expect_err(&format!("case {i} must reject"));
            assert_eq!(actual.0.as_u16(), 422, "case {i}");
            assert_eq!(&actual.1["detail"], error, "case {i}");
        } else {
            assert_eq!(
                normalize(result.unwrap_or_else(|e| panic!("case {i}: {e:?}"))),
                normalize(case["expected"].clone()),
                "case {i} ({})",
                case["kind"]
            );
        }
    }
}

#[test]
fn ai_offline_status_remains_fail_closed() {
    let status = control_routes::ai_status();
    assert_eq!(status["execution_capability"], false);
    assert_eq!(status["provider"], "offline");
    assert_eq!(status["enabled_jobs"], serde_json::json!([]));
}

#[test]
fn claims_only_implemented_routes() {
    assert!(control_routes::native("POST", "/api/v2/data/cost-preview"));
    assert!(!control_routes::native("GET", "/api/v2/live/status"));
    assert!(!control_routes::native(
        "POST",
        "/api/v2/connectors/notion/oauth/start"
    ));
    assert!(!control_routes::native("POST", "/api/v2/learn/overview"));
}

#[test]
fn controls_reject_extreme_decimal_scales_before_arithmetic() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("rust_control/oracle.json")).unwrap();
    let cost = &cases
        .iter()
        .find(|c| c["kind"] == "cost" && c.get("error").is_none())
        .unwrap()["body"];
    let instrument = &cases
        .iter()
        .find(|c| c["kind"] == "instrument" && c.get("error").is_none())
        .unwrap()["body"];
    for raw in [
        "1e9223372036854775807".to_owned(),
        "1e-9223372036854775807".to_owned(),
        "1e9223372036854775808".to_owned(),
        "1e-9223372036854775808".to_owned(),
        "9".repeat(513),
    ] {
        let mut body = cost.clone();
        body["quantity"] = serde_json::json!(raw);
        body["contract_size"] = serde_json::json!(raw);
        assert_eq!(
            control_routes::preview_cost(&body)
                .expect_err("unbounded cost input")
                .0
                .as_u16(),
            422
        );
        let mut body = instrument.clone();
        body["instrument"]["tick_size"] = serde_json::json!(raw);
        assert_eq!(
            control_routes::validate_instrument(&body)
                .expect_err("unbounded instrument input")
                .0
                .as_u16(),
            422
        );
    }
}

#[test]
fn financial_snapshots_reject_extreme_decimals_without_panicking() {
    use trading_workspace_api::{analytics, prop_core, replay_core};
    let cases: Value =
        serde_json::from_str(include_str!("../src/analytics/oracle_cases.json")).unwrap();
    let record = &cases["inputs"][13][0];
    assert!(replay_core::validate(&record["payload"]["execution"]).is_ok());
    for raw in [
        "1e9223372036854775808".to_owned(),
        "1e-9223372036854775807".to_owned(),
        "9".repeat(513),
    ] {
        let mut corrupted = record.clone();
        corrupted["payload"]["execution"]["starting_balance"] = serde_json::json!(raw);
        assert!(replay_core::validate(&corrupted["payload"]["execution"]).is_err());
        assert!(analytics::build_replay_analytics_view(&corrupted, None).is_err());
        let phase = serde_json::json!({"balance":raw,"floating_pl":raw,"equity":raw,"virtual_time_utc":"2026-10-17T00:00:00Z"});
        assert!(prop_core::validate_phase_snapshot(&phase).is_err());
    }
}
