use serde_json::{Value, json};
use trading_workspace_api::prop_core;

#[test]
fn ftmo_daily_balance_anchor_is_independent_of_equity() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/ftmo-swing-offline.json")).unwrap();
    for order in ["fees_then_reset", "reset_then_fees"] {
        for floating in ["-100", "100"] {
            let mut p = fixture.clone();
            p["session"]["profile"]["phases"][0]["reset_order"] = json!(order);
            p["event"]["floating_pl"] = json!(floating);
            p["event"]["fees"] = json!("2");
            p["event"]["swap"] = json!("3");
            let result = prop_core::evaluate_prop_lifecycle_event(
                &p["session"],
                &p["attempt"],
                &p["phase"],
                &p["event"],
                &p["resume_state"],
            )
            .unwrap();
            let (anchor, floor) = if order == "fees_then_reset" {
                ("10195", "9695")
            } else {
                ("10200", "9700")
            };
            assert_eq!(result["phase"]["daily_anchor"], anchor);
            assert_eq!(result["phase"]["balance"], "10195");
            assert_eq!(result["objectives"]["money"]["daily_loss"]["floor"], floor);
        }
    }
    let mut p = fixture.clone();
    p["session"]["profile"]["phases"][0]
        .as_object_mut()
        .unwrap()
        .remove("daily_anchor_basis");
    let legacy = prop_core::evaluate_prop_lifecycle_event(
        &p["session"],
        &p["attempt"],
        &p["phase"],
        &p["event"],
        &p["resume_state"],
    )
    .unwrap();
    assert_eq!(legacy["phase"]["daily_anchor"], "10100");
    let mut p = fixture;
    p["event"]["floating_pl"] = json!("-600");
    let breached = prop_core::evaluate_prop_lifecycle_event(
        &p["session"],
        &p["attempt"],
        &p["phase"],
        &p["event"],
        &p["resume_state"],
    )
    .unwrap();
    assert_eq!(
        breached["objectives"]["money"]["daily_loss"]["floor"],
        "9700"
    );
    assert_eq!(breached["attempt"]["status"], "failed_breach");
}

// Money persisted in objectives is compared exactly below. Other model projections
// accept equivalent Decimal scales and timezone-aware datetime spellings.
fn canonical(v: &Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), canonical(v))).collect())
        }
        Value::String(s) => {
            if let Ok(d) = s.parse::<bigdecimal::BigDecimal>() {
                return json!(d.normalized().to_string());
            }
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&s.replacen(' ', "T", 1)) {
                return json!(t.timestamp_micros());
            }
            v.clone()
        }
        _ => v.clone(),
    }
}
#[test]
fn python_differential_prop_corpus() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/prop/fixtures.json"
    ))
    .unwrap();
    let decimal_fixtures: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/prop/decimal-scale-fixtures.json"
    ))
    .unwrap();
    for case in fixtures
        .as_array()
        .unwrap()
        .iter()
        .chain(decimal_fixtures.as_array().unwrap())
    {
        let a = case["args"].as_array().unwrap();
        let actual = match case["op"].as_str().unwrap() {
            "money" => prop_core::money_oracle(&a[0], &a[1]),
            "calendar" => prop_core::calendar_oracle(&a[0], &a[1]),
            "event" => prop_core::evaluate_prop_lifecycle_event(&a[0], &a[1], &a[2], &a[3], &a[4]),
            "command" => prop_core::apply_prop_lifecycle_command(
                &a[0],
                &a[1],
                &a[2],
                &a[3],
                &a[4],
                a[5].as_bool().unwrap(),
            ),
            "transition" => prop_core::apply_transition_intent(&a[0], &a[1], &a[2]),
            "paper" => prop_core::paper::apply_paper_receipt(&a[0], &a[1], &a[2]),
            "reconcile" => prop_core::paper::reconcile_paper_account(&a[0], &a[1]),
            "report" => prop_core::report::build_prop_attempt_report(&a[0], &a[1], &a[2], &a[3]),
            "csv" => Ok(json!(prop_core::report::prop_attempt_report_csv(&a[0]))),
            "binding" => {
                prop_core::validate_replay_prop_binding(&a[0], &a[1], &a[2]).map(|_| Value::Null)
            }
            "feed" => prop_core::replay_mark_to_prop_event(&a[0], &a[1], &a[2]),
            "transition_boundary" => prop_core::validate_replay_prop_transition_boundary(
                &a[0],
                &a[1],
                a[2].as_i64().unwrap(),
                &a[3],
                &a[4],
                &a[5],
                &a[6],
            )
            .map(|_| Value::Null),
            "transition_result" => {
                prop_core::validate_replay_prop_transition_result(&a[0], &a[1], &a[2], &a[3])
                    .map(|_| Value::Null)
            }
            "branch_checkpoint" => prop_core::validate_replay_prop_branch_checkpoint(
                &a[0], &a[1], &a[2], &a[3], &a[4], &a[5],
            )
            .map(|_| Value::Null),
            _ => panic!("unknown fixture op"),
        };
        if let Some(error) = case.get("error") {
            assert_eq!(
                actual.as_ref().err().map(String::as_str),
                error.as_str(),
                "{}",
                case["name"]
            )
        } else {
            let actual = actual.unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
            if case["op"] == "money" {
                assert_eq!(
                    actual, case["expected"],
                    "exact persisted money strings: {}",
                    case["name"]
                );
            } else if case["op"] == "event" && !case["expected"]["objectives"]["money"].is_null() {
                assert_eq!(
                    actual["objectives"]["money"], case["expected"]["objectives"]["money"],
                    "exact lifecycle money strings: {}",
                    case["name"]
                );
            }
            assert_eq!(
                canonical(&actual),
                canonical(&case["expected"]),
                "{}",
                case["name"]
            )
        }
    }
}
