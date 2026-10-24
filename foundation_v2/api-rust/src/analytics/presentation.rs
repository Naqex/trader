use super::*;
use chrono::{Months, NaiveDate, TimeZone};
use chrono_tz::Tz;

pub(super) fn search_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter_map(|c| {
            Some(match c {
                'à' | 'á' | 'ạ' | 'ả' | 'ã' | 'â' | 'ầ' | 'ấ' | 'ậ' | 'ẩ' | 'ẫ' | 'ă' | 'ằ'
                | 'ắ' | 'ặ' | 'ẳ' | 'ẵ' => 'a',
                'è' | 'é' | 'ẹ' | 'ẻ' | 'ẽ' | 'ê' | 'ề' | 'ế' | 'ệ' | 'ể' | 'ễ' => {
                    'e'
                }
                'ì' | 'í' | 'ị' | 'ỉ' | 'ĩ' => 'i',
                'ò' | 'ó' | 'ọ' | 'ỏ' | 'õ' | 'ô' | 'ồ' | 'ố' | 'ộ' | 'ổ' | 'ỗ' | 'ơ' | 'ờ'
                | 'ớ' | 'ợ' | 'ở' | 'ỡ' => 'o',
                'ù' | 'ú' | 'ụ' | 'ủ' | 'ũ' | 'ư' | 'ừ' | 'ứ' | 'ự' | 'ử' | 'ữ' => {
                    'u'
                }
                'ỳ' | 'ý' | 'ỵ' | 'ỷ' | 'ỹ' => 'y',
                'đ' => 'd',
                '\u{0300}'..='\u{036f}' => return None,
                _ => c,
            })
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn timezone(value: Option<&str>) -> R<Tz> {
    value
        .unwrap_or("UTC")
        .parse()
        .map_err(|_| "analytics_timezone_invalid".into())
}

pub(super) fn apply_timezone(view: &mut Value, zone: Tz) {
    view["timezone"] = json!(zone.name());
    if view["provenance"].is_object() {
        view["provenance"]["timezone"] = json!(zone.name());
    }
}

pub(super) fn first_opening(record: &Value) -> Option<DateTime<Utc>> {
    let payload = &record["payload"];
    let states: Vec<&Value> = if let Some(states) = payload["asset_states"].as_object() {
        states.values().map(|state| &state["execution"]).collect()
    } else {
        vec![&payload["execution"]]
    };
    states
        .into_iter()
        .flat_map(|state| state["ledger"].as_array().into_iter().flatten())
        .filter(|event| event["kind"] == "market_fill")
        .filter_map(|event| timestamp(&event["virtual_time_utc"]).ok().flatten())
        .min()
}

// Execution timestamps are simulated market time. They cannot stand in for the
// wall-clock instant when the user submitted an order, which legacy fills omit.
pub(super) fn entry_metadata(view: &mut Value, record: &Value) {
    let payload = &record["payload"];
    let mut entries = HashMap::new();
    let states: Vec<&Value> = if let Some(states) = payload["asset_states"].as_object() {
        states.values().map(|s| &s["execution"]).collect()
    } else {
        vec![&payload["execution"]]
    };
    for state in states {
        if let Some(events) = state["ledger"].as_array() {
            for event in events.iter().filter(|e| e["kind"] == "market_fill") {
                entries.insert(
                    (
                        text(&state["dataset_id"]),
                        text(&event["details"]["position_id"]),
                        text(&event["details"]["operation_id"]),
                    ),
                    event,
                );
            }
        }
    }
    if let Some(trades) = view["ledger"].as_array_mut() {
        for trade in trades {
            let dataset = trade.get("dataset_id").unwrap_or(&payload["dataset_id"]);
            let raw_position = text(&trade["source_position_id"]);
            let prefix = format!("{}:", text(dataset));
            let position = if trade.get("dataset_id").is_some() {
                raw_position
                    .strip_prefix(&prefix)
                    .unwrap_or(raw_position)
                    .split(":close:")
                    .next()
                    .unwrap_or("")
            } else {
                raw_position
            };
            let entry =
                entries.get(&(text(dataset), position, text(&trade["source_operation_id"])));
            let recording = &payload["entry_recording"]["datasets"][text(dataset)][position];
            let recorded = entry.filter(|entry| {
                payload["entry_recording"]["schema_version"] == "replay-entry-recording-v1"
                    && recording["source_operation_id"] == entry["details"]["operation_id"]
                    && recording["open_event_sequence"] == entry["sequence"]
                    && timestamp(&recording["recorded_at_utc"])
                        .ok()
                        .flatten()
                        .is_some()
            });
            let kind = entry.and_then(|entry| {
                let details = &entry["details"];
                details["entry_order"]["order_type"]
                    .as_str()
                    .or(details["open_position"]["entry_order_type"].as_str())
                    .or_else(|| {
                        (details["execution_timing"] == "current_quote").then_some("market")
                    })
                    .or_else(|| recorded.and_then(|_| recording["entry_type"].as_str()))
                    .filter(|k| matches!(*k, "market" | "limit" | "stop"))
            });
            let kind = json!(kind);
            let recorded_at = if recorded.is_some() {
                recording["recorded_at_utc"].clone()
            } else {
                Value::Null
            };
            trade["entry_type"] = kind;
            trade["recorded_at_utc"] = recorded_at;
        }
    }
}

fn next_month(start: DateTime<Utc>, zone: Tz) -> R<DateTime<Utc>> {
    let local = start.with_timezone(&zone);
    let next = NaiveDate::from_ymd_opt(local.year(), local.month(), 1)
        .and_then(|d| d.checked_add_months(Months::new(1)))
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .ok_or("activity range overflow")?;
    // Some IANA zones move their clocks at midnight. Find the first existing
    // local minute instead of rejecting an otherwise valid measured interval.
    for minutes in 0..=2880 {
        let candidate = next
            .checked_add_signed(chrono::Duration::minutes(minutes))
            .ok_or("activity range overflow")?;
        if let Some(boundary) = zone.from_local_datetime(&candidate).earliest() {
            let boundary = boundary.with_timezone(&Utc);
            if boundary > start {
                return Ok(boundary);
            }
        }
    }
    Err("activity month boundary unavailable".into())
}

pub(super) fn activity_months(records: &[Value], intervals: &[Value], zone: Tz) -> R<Value> {
    let ids: HashSet<_> = records.iter().map(|r| text(&r["record_id"])).collect();
    let mut pairs = Vec::new();
    for interval in intervals
        .iter()
        .filter(|i| ids.contains(text(&i["session_id"])))
    {
        let start = timestamp(&interval["started_at_utc"])?.ok_or("missing activity start")?;
        let end = timestamp(&interval["ended_at_utc"])?.ok_or("missing activity end")?;
        pairs.push((start, end));
    }
    pairs.sort();
    let mut months = BTreeMap::<String, f64>::new();
    let mut prior = None;
    for (start, end) in pairs {
        let mut start = prior.map_or(start, |last: DateTime<Utc>| last.max(start));
        while start < end {
            let stop = end.min(next_month(start, zone)?);
            *months
                .entry(start.with_timezone(&zone).format("%Y-%m").to_string())
                .or_default() += (stop - start)
                .num_microseconds()
                .ok_or("activity range overflow")? as f64
                / 1e6;
            start = stop;
        }
        prior = Some(prior.map_or(end, |last| last.max(end)));
    }
    Ok(json!(
        months
            .into_iter()
            .map(|(month, seconds)| json!({"month": month, "time_invested_seconds": seconds}))
            .collect::<Vec<_>>()
    ))
}

// Keep the complete small calendar projection; the compatibility summary above
// still exposes its last twelve months. No trade ledger is sent with this view.
pub(super) fn performance_periods(view: &Value, zone: chrono_tz::Tz) -> R<Value> {
    let mut months = BTreeMap::<String, (f64, f64, usize)>::new();
    let mut days = [(0.0f64, 0.0f64, 0usize); 7];
    for trade in array(&view["ledger"])? {
        let Some(date) = timestamp(activity::time(trade))? else { continue };
        let date = date.with_timezone(&zone);
        let pnl = number(&trade["net_pnl"])?;
        let month = months.entry(date.format("%Y-%m").to_string()).or_default();
        let day = &mut days[date.weekday().num_days_from_monday() as usize];
        for bucket in [month, day] {
            bucket.0 += pnl.max(0.0); bucket.1 += pnl.min(0.0); bucket.2 += 1;
        }
    }
    let has_dates = !months.is_empty();
    let row = |label: String, (profit, loss, count): (f64, f64, usize)| json!({"label":label,"value":profit+loss,"profit":profit,"loss":loss,"count":count});
    Ok(json!({"months":months.into_iter().map(|(k,v)|row(k,v)).collect::<Vec<_>>(),"weekdays":if !has_dates {vec![]} else {["T2","T3","T4","T5","T6","T7","CN"].iter().zip(days).map(|(k,v)|row(k.to_string(),v)).collect::<Vec<_>>()}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_month_history_splits_net_wins_and_losses_without_merging_years() {
        let mut ledger = Vec::new();
        for year in 2003..2006 {
            for month in 1..=12 {
                let stamp = format!("{year}-{month:02}-05T23:30:00Z");
                ledger.push(json!({"close_time_utc":stamp,"net_pnl":10.0}));
                ledger.push(json!({"close_time_utc":stamp,"net_pnl":-4.0}));
            }
        }
        let view = json!({"ledger":ledger});
        let periods = performance_periods(&view,chrono_tz::UTC).unwrap();
        let months = periods["months"].as_array().unwrap();
        assert_eq!(months.len(),36);
        assert_eq!(months[0],json!({"label":"2003-01","profit":10.0,"loss":-4.0,"value":6.0,"count":2}));
        assert_eq!(months[35]["label"],"2005-12");
        assert_eq!(periods["weekdays"].as_array().unwrap().iter().map(|r|r["value"].as_f64().unwrap()).sum::<f64>(),216.0);
        let unknown=json!({"ledger":[{"report_time_utc":null,"close_time_utc":1700000060,"net_pnl":9.0}]});
        assert!(performance_periods(&unknown,chrono_tz::UTC).unwrap()["months"].as_array().unwrap().is_empty());
        let shifted=performance_periods(&json!({"ledger":[{"close_time_utc":"2026-01-31T23:30:00Z","net_pnl":-3.0}]}),chrono_tz::Asia::Ho_Chi_Minh).unwrap();
        assert_eq!(shifted["months"][0]["label"],"2026-02");
    }

    fn fixture() -> Value {
        let cases: Value = serde_json::from_str(include_str!("oracle_cases.json")).unwrap();
        cases["inputs"][2].clone()
    }
    fn shifted(close: &str) -> Value {
        let mut record = fixture();
        let time = timestamp(&json!(close)).unwrap().unwrap().timestamp();
        let offset = time - 1700000060;
        for event in record["payload"]["execution"]["ledger"]
            .as_array_mut()
            .unwrap()
        {
            event["virtual_time_utc"] = json!(event["virtual_time_utc"].as_i64().unwrap() + offset);
        }
        record
    }
    #[test]
    fn summary_and_performance_use_local_month_weekday_and_actual_curve_times() {
        let record = shifted("2026-01-31T23:30:00Z");
        let utc = build_session_summary(&record, "tenant-a").unwrap();
        let zone = timezone(Some("Asia/Ho_Chi_Minh")).unwrap();
        let local = build_session_summary_in_timezone(&record, "tenant-a", zone).unwrap();
        assert_eq!(utc["periods"]["months"][0]["label"], "2026-01");
        assert_eq!(local["periods"]["months"][0]["label"], "2026-02");
        assert_eq!(local["periods"]["weekdays"][6]["value"], 17.0);
        assert_eq!(local["metrics"], utc["metrics"]);
        assert_eq!(
            local["curve"]["points"][0]["time_utc"],
            "2026-01-31T23:29:00+00:00"
        );
        assert_eq!(
            local["curve"]["points"][1]["time_utc"],
            "2026-01-31T23:30:00+00:00"
        );
        let report = build_dashboard_performance_in_timezone(
            &[record],
            "tenant-a",
            None,
            None,
            None,
            true,
            &[],
            zone,
        )
        .unwrap();
        assert_eq!(report["scope"]["timezone"], "Asia/Ho_Chi_Minh");
        assert_eq!(report["months"][0]["month"], "2026-02");
        assert_eq!(report["ledger"][0]["close_time_utc"], 1769902200_i64);
    }
    #[test]
    fn new_york_month_and_dst_activity_union_preserves_real_elapsed_seconds() {
        let records = vec![json!({"record_id":"a"}), json!({"record_id":"b"})];
        let interval = |id: &str, from: &str, to: &str| json!({"session_id":id,"started_at_utc":from,"ended_at_utc":to});
        let intervals = vec![
            interval("a", "2026-11-01T03:59:50Z", "2026-11-01T04:00:10Z"),
            interval("b", "2026-11-01T03:59:55Z", "2026-11-01T04:00:15Z"),
            interval("a", "2026-11-01T05:59:50Z", "2026-11-01T06:00:10Z"),
            interval("other", "2026-11-01T03:00:00Z", "2026-11-01T04:00:00Z"),
        ];
        let months = activity_months(
            &records,
            &intervals,
            timezone(Some("America/New_York")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            months,
            json!([{"month":"2026-10","time_invested_seconds":10.0},{"month":"2026-11","time_invested_seconds":35.0}])
        );
        let timing = dashboard_timing(&records, &intervals).unwrap();
        assert_eq!(timing["time_invested_seconds"], 45.0);
        assert!(timing["historical_time_replayed_seconds"].is_null());
        let summary = build_session_summary_in_timezone(
            &shifted("2026-11-01T03:30:00Z"),
            "tenant-a",
            timezone(Some("America/New_York")).unwrap(),
        )
        .unwrap();
        assert_eq!(summary["periods"]["months"][0]["label"], "2026-10");
        assert_eq!(summary["periods"]["weekdays"][5]["value"], 17.0);
    }
    #[test]
    fn entry_recording_requires_exact_fill_proof_and_never_borrows_virtual_time() {
        let mut record = fixture();
        let mut view = build_replay_analytics_view(&record, None).unwrap();
        entry_metadata(&mut view, &record);
        assert!(view["ledger"][0]["recorded_at_utc"].is_null());
        assert!(view["ledger"][0]["entry_type"].is_null());
        record["payload"]["entry_recording"] = json!({"schema_version":"replay-entry-recording-v1","datasets":{"dataset-fixture":{"replay-pos-1":{"source_operation_id":"open-1","open_event_sequence":1,"recorded_at_utc":"2026-10-24T10:00:00Z","entry_type":"market"}}}});
        entry_metadata(&mut view, &record);
        assert_eq!(view["ledger"][0]["recorded_at_utc"], "2026-10-24T10:00:00Z");
        assert_eq!(view["ledger"][0]["entry_type"], "market");
        record["payload"]["entry_recording"]["datasets"]["dataset-fixture"]["replay-pos-1"]["open_event_sequence"] =
            json!(4);
        entry_metadata(&mut view, &record);
        assert!(view["ledger"][0]["recorded_at_utc"].is_null());
        assert!(view["ledger"][0]["entry_type"].is_null());
    }
    #[test]
    fn trade_date_facets_share_the_filter_timezone() {
        let report = json!({"status":"ready","metrics":{"closed_trade_count":1},"scope":{},"ledger":[{"trade_id":"t","session_id":"s","close_time_utc":"2026-12-31T23:30:00Z","net_pnl":1.0}]});
        let page = trades::build_trades_page(
            &report,
            &[],
            1,
            10,
            "close_time_utc",
            "desc",
            r#"{"timezone":"Asia/Ho_Chi_Minh","years":["2027"],"months":["1"],"days":["5"]}"#,
            None,
        )
        .unwrap();
        assert_eq!(page["pagination"]["returned_count"], 1);
        assert_eq!(
            page["facets"]["date_range"],
            json!({"from":"2027-01-01","to":"2027-01-01"})
        );
        assert_eq!(page["facets"]["years"], json!(["2027"]));
    }
}
