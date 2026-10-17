//! Offline spot accounting; an unknown observation never moves money.
use super::{PropResult, d0, date_time, dec, integer, num, obj, text, zero};
use bigdecimal::{BigDecimal, RoundingMode};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    num::NonZeroU64,
};
fn rounded(v: BigDecimal) -> BigDecimal {
    v.with_precision_round(NonZeroU64::new(28).unwrap(), RoundingMode::HalfEven)
}
pub fn fingerprint(value: &Value) -> Result<String, String> {
    Ok(format!("sha256:{}", super::intent_fingerprint(value)?))
}
fn contains(a: &Value, s: &str) -> bool {
    a.as_array().is_some_and(|x| x.iter().any(|v| v == s))
}
fn mapped(values: &Value, key: &str) -> BTreeMap<String, Value> {
    values
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| (text(v, key).to_owned(), v.clone()))
        .collect()
}

pub fn validate_paper_intent(intent: &Value) -> Result<(), String> {
    if num(intent, "quantity")? <= zero() {
        return Err("quantity must be positive".into());
    }
    if date_time(intent, "expires_at_utc")? <= date_time(intent, "created_at_utc")? {
        return Err("expires_at_utc must be after created_at_utc".into());
    }
    if intent["strategy_id"].is_null() != intent["strategy_version"].is_null() {
        return Err("strategy_id and strategy_version must be provided together".into());
    }
    Ok(())
}
pub fn validate_paper_receipt(receipt: &Value) -> Result<(), String> {
    date_time(receipt, "observed_at_utc")?;
    let status = text(receipt, "status");
    let source = text(receipt, "source");
    let quantity = d0(receipt, "filled_quantity")?;
    let fee = d0(receipt, "fee")?;
    if quantity < zero() || fee < zero() {
        return Err("receipt quantity and fee must be nonnegative".into());
    }
    if status == "filled" || status == "partial" {
        if quantity <= zero() {
            return Err(format!(
                "{status} receipt requires positive filled_quantity"
            ));
        }
        if receipt["fill_price"].is_null() {
            return Err(format!("{status} receipt requires fill_price"));
        }
        if num(receipt, "fill_price")? <= zero() {
            return Err("fill_price must be positive".into());
        }
    } else if status == "rejected" || status == "unknown" {
        if quantity != zero() {
            return Err(format!("{status} receipt cannot report a fill"));
        }
        if !receipt["fill_price"].is_null() {
            return Err(format!("{status} receipt cannot report fill_price"));
        }
        if fee != zero() {
            return Err(format!("{status} receipt cannot report a fee"));
        }
    } else {
        return Err("unknown paper receipt status".into());
    }
    if status == "unknown" && source != "adapter_response" {
        return Err("unknown receipt must originate from adapter_response".into());
    }
    if source == "reconciliation" && status == "rejected" {
        return Err("reconciliation may settle an unknown only with a fill".into());
    }
    Ok(())
}
pub fn validate_paper_state(state: &Value) -> Result<(), String> {
    date_time(state, "updated_at_utc")?;
    if num(state, "cash")? < zero() {
        return Err("cash must be nonnegative".into());
    }
    for (field, key, msg) in [
        (
            "positions",
            "symbol",
            "positions must be sorted uniquely by symbol",
        ),
        (
            "intents",
            "intent_id",
            "intents must be sorted uniquely by intent_id",
        ),
    ] {
        let items = state[field]
            .as_array()
            .ok_or_else(|| format!("{field} must be an array"))?;
        let keys: Vec<&str> = items.iter().map(|v| text(v, key)).collect();
        if keys.windows(2).any(|p| p[0] >= p[1]) {
            return Err(msg.into());
        }
    }
    let entries = state["entries"]
        .as_array()
        .ok_or("entries must be an array")?;
    if integer(state, "sequence")? != entries.len() as i64 {
        return Err("sequence must equal ledger entry count".into());
    }
    let ids = state["applied_receipt_ids"]
        .as_array()
        .ok_or("applied_receipt_ids must be an array")?;
    if ids
        .iter()
        .map(Value::to_string)
        .collect::<BTreeSet<_>>()
        .len()
        != ids.len()
    {
        return Err("applied_receipt_ids must be unique".into());
    }
    let receipts: Vec<Value> = entries.iter().map(|e| e["receipt_id"].clone()).collect();
    if &receipts != ids {
        return Err("entry receipt IDs must match applied receipt IDs".into());
    }
    for (index, entry) in entries.iter().enumerate() {
        if entry["sequence"] != json!(index + 1) {
            return Err("ledger entry sequence must be contiguous".into());
        }
        if index > 0
            && date_time(entry, "observed_at_utc")?
                < date_time(&entries[index - 1], "observed_at_utc")?
        {
            return Err("ledger entries must be chronological".into());
        }
    }
    let pending = state["pending_unknown_intent_ids"]
        .as_array()
        .ok_or("pending_unknown_intent_ids must be an array")?;
    if pending
        .iter()
        .map(Value::to_string)
        .collect::<BTreeSet<_>>()
        .len()
        != pending.len()
    {
        return Err("pending_unknown_intent_ids must be unique".into());
    }
    for intent in state["intents"].as_array().unwrap() {
        if intent["terminal_status"] != "open" && pending.contains(&intent["intent_id"]) {
            return Err("terminal intents cannot remain pending unknown".into());
        }
    }
    if state["execution_capability"] != false {
        return Err("paper execution_capability must be false".into());
    }
    Ok(())
}

