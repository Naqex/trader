use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use trading_workspace_api::{
    replay_core::{transform, validate},
    session_trading_options,
};

fn seed(costs: bool, charge: &str, slip: &str) -> Value {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/replay-core/oracle.json"
    ))
    .unwrap();
    let mut args = corpus
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["request"]["action"] == "initialize")
        .unwrap()["request"]["args"]
        .clone();
    let dataset = args["dataset_id"].as_str().unwrap().to_owned();
    let options = json!({"version":session_trading_options::VERSION,"costs_enabled":costs,"assets":{dataset.clone():{"spread_price":"0","commission_per_lot":"7","commission_charge":charge,"slippage_price":slip}}});
    let payload = json!({"dataset_id":dataset,"trading_options":options});
    args = session_trading_options::initialization(
        &payload,
        &json!({"instrument_spec":args["instrument_spec"]}),
        &args,
    )
    .unwrap();
    transform(&json!({"action":"initialize","args":args})).unwrap()["snapshot"].clone()
}
fn trade(snapshot: Value, side: &str, quantity: &str, id: &str) -> Value {
    transform(&json!({"action":"queue_current_quote","snapshot":snapshot,"args":{"operation_id":id,"side":side,"quantity":quantity,"mid_close":"1.12044","virtual_time_utc":60}})).unwrap()["snapshot"].clone()
}
fn close(snapshot: Value, id: &str) -> Value {
    transform(&json!({"action":"close","snapshot":snapshot,"args":{"operation_id":id,"target_id":snapshot["position"]["position_id"],"mid_close":"1.12044","virtual_time_utc":60}})).unwrap()["snapshot"].clone()
}
fn amount(value: &Value) -> BigDecimal {
    value.as_str().unwrap().parse().unwrap()
}
#[test]
fn costs_off_both_sides_fill_exact_raw_close_with_zero_initial_pnl() {
    for side in ["BUY", "SELL"] {
        let opened = trade(seed(false, "round_trip", "0"), side, "0.01", "open");
        assert_eq!(opened["position"]["entry_fill"], "1.12044");
        assert_eq!(opened["position"]["entry_bid"], "1.12044");
        assert_eq!(opened["position"]["entry_ask"], "1.12044");
        assert_eq!(opened["floating_pl"], "0");
        let closed = close(opened, "close");
        assert_eq!(
            amount(&closed["balance"]),
            "100000".parse::<BigDecimal>().unwrap()
        );
        validate(&closed).unwrap();
    }
}
#[test]
fn commission_scales_each_position_without_rewriting_history() {
    for (charge, first, second, total) in [
        ("round_trip", -0.07, -0.14, "99999.79"),
        ("per_side", -0.14, -0.28, "99999.58"),
    ] {
        let opened = trade(seed(true, charge, "0"), "SELL", "0.01", "first");
        assert_eq!(
            opened["floating_pl"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap(),
            first
        );
        let first_closed = close(opened, "close-first");
        let old_events = first_closed["ledger"].as_array().unwrap().clone();
        let second_open = trade(first_closed, "BUY", "0.02", "second");
        assert_eq!(
            second_open["floating_pl"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap(),
            second
        );
        let final_state = close(second_open, "close-second");
        assert_eq!(
            amount(&final_state["balance"]),
            total.parse::<BigDecimal>().unwrap()
        );
        assert_eq!(
            &final_state["ledger"].as_array().unwrap()[..old_events.len()],
            old_events.as_slice()
        );
        validate(&final_state).unwrap();
    }
}
#[test]
fn slippage_is_independent_cost_and_not_a_second_spread() {
    let opened = trade(seed(false, "round_trip", "0.00001"), "BUY", "0.01", "open");
    assert_eq!(opened["position"]["entry_fill"], "1.12044");
    assert_eq!(opened["floating_pl"], "-0.02");
    assert_eq!(
        amount(&close(opened, "close")["balance"]),
        "99999.98".parse::<BigDecimal>().unwrap()
    );
}
