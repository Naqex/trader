use provider_routes::{DownloadEngine, ProviderRuntime, catalog};
use serde_json::{Value, json};
use trading_workspace_api::provider_routes;

#[test]
fn provider_offline_oracle() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("rust_provider/oracle.json")).unwrap();
    for (i, case) in cases.iter().enumerate() {
        let body = &case["body"];
        let result = match case["kind"].as_str().unwrap() {
            "qdm" => catalog::parse_qdm(
                &body
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|n| n.as_u64().unwrap() as u8)
                    .collect::<Vec<_>>(),
            )
            .map(|v| json!(v)),
            "dukascopy" => catalog::normalize_dukascopy(body).map(|v| json!(v)),
            "instrument" => Ok(catalog::replay_instrument(body).unwrap_or(Value::Null)),
            _ => panic!("unknown fixture"),
        };
        if case.get("error").is_some() {
            assert!(result.is_err(), "case {i} accepted invalid source");
        } else {
            assert_eq!(
                result.unwrap_or_else(|e| panic!("case {i}: {e}")),
                case["expected"],
                "case {i}"
            );
        }
    }
}

#[test]
fn absent_and_configured_empty_provider_are_distinct() {
    let root = std::env::temp_dir().join(format!("rust-provider-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let absent = ProviderRuntime::load(root.clone(), DownloadEngine::None).unwrap();
    assert_eq!(absent.capabilities().as_array().unwrap().len(), 1);
    assert_eq!(absent.catalog_state(), Value::Null);
    let qdm = ProviderRuntime::load(
        root.clone(),
        DownloadEngine::Qdm {
            home: root.join("missing-qdm"),
        },
    )
    .unwrap();
    assert_eq!(qdm.capabilities()[1]["provider_id"], "qdm-catalog");
    assert_eq!(qdm.catalog_state()["error"], "qdm_catalog_missing");
    let duka = ProviderRuntime::load(
        root.clone(),
        DownloadEngine::Dukascopy {
            metadata: json!({"version":"1.50.0","items":[]}),
            adapter_present: true,
        },
    )
    .unwrap();
    assert_eq!(duka.capabilities()[0]["provider_id"], "dukascopy-catalog");
    assert_eq!(duka.catalog_state()["configured"], true);
    std::fs::remove_dir(&root).unwrap();
}

#[test]
fn dukascopy_cache_identity_and_invalid_replacement() {
    let root = std::env::temp_dir().join(format!("rust-provider-cache-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("catalog")).unwrap();
    let path = root.join("catalog/dukascopy-instruments.json");
    let bytes = include_str!("rust_provider/cache.json");
    std::fs::write(&path, bytes).unwrap();
    let engine = DownloadEngine::Dukascopy {
        metadata: json!({"version":"1.50.0","items":[{"name":"EUR/USD","code":"eurusd","startDayForMinuteCandles":"2003-01-01T00:00:00Z"}]}),
        adapter_present: true,
    };
    let runtime = ProviderRuntime::load(root.clone(), engine.clone()).unwrap();
    assert_eq!(runtime.catalog_state()["status"], "cached");
    assert_eq!(runtime.instruments().len(), 2);
    let mut corrupt: Value = serde_json::from_str(bytes).unwrap();
    corrupt["raw_catalog"]["instruments"][0]["description"] = json!("modified");
    std::fs::write(&path, corrupt.to_string()).unwrap();
    let runtime = ProviderRuntime::load(root.clone(), engine).unwrap();
    assert_eq!(runtime.catalog_state()["error"], "invalid_cache");
    assert!(runtime.instruments().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}
