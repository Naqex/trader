//! Open exposure belongs to the table, never to the realized performance ledger.
use super::*;

pub(super) fn rows(record: &Value, activity_basis: bool) -> R<Vec<Value>> {
    let view = build_replay_analytics_view(record, None)?;
    if view["analytics_available"] != true {
        return Ok(vec![]);
    }
    let payload = &record["payload"];
    let portfolio = payload["asset_states"].as_object();
    let states: Vec<(&str, &Value)> = if let Some(states) = portfolio {
        states
            .iter()
            .map(|(id, state)| (id.as_str(), &state["execution"]))
            .collect()
    } else {
        vec![(text(&payload["dataset_id"]), &payload["execution"])]
    };
    let mut rows = vec![];
    for (dataset, snapshot) in states {
        let position = &snapshot["position"];
        if position.is_null() {
            continue;
        }
        let opening = array(&snapshot["ledger"])?
            .iter()
            .find(|event| {
                event["kind"] == "market_fill"
                    && event["details"]["position_id"] == position["position_id"]
                    && event["details"]["operation_id"] == position["source_operation_id"]
            })
            .ok_or("open position has no matching entry")?;
        let id = if portfolio.is_some() {
            format!("{}:{}", dataset, text(&position["position_id"]))
        } else {
            text(&position["position_id"]).to_string()
        };
        let mut row = json!({
            "trade_id":id,"session_id":record["record_id"],"status":"open",
            "source_position_id":id,"source_operation_id":position["source_operation_id"],
            "source":{"session_id":record["record_id"],"revision":record["revision"]},
            "session_name":payload.get("name").filter(|v|truth(v)).unwrap_or(&record["record_id"]),
            "symbol":snapshot["instrument_spec"]["instrument_id"],"side":position["side"],
            "quantity":number(&position["quantity"])?,"price_open":number(&position["entry_fill"])?,
            "stop_loss":position["stop_loss"],"take_profit":position["take_profit"],
            "open_time_utc":opening["virtual_time_utc"],"open_event_sequence":opening["sequence"],
            "open_cursor_index":if portfolio.is_none() || dataset == text(&payload["dataset_id"]) { opening["cursor_index"].clone() } else { Value::Null },
            "close_time_utc":null,"report_time_utc":null,"close_recorded_at_utc":null,
            "close_cursor_index":null,"close_event_sequence":null,"price_close":null,
            "net_pnl":null,"gross_pnl":null,"fees":null,"realized_r":null,"planned_risk_budget":null,
            "account_currency":snapshot["instrument_spec"]["account_ccy"],
            "starting_balance":number(&snapshot["starting_balance"])?,
            "playbook_id":payload["playbook_id"],"source_provenance":view["provenance"]
        });
        if portfolio.is_some() {
            row["dataset_id"] = json!(dataset);
            row["asset_open_cursor_index"] = opening["cursor_index"].clone();
            row["asset_open_event_sequence"] = opening["sequence"].clone();
            // A portfolio event sequence is not an asset's execution sequence.
            row["open_event_sequence"] = Value::Null;
        }
        rows.push(row);
    }
    let mut decorated = json!({"ledger":rows});
    presentation::entry_metadata(&mut decorated, record);
    let mut rows = decorated["ledger"].as_array().cloned().unwrap_or_default();
    for row in &mut rows {
        row["table_time_utc"] = if activity_basis {
            row["recorded_at_utc"].clone()
        } else {
            row["open_time_utc"].clone()
        };
    }
    Ok(rows)
}

pub(super) fn matches_filters(row: &Value, filters: &Value) -> R<bool> {
    let filters = normalize_filters(Some(filters))?;
    if filters["side"] != "all" && text(&row["side"]).to_lowercase() != text(&filters["side"]) {
        return Ok(false);
    }
    if filters["outcome"] != "all" {
        return Ok(false);
    }
    let time = timestamp(&row["table_time_utc"])?;
    let from = timestamp(&filters["from_close_utc"])?;
    let to = timestamp(&filters["to_close_utc"])?;
    Ok(
        from.is_none_or(|from| time.is_some_and(|time| time >= from))
            && to.is_none_or(|to| time.is_some_and(|time| time <= to)),
    )
}

