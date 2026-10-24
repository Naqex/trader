use chrono::DateTime;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const SCHEMA: &str = "replay-activity-recording-v1";

fn assets(payload: &Value) -> Vec<(String, &Value)> {
    if let Some(states) = payload["asset_states"].as_object() {
        states
            .iter()
            .map(|(dataset, state)| (dataset.clone(), &state["execution"]))
            .collect()
    } else {
        payload["dataset_id"]
            .as_str()
            .or(payload["execution"]["dataset_id"].as_str())
            .map(|dataset| vec![(dataset.to_owned(), &payload["execution"])])
            .unwrap_or_default()
    }
}

fn head(execution: &Value) -> Value {
    if execution.is_null() {
        json!({"sequence":0,"equity":null})
    } else {
        json!({"sequence":execution["event_sequence"],"equity":execution["equity"]})
    }
}

pub(super) fn baseline(payload: &Value) -> Value {
    let assets: Map<String, Value> = assets(payload)
        .into_iter()
        .map(|(dataset, execution)| (dataset, head(execution)))
        .collect();
    // A reconstructed portfolio must not acquire a wall clock for old local history.
    let portfolio = if payload["portfolio_execution"].is_object()
        || (payload["asset_states"].is_object()
            && assets
                .values()
                .all(|entry| entry["sequence"].as_u64() == Some(0)))
    {
        head(&payload["portfolio_execution"])
    } else {
        Value::Null
    };
    json!({"assets":assets,"portfolio":portfolio})
}

fn valid_stamp(stamp: &str) -> bool {
    DateTime::parse_from_rfc3339(stamp).is_ok_and(|value| value.offset().local_minus_utc() == 0)
}

fn hash(event: &Value) -> Option<String> {
    let mut event = event.as_object()?.clone();
    // Forking changes only scope. Financial/cause fields remain part of the proof.
    event.remove("replay_session_id");
    event.remove("branch_id");
    let canonical = serde_json::to_vec(&event).ok()?;
    Some(format!("{:x}", Sha256::digest(canonical)))
}

fn causal(event: &Value) -> bool {
    matches!(
        event["kind"].as_str(),
        Some("market_fill" | "protective_fill" | "manual_close" | "phase_transition")
    ) || event["details"]["source_events"]
        .as_array()
        .is_some_and(|sources| sources.iter().any(causal))
}

fn collect<'a>(prior: &Value, events: impl Iterator<Item = &'a Value>) -> Vec<(String, String)> {
    let Some(previous) = prior["sequence"].as_u64() else {
        return vec![];
    };
    let ordered: BTreeMap<u64, &Value> = events
        .filter_map(|event| {
            let sequence = event["sequence"].as_u64()?;
            (sequence > previous).then_some((sequence, event))
        })
        .collect();
    let mut equity = prior["equity"].clone();
    let mut proofs = Vec::new();
    for (sequence, event) in ordered {
        let changed = !event["equity"].is_null() && event["equity"] != equity;
        if (causal(event) || changed || previous == 0 && sequence == 1)
            && let Some(hash) = hash(event)
        {
            proofs.push((sequence.to_string(), hash));
        }
        if !event["equity"].is_null() {
            equity = event["equity"].clone();
        }
    }
    proofs
}

fn prune(proofs: &mut Value, head: &Value) {
    if let Some(proofs) = proofs.as_object_mut() {
        proofs.retain(|sequence, _| {
            sequence
                .parse::<u64>()
                .ok()
                .zip(head["sequence"].as_u64())
                .is_some_and(|(sequence, head)| sequence <= head)
        });
    }
}

pub(super) fn capture(prior: &Value, payload: &mut Value, events: &[Value], stamp: &str) {
    if !valid_stamp(stamp) {
        return;
    }
    let heads = baseline(payload);
    let mut additions = Vec::new();
    for (dataset, execution) in assets(payload) {
        let proofs = collect(
            &prior["assets"][&dataset],
            execution["ledger"].as_array().into_iter().flatten().chain(
                events
                    .iter()
                    .filter(|event| event["dataset_id"].as_str() == Some(dataset.as_str())),
            ),
        );
        if !proofs.is_empty() {
            additions.push((dataset, proofs));
        }
    }
    let portfolio = collect(
        &prior["portfolio"],
        payload["portfolio_execution"]["ledger"]
            .as_array()
            .into_iter()
            .flatten(),
    );
    if payload["activity_recording"].is_null() {
        if additions.is_empty() && portfolio.is_empty() {
            return;
        }
        payload["activity_recording"] =
            json!({"schema_version":SCHEMA,"batches":[],"assets":{},"portfolio":{}});
    }
    let recording = &mut payload["activity_recording"];
    if recording["schema_version"] != SCHEMA
        || !recording["batches"].is_array()
        || !recording["assets"].is_object()
        || !recording["portfolio"].is_object()
    {
        return;
    }
    // Branch payloads may copy receipts from a later parent revision. Drop them at
    // the restored cutoff; reused child sequences get their own observed batch.
    for (dataset, proofs) in recording["assets"].as_object_mut().unwrap() {
        prune(proofs, &heads["assets"][dataset]);
    }
    prune(&mut recording["portfolio"], &heads["portfolio"]);
    if additions.is_empty() && portfolio.is_empty() {
        return;
    }
    let index = recording["batches"].as_array().unwrap().len();
    recording["batches"]
        .as_array_mut()
        .unwrap()
        .push(json!({"recorded_at_utc":stamp}));
    for (dataset, proofs) in additions {
        if !recording["assets"][&dataset].is_object() {
            recording["assets"][&dataset] = json!({});
        }
        for (sequence, hash) in proofs {
            recording["assets"][&dataset][&sequence] =
                json!({"event_sha256":hash,"batch_index":index});
        }
    }
    for (sequence, hash) in portfolio {
        recording["portfolio"][&sequence] = json!({"event_sha256":hash,"batch_index":index});
    }
}

