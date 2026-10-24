//! Product reports use observed activity time; engine and Prop clocks stay virtual.
use super::*;

pub(super) fn time(trade: &Value) -> &Value {
    trade.get("report_time_utc").unwrap_or(&trade["close_time_utc"])
}

pub(super) fn view(record: &Value, filters: Option<&Value>, zone: chrono_tz::Tz) -> R<Value> {
    let mut view = build_replay_analytics_view(record, None)?;
    presentation::apply_timezone(&mut view, zone);
    presentation::entry_metadata(&mut view, record);
    let payload = &record["payload"];
    let mut events = HashMap::new();
    if let Some(states) = payload["asset_states"].as_object() {
        for (dataset, state) in states {
            for event in state["execution"]["ledger"].as_array().into_iter().flatten() {
                events.insert((dataset.as_str(), event["sequence"].as_u64()), event);
            }
        }
    } else {
        for event in payload["execution"]["ledger"].as_array().into_iter().flatten() {
            events.insert((text(&payload["dataset_id"]), event["sequence"].as_u64()), event);
        }
    }
    if let Some(rows) = view["ledger"].as_array_mut() {
        for row in rows {
            let dataset = row.get("dataset_id").unwrap_or(&payload["dataset_id"]);
            let sequence = row.get("asset_close_event_sequence").unwrap_or(&row["close_event_sequence"]);
            let stamp = events.get(&(text(dataset), sequence.as_u64())).and_then(|event| {
                crate::replay_service::activity_recording::timestamp(payload, event, false)
            });
            row["close_recorded_at_utc"] = json!(stamp);
            row["report_time_utc"] = row["close_recorded_at_utc"].clone();
        }
    }
    let all_rows = view["ledger"].as_array().cloned().unwrap_or_default();
    let all_known = all_rows.iter().filter(|r|!r["report_time_utc"].is_null()).count();
    if view["analytics_available"] == true {
        let source = json!({"ledger":view["ledger"],"protocol":{"starting_balance":view["metrics"]["starting_balance"]}});
        let selected = build_analytics_view(&source, filters)?;
        for key in ["ledger", "metrics", "scope", "filters"] { view[key] = selected[key].clone(); }
        let metrics = if let Some(rows) = view["ledger"].as_array_mut() {
            rows.sort_by_key(|r| timestamp(time(r)).ok().flatten());
            Some(compute_metrics_v2(rows, &source["protocol"]["starting_balance"])?)
        } else { None };
        if let Some(metrics) = metrics { view["metrics"] = metrics; }
    }
    view["scope"]["time_basis"] = json!("activity");
    view["provenance"]["time_basis"] = json!("activity");
    let rows = view["ledger"].as_array().cloned().unwrap_or_default();
    let known = rows.iter().filter(|r| !r["report_time_utc"].is_null()).count();
    view["scope"]["recording_coverage"] = json!({"known_close_count":known,"unknown_close_count":all_rows.len()-all_known,"selected_known_close_count":known,"legacy_backfill":false});
    view["equity_curve"] = equity_curve(payload, filters)?;
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn fixture(stamps: &[Option<&str>]) -> Value {
        let cases: Value = serde_json::from_str(include_str!("oracle_cases.json")).unwrap();
        let mut record = cases["inputs"][2].clone();
        let events = record["payload"]["execution"]["ledger"].as_array().unwrap().clone();
        let mut proofs = json!({}); let mut batches = vec![];
        for (event, stamp) in events.iter().zip(stamps) {
            if let Some(stamp) = stamp {
                let mut canonical = event.as_object().unwrap().clone();
                canonical.remove("replay_session_id"); canonical.remove("branch_id");
                let hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&canonical).unwrap()));
                proofs[event["sequence"].to_string()] = json!({"event_sha256":hash,"batch_index":batches.len()});
                batches.push(json!({"recorded_at_utc":stamp}));
            }
        }
        record["payload"]["activity_recording"] = json!({"schema_version":"replay-activity-recording-v1","batches":batches,"assets":{"dataset-fixture":proofs},"portfolio":{}});
        record
    }
    #[test]
    fn real_close_drives_summary_dashboard_filters_and_facets_without_changing_market_clock() {
        let r = fixture(&[Some("2026-01-31T23:29:00Z"),Some("2026-01-31T23:30:00Z")]);
        let zone = chrono_tz::Asia::Ho_Chi_Minh;
        let f = json!({"from_close_utc":"2026-02-01T00:00:00+07:00","to_close_utc":"2026-02-01T23:59:59+07:00"});
        let v = view(&r,Some(&f),zone).unwrap();
        assert_eq!(v["ledger"].as_array().unwrap().len(),1);
        assert_eq!(v["ledger"][0]["close_time_utc"],1700000060);
        assert_eq!(v["ledger"][0]["report_time_utc"],"2026-01-31T23:30:00Z");
        let summary = build_activity_session_summary(&r,"tenant-a",zone).unwrap();
        assert_eq!(summary["periods"]["months"][0]["label"],"2026-02");
        let d = build_activity_dashboard(&[r.clone()],"tenant-a",None,None,Some(&f),true,&[],zone).unwrap();
        assert_eq!(d["months"][0]["month"],"2026-02");
        let page = trades::build_trades_page(&d,&[],1,10,"close_time_utc","desc",r#"{"timezone":"Asia/Ho_Chi_Minh","years":["2026"],"months":["2"]}"#,None).unwrap();
        assert_eq!(page["pagination"]["returned_count"],1);
        assert_eq!(page["facets"]["date_range"]["from"],"2026-02-01");
        assert!(build_replay_analytics_view(&r,Some(&f)).unwrap()["ledger"].as_array().unwrap().is_empty());
    }
    #[test]
    fn legacy_missing_close_keeps_alltime_money_but_never_invents_date_or_equity_history() {
        let r = fixture(&[Some("2026-10-24T10:00:00Z"),None]);
        let v = view(&r,None,chrono_tz::UTC).unwrap();
        assert_eq!(v["metrics"]["net_pnl"],17.0);
        assert!(v["ledger"][0]["report_time_utc"].is_null());
        assert_eq!(v["scope"]["recording_coverage"]["unknown_close_count"],1);
        let summary = build_activity_session_summary(&r,"tenant-a",chrono_tz::UTC).unwrap();
        assert!(summary["periods"]["months"].as_array().unwrap().is_empty());
        assert_eq!(summary["periods"]["incomplete"],true);
        assert_eq!(v["equity_curve"]["points"][0]["equity"],99996.0);
        assert_ne!(v["equity_curve"]["points"][0]["equity"],v["metrics"]["starting_balance"]);
        assert_eq!(v["equity_curve"]["partial"],true);
        let filtered = view(&r,Some(&json!({"from_close_utc":"2026-10-01T00:00:00Z"})),chrono_tz::UTC).unwrap();
        assert_eq!(filtered["metrics"]["closed_trade_count"],0);
    }
    #[test]
    fn true_equity_includes_open_floating_and_cannot_be_reconstructed_from_filtered_wins() {
        let r = fixture(&[Some("2026-11-01T05:59:00Z"),Some("2026-11-01T06:01:00Z")]);
        let v = view(&r,Some(&json!({"outcome":"loss"})),chrono_tz::America::New_York).unwrap();
        assert_eq!(v["metrics"]["closed_trade_count"],0);
        assert_eq!(v["equity_curve"]["points"][0]["equity"],99996.0);
        assert_eq!(v["equity_curve"]["points"][1]["equity"],100017.0);
        assert_eq!(v["equity_curve"]["scope"],"account");
        assert_eq!(v["equity_curve"]["trade_filters_apply"],false);
    }
}