pub fn apply_paper_receipt(state: &Value, intent: &Value, receipt: &Value) -> PropResult {
    if state["account_id"] != intent["account_id"] || receipt["account_id"] != intent["account_id"]
    {
        return Err("account_scope_mismatch".into());
    }
    if receipt["intent_id"] != intent["intent_id"] {
        return Err("receipt_intent_id_mismatch".into());
    }
    let intent_hash = fingerprint(intent)?;
    let receipt_hash = fingerprint(receipt)?;
    if receipt["intent_fingerprint"] != intent_hash {
        return Err("receipt_intent_fingerprint_mismatch".into());
    }
    if receipt["symbol"] != intent["symbol"] || receipt["side"] != intent["side"] {
        return Err("receipt_instrument_scope_mismatch".into());
    }
    let observed = date_time(receipt, "observed_at_utc")?;
    if observed < date_time(intent, "created_at_utc")? {
        return Err("receipt_predates_intent".into());
    }
    if state["entries"].as_array().is_some_and(|v| !v.is_empty())
        && observed < date_time(state, "updated_at_utc")?
    {
        return Err("stale_paper_receipt".into());
    }
    let id = text(intent, "intent_id");
    let source = text(receipt, "source");
    let status = text(receipt, "status");
    let mut intents = mapped(&state["intents"], "intent_id");
    if source == "reconciliation" && !intents.contains_key(id) {
        return Err("reconciliation_requires_prepared_intent".into());
    }
    if contains(&state["applied_receipt_ids"], text(receipt, "receipt_id")) {
        let entry = state["entries"]
            .as_array()
            .and_then(|a| a.iter().find(|v| v["receipt_id"] == receipt["receipt_id"]))
            .ok_or("applied receipt has no ledger entry")?;
        if entry["receipt_fingerprint"] != receipt_hash {
            return Err("receipt_id_reused_with_different_content".into());
        }
        return Ok(state.clone());
    }
    if source == "reconciliation" && !contains(&state["pending_unknown_intent_ids"], id) {
        return Err("reconciliation_requires_pending_unknown".into());
    }
    let mut existing = if let Some(existing) = intents.get(id) {
        if existing["intent_fingerprint"] != intent_hash {
            return Err("intent_id_reused_with_different_content".into());
        }
        if existing["terminal_status"] != "open" {
            return Err("terminal_intent_cannot_receive_new_receipt".into());
        }
        if num(intent, "quantity")? != num(existing, "requested_quantity")? {
            return Err("intent_quantity_changed".into());
        }
        existing.clone()
    } else {
        json!({"intent_id":intent["intent_id"],"intent_fingerprint":intent_hash,"account_id":intent["account_id"],"symbol":intent["symbol"],"side":intent["side"],"requested_quantity":intent["quantity"],"filled_quantity":"0","terminal_status":"open"})
    };
    if source == "adapter_response" && contains(&state["pending_unknown_intent_ids"], id) {
        return Err("unknown_intent_requires_reconciliation".into());
    }
    let mut positions = mapped(&state["positions"], "symbol");
    let symbol = text(intent, "symbol");
    let mut cash = num(state, "cash")?;
    let quantity = d0(receipt, "filled_quantity")?;
    let mut total = num(&existing, "filled_quantity")?;
    let mut delta = zero();
    if status == "partial" || status == "filled" {
        total = rounded(total + &quantity);
        let requested = num(intent, "quantity")?;
        if total > requested {
            return Err("cumulative_fill_exceeds_intent".into());
        }
        if status == "filled" && total != requested {
            return Err("filled_receipt_does_not_complete_intent".into());
        }
        if status == "partial" && total >= requested {
            return Err("partial_receipt_must_leave_quantity".into());
        }
        let price = num(receipt, "fill_price")?;
        let fee = d0(receipt, "fee")?;
        let notional = rounded(&quantity * &price);
        if text(intent, "side") == "buy" {
            let cost = rounded(&notional + fee);
            if cash < cost {
                return Err("insufficient_cash".into());
            }
            if let Some(current) = positions.get(symbol) {
                let q = num(current, "quantity")?;
                let next = rounded(&q + &quantity);
                let old_cost = rounded(&q * num(current, "average_cost")?);
                let new_cost = rounded(&quantity * &price);
                let avg = rounded(rounded(old_cost + new_cost) / &next);
                positions.insert(
                    symbol.into(),
                    json!({"symbol":symbol,"quantity":dec(&next),"average_cost":dec(&avg)}),
                );
            } else {
                positions.insert(
                    symbol.into(),
                    json!({"symbol":symbol,"quantity":dec(&quantity),"average_cost":dec(&price)}),
                );
            }
            cash = rounded(cash - &cost);
            delta = -cost;
        } else {
            let current = positions.get(symbol).ok_or("insufficient_position")?;
            let current_quantity = num(current, "quantity")?;
            if current_quantity < quantity {
                return Err("insufficient_position".into());
            }
            if rounded(rounded(&cash + &notional) - &fee) < zero() {
                return Err("insufficient_cash_for_fee".into());
            }
            let remaining = rounded(current_quantity - &quantity);
            if remaining == zero() {
                positions.remove(symbol);
            } else {
                let mut current = current.clone();
                current["quantity"] = dec(&remaining);
                positions.insert(symbol.into(), current);
            }
            delta = rounded(notional - fee);
            cash = rounded(cash + &delta);
        }
        if status == "filled" {
            existing["terminal_status"] = json!("filled")
        }
    } else if status == "rejected" {
        if num(&existing, "filled_quantity")? != zero() {
            return Err("partially_filled_intent_cannot_be_rejected".into());
        }
        existing["terminal_status"] = json!("rejected");
    }
    existing["filled_quantity"] = dec(&total);
    intents.insert(id.into(), existing);
    let seq = integer(state, "sequence")? + 1;
    let entry = json!({"schema_version":"paper-ledger-entry-v1","sequence":seq,"receipt_id":receipt["receipt_id"],"receipt_fingerprint":receipt_hash,"intent_id":intent["intent_id"],"symbol":intent["symbol"],"side":intent["side"],"status":receipt["status"],"quantity":dec(&quantity),"price":receipt["fill_price"],"fee":receipt["fee"],"cash_delta":dec(&delta),"observed_at_utc":receipt["observed_at_utc"]});
    let mut entries = state["entries"].as_array().cloned().unwrap_or_default();
    entries.push(entry);
    let mut applied = state["applied_receipt_ids"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    applied.push(receipt["receipt_id"].clone());
    let mut pending: Vec<Value> = state["pending_unknown_intent_ids"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if status == "unknown" {
        pending.push(json!(id));
        pending.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
        pending.dedup();
    } else {
        pending.retain(|v| v != id);
    }
    let mut updated = obj(state);
    updated["cash"] = dec(&cash);
    updated["positions"] = json!(positions.into_values().collect::<Vec<_>>());
    updated["intents"] = json!(intents.into_values().collect::<Vec<_>>());
    updated["entries"] = json!(entries);
    updated["applied_receipt_ids"] = json!(applied);
    updated["pending_unknown_intent_ids"] = json!(pending);
    updated["sequence"] = json!(seq);
    updated["updated_at_utc"] = receipt["observed_at_utc"].clone();
    Ok(updated)
}

pub fn reconcile_paper_account(state: &Value, args: &Value) -> PropResult {
    let expected = mapped(&state["positions"], "symbol");
    let observed = mapped(&args["observed_positions"], "symbol");
    let mut mismatches = Vec::<String>::new();
    if num(args, "observed_cash")? != num(state, "cash")? {
        mismatches.push("cash_mismatch".into())
    }
    if expected.keys().collect::<BTreeSet<_>>() != observed.keys().collect::<BTreeSet<_>>() {
        mismatches.push("position_symbols_mismatch".into())
    }
    for (symbol, position) in &expected {
        if let Some(o) = observed.get(symbol) {
            for key in ["quantity", "average_cost"] {
                if num(position, key)? != num(o, key)? {
                    mismatches.push(format!("{symbol}.{key}_mismatch"))
                }
            }
        }
    }
    let checked = args["checked_at_utc"]
        .as_str()
        .ok_or("checked_at_utc is required for deterministic reconciliation")?;
    date_time(args, "checked_at_utc")?;
    Ok(
        json!({"schema_version":"paper-reconciliation-receipt-v1","account_id":state["account_id"],"result":if mismatches.is_empty(){"matched"}else{"mismatch"},"expected_cash":state["cash"],"observed_cash":args["observed_cash"],"expected_positions":state["positions"],"observed_positions":args["observed_positions"],"mismatches":mismatches,"checked_at_utc":checked,"execution_capability":false}),
    )
}