pub(crate) fn timestamp(payload: &Value, event: &Value, portfolio: bool) -> Option<String> {
    let recording = &payload["activity_recording"];
    if recording["schema_version"] != SCHEMA {
        return None;
    }
    let sequence = event["sequence"].as_u64()?.to_string();
    let proof = if portfolio {
        &recording["portfolio"][&sequence]
    } else {
        &recording["assets"][event["dataset_id"].as_str()?][&sequence]
    };
    if proof["event_sha256"].as_str()? != hash(event)? {
        return None;
    }
    let index = usize::try_from(proof["batch_index"].as_u64()?).ok()?;
    let stamp = recording["batches"].get(index)?["recorded_at_utc"].as_str()?;
    valid_stamp(stamp).then(|| stamp.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIRST: &str = "2026-10-24T10:00:00Z";
    const SECOND: &str = "2026-10-25T11:00:00Z";
    fn event(sequence: u64, kind: &str, equity: &str) -> Value {
        json!({"sequence":sequence,"kind":kind,"dataset_id":"d","equity":equity,
            "replay_session_id":"parent","branch_id":"main","virtual_time_utc":120,
            "details":{"operation_id":format!("op-{sequence}"),"position_id":"p"}})
    }
    fn payload(sequence: u64, ledger: Vec<Value>) -> Value {
        let equity = ledger
            .last()
            .map(|event| event["equity"].clone())
            .unwrap_or(json!("10000"));
        json!({"execution":{"dataset_id":"d","event_sequence":sequence,"equity":equity,"ledger":ledger}})
    }
    #[test]
    fn full_compact_parity_and_metadata_retry_do_not_restamp() {
        let prior = payload(2, vec![event(2, "price_mark", "10000")]);
        let suffix = vec![
            event(3, "market_fill", "10000"),
            event(4, "price_mark", "10001"),
            event(5, "price_mark", "10001"),
            event(6, "manual_close", "10001"),
        ];
        let mut full = payload(6, suffix.clone());
        let mut compact = payload(6, vec![]);
        let unchanged = full["execution"].clone();
        capture(&baseline(&prior), &mut full, &[], FIRST);
        capture(&baseline(&prior), &mut compact, &suffix, FIRST);
        assert_eq!(full["activity_recording"], compact["activity_recording"]);
        assert_eq!(full["execution"], unchanged);
        assert_eq!(timestamp(&full, &suffix[0], false).as_deref(), Some(FIRST));
        assert_eq!(timestamp(&full, &suffix[1], false).as_deref(), Some(FIRST));
        assert!(timestamp(&full, &suffix[2], false).is_none());
        assert_eq!(timestamp(&full, &suffix[3], false).as_deref(), Some(FIRST));
        let saved = full.clone();
        capture(&baseline(&saved), &mut full, &[], SECOND);
        assert_eq!(full["activity_recording"], saved["activity_recording"]);
        assert!(timestamp(&full, &event(2, "price_mark", "10000"), false).is_none());
    }
    #[test]
    fn first_new_unchanged_event_anchors_the_observed_account_curve() {
        let anchor = event(1, "price_mark", "10000");
        let mut next = payload(2, vec![anchor.clone(), event(2, "price_mark", "10000")]);
        capture(&baseline(&payload(0, vec![])), &mut next, &[], FIRST);
        assert_eq!(timestamp(&next, &anchor, false).as_deref(), Some(FIRST));
        assert!(timestamp(&next, &event(2, "price_mark", "10000"), false).is_none());
        let legacy = payload(1, vec![anchor.clone()]);
        let mut historical = legacy.clone();
        capture(&baseline(&legacy), &mut historical, &[], FIRST);
        assert!(timestamp(&historical, &anchor, false).is_none());
    }
    #[test]
    fn unknown_legacy_and_reconstructed_portfolio_are_not_backfilled() {
        let mut legacy = payload(8, vec![event(8, "manual_close", "10000")]);
        capture(&baseline(&Value::Null), &mut legacy, &[], FIRST);
        assert!(legacy["activity_recording"].is_null());
        let prior = json!({"asset_states":{"d":{"execution":legacy["execution"]}}});
        let mut next = prior.clone();
        next["portfolio_execution"] = legacy["execution"].clone();
        capture(&baseline(&prior), &mut next, &[], FIRST);
        assert!(timestamp(&next, &event(8, "manual_close", "10000"), true).is_none());
    }
    #[test]
    fn separate_partial_close_and_portfolio_clocks_and_initial_fill() {
        let prior = json!({"asset_states":{"d":{"execution":null}},"portfolio_execution":null});
        let close1 = event(2, "manual_close", "10001");
        let close2 = event(3, "manual_close", "10002");
        let account = event(1, "price_mark", "10002");
        let mut next = json!({"asset_states":{"d":{"execution":{"event_sequence":3,"equity":"10002","ledger":[event(1,"market_fill","10000"),close1,close2]}}},
            "portfolio_execution":{"event_sequence":1,"equity":"10002","ledger":[account]}});
        capture(&baseline(&prior), &mut next, &[], FIRST);
        for event in next["asset_states"]["d"]["execution"]["ledger"]
            .as_array()
            .unwrap()
        {
            assert_eq!(timestamp(&next, event, false).as_deref(), Some(FIRST));
        }
        assert_eq!(timestamp(&next, &account, true).as_deref(), Some(FIRST));
        assert!(timestamp(&next, &account, false).is_none());
    }
    #[test]
    fn proof_covers_financial_and_causal_fields_but_allows_fork_scope() {
        let original = event(1, "manual_close", "10001");
        let mut next = payload(1, vec![original.clone()]);
        capture(&baseline(&payload(0, vec![])), &mut next, &[], FIRST);
        for (field, value) in [
            ("equity", json!("99999")),
            ("dataset_id", json!("other")),
            ("kind", json!("price_mark")),
            ("sequence", json!(2)),
            ("details", json!({"operation_id":"other"})),
        ] {
            let mut altered = original.clone();
            altered[field] = value;
            assert!(timestamp(&next, &altered, false).is_none(), "{field}");
        }
        let mut branch = original;
        branch["replay_session_id"] = json!("child");
        branch["branch_id"] = json!("fork");
        assert_eq!(timestamp(&next, &branch, false).as_deref(), Some(FIRST));
    }
    #[test]
    fn branch_cutoff_prunes_future_and_reused_sequences_receive_new_batch() {
        let e1 = event(1, "market_fill", "10000");
        let e2 = event(2, "manual_close", "10001");
        let mut parent = payload(2, vec![e1.clone(), e2.clone()]);
        capture(&baseline(&payload(0, vec![])), &mut parent, &[], FIRST);
        let mut child = parent.clone();
        child["execution"] = payload(1, vec![e1.clone()])["execution"].clone();
        let cutoff = baseline(&child);
        capture(&cutoff, &mut child, &[], SECOND);
        assert!(timestamp(&child, &e2, false).is_none());
        assert_eq!(timestamp(&child, &e1, false).as_deref(), Some(FIRST));
        child["execution"] = parent["execution"].clone();
        capture(&cutoff, &mut child, &[], SECOND);
        assert_eq!(timestamp(&child, &e2, false).as_deref(), Some(SECOND));
        assert_eq!(timestamp(&child, &e1, false).as_deref(), Some(FIRST));
    }
    #[test]
    fn timestamps_require_explicit_utc_and_historical_prefix_is_self_sufficient() {
        let e1 = event(1, "market_fill", "10000");
        let mut next = payload(2, vec![e1.clone(), event(2, "manual_close", "10001")]);
        capture(&baseline(&payload(0, vec![])), &mut next, &[], FIRST);
        next["execution"]["ledger"] = json!([e1]);
        next["execution"]["event_sequence"] = json!(1);
        assert_eq!(timestamp(&next, &e1, false).as_deref(), Some(FIRST));
        for malformed in ["2026-10-24T10:00:00", "2026-10-24T10:00:00+07:00", "bad"] {
            next["activity_recording"]["batches"][0]["recorded_at_utc"] = json!(malformed);
            assert!(timestamp(&next, &e1, false).is_none());
        }
    }
    #[test]
    fn detached_payload_retains_activity_heads() {
        let mut record = json!({"payload":payload(2,vec![event(2,"price_mark","10000")])});
        let mut next = super::super::take_mutation_payload(&mut record);
        next["execution"]["ledger"]
            .as_array_mut()
            .unwrap()
            .push(event(3, "manual_close", "10001"));
        next["execution"]["event_sequence"] = json!(3);
        capture(
            &record["_activity_recording_baseline"],
            &mut next,
            &[],
            FIRST,
        );
        assert!(timestamp(&next, &event(2, "price_mark", "10000"), false).is_none());
        assert_eq!(
            timestamp(&next, &event(3, "manual_close", "10001"), false).as_deref(),
            Some(FIRST)
        );
    }
}