pub(super) fn project(records: &[Value], workspace: &str, activity_basis: bool) -> Value {
    let (mut projected, mut invalid) = (vec![], vec![]);
    for record in records {
        let payload = &record["payload"];
        let exposed = payload["execution"]["position"].is_object()
            || payload["asset_states"].as_object().is_some_and(|states| {
                states
                    .values()
                    .any(|s| s["execution"]["position"].is_object())
            });
        if !exposed {
            continue;
        }
        let mut record = record.clone();
        record["workspace_id"] = json!(workspace);
        match rows(&record, activity_basis) {
            Ok(rows) => projected.extend(rows),
            Err(_) => invalid.push(record["record_id"].clone()),
        }
    }
    json!({"rows":projected,"invalid_sessions":invalid})
}

pub(super) fn append_projected(report: &mut Value, projection: &Value, filters: &Value) -> R<()> {
    let readable: HashSet<String> = array(&report["sources"])?
        .iter()
        .map(|s| text(&s["session_id"]).to_string())
        .collect();
    // The financial report owns source failures. An exposure projection must
    // never silently omit a session that the same revision declared readable.
    if array(&projection["invalid_sessions"])?
        .iter()
        .any(|id| readable.contains(text(id)))
    {
        return Err("readable replay open projection invalid".into());
    }
    let mut open = vec![];
    for row in array(&projection["rows"])? {
        if readable.contains(text(&row["session_id"])) && matches_filters(row, filters)? {
            open.push(row.clone());
        }
    }
    // Forked sessions are separate current exposures. Existing closed-fill
    // ancestry dedup remains unchanged; no open row enters financial metrics.
    if !open.is_empty() {
        report["scope"]["open_positions"] = json!("per_selected_session_snapshot");
        report["ledger"]
            .as_array_mut()
            .ok_or("table ledger unavailable")?
            .extend(open);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> Value {
        let cases: Value = serde_json::from_str(include_str!("oracle_cases.json")).unwrap();
        let mut record = cases["inputs"][1].clone();
        let queued = crate::replay_core::transform(&json!({"action":"queue","snapshot":record["payload"]["execution"],"args":{"operation_id":"open-test","side":"BUY","quantity":"0.10","stop_loss":"1.0900","take_profit":"1.1200"}})).unwrap();
        let opened = crate::replay_core::transform(&json!({"action":"advance","snapshot":queued["snapshot"],"args":{"cursor_index":1,"bar":{"timestamp":1700000000,"open":1.1000,"high":1.1030,"low":1.0990,"close":1.1020}}})).unwrap();
        record["payload"]["execution"] = opened["snapshot"].clone();
        record["payload"]["cursor_index"] = json!(1);
        record
    }
    #[test]
    fn open_table_row_preserves_unknown_realized_values_and_does_not_change_performance() {
        let record = record();
        let before = build_replay_analytics_view(&record, None).unwrap();
        let row = rows(&record, false).unwrap().remove(0);
        assert_eq!(row["status"], "open");
        assert_eq!(row["quantity"], 0.1);
        assert_eq!(row["open_event_sequence"], 1);
        assert_eq!(row["open_cursor_index"], 1);
        for key in [
            "net_pnl",
            "gross_pnl",
            "fees",
            "realized_r",
            "price_close",
            "close_time_utc",
            "report_time_utc",
        ] {
            assert!(row[key].is_null(), "{key}");
        }
        assert_eq!(row["table_time_utc"], 1700000000);
        assert!(rows(&record, true).unwrap()[0]["table_time_utc"].is_null());
        assert_eq!(build_replay_analytics_view(&record, None).unwrap(), before);
        assert_eq!(before["metrics"]["closed_trade_count"], 0);
        assert!(!matches_filters(&row, &json!({"outcome":"win"})).unwrap());
        assert!(
            matches_filters(
                &row,
                &json!({"from_close_utc":1700000000,"to_close_utc":1700000000})
            )
            .unwrap()
        );
    }
    #[test]
    fn open_entries_filter_sort_and_page_without_becoming_breakeven() {
        let record = record();
        let mut report =
            build_dashboard_performance(&[record.clone()], "tenant-a", None, None, None, true, &[])
                .unwrap();
        append_projected(
            &mut report,
            &project(&[record], "tenant-a", false),
            &json!({}),
        )
        .unwrap();
        assert_eq!(report["metrics"]["closed_trade_count"], 0);
        let page = trades::build_trades_page(
            &report,
            &[],
            2,
            1,
            "net_pnl",
            "desc",
            r#"{"statuses":["open"],"outcomes":["unknown"]}"#,
            None,
        )
        .unwrap();
        assert_eq!(page["pagination"]["filtered_count"], 1);
        assert_eq!(page["pagination"]["page"], 1);
        assert!(
            trades::build_trades_page(
                &report,
                &[],
                1,
                10,
                "status",
                "asc",
                r#"{"outcomes":["breakeven"]}"#,
                None
            )
            .unwrap()["ledger"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn partial_close_and_historical_snapshot_keep_realized_and_open_rows_separate() {
        let historical = record();
        let snapshot = &historical["payload"]["execution"];
        let closed = crate::replay_core::transform(&json!({"action":"close","snapshot":snapshot,"args":{
            "target_id":snapshot["position"]["position_id"],"operation_id":"partial-test","quantity":"0.04",
            "mid_close":"1.1020","virtual_time_utc":1700000060
        }})).unwrap();
        let mut partial = historical.clone();
        partial["payload"]["execution"] = closed["snapshot"].clone();
        let row = rows(&partial, false).unwrap().remove(0);
        assert_eq!(row["quantity"], 0.06);
        assert!(row["net_pnl"].is_null());
        let financial = build_replay_analytics_view(&partial, None).unwrap();
        assert_eq!(financial["metrics"]["closed_trade_count"], 1);
        assert_ne!(financial["ledger"][0]["trade_id"], row["trade_id"]);
        assert_eq!(financial["ledger"][0]["quantity"], 0.04);
        assert_eq!(rows(&historical, false).unwrap()[0]["quantity"], 0.1);
        let mut invalid = partial;
        invalid["payload"]["execution"]["position"]["quantity"] = json!("0.99");
        assert!(rows(&invalid, false).is_err());
    }
    #[test]
    fn portfolio_open_rows_keep_asset_authority_without_inventing_inactive_cursor() {
        let mut record = record();
        let first = record["payload"]["execution"].clone();
        let mut second = first.clone();
        second["dataset_id"] = json!("second-dataset");
        for event in second["ledger"].as_array_mut().unwrap() {
            event["dataset_id"] = json!("second-dataset");
        }
        record["payload"]["dataset_ids"] = json!(["dataset-fixture", "second-dataset"]);
        record["payload"]["starting_balance"] = first["starting_balance"].clone();
        record["payload"]["starting_balance_ccy"] = first["instrument_spec"]["account_ccy"].clone();
        record["payload"]["asset_states"] = json!({"dataset-fixture":{"execution":first,"cursor_index":1},"second-dataset":{"execution":second,"cursor_index":1}});
        let rows = rows(&record, false).unwrap();
        assert_eq!(rows.len(), 2);
        let inactive = rows
            .iter()
            .find(|r| r["dataset_id"] == "second-dataset")
            .unwrap();
        assert!(inactive["open_cursor_index"].is_null());
        assert!(inactive["open_event_sequence"].is_null());
        assert_eq!(inactive["asset_open_cursor_index"], 1);
        assert_eq!(inactive["asset_open_event_sequence"], 1);
        assert_eq!(inactive["trade_id"], "second-dataset:replay-pos-1");
    }
    #[test]
    fn reusable_projection_intersects_readable_sources_and_retains_entry_proof() {
        let mut record = record();
        record["payload"]["entry_recording"] = json!({"schema_version":"replay-entry-recording-v1","datasets":{"dataset-fixture":{"replay-pos-1":{"source_operation_id":"open-test","open_event_sequence":1,"recorded_at_utc":"2026-10-25T10:30:00Z","entry_type":"market"}}}});
        let mut invalid = record.clone();
        invalid["record_id"] = json!("invalid-session");
        let projection = project(&[record.clone(), invalid], "tenant-a", true);
        assert_eq!(projection["rows"].as_array().unwrap().len(), 1);
        assert_eq!(
            projection["rows"][0]["table_time_utc"],
            "2026-10-25T10:30:00Z"
        );
        assert_eq!(projection["rows"][0]["entry_type"], "market");
        let mut report =
            build_dashboard_performance(&[record], "tenant-a", None, None, None, true, &[])
                .unwrap();
        append_projected(
            &mut report,
            &projection,
            &json!({"from_close_utc":"2026-10-25T10:30:00Z","to_close_utc":"2026-10-25T10:30:00Z"}),
        )
        .unwrap();
        assert_eq!(report["ledger"].as_array().unwrap().len(), 1);
        let mut other = json!({"ledger":[],"sources":[{"session_id":"unselected"}],"scope":{}});
        append_projected(&mut other, &projection, &json!({})).unwrap();
        assert!(other["ledger"].as_array().unwrap().is_empty());
        other["sources"] = json!([{"session_id":"invalid-session"}]);
        assert!(append_projected(&mut other, &projection, &json!({})).is_err());
    }
}
