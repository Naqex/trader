use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use trading_workspace_api::{
    replay_core::{transform, validate},
    session_trading_options,
};

fn amount(value: &Value) -> BigDecimal {
    value.as_str().unwrap().parse().unwrap()
}
fn initial(mode: &str, non_fx: bool) -> Value {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/replay-core/oracle.json"
    ))
    .unwrap();
    let mut args = corpus
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["request"]["action"] == "initialize")
        .unwrap()["request"]["args"]
        .clone();
    args["instrument_spec"]["tick_size"] = json!("0.00001");
    if non_fx {
        args["instrument_spec"]["asset_class"] = json!("metal");
    }
    let dataset = args["dataset_id"].as_str().unwrap().to_owned();
    let mut slippage = json!({"mode":mode});
    if mode == "fixed" {
        slippage["fixed_steps"] = json!(2);
    }
    let options = json!({"version":"session-trading-options-v2","costs_enabled":false,"assets":{dataset.clone():{"spread_price":"0","commission_per_lot":"0","commission_charge":"round_trip","slippage":slippage}}});
    let payload = json!({"dataset_id":dataset,"trading_options":options,"trading_options_seed":"frozen-fixture-seed"});
    args = session_trading_options::initialization(
        &payload,
        &json!({"instrument_spec":args["instrument_spec"]}),
        &args,
    )
    .unwrap();
    transform(&json!({"action":"initialize","args":args})).unwrap()["snapshot"].clone()
}
fn apply(snapshot: Value, action: &str, args: Value) -> Value {
    transform(&json!({"action":action,"snapshot":snapshot,"args":args})).unwrap()["snapshot"]
        .clone()
}
fn open(snapshot: Value, side: &str, operation: &str) -> Value {
    apply(
        snapshot,
        "queue_current_quote",
        json!({"operation_id":operation,"side":side,"quantity":"0.01","mid_close":"1.12044","virtual_time_utc":60}),
    )
}
fn protect(snapshot: Value, side: &str, tp: bool) -> Value {
    let mut args = json!({"operation_id":"protect","target_id":snapshot["position"]["position_id"],"mid_close":"1.12044","virtual_time_utc":60});
    args[if tp { "take_profit" } else { "stop_loss" }] = json!(if side == "BUY" {
        if tp { "1.12100" } else { "1.12000" }
    } else if tp {
        "1.12000"
    } else {
        "1.12100"
    });
    apply(snapshot, "protection", args)
}
fn advance(snapshot: Value, side: &str, tp: bool, gap: bool) -> Value {
    let rising = (side == "BUY") == tp;
    let bar = if rising {
        json!({"timestamp":60,"open":if gap { "1.12150" } else { "1.12044" },"high":"1.12200","low":"1.12040","close":"1.12150"})
    } else {
        json!({"timestamp":60,"open":if gap { "1.11950" } else { "1.12044" },"high":"1.12050","low":"1.11900","close":"1.11950"})
    };
    apply(snapshot, "advance", json!({"cursor_index":1,"bar":bar}))
}

#[test]
fn market_slippage_is_adverse_bounded_and_deterministic_for_all_modes() {
    for mode in ["off", "light", "medium", "fixed"] {
        for side in ["BUY", "SELL"] {
            let seed = initial(mode, false);
            let first = open(seed.clone(), side, "market-one");
            assert_eq!(first, open(seed.clone(), side, "market-one"));
            let fork = apply(
                seed,
                "fork",
                json!({"replay_session_id":"child","branch_id":"child-branch"}),
            );
            let branched = open(fork, side, "market-one");
            assert_eq!(
                first["position"]["entry_fill"],
                branched["position"]["entry_fill"]
            );
            assert_eq!(
                first["position"]["entry_slippage"],
                branched["position"]["entry_slippage"]
            );
            let p = &first["position"];
            let base = "1.12044".parse::<BigDecimal>().unwrap();
            let fill = amount(&p["entry_fill"]);
            assert!(if side == "BUY" {
                fill >= base
            } else {
                fill <= base
            });
            let max = p["entry_slippage"]["maximum_ticks"].as_u64().unwrap();
            assert_eq!(
                max,
                match mode {
                    "off" => 0,
                    "light" => 10,
                    "medium" => 30,
                    _ => 20,
                }
            );
            assert!(p["entry_slippage"]["offset_ticks"].as_u64().unwrap() <= max);
            if mode == "fixed" {
                assert_eq!(p["entry_slippage"]["offset_ticks"], 20);
            }
            validate(&first).unwrap();
            validate(&branched).unwrap();
            let mut tampered = first.clone();
            tampered["position"]["entry_slippage"]["offset_ticks"] = json!(999);
            assert!(validate(&tampered).is_err());
        }
    }
}

