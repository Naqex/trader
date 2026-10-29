//! One causal account ledger for a replay's immutable collection of assets.
use bigdecimal::BigDecimal;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

type R<T> = Result<T, String>;
fn n(v: &Value, k: &str) -> R<i64> {
    v[k].as_i64()
        .ok_or_else(|| format!("portfolio {k} is invalid"))
}
fn d(v: &Value) -> R<BigDecimal> {
    crate::replay_core::d(v)
}

pub fn initialize(payload: &mut Value, id: &str, mut pins: Vec<Value>) -> R<()> {
    pins.sort_by(|a, b| a["dataset_id"].as_str().cmp(&b["dataset_id"].as_str()));
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&pins).map_err(|e| e.to_string())?)
    );
    let primary = payload["dataset_ids"][0]
        .as_str()
        .ok_or("portfolio primary dataset is missing")?;
    let primary_pin = pins
        .iter()
        .find(|p| p["dataset_id"] == primary)
        .ok_or("portfolio primary pin is missing")?;
    let initial = d(&payload["starting_balance"])?;
    payload["portfolio_execution"] = json!({"schema_version":"replay-portfolio-v1",
        "replay_session_id":id,"branch_id":payload["branch_id"],"dataset_id":primary,
        "dataset_sha256":digest,"primary_dataset_sha256":primary_pin["dataset_sha256"],
        "dataset_pins":pins,"starting_balance":initial.to_string(),"balance_basis":initial.to_string(),
        "phase_initial_balance":initial.to_string(),"phase_index":1,"account_ccy":payload["starting_balance_ccy"],
        "cost_model":null,"engine_version":"replay-v1","balance":initial.to_string(),"floating_pl":"0","equity":initial.to_string(),
        "positions":[],"pending_orders":[],"position":null,"pending_market_order":null,
        "cursor_index":payload["asset_states"][primary]["cursor_index"],"event_sequence":0,"ledger":[],"asset_marks":{},"phase_transitions":[],
        "evaluation_quality":"full_for_declared_model"});
    Ok(())
}

fn tagged(raw: &Value, dataset: &str, spec: &Value) -> Value {
    let mut value = raw.clone();
    if let Some(obj) = value.as_object_mut() {
        obj.insert("dataset_id".into(), json!(dataset));
        obj.insert("instrument_id".into(), spec["instrument_id"].clone());
    }
    value
}

fn total(snapshot: &mut Value) -> R<()> {
    let mut balance = d(&snapshot["balance_basis"])?;
    let mut floating = BigDecimal::from(0);
    let mut positions = Vec::new();
    let mut pending = Vec::new();
    let mut quality = "full_for_declared_model";
    let mut coverage = "complete";
    for mark in snapshot["asset_marks"]
        .as_object()
        .ok_or("portfolio marks are invalid")?
        .values()
    {
        balance += d(&mark["balance"])? - d(&mark["balance_base"])?;
        floating += d(&mark["floating_pl"])?;
        if !mark["position"].is_null() {
            positions.push(mark["position"].clone());
        }
        if !mark["pending_market_order"].is_null() {
            pending.push(mark["pending_market_order"].clone());
        }
        if mark["evaluation_quality"] != "full_for_declared_model" {
            quality = "insufficient";
        }
        if !mark["position"].is_null() && mark["intrabar_equity_coverage"] != "complete" {
            coverage = "insufficient";
        }
    }
    snapshot["balance"] = json!(balance.to_string());
    snapshot["floating_pl"] = json!(floating.to_string());
    snapshot["equity"] = json!((balance + floating).to_string());
    snapshot["positions"] = json!(positions);
    snapshot["pending_orders"] = json!(pending);
    snapshot["evaluation_quality"] = json!(quality);
    snapshot["intrabar_equity_coverage"] = json!(coverage);
    Ok(())
}

