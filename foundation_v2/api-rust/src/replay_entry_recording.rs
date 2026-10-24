use serde_json::{Value, json};

fn snapshots(payload: &Value) -> Vec<&Value> {
    if let Some(states) = payload["asset_states"].as_object() {
        states.values().map(|state| &state["execution"]).collect()
    } else {
        vec![&payload["execution"]]
    }
}

pub(super) fn baseline(payload: &Value) -> Value {
    let mut heads = serde_json::Map::new();
    let mut add = |dataset: &str, execution: &Value| {
        let sequence = if execution.is_null() {
            Some(0)
        } else {
            execution["event_sequence"].as_u64()
        };
        if let Some(sequence) = sequence {
            heads.insert(dataset.to_owned(), json!(sequence));
        }
    };
    if let Some(states) = payload["asset_states"].as_object() {
        for (dataset, state) in states {
            add(dataset, &state["execution"]);
        }
    } else if let Some(dataset) = payload["dataset_id"]
        .as_str()
        .or(payload["execution"]["dataset_id"].as_str())
    {
        add(dataset, &payload["execution"]);
    }
    Value::Object(heads)
}

pub(super) fn capture(baseline: &Value, payload: &mut Value, events: &[Value], stamp: &str) {
    let mut additions = Vec::new();
    for event in snapshots(payload)
        .into_iter()
        .flat_map(|snapshot| snapshot["ledger"].as_array().into_iter().flatten())
        .chain(events)
        .filter(|event| event["kind"] == "market_fill")
    {
        let Some(dataset) = event["dataset_id"].as_str() else {
            continue;
        };
        let Some(sequence) = event["sequence"].as_u64() else {
            continue;
        };
        let Some(previous) = baseline[dataset].as_u64() else {
            continue;
        };
        if sequence <= previous {
            continue;
        }
        let details = &event["details"];
        let (Some(position), Some(operation)) = (
            details["position_id"].as_str(),
            details["operation_id"].as_str(),
        ) else {
            continue;
        };
        let kind = details["entry_order"]["order_type"]
            .as_str()
            .or(details["open_position"]["entry_order_type"].as_str())
            .unwrap_or("market");
        additions.push((
            dataset.to_owned(),
            position.to_owned(),
            json!({
                "source_operation_id":operation,"open_event_sequence":sequence,
                "recorded_at_utc":stamp,"entry_type":kind
            }),
        ));
    }
    if additions.is_empty() {
        return;
    }
    if !payload["entry_recording"].is_object() {
        payload["entry_recording"] =
            json!({"schema_version":"replay-entry-recording-v1","datasets":{}});
    }
    for (dataset, position, recording) in additions {
        if !payload["entry_recording"]["datasets"][&dataset].is_object() {
            payload["entry_recording"]["datasets"][&dataset] = json!({});
        }
        // Capture only newly appended fills. Metadata saves, retries and copied
        // branch history must never replace the original observed wall clock.
        payload["entry_recording"]["datasets"][&dataset][&position] = recording;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(sequence: u64, position: &str, operation: &str) -> Value {
        json!({"kind":"market_fill","dataset_id":"d","sequence":sequence,
            "details":{"position_id":position,"operation_id":operation}})
    }
    fn payload(sequence: u64, ledger: Vec<Value>) -> Value {
        json!({"execution":{"dataset_id":"d","event_sequence":sequence,"ledger":ledger}})
    }
    #[test]
    fn capture_full_and_compact_only_new_fills() {
        let old = payload(4, vec![event(2, "old", "old-op")]);
        let fill = event(5, "new", "new-op");
        let mut full = payload(6, vec![event(2, "old", "old-op"), fill.clone()]);
        let unchanged_execution = full["execution"].clone();
        let mut compact = payload(6, vec![]);
        capture(&baseline(&old), &mut full, &[], "2026-10-24T10:00:00Z");
        capture(
            &baseline(&old),
            &mut compact,
            &[fill],
            "2026-10-24T10:00:00Z",
        );
        assert_eq!(full["entry_recording"], compact["entry_recording"]);
        assert_eq!(full["execution"], unchanged_execution);
        assert!(full["entry_recording"]["datasets"]["d"]["old"].is_null());
        let saved = full.clone();
        capture(&baseline(&saved), &mut full, &[], "2026-10-25T00:00:00Z");
        assert_eq!(saved["entry_recording"], full["entry_recording"]);
    }
    #[test]
    fn detached_mutation_payload_keeps_exact_prior_head_and_legacy_stays_unknown() {
        let mut prior = payload(4, vec![event(2, "old", "old-op")]);
        prior["entry_recording"] = json!({"schema_version":"replay-entry-recording-v1","datasets":{"d":{"old":{
            "source_operation_id":"old-op","open_event_sequence":2,"recorded_at_utc":"2026-10-22T10:00:00Z","entry_type":"market"
        }}}});
        let old_recording = prior["entry_recording"].clone();
        let mut record = json!({"payload":prior});
        let mut next = super::super::take_mutation_payload(&mut record);
        assert!(record["payload"].is_null());
        next["execution"]["ledger"]
            .as_array_mut()
            .unwrap()
            .push(event(5, "new", "new-op"));
        next["execution"]["event_sequence"] = json!(6);
        capture(
            &record["_entry_recording_baseline"],
            &mut next,
            &[],
            "2026-10-24T10:00:00Z",
        );
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["old"],
            old_recording["datasets"]["d"]["old"]
        );
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["new"]["recorded_at_utc"],
            "2026-10-24T10:00:00Z"
        );
        let mut cold = payload(6, vec![event(2, "old", "old-op")]);
        capture(
            &baseline(&Value::Null),
            &mut cold,
            &[],
            "2026-10-24T10:00:00Z",
        );
        assert!(cold["entry_recording"].is_null());
    }
    #[test]
    fn explicit_uninitialized_dataset_can_record_its_first_future_fill() {
        let prior = json!({"dataset_id":"d","execution":null});
        let mut next = payload(2, vec![event(1, "first", "first-op")]);
        capture(&baseline(&prior), &mut next, &[], "2026-10-24T10:00:00Z");
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["first"]["open_event_sequence"],
            1
        );
    }
    #[test]
    fn capture_portfolio_and_branch_preserve_original_recording() {
        let mut fill = event(7, "position", "limit-op");
        fill["details"]["open_position"] = json!({"entry_order_type":"limit"});
        let prior =
            json!({"asset_states":{"d":{"execution":{"dataset_id":"d","event_sequence":6}}}});
        let mut next = json!({"asset_states":{"d":{"execution":{"dataset_id":"d","event_sequence":7,"ledger":[fill]}}}});
        capture(&baseline(&prior), &mut next, &[], "2026-10-24T10:00:00Z");
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["position"]["entry_type"],
            "limit"
        );
        let mut branch = next.clone();
        capture(&baseline(&next), &mut branch, &[], "2026-10-25T00:00:00Z");
        assert_eq!(branch["entry_recording"], next["entry_recording"]);
    }
    #[test]
    fn new_branch_fill_replaces_only_its_position_recording() {
        let mut prior = payload(4, vec![]);
        prior["entry_recording"] = json!({"schema_version":"replay-entry-recording-v1","datasets":{"d":{
            "reused":{"source_operation_id":"parent-future","open_event_sequence":5,"recorded_at_utc":"2026-10-23T10:00:00Z"},
            "inherited":{"source_operation_id":"old-op","open_event_sequence":2,"recorded_at_utc":"2026-10-22T10:00:00Z"}
        }}});
        let mut next = prior.clone();
        next["execution"]["event_sequence"] = json!(6);
        capture(
            &baseline(&prior),
            &mut next,
            &[event(5, "reused", "branch-new")],
            "2026-10-24T10:00:00Z",
        );
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["reused"]["source_operation_id"],
            "branch-new"
        );
        assert_eq!(
            next["entry_recording"]["datasets"]["d"]["inherited"],
            prior["entry_recording"]["datasets"]["d"]["inherited"]
        );
    }
}
