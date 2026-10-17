use serde_json::Value;
#[test]
#[ignore = "generated Python contract oracle via rust_data_ingest_parity.py"]
fn python_csv_preview_oracle() {
    let path =
        std::env::var("TW_DATA_PREVIEW_ORACLE").expect("run scripts/rust_data_ingest_parity.py");
    let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let mut failures = vec![];
    for case in &cases {
        let actual = trading_workspace_api::native_contracts::validate_body(
            "preview_csv_payload",
            case["body"].clone(),
        )
        .map_err(|e| e.1["detail"].as_str().unwrap_or("validation").to_owned())
        .and_then(|v| {
            if let Some(symbol) = case["price_only"].as_str() {
                let range = case["range"]
                    .as_array()
                    .map(|r| (r[0].as_i64().unwrap(), r[1].as_i64().unwrap()));
                trading_workspace_api::data_routes::ingest::preview_price_only(
                    v["csv_text"].as_str().unwrap(),
                    &v["source"],
                    symbol,
                    v["timeframe_seconds"].as_i64().unwrap(),
                    range,
                )
                .map(|(p, _)| p)
            } else {
                trading_workspace_api::data_routes::ingest::preview(&v).map(|(p, _)| p)
            }
        });
        if case.get("error").is_some() {
            if let Err(error) = actual {
                if case["error"] != "validation" && case["error"] != error {
                    failures.push(format!(
                        "{} error {:?} != {}",
                        case["name"], error, case["error"]
                    ));
                }
            } else {
                failures.push(format!("{} expected error", case["name"]));
            }
        } else if actual.as_ref().ok() != Some(&case["expected"]) {
            failures.push(format!(
                "{} actual {:?} != {}",
                case["name"], actual, case["expected"]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    eprintln!("{} Python CSV preview oracle cases passed", cases.len());
}