/// The suffix is appended in causal time order; simultaneous bar closes are evaluated together.
/// The active chart is deliberately absent from both identity and event sequencing.
pub fn update(payload: &mut Value) -> R<()> {
    if !payload["asset_states"].is_object() {
        return Ok(());
    }
    let mut account = payload["portfolio_execution"].clone();
    if account["schema_version"] != "replay-portfolio-v1" {
        return Err("portfolio account history predates the canonical multi-asset contract; create a new session".into());
    }
    let mut groups: BTreeMap<i64, Vec<(String, Value, Value)>> = BTreeMap::new();
    let mut head_changed = false;
    for (dataset, asset) in payload["asset_states"].as_object().unwrap() {
        let execution = &asset["execution"];
        if execution.is_null() {
            continue;
        }
        crate::replay_core::validate(execution)?;
        let pin = account["dataset_pins"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pin| pin["dataset_id"] == *dataset)
            .ok_or("portfolio dataset is not pinned")?;
        if pin["dataset_sha256"] != execution["dataset_sha256"]
            || execution["branch_id"] != account["branch_id"]
            || execution["replay_session_id"] != account["replay_session_id"]
            || execution["instrument_spec"]["account_ccy"] != account["account_ccy"]
        {
            return Err("portfolio immutable execution lineage changed".into());
        }
        if account["cost_model"].is_null() {
            account["cost_model"] = execution["cost_model"].clone();
            account["engine_version"] =
                json!(if execution["schema_version"] == "replay-execution-v2" {
                    "replay-v2"
                } else {
                    "replay-v1"
                });
        }
        if (payload["session_kind"] == "prop" || !payload["prop_session_id"].is_null())
            && account["cost_model"]["version"] != execution["cost_model"]["version"]
        {
            return Err("portfolio assets must use the same frozen cost model version".into());
        }
        let prior = account["asset_marks"][dataset]["sequence"]
            .as_i64()
            .unwrap_or(0);
        if prior > n(execution, "event_sequence")? {
            return Err("portfolio local history moved backwards".into());
        }
        if account["asset_marks"][dataset].is_null() {
            head_changed = true;
            account["asset_marks"][dataset] = json!({"sequence":0,"balance_base":execution["starting_balance"],
                "balance":execution["starting_balance"],"floating_pl":"0","position":null,"pending_market_order":null,
                "evaluation_quality":"full_for_declared_model","intrabar_equity_coverage":"complete","cursor_index":asset["cursor_index"]});
        }
        for event in execution["ledger"]
            .as_array()
            .ok_or("portfolio source ledger is missing")?
        {
            if n(event, "sequence")? > prior {
                groups.entry(n(event,"virtual_time_utc")?).or_default()
                    .push((dataset.clone(),event.clone(),json!({"instrument_spec":execution["instrument_spec"],
                        "position":execution["position"],"pending_market_order":execution["pending_market_order"],
                        "event_sequence":execution["event_sequence"]})));
            }
        }
        // Initialization at sequence zero does not create a financial event.
    }
    // Queuing a next-bar order changes its head without a local ledger event.
    // It still needs a canonical account mark so recovery can restore every asset.
    if groups.is_empty() {
        for (dataset, asset) in payload["asset_states"].as_object().unwrap() {
            let execution = &asset["execution"];
            if execution.is_null() {
                continue;
            }
            let pending = tagged(
                &execution["pending_market_order"],
                dataset,
                &execution["instrument_spec"],
            );
            if account["asset_marks"][dataset]["pending_market_order"] != pending {
                account["asset_marks"][dataset]["pending_market_order"] = pending;
                head_changed = true;
            }
        }
        if head_changed {
            total(&mut account)?;
            let sequence = n(&account, "event_sequence")? + 1;
            account["event_sequence"] = json!(sequence);
            let primary = account["dataset_id"]
                .as_str()
                .ok_or("portfolio primary dataset is missing")?;
            account["cursor_index"] = payload["asset_states"][primary]["cursor_index"].clone();
            let cursors: Map<String, Value> = payload["asset_states"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(id, asset)| (id.clone(), asset["cursor_index"].clone()))
                .collect();
            let event = json!({"schema_version":"replay-portfolio-event-v1","sequence":sequence,"kind":"price_mark",
                "replay_session_id":account["replay_session_id"],"branch_id":account["branch_id"],
                "dataset_id":account["dataset_id"],"dataset_sha256":account["dataset_sha256"],
                "cursor_index":account["cursor_index"],"virtual_time_utc":payload["replay_clock_utc"],
                "balance":account["balance"],"floating_pl":account["floating_pl"],"equity":account["equity"],
                "open_positions":account["positions"].as_array().unwrap().len(),"pending_orders":account["pending_orders"].as_array().unwrap().len(),
                "evaluation_quality":account["evaluation_quality"],"details":{"open_positions":account["positions"],
                "pending_orders":account["pending_orders"],"asset_cursor_indices":cursors,"source_events":[],
                "intrabar_equity_coverage":account["intrabar_equity_coverage"]}});
            account["ledger"].as_array_mut().unwrap().push(event);
        }
    }
    for (time, mut events) in groups {
        if account["ledger"]
            .as_array()
            .unwrap()
            .last()
            .is_some_and(|e| e["virtual_time_utc"].as_i64().is_some_and(|t| t > time))
        {
            return Err("portfolio events cannot precede the acknowledged account clock".into());
        }
        events.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then(a.1["sequence"].as_i64().cmp(&b.1["sequence"].as_i64()))
        });
        let mut sources = Vec::new();
        let mut transition = None;
        for (dataset, event, execution) in &events {
            let mark = &mut account["asset_marks"][dataset];
            if n(event, "sequence")? != n(mark, "sequence")? + 1 {
                return Err("portfolio source event suffix is not contiguous".into());
            }
            mark["sequence"] = event["sequence"].clone();
            mark["cursor_index"] = event["cursor_index"].clone();
            for key in ["balance", "floating_pl", "evaluation_quality"] {
                mark[key] = event[key].clone();
            }
            for key in [
                "open_position",
                "pending_market_order",
                "intrabar_equity_coverage",
            ] {
                if let Some(value) = event["details"].get(key) {
                    mark[if key == "open_position" {
                        "position"
                    } else {
                        key
                    }] = if value.is_null() {
                        Value::Null
                    } else if ["open_position", "pending_market_order"].contains(&key) {
                        tagged(value, dataset, &execution["instrument_spec"])
                    } else {
                        value.clone()
                    };
                }
            }
            if event["sequence"] == execution["event_sequence"] {
                mark["position"] = tagged(
                    &execution["position"],
                    dataset,
                    &execution["instrument_spec"],
                );
                mark["pending_market_order"] = tagged(
                    &execution["pending_market_order"],
                    dataset,
                    &execution["instrument_spec"],
                );
            }
            if event["kind"] == "phase_transition" {
                let mut details = event["details"].clone();
                details["virtual_time_utc"] = json!(time);
                transition = Some(details);
                if event["details"]["carry_policy"] == "reset" {
                    mark["balance_base"] = event["balance"].clone();
                }
            }
            sources.push(
                json!({"dataset_id":dataset,"sequence":event["sequence"],"kind":event["kind"]}),
            );
        }
        if let Some(details) = &transition {
            account["phase_index"] = details["to_phase_index"].clone();
            account["phase_initial_balance"] = details["next_phase_initial_balance"].clone();
            if details["carry_policy"] == "reset" {
                account["balance_basis"] = details["next_phase_initial_balance"].clone();
            }
            account["phase_transitions"]
                .as_array_mut()
                .unwrap()
                .push(details.clone());
        }
        total(&mut account)?;
        let sequence = n(&account, "event_sequence")?
            .checked_add(1)
            .ok_or("portfolio sequence overflow")?;
        account["event_sequence"] = json!(sequence);
        let primary = account["dataset_id"]
            .as_str()
            .ok_or("portfolio primary dataset is missing")?
            .to_owned();
        account["cursor_index"] = account["asset_marks"][&primary]
            .get("cursor_index")
            .cloned()
            .unwrap_or(account["cursor_index"].clone());
        let cursors: Map<String, Value> = account["asset_marks"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(id, mark)| (id.clone(), mark["cursor_index"].clone()))
            .collect();
        let mut details = json!({"open_positions":account["positions"],"pending_orders":account["pending_orders"],
            "asset_cursor_indices":cursors,"source_events":sources,"intrabar_equity_coverage":account["intrabar_equity_coverage"]});
        if let Some(t) = &transition {
            details
                .as_object_mut()
                .unwrap()
                .extend(t.as_object().unwrap().clone());
        }
        let aggregate = json!({"schema_version":"replay-portfolio-event-v1","sequence":sequence,
            "kind":if transition.is_some(){"phase_transition"}else{"price_mark"},
            "replay_session_id":account["replay_session_id"],"branch_id":account["branch_id"],
            "dataset_id":account["dataset_id"],"dataset_sha256":account["dataset_sha256"],
            "cursor_index":account["cursor_index"],"virtual_time_utc":time,"balance":account["balance"],
            "floating_pl":account["floating_pl"],"equity":account["equity"],
            "open_positions":account["positions"].as_array().unwrap().len(),
            "pending_orders":account["pending_orders"].as_array().unwrap().len(),
            "evaluation_quality":account["evaluation_quality"],"details":details});
        account["ledger"].as_array_mut().unwrap().push(aggregate);
    }
    total(&mut account)?;
    payload["portfolio_execution"] = account;
    Ok(())
}