fn equity_curve(payload: &Value, filters: Option<&Value>) -> R<Value> {
    let portfolio = payload["asset_states"].is_object();
    let account = if portfolio { &payload["portfolio_execution"] } else { &payload["execution"] };
    let f = normalize_filters(filters)?;
    let from = timestamp(&f["from_close_utc"])?;
    let to = timestamp(&f["to_close_utc"])?;
    let mut points = Vec::new();
    let (mut segment, mut missing, mut previous) = (0usize, 0usize, None::<Value>);
    for event in account["ledger"].as_array().into_iter().flatten() {
        let state = json!([event["equity"], event["balance"]]);
        // Unchanged administrative events do not create holes in a financial curve.
        if previous.as_ref() == Some(&state) && !["market_fill","manual_close","protective_fill","phase_transition"].contains(&text(&event["kind"])) { continue; }
        previous = Some(state);
        let stamp = crate::replay_service::activity_recording::timestamp(payload, event, portfolio);
        let Some(date) = stamp.as_ref().and_then(|s| timestamp(&json!(s)).ok().flatten()) else { missing += 1; segment += 1; continue; };
        if from.is_some_and(|f|date<f) || to.is_some_and(|t|date>t) { continue; }
        points.push(json!({"time_utc":stamp,"equity":number(&event["equity"])? ,"balance":number(&event["balance"])? ,"sequence":event["sequence"],"segment":segment}));
    }
    // Sample within each segment; never connect across missing observations.
    let total = points.len();
    if total > 128 {
        let keep: BTreeSet<_> = (0..128).map(|i|i*(total-1)/127).collect();
        points = points.into_iter().enumerate().filter(|(i,_)|keep.contains(i)).map(|(_,p)|p).collect();
    }
    Ok(json!({"points":points,"total_points":total,"sampled":total>128,"time_basis":"activity","value_basis":"account_equity_including_floating_pnl","scope":"account","trade_filters_apply":false,"unknown_event_count":missing,"partial":missing>0,"legacy_backfill":false}))
}