#[test]
fn stop_and_stop_gap_have_adverse_slippage_but_tp_never_gets_worse() {
    for mode in ["off", "light", "medium", "fixed"] {
        for side in ["BUY", "SELL"] {
            for tp in [false, true] {
                for gap in [false, true] {
                    let closed = advance(
                        protect(open(initial(mode, false), side, "open"), side, tp),
                        side,
                        tp,
                        gap,
                    );
                    let event = closed["ledger"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|e| e["kind"] == "protective_fill")
                        .unwrap();
                    let d = &event["details"];
                    let slip = &d["fill_slippage"];
                    let fill = amount(&d["fill_price"]);
                    let base = amount(&slip["base_price"]);
                    if tp {
                        assert_eq!(
                            fill,
                            if side == "BUY" { "1.12100" } else { "1.12000" }
                                .parse::<BigDecimal>()
                                .unwrap()
                        );
                        assert_eq!(slip["offset_ticks"], 0);
                        assert_eq!(slip["order_kind"], "limit");
                    } else {
                        assert!(if side == "BUY" {
                            fill <= base
                        } else {
                            fill >= base
                        });
                        assert_eq!(
                            slip["maximum_ticks"],
                            match mode {
                                "off" => 0,
                                "light" => 20,
                                "medium" => 80,
                                _ => 20,
                            }
                        );
                    }
                    validate(&closed).unwrap();
                    let mut tampered = closed.clone();
                    let index = tampered["ledger"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .position(|e| e["kind"] == "protective_fill")
                        .unwrap();
                    tampered["ledger"][index]["details"]["fill_slippage"]["offset_ticks"] =
                        json!(999);
                    assert!(validate(&tampered).is_err());
                }
            }
        }
    }
}

#[test]
fn mark_to_market_does_not_resample_and_manual_close_charges_only_actual_fills() {
    let opened = open(initial("fixed", false), "BUY", "open");
    assert_eq!(
        amount(&opened["floating_pl"]),
        "-0.2".parse::<BigDecimal>().unwrap()
    );
    let marked = apply(
        opened.clone(),
        "advance",
        json!({"cursor_index":1,"bar":{"timestamp":60,"open":"1.12044","high":"1.12050","low":"1.12030","close":"1.12044"}}),
    );
    assert_eq!(opened["position"], marked["position"]);
    assert_eq!(
        amount(&marked["floating_pl"]),
        "-0.2".parse::<BigDecimal>().unwrap()
    );
    let closed = apply(
        marked.clone(),
        "close",
        json!({"operation_id":"manual","target_id":marked["position"]["position_id"],"mid_close":"1.12044","virtual_time_utc":120}),
    );
    assert_eq!(
        amount(&closed["balance"]),
        "99999.60".parse::<BigDecimal>().unwrap()
    );
    validate(&closed).unwrap();
    let non_fx = open(initial("fixed", true), "SELL", "metal");
    assert_eq!(non_fx["position"]["entry_slippage"]["unit"], "tick");
    assert_eq!(non_fx["position"]["entry_slippage"]["maximum_ticks"], 2);
}

#[test]
fn partial_close_then_protection_preserves_remaining_costs_and_analytics() {
    for side in ["BUY", "SELL"] {
        let mut seed = initial("fixed", false);
        seed["cost_model"]["commission_per_lot_account"] = json!("8");
        let opened = apply(
            seed,
            "queue_current_quote",
            json!({"operation_id":"open-partial","side":side,"quantity":"0.04","mid_close":"1.12044","virtual_time_utc":60}),
        );
        let partial = apply(
            opened.clone(),
            "close",
            json!({"operation_id":"partial","target_id":opened["position"]["position_id"],"quantity":"0.01","mid_close":"1.12044","virtual_time_utc":60}),
        );
        assert_eq!(partial["position"]["original_quantity"], "0.04");
        assert_eq!(
            partial["ledger"].as_array().unwrap().last().unwrap()["details"]["cost_breakdown"]["commission_account"],
            0.08
        );
        let closed = advance(protect(partial, side, true), side, true, false);
        assert!(closed["position"].is_null());
        validate(&closed).unwrap();
        let protective = closed["ledger"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["kind"] == "protective_fill")
            .unwrap();
        assert_eq!(protective["details"]["closed_position"]["quantity"], "0.03");
        assert_eq!(
            protective["details"]["cost_breakdown"]["commission_account"],
            0.24
        );
        let view = json!({"record_id":closed["replay_session_id"],"workspace_id":"tenant-a","revision":1,"payload":{"dataset_id":closed["dataset_id"],"branch_id":closed["branch_id"],"cursor_index":closed["cursor_index"],"execution":closed}});
        let analytics =
            trading_workspace_api::analytics::build_replay_analytics_view(&view, None).unwrap();
        assert_eq!(analytics["analytics_available"], true);
        assert_eq!(analytics["ledger"].as_array().unwrap().len(), 2);
        assert_eq!(analytics["ledger"][0]["quantity"], 0.01);
        assert_eq!(analytics["ledger"][1]["quantity"], 0.03);
        assert_ne!(
            analytics["ledger"][0]["trade_id"],
            analytics["ledger"][1]["trade_id"]
        );
        for (index, event) in view["payload"]["execution"]["ledger"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| matches!(e["kind"].as_str(), Some("manual_close" | "protective_fill")))
            .enumerate()
        {
            let row = &analytics["ledger"][index];
            let cost = &event["details"]["cost_breakdown"];
            assert_eq!(row["gross_pnl"], cost["gross_account"]);
            let gross: BigDecimal = row["gross_pnl"].to_string().parse().unwrap();
            let net: BigDecimal = row["net_pnl"].to_string().parse().unwrap();
            let fees: BigDecimal = row["fees"].to_string().parse().unwrap();
            assert_eq!(gross - fees, net);
            for key in ["stop_loss", "take_profit"] {
                assert_eq!(row[key], event["details"]["closed_position"][key]);
            }
            assert!(row["planned_risk_budget"].is_null());
            assert!(row["realized_r"].is_null());
        }
        assert!(analytics["metrics"]["gross_pnl"].is_number());
        assert!(analytics["metrics"]["fees"].is_number());
    }
}

#[test]
fn next_bar_market_fill_preserves_actual_entry_and_provenance() {
    let queued = apply(
        initial("fixed", false),
        "queue",
        json!({"operation_id":"queued","side":"SELL","quantity":"0.01"}),
    );
    let opened = apply(
        queued,
        "advance",
        json!({"cursor_index":1,"bar":{"timestamp":60,"open":"1.12044","high":"1.12050","low":"1.12030","close":"1.12044"}}),
    );
    assert_eq!(
        amount(&opened["position"]["entry_fill"]),
        "1.12024".parse::<BigDecimal>().unwrap()
    );
    validate(&opened).unwrap();
}

#[test]
fn model_rejects_ambiguous_units_and_double_slippage_costs() {
    for (field, value) in [
        ("unit", json!("tick")),
        ("fixed_steps", json!(21)),
        ("unit_price", json!("0.000001")),
        ("seed", json!("")),
    ] {
        let mut seed = initial("fixed", false);
        seed["cost_model"]["slippage_model"][field] = value;
        assert!(validate(&seed).is_err());
    }
    let mut seed = initial("fixed", false);
    seed["cost_model"]["slippage_price_per_side"] = json!("0.00001");
    assert!(validate(&seed).is_err());
}