pub fn binding(snapshot: &Value, sequence: &Value) -> Value {
    let mut binding = json!({"replay_session_id":snapshot["replay_session_id"],"branch_id":snapshot["branch_id"],
        "dataset_id":snapshot["dataset_id"],"dataset_sha256":snapshot["dataset_sha256"],"last_replay_event_sequence":sequence});
    if snapshot["schema_version"] == "replay-portfolio-v1" {
        binding["dataset_pins"] = snapshot["dataset_pins"].clone();
        binding["schema_version"] = json!("replay-portfolio-binding-v1");
    }
    binding
}

/// Select an account event, including all and only the local events it acknowledged.
/// A timestamp alone cannot distinguish closes, protection edits and phase resets
/// made on the same candle. Account ordinals are also different from local ones.
pub fn checkpoint_event(payload: &Value, sequence: i64) -> R<Value> {
    let snapshot = &payload["portfolio_execution"];
    if snapshot["schema_version"] != "replay-portfolio-v1" {
        return Err("portfolio event checkpoint requires canonical account history".into());
    }
    let pins = snapshot["dataset_pins"]
        .as_array()
        .ok_or("portfolio pins are missing")?;
    let mut sorted = pins.clone();
    sorted.sort_by(|a, b| a["dataset_id"].as_str().cmp(&b["dataset_id"].as_str()));
    let digest = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&sorted).map_err(|e| e.to_string())?)
    );
    let mut hashes = BTreeMap::new();
    for pin in pins {
        let id = pin["dataset_id"]
            .as_str()
            .ok_or("portfolio pin id is invalid")?;
        let hash = pin["dataset_sha256"]
            .as_str()
            .ok_or("portfolio pin hash is invalid")?;
        if hashes.insert(id, hash).is_some() {
            return Err("portfolio pins are duplicated".into());
        }
    }
    if snapshot["dataset_sha256"] != digest
        || hashes.get(snapshot["dataset_id"].as_str().unwrap_or(""))
            != snapshot["primary_dataset_sha256"].as_str().as_ref()
        || snapshot["branch_id"] != payload["branch_id"]
        || snapshot["account_ccy"] != payload["starting_balance_ccy"]
        || d(&snapshot["starting_balance"])? != d(&payload["starting_balance"])?
    {
        return Err("portfolio immutable account lineage changed".into());
    }
    let states = payload["asset_states"]
        .as_object()
        .ok_or("portfolio assets are missing")?;
    let ids = payload["dataset_ids"]
        .as_array()
        .ok_or("portfolio dataset ids are missing")?;
    let distinct: std::collections::BTreeSet<_> = ids.iter().filter_map(Value::as_str).collect();
    if ids.len() != hashes.len()
        || distinct.len() != ids.len()
        || ids
            .iter()
            .any(|id| !hashes.contains_key(id.as_str().unwrap_or("")))
        || states.keys().any(|id| !hashes.contains_key(id.as_str()))
    {
        return Err("portfolio dataset collection differs from immutable pins".into());
    }
    for (id, asset) in states {
        let local = &asset["execution"];
        if local.is_null() {
            continue;
        }
        crate::replay_core::validate(local)?;
        if hashes.get(id.as_str()) != local["dataset_sha256"].as_str().as_ref()
            || local["dataset_id"] != *id
            || local["branch_id"] != snapshot["branch_id"]
            || local["replay_session_id"] != snapshot["replay_session_id"]
            || local["instrument_spec"]["account_ccy"] != snapshot["account_ccy"]
            || d(&local["starting_balance"])? != d(&snapshot["starting_balance"])?
        {
            return Err("portfolio immutable execution lineage changed".into());
        }
    }
    let ledger = snapshot["ledger"]
        .as_array()
        .ok_or("portfolio history is missing")?;
    if sequence <= 0
        || sequence > n(snapshot, "event_sequence")?
        || ledger.len() as i64 != n(snapshot, "event_sequence")?
    {
        return Err("portfolio event sequence is outside canonical account history".into());
    }
    let mut acknowledged = BTreeMap::<String, i64>::new();
    let mut prior_time = i64::MIN;
    let mut phase = 1;
    for (index, event) in ledger.iter().take(sequence as usize).enumerate() {
        if n(event, "sequence")? != index as i64 + 1 || n(event, "virtual_time_utc")? < prior_time {
            return Err("portfolio account history is not contiguous".into());
        }
        prior_time = n(event, "virtual_time_utc")?;
        for key in [
            "replay_session_id",
            "branch_id",
            "dataset_id",
            "dataset_sha256",
        ] {
            if event[key] != snapshot[key] {
                return Err("portfolio event lineage changed".into());
            }
        }
        for source in event["details"]["source_events"]
            .as_array()
            .ok_or("portfolio source events are missing")?
        {
            let id = source["dataset_id"]
                .as_str()
                .ok_or("portfolio source dataset is invalid")?;
            let seq = n(source, "sequence")?;
            if seq <= 0 {
                return Err("portfolio source sequence is invalid".into());
            }
            let local = &payload["asset_states"][id]["execution"];
            let original = local["ledger"]
                .as_array()
                .and_then(|events| events.get((seq - 1) as usize))
                .ok_or("portfolio source event is unavailable")?;
            if seq != acknowledged.get(id).copied().unwrap_or(0) + 1
                || original["sequence"] != seq
                || original["kind"] != source["kind"]
                || original["virtual_time_utc"] != event["virtual_time_utc"]
            {
                return Err("portfolio source event differs from local history".into());
            }
            acknowledged.insert(id.to_owned(), seq);
            if original["kind"] == "phase_transition" {
                if event["kind"] != "phase_transition" {
                    return Err("portfolio phase transition is missing".into());
                }
                for key in [
                    "intent_id",
                    "intent_fingerprint",
                    "from_phase_index",
                    "to_phase_index",
                    "carry_policy",
                    "position_policy",
                    "next_phase_initial_balance",
                ] {
                    if event["details"][key] != original["details"][key] {
                        return Err("portfolio phase transition differs from local history".into());
                    }
                }
            }
        }
        if event["kind"] == "phase_transition" {
            if n(&event["details"], "from_phase_index")? != phase
                || n(&event["details"], "to_phase_index")? != phase + 1
            {
                return Err("portfolio phase history is not contiguous".into());
            }
            phase += 1;
            // A lazily initialized asset inherits the already acknowledged phase
            // history before its first financial event (initialize_execution).
            for (id, asset) in states {
                let next = acknowledged.get(id).copied().unwrap_or(0) + 1;
                let inherited = asset["execution"]["ledger"]
                    .as_array()
                    .and_then(|events| events.get((next - 1) as usize));
                if let Some(local) = inherited.filter(|local| local["kind"] == "phase_transition") {
                    let keys = [
                        "intent_id",
                        "intent_fingerprint",
                        "from_phase_index",
                        "to_phase_index",
                        "carry_policy",
                        "position_policy",
                        "next_phase_initial_balance",
                    ];
                    if local["virtual_time_utc"] == event["virtual_time_utc"]
                        && keys
                            .iter()
                            .all(|key| local["details"][*key] == event["details"][*key])
                    {
                        acknowledged.insert(id.clone(), next);
                    }
                }
            }
        }
    }
    let tip = &ledger[sequence as usize - 1];
    let mut out = payload.clone();
    for (id, asset) in states {
        let raw = &asset["execution"];
        if raw.is_null() {
            continue;
        }
        let seq = acknowledged.get(id).copied().unwrap_or(0);
        let target = tip["details"]["asset_cursor_indices"][id].as_i64();
        let Some(cursor) = target else {
            out["asset_states"][id]["execution"] = Value::Null;
            continue;
        };
        let mut local = if seq == n(raw, "event_sequence")? && cursor == n(raw, "cursor_index")? {
            raw.clone()
        } else if seq == 0 {
            let mut local = raw.clone();
            local["ledger"] = json!([]);
            local["event_sequence"] = json!(0);
            local["cursor_index"] = json!(cursor);
            local["phase_index"] = json!(1);
            local["phase_initial_balance"] = local["starting_balance"].clone();
            local["balance"] = local["starting_balance"].clone();
            local["floating_pl"] = json!("0");
            local["equity"] = local["balance"].clone();
            local["position"] = Value::Null;
            local["pending_market_order"] = Value::Null;
            local
        } else {
            crate::replay_core::transform(&json!({"snapshot":raw,"action":"reconstruct",
                "args":{"cursor_index":cursor,"event_sequence":seq}}))?["snapshot"]
                .clone()
        };
        // A queued next-bar order can change without appending a local event.
        local["pending_market_order"] = tip["details"]["pending_orders"]
            .as_array()
            .ok_or("portfolio pending orders are missing")?
            .iter()
            .find(|order| order["dataset_id"] == *id)
            .cloned()
            .map(|mut order| {
                order.as_object_mut().unwrap().remove("dataset_id");
                order.as_object_mut().unwrap().remove("instrument_id");
                order
            })
            .unwrap_or(Value::Null);
        crate::replay_core::validate(&local)?;
        out["asset_states"][id] = json!({"cursor_index":cursor,"execution":local});
    }
    let mut bounded = snapshot.clone();
    bounded["ledger"] = json!(&ledger[..sequence as usize]);
    let account = checkpoint(&bounded, &out, n(tip, "virtual_time_utc")?)?;
    for key in ["positions", "pending_orders"] {
        if account[key]
            != tip["details"][if key == "positions" {
                "open_positions"
            } else {
                key
            }]
        {
            return Err("portfolio checkpoint exposure differs from account event".into());
        }
    }
    if sequence == n(snapshot, "event_sequence")? {
        for key in [
            "balance",
            "floating_pl",
            "equity",
            "phase_index",
            "phase_initial_balance",
            "positions",
            "pending_orders",
        ] {
            let equal =
                if ["balance", "floating_pl", "equity", "phase_initial_balance"].contains(&key) {
                    d(&account[key])? == d(&snapshot[key])?
                } else {
                    account[key] == snapshot[key]
                };
            if !equal {
                return Err("portfolio head differs from canonical account event".into());
            }
        }
    }
    out["portfolio_execution"] = account;
    let primary = snapshot["dataset_id"]
        .as_str()
        .ok_or("portfolio primary is missing")?;
    out["dataset_id"] = json!(primary);
    out["cursor_index"] = tip["cursor_index"].clone();
    out["replay_clock_utc"] = tip["virtual_time_utc"].clone();
    out["execution"] = out["asset_states"][primary]["execution"].clone();
    Ok(out)
}

