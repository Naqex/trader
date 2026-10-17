use serde_json::Value;
use trading_workspace_api::artifact_data::{ArtifactData, ChartPeriod, TimingQuery};

fn assert_same(actual: &Value, expected: &Value, path: &str) {
    match (actual, expected) {
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path} length");
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                assert_same(a, b, &format!("{path}[{index}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path} columns");
            for (key, b) in b {
                assert_same(
                    a.get(key).unwrap_or_else(|| panic!("missing {path}.{key}")),
                    b,
                    &format!("{path}.{key}"),
                );
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

#[test]
fn chart_period_contract() {
    assert_eq!(
        ChartPeriod::parse("5", 60).unwrap(),
        ChartPeriod::Seconds(300)
    );
    assert!(ChartPeriod::parse("2", 60).is_err());
    assert!(ChartPeriod::parse("1S", 60).is_err());
    assert!(ChartPeriod::parse("1W", 120).is_ok());
    assert!(ChartPeriod::parse("1W", 101).is_err());
    assert_eq!(ChartPeriod::Week.bucket(1704067200).unwrap(), 1704067200000);
    assert_eq!(
        ChartPeriod::Month.bucket(1706745599).unwrap(),
        1704067200000
    );
    assert_eq!(ChartPeriod::Seconds(60).bucket(-1).unwrap(), -60000);
}

#[test]
#[ignore = "run scripts/rust_artifact_parity.py to generate the Python oracle"]
fn python_oracle_parity() {
    let fixture = std::env::var("TW_RUST_ARTIFACT_ORACLE").expect("oracle path");
    let fixture: Value = serde_json::from_slice(&std::fs::read(fixture).unwrap()).unwrap();
    let data = ArtifactData::new(fixture["root"].as_str().unwrap()).unwrap();
    let path = fixture["path"].as_str().unwrap();
    let sha = fixture["sha"].as_str().unwrap();
    for case in fixture["indices"].as_array().unwrap() {
        let actual = data
            .indices(
                path,
                sha,
                case["start"].as_u64().unwrap() as usize,
                case["end"].as_u64().unwrap() as usize,
            )
            .unwrap();
        assert_same(&serde_json::json!(actual), &case["expected"], "indices");
    }
    for case in fixture["ranges"].as_array().unwrap() {
        let actual = data
            .range(
                path,
                sha,
                case["start"].as_i64().unwrap(),
                case["end"].as_i64().unwrap(),
                case["max"].as_u64().unwrap() as usize,
            )
            .unwrap();
        assert_same(&serde_json::json!(actual), &case["expected"], "range");
    }
    let queries: Vec<TimingQuery> = fixture["queries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|query| TimingQuery {
            index: query["index"].as_u64().unwrap() as usize,
            at_or_before: query["at_or_before"].as_i64(),
        })
        .collect();
    assert_eq!(
        serde_json::json!(data.timings(path, sha, &queries).unwrap()),
        fixture["timings"]
    );
    for case in fixture["find"].as_array().unwrap() {
        assert_eq!(
            data.find_cursor(
                path,
                sha,
                case["canonical"].as_u64().unwrap() as usize,
                case["timestamp"].as_i64().unwrap()
            )
            .unwrap(),
            case["expected"].as_u64().unwrap() as usize
        );
    }
    for case in fixture["charts"].as_array().unwrap() {
        let period = ChartPeriod::parse(case["resolution"].as_str().unwrap(), 60).unwrap();
        let actual = data
            .chart_window(
                path,
                sha,
                case["cursor"].as_u64().unwrap() as usize,
                period,
                case["to"].as_i64(),
                case["count"].as_u64().unwrap() as usize,
            )
            .unwrap();
        assert_same(&actual, &case["expected"], "chart");
    }
    let tick = &fixture["tick"];
    let snapshot = tick["snapshot"].as_str().unwrap();
    assert_eq!(
        data.tick_manifest("fixture", snapshot).unwrap(),
        tick["expected_manifest"]
    );
    assert_eq!(
        data.latest_ticks("fixture", "EURUSD").unwrap(),
        Some(tick["expected_manifest"].clone())
    );
    assert!(data.latest_ticks("fixture", "ABSENT").unwrap().is_none());
    assert!(data.tick_manifest("another", snapshot).is_err());
    assert_eq!(
        serde_json::json!(
            data.tick_interval(
                "fixture",
                snapshot,
                tick["start"].as_i64().unwrap(),
                tick["end"].as_i64().unwrap()
            )
            .unwrap()
        ),
        tick["expected"]
    );
    assert!(
        data.assert_tick_interval(
            "fixture",
            snapshot,
            tick["start"].as_i64().unwrap() - 1000,
            tick["end"].as_i64().unwrap()
        )
        .is_err()
    );
    assert!(data.indices(path, sha, 0, 12014).is_err());
    assert!(data.indices(path, sha, 2, 1).is_err());
    assert!(data.indices("../escape", sha, 0, 1).is_err());
    assert!(data.indices("fixture/CON.parquet", sha, 0, 1).is_err());
    assert!(data.indices(path, &"0".repeat(64), 0, 1).is_err());
    let base = fixture["base"].as_i64().unwrap();
    assert!(data.range(path, sha, base, base + 300, 1).is_err());
    assert!(data.find_cursor(path, sha, 0, base + 1).is_err());
    let mut samples = Vec::new();
    for _ in 0..8 {
        let begin = std::time::Instant::now();
        let (_, stats) = data
            .chart_window_with_stats(path, sha, 12012, ChartPeriod::Seconds(60), None, 20)
            .unwrap();
        samples.push(begin.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(stats.sha256_bytes, 0);
        assert!(stats.rows_decoded <= 514, "read amplification {stats:?}");
    }
    println!("rust_warm_chart_ms={samples:?}");
    let written_rows: Vec<Value> = (0..50003).map(|index|serde_json::json!({
        "timestamp":base+(index/2)*60,"open":100.0,"high":101.0,"low":99.0,"close":100.5,"volume":index as f64
    })).collect();
    let (written_path, written_sha) = data
        .write_dataset("fixture", "rust-created", &written_rows)
        .unwrap();
    assert_eq!(
        data.indices(&written_path, &written_sha, 49999, 50003)
            .unwrap(),
        written_rows[49999..50003]
    );
    assert!(
        data.write_dataset("fixture", "rust-created", &written_rows)
            .is_err()
    );
    assert!(
        data.write_dataset("../escape", "rust-created", &written_rows)
            .is_err()
    );
    assert!(data.write_dataset("fixture", "empty", &[]).is_err());
    let (raw_path, raw_sha) = data
        .write_raw_source_bytes("fixture", "rust-created", b"timestamp,open\r\n1,2\r\n")
        .unwrap();
    assert!(
        data.write_raw_source_bytes("fixture", "rust-created", b"replace")
            .is_err()
    );
    std::fs::write(std::path::Path::new(fixture["root"].as_str().unwrap()).join("rust-writes.json"),
        serde_json::to_vec(&serde_json::json!({"path":written_path,"sha":written_sha,"raw_path":raw_path,"raw_sha":raw_sha,"base":base})).unwrap()).unwrap();
    // A verified receipt must not authorize a later in-place edit, even with
    // identical length and LastWriteTime restored by the operating system.
    let absolute = std::path::Path::new(fixture["root"].as_str().unwrap()).join(path);
    let prior_modified = std::fs::metadata(&absolute).unwrap().modified().unwrap();
    let mut bytes = std::fs::read(&absolute).unwrap();
    bytes[12] ^= 1;
    std::fs::write(&absolute, bytes).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&absolute)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(prior_modified))
        .unwrap();
    assert!(data.indices(path, sha, 0, 1).is_err());
    println!(
        "canonical parity: 5 index windows, 3 timestamp ranges, 5 timings, 4 cursor lookups, 24 chart windows; pinned tick/hash/uint64 parity; native 50003-row+raw source immutable publication; invalid bounds/path/checksum and restored-mtime mutation rejected"
    );
}