pub fn checkpoint(snapshot: &Value, payload: &Value, clock: i64) -> R<Value> {
    checkpoint_inner(snapshot, payload, clock, true)
}
pub(crate) fn checkpoint_head(snapshot: &Value, payload: &Value, clock: i64) -> R<Value> {
    checkpoint_inner(snapshot, payload, clock, false)
}
fn checkpoint_inner(
    snapshot: &Value,
    payload: &Value,
    clock: i64,
    retain_ledger: bool,
) -> R<Value> {
    let mut out = Value::Object(
        snapshot
            .as_object()
            .ok_or("portfolio snapshot is invalid")?
            .iter()
            .filter(|(key, _)| key.as_str() != "ledger")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    let events: Vec<&Value> = snapshot["ledger"]
        .as_array()
        .ok_or("portfolio history is missing")?
        .iter()
        .take_while(|e| {
            e["virtual_time_utc"]
                .as_i64()
                .is_some_and(|time| time <= clock)
                && e["details"]["source_events"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .all(|source| {
                        source["sequence"].as_i64().unwrap_or(i64::MAX)
                            <= payload["asset_states"][source["dataset_id"].as_str().unwrap_or("")]
                                ["execution"]["event_sequence"]
                                .as_i64()
                                .unwrap_or(0)
                    })
        })
        .collect();
    let Some(tip) = events.last() else {
        return Err("portfolio checkpoint precedes account history".into());
    };
    for key in [
        "event_sequence",
        "cursor_index",
        "balance",
        "floating_pl",
        "equity",
        "evaluation_quality",
    ] {
        out[key] = if key == "event_sequence" {
            tip["sequence"].clone()
        } else {
            tip[key].clone()
        };
    }
    out["positions"] = tip["details"]["open_positions"].clone();
    out["pending_orders"] = tip["details"]["pending_orders"].clone();
    if retain_ledger {
        out["ledger"] = json!(events);
    }
    out["asset_marks"] = json!({});
    out["phase_index"] = json!(1);
    out["phase_initial_balance"] = out["starting_balance"].clone();
    out["balance_basis"] = out["starting_balance"].clone();
    out["phase_transitions"] = json!([]);
    for (dataset, asset) in payload["asset_states"]
        .as_object()
        .ok_or("portfolio assets are missing")?
    {
        let local = &asset["execution"];
        if local.is_null() {
            continue;
        }
        let reset = local["ledger"]
            .as_array()
            .into_iter()
            .flatten()
            .rev()
            .find(|event| {
                event["kind"] == "phase_transition" && event["details"]["carry_policy"] == "reset"
            });
        out["asset_marks"][dataset] = json!({"sequence":local["event_sequence"],"cursor_index":local["cursor_index"],
            "balance_base":reset.map(|event|event["balance"].clone()).unwrap_or(local["starting_balance"].clone()),
            "balance":local["balance"],"floating_pl":local["floating_pl"],
            "position":tagged(&local["position"],dataset,&local["instrument_spec"]),
            "pending_market_order":tagged(&local["pending_market_order"],dataset,&local["instrument_spec"]),
            "evaluation_quality":local["evaluation_quality"],"intrabar_equity_coverage":local["ledger"].as_array().into_iter().flatten().rev()
                .find_map(|e|e["details"].get("intrabar_equity_coverage").cloned()).unwrap_or(json!("complete"))});
    }
    let transitions: Vec<Value> = events
        .iter()
        .filter(|event| event["kind"] == "phase_transition")
        .map(|event| event["details"].clone())
        .collect();
    for details in &transitions {
        out["phase_index"] = details["to_phase_index"].clone();
        out["phase_initial_balance"] = details["next_phase_initial_balance"].clone();
        if details["carry_policy"] == "reset" {
            out["balance_basis"] = details["next_phase_initial_balance"].clone();
        }
    }
    out["phase_transitions"] = json!(transitions);
    let expected = [
        out["balance"].clone(),
        out["floating_pl"].clone(),
        out["equity"].clone(),
    ];
    total(&mut out)?;
    for (index, key) in ["balance", "floating_pl", "equity"].iter().enumerate() {
        if d(&out[key])? != d(&expected[index])? {
            return Err(
                "portfolio checkpoint source state does not match canonical account event".into(),
            );
        }
    }
    Ok(out)
}

pub fn fork(snapshot: &mut Value, id: &str, branch: &str) -> R<()> {
    snapshot["replay_session_id"] = json!(id);
    snapshot["branch_id"] = json!(branch);
    for event in snapshot["ledger"]
        .as_array_mut()
        .ok_or("portfolio history is missing")?
    {
        event["replay_session_id"] = json!(id);
        event["branch_id"] = json!(branch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn transform(snapshot: Value, action: &str, args: Value) -> Value {
        crate::replay_core::transform_owned(
            json!({"snapshot":snapshot,"action":action,"args":args}),
        )
        .unwrap()["snapshot"]
            .clone()
    }
    fn fixture() -> Value {
        let mut payload = json!({"dataset_id":"a","dataset_ids":["a","b"],"branch_id":"branch",
            "starting_balance":"10000","starting_balance_ccy":"USD","replay_clock_utc":60,"asset_states":{}});
        initialize(
            &mut payload,
            "replay",
            vec![
                json!({"dataset_id":"a","dataset_sha256":"a".repeat(64)}),
                json!({"dataset_id":"b","dataset_sha256":"b".repeat(64)}),
            ],
        )
        .unwrap();
        for id in ["a", "b"] {
            let s = transform(
                Value::Null,
                "initialize",
                json!({"replay_session_id":"replay","branch_id":"branch",
                "dataset_id":id,"dataset_sha256":id.repeat(64),"cursor_index":0,"starting_balance":"10000","timeframe_seconds":60,"spread_price":"0",
                "instrument_spec":{"instrument_id":id,"asset_class":"fx","base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD",
                    "tick_size":"0.0001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2026-01-01T00:00:00Z","effective_to_utc":""},
                "cost_model":{"version":"test","spread_basis":"bid_ask_embedded","commission_per_side_account":"0","minimum_fee_account":"0",
                    "slippage_price_per_side":"0","financing_account":"0","quote_to_account_rate":"1","account_ccy":"USD","rounding_decimals":2}}),
            );
            payload["asset_states"][id] = json!({"cursor_index":0,"execution":s});
        }
        update(&mut payload).unwrap();
        payload
    }
    fn open(p: &mut Value, id: &str) {
        p["asset_states"][id]["execution"] = transform(
            p["asset_states"][id]["execution"].clone(),
            "queue_current_quote",
            json!({"operation_id":format!("buy-{id}"),"side":"BUY","quantity":"0.01","mid_close":"1.1","virtual_time_utc":60}),
        );
        update(p).unwrap();
    }
    fn advance(p: &mut Value, id: &str, index: i64, close: &str) {
        p["asset_states"][id]["execution"] = transform(
            p["asset_states"][id]["execution"].clone(),
            "advance",
            json!({"cursor_index":index,"bar":{"timestamp":index*60,"open":"1.1","high":"1.2","low":"1.0","close":close}}),
        );
        p["asset_states"][id]["cursor_index"] = json!(index);
    }
    #[test]
    fn causal_marks_group_simultaneous_assets_and_ignore_chart_switches() {
        let mut p = fixture();
        open(&mut p, "a");
        open(&mut p, "b");
        advance(&mut p, "a", 1, "1.101");
        advance(&mut p, "a", 2, "1.102");
        advance(&mut p, "b", 1, "1.103");
        advance(&mut p, "b", 2, "1.104");
        update(&mut p).unwrap();
        let ledger = p["portfolio_execution"]["ledger"].as_array().unwrap();
        let first = ledger
            .iter()
            .find(|e| e["virtual_time_utc"] == 120)
            .unwrap();
        assert_eq!(d(&first["balance"]).unwrap(), BigDecimal::from(10000));
        assert_eq!(d(&first["floating_pl"]).unwrap(), BigDecimal::from(4));
        assert_eq!(
            first["details"]["source_events"].as_array().unwrap().len(),
            2
        );
        assert_eq!(
            d(&p["portfolio_execution"]["floating_pl"]).unwrap(),
            BigDecimal::from(6)
        );
        let before = p["portfolio_execution"].clone();
        p["dataset_id"] = json!("b");
        update(&mut p).unwrap();
        assert_eq!(before, p["portfolio_execution"]);
    }
    #[test]
    fn pending_heads_are_acknowledgeable_and_phase_reset_counts_capital_once() {
        let mut p = fixture();
        p["asset_states"]["a"]["execution"] = transform(
            p["asset_states"]["a"]["execution"].clone(),
            "queue",
            json!({"operation_id":"pending-a","side":"BUY","quantity":"0.01"}),
        );
        update(&mut p).unwrap();
        assert_eq!(
            p["portfolio_execution"]["pending_orders"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        p = fixture();
        let args = json!({"intent_id":"next","intent_fingerprint":"a".repeat(64),"from_phase_index":1,"to_phase_index":2,
            "carry_policy":"reset","position_policy":"must_be_flat","next_phase_initial_balance":"20000","virtual_time_utc":60});
        for id in ["a", "b"] {
            p["asset_states"][id]["execution"] = transform(
                p["asset_states"][id]["execution"].clone(),
                "transition",
                args.clone(),
            );
        }
        update(&mut p).unwrap();
        assert_eq!(
            d(&p["portfolio_execution"]["balance"]).unwrap(),
            BigDecimal::from(20000)
        );
        assert_eq!(p["portfolio_execution"]["phase_index"], 2);
        let clocked = checkpoint(&p["portfolio_execution"], &p, 60).unwrap();
        for key in [
            "balance",
            "floating_pl",
            "equity",
            "event_sequence",
            "phase_index",
            "positions",
            "pending_orders",
        ] {
            assert_eq!(clocked[key], p["portfolio_execution"][key]);
        }
        let sequence = clocked["event_sequence"].clone();
        p["portfolio_execution"] = clocked;
        update(&mut p).unwrap();
        assert_eq!(p["portfolio_execution"]["event_sequence"], sequence);
    }
    #[test]
    fn secondary_first_does_not_borrow_a_future_primary_cursor() {
        let mut p = fixture();
        p["asset_states"]["a"]["execution"] = Value::Null;
        initialize(
            &mut p,
            "replay",
            vec![
                json!({"dataset_id":"a","dataset_sha256":"a".repeat(64)}),
                json!({"dataset_id":"b","dataset_sha256":"b".repeat(64)}),
            ],
        )
        .unwrap();
        update(&mut p).unwrap();
        open(&mut p, "b");
        advance(&mut p, "b", 1, "1.101");
        advance(&mut p, "b", 2, "1.102");
        p["asset_states"]["a"]["cursor_index"] = json!(2);
        update(&mut p).unwrap();
        assert_eq!(p["portfolio_execution"]["cursor_index"], 0);
        let first = p["portfolio_execution"]["ledger"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["virtual_time_utc"] == 120)
            .unwrap();
        assert_eq!(first["cursor_index"], 0);
        assert_eq!(first["details"]["asset_cursor_indices"]["b"], 1);
    }

    #[test]
    fn event_checkpoint_keeps_same_candle_order_phase_and_portfolio_provenance() {
        let mut p = fixture();
        open(&mut p, "a");
        open(&mut p, "b");
        let opened = n(&p["portfolio_execution"], "event_sequence").unwrap();
        for id in ["a", "b"] {
            let target = p["asset_states"][id]["execution"]["position"]["position_id"].clone();
            p["asset_states"][id]["execution"] = transform(
                p["asset_states"][id]["execution"].clone(),
                "close",
                json!({"operation_id":format!("close-{id}"),"target_id":target,"mid_close":"1.1","virtual_time_utc":60}),
            );
            update(&mut p).unwrap();
        }
        let closed = n(&p["portfolio_execution"], "event_sequence").unwrap();
        let before = checkpoint_event(&p, opened).unwrap();
        assert_eq!(
            before["portfolio_execution"]["positions"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(before["portfolio_execution"]["event_sequence"], opened);
        let args = json!({"intent_id":"next","intent_fingerprint":"a".repeat(64),"from_phase_index":1,"to_phase_index":2,
            "carry_policy":"reset","position_policy":"must_be_flat","next_phase_initial_balance":"20000","virtual_time_utc":60});
        for id in ["a", "b"] {
            p["asset_states"][id]["execution"] = transform(
                p["asset_states"][id]["execution"].clone(),
                "transition",
                args.clone(),
            );
        }
        update(&mut p).unwrap();
        let previous = checkpoint_event(&p, closed).unwrap();
        assert_eq!(previous["portfolio_execution"]["phase_index"], 1);
        assert_eq!(
            d(&previous["portfolio_execution"]["balance"]).unwrap(),
            BigDecimal::from(10000)
        );
        let current =
            checkpoint_event(&p, n(&p["portfolio_execution"], "event_sequence").unwrap()).unwrap();
        assert_eq!(current["portfolio_execution"]["phase_index"], 2);
        assert_eq!(
            d(&current["portfolio_execution"]["balance"]).unwrap(),
            BigDecimal::from(20000)
        );
        let view = crate::analytics::build_replay_analytics_view(
            &json!({"record_id":"replay","workspace_id":"tenant-a",
            "revision":1,"payload":current}),
            None,
        )
        .unwrap();
        for key in [
            "dataset_id",
            "dataset_sha256",
            "dataset_pins",
            "phase_index",
        ] {
            assert_eq!(view["provenance"][key], p["portfolio_execution"][key]);
        }
        assert_eq!(
            view["provenance"]["execution_event_sequence"],
            p["portfolio_execution"]["event_sequence"]
        );
        assert_eq!(
            d(&view["portfolio_account"]["balance"]).unwrap(),
            BigDecimal::from(20000)
        );
        assert_eq!(view["ledger"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn event_checkpoint_retains_queued_heads_and_rejects_mismatches() {
        let mut p = fixture();
        p["asset_states"]["a"]["execution"] = transform(
            p["asset_states"]["a"]["execution"].clone(),
            "queue",
            json!({"operation_id":"pending","side":"BUY","quantity":"0.01"}),
        );
        update(&mut p).unwrap();
        let queued = n(&p["portfolio_execution"], "event_sequence").unwrap();
        let selected = checkpoint_event(&p, queued).unwrap();
        assert_eq!(
            selected["portfolio_execution"]["pending_orders"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(checkpoint_event(&p, queued + 1).is_err());
        for path in ["pin", "branch", "currency", "balance", "source"] {
            let mut wrong = p.clone();
            match path {
                "pin" => {
                    wrong["portfolio_execution"]["dataset_pins"][0]["dataset_sha256"] =
                        json!("wrong")
                }
                "branch" => wrong["portfolio_execution"]["branch_id"] = json!("wrong"),
                "currency" => wrong["portfolio_execution"]["account_ccy"] = json!("EUR"),
                "balance" => wrong["portfolio_execution"]["balance"] = json!("1"),
                _ => wrong["portfolio_execution"]["ledger"][0]["dataset_sha256"] = json!("wrong"),
            }
            assert!(checkpoint_event(&wrong, queued).is_err(), "{path}");
        }
        let mut duplicate = p.clone();
        duplicate["dataset_ids"] = json!(["a", "a"]);
        assert!(checkpoint_event(&duplicate, queued).is_err());
        let mut skipped = fixture();
        open(&mut skipped, "a");
        skipped["portfolio_execution"]["ledger"][1]["details"]["source_events"]
            .as_array_mut()
            .unwrap()
            .remove(0);
        assert!(
            checkpoint_event(
                &skipped,
                n(&skipped["portfolio_execution"], "event_sequence").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    fn event_checkpoint_allows_only_matching_inherited_phases_for_late_assets() {
        let mut p = fixture();
        let b = p["asset_states"]["b"]["execution"].clone();
        p["asset_states"]["b"]["execution"] = Value::Null;
        initialize(
            &mut p,
            "replay",
            vec![
                json!({"dataset_id":"a","dataset_sha256":"a".repeat(64)}),
                json!({"dataset_id":"b","dataset_sha256":"b".repeat(64)}),
            ],
        )
        .unwrap();
        update(&mut p).unwrap();
        let args = json!({"intent_id":"late","intent_fingerprint":"a".repeat(64),"from_phase_index":1,"to_phase_index":2,
            "carry_policy":"reset","position_policy":"must_be_flat","next_phase_initial_balance":"20000","virtual_time_utc":60});
        p["asset_states"]["a"]["execution"] = transform(
            p["asset_states"]["a"]["execution"].clone(),
            "transition",
            args.clone(),
        );
        update(&mut p).unwrap();
        p["asset_states"]["b"]["execution"] = transform(b, "transition", args);
        let local = &p["asset_states"]["b"]["execution"];
        p["portfolio_execution"]["asset_marks"]["b"] = json!({"sequence":local["event_sequence"],"cursor_index":0,
            "balance_base":local["balance"],"balance":local["balance"],"floating_pl":"0","position":null,
            "pending_market_order":null,"evaluation_quality":"full_for_declared_model","intrabar_equity_coverage":"complete"});
        let record = json!({"record_id":"replay","payload":p});
        crate::analytics::build_replay_analytics_view(&record, None).unwrap();
        open(&mut p, "b");
        checkpoint_event(&p, n(&p["portfolio_execution"], "event_sequence").unwrap()).unwrap();
        let mut wrong = p.clone();
        wrong["portfolio_execution"]["ledger"][1]["details"]["to_phase_index"] = json!(9);
        assert!(
            checkpoint_event(
                &wrong,
                n(&wrong["portfolio_execution"], "event_sequence").unwrap()
            )
            .is_err()
        );
    }

    #[test]
    #[ignore = "requires an explicitly supplied, read-only persisted replay record"]
    fn persisted_prop_report_portfolio_checkpoint() {
        let path = std::env::var("TW_REVIEW_REPLAY_RECORD").expect("TW_REVIEW_REPLAY_RECORD");
        let record: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let p = &record["payload"];
        let sequence = n(&p["portfolio_execution"], "event_sequence").unwrap();
        let selected = checkpoint_event(p, sequence).unwrap();
        let mut record = record.clone();
        record["payload"] = selected;
        let view = crate::analytics::build_replay_analytics_view(&record, None).unwrap();
        assert_eq!(
            view["provenance"]["dataset_sha256"],
            p["portfolio_execution"]["dataset_sha256"]
        );
        assert_eq!(view["provenance"]["execution_event_sequence"], sequence);
        assert_eq!(
            view["provenance"]["phase_index"],
            p["portfolio_execution"]["phase_index"]
        );
        for event in p["portfolio_execution"]["ledger"].as_array().unwrap() {
            checkpoint_event(p, n(event, "sequence").unwrap()).unwrap();
        }
    }
}
