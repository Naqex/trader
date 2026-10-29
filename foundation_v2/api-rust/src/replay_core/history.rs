//! Incremental BAR execution over a previously validated, immutable prefix.
//!
//! Checksums bind persisted head/context bytes; they do not authenticate an
//! unscanned PostgreSQL prefix. Repository restore is valid only for immutable
//! committed events imported by this validator version. Import/restore and
//! validator upgrades must full-validate the stream before granting that trust.
use super::*;
use sha2::{Digest, Sha256};

pub const BAR_PREFIX_VERSION: &str = "replay-bar-prefix-v1";

pub fn empty_prefix_sha256() -> String {
    digest(&json!([BAR_PREFIX_VERSION]))
}
pub fn extend_prefix_sha256(previous: &str, event: &Value) -> R<String> {
    if !hash_valid(previous) {
        return Err("invalid previous prefix hash".into());
    }
    Ok(digest(&json!([previous, event])))
}

/// The repository prepares an indexed admission for the exact tuple before CPU
/// offload. No operation list or caller-controlled JSON freshness flag is used.
pub trait OperationLookup {
    fn ensure_prefix(&self, head: &Value, prefix_sha256: &str) -> R<()>;
    fn ensure_fresh(
        &self,
        replay_session_id: &str,
        branch_id: &str,
        dataset_id: &str,
        operation_id: &str,
    ) -> R<()>;
}

#[derive(Clone, Debug)]
pub(super) struct BarContext {
    sequence: i64,
    last_event: Option<Value>,
    last_quote: Option<Value>,
    coverage: Option<Value>,
    prefix_sha256: String,
}

impl BarContext {
    fn empty() -> Self {
        Self {
            sequence: 0,
            last_event: None,
            last_quote: None,
            coverage: None,
            prefix_sha256: empty_prefix_sha256(),
        }
    }
    fn append(&mut self, event: &Value) -> R<()> {
        if int(event, "sequence")?
            != self
                .sequence
                .checked_add(1)
                .ok_or("event sequence overflow")?
        {
            return Err("incremental event sequence is not contiguous".into());
        }
        self.prefix_sha256 = extend_prefix_sha256(&self.prefix_sha256, event)?;
        self.sequence += 1;
        if event["kind"] == "price_mark" {
            self.coverage = Some(
                event["details"]
                    .get("intrabar_equity_coverage")
                    .cloned()
                    .unwrap_or(json!("insufficient")),
            );
        }
        if event["details"].get("bid").is_some() {
            self.last_quote = Some(event.clone());
        }
        self.last_event = Some(event.clone());
        Ok(())
    }
    fn json(&self) -> Value {
        json!({"sequence":self.sequence,"last_event":self.last_event,
            "last_quote":self.last_quote,"coverage":self.coverage,"prefix_sha256":self.prefix_sha256})
    }
}

/// Compare JSON values under the same numeric normalization used by PostgreSQL.
pub fn equivalent_json(left: &Value, right: &Value) -> bool {
    digest(left) == digest(right)
}

fn digest(value: &Value) -> String {
    // JSONB may normalize numeric spelling (including signed zero). Commit to
    // numeric values while preserving the distinction between numbers/strings.
    fn canonical(value: &Value, bytes: &mut Vec<u8>) {
        match value {
            Value::Number(number) => bytes.extend_from_slice(
                BigDecimal::from_str(&number.to_string())
                    .expect("finite JSON number")
                    .normalized()
                    .to_string()
                    .as_bytes(),
            ),
            Value::Array(values) => {
                bytes.push(b'[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        bytes.push(b',');
                    }
                    canonical(value, bytes);
                }
                bytes.push(b']');
            }
            Value::Object(values) => {
                bytes.push(b'{');
                let mut entries: Vec<_> = values.iter().collect();
                entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index > 0 {
                        bytes.push(b',');
                    }
                    bytes.extend(serde_json::to_vec(key).expect("JSON key serializes"));
                    bytes.push(b':');
                    canonical(value, bytes);
                }
                bytes.push(b'}');
            }
            _ => bytes.extend(serde_json::to_vec(value).expect("JSON value serializes")),
        }
    }
    let mut bytes = Vec::new();
    canonical(value, &mut bytes);
    format!("{:x}", Sha256::digest(bytes))
}
fn hash_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Debug)]
pub struct ValidatedBarPrefix {
    head: Value,
    context: BarContext,
}

pub struct BarTransition {
    pub next: ValidatedBarPrefix,
    pub events: Vec<Value>,
    /// Counts event validations in this transition, excluding initial import.
    pub validated_events: usize,
}

impl ValidatedBarPrefix {
    pub fn import(mut snapshot: Value) -> R<Self> {
        validate(&snapshot)?;
        if tick_mode(&snapshot) {
            return Err("incremental execution supports BAR snapshots only".into());
        }
        let ledger = snapshot
            .as_object_mut()
            .ok_or("snapshot must be object")?
            .remove("ledger")
            .ok_or("ledger missing")?;
        let mut context = BarContext::empty();
        for event in ledger.as_array().ok_or("ledger must be array")? {
            context.append(event)?;
        }
        let value = Self {
            head: snapshot,
            context,
        };
        value.validate_context()?;
        Ok(value)
    }
    pub fn head(&self) -> &Value {
        &self.head
    }
    pub fn event_sequence(&self) -> i64 {
        self.context.sequence
    }
    pub fn prefix_sha256(&self) -> &str {
        &self.context.prefix_sha256
    }
    pub fn last_event(&self) -> Option<&Value> {
        self.context.last_event.as_ref()
    }

    pub fn export(&self) -> Value {
        let body = json!({"validator_version":BAR_PREFIX_VERSION,"head":self.head,"context":self.context.json()});
        json!({"body":body,"sha256":digest(&body)})
    }

    /// Repository-only deserialization, after checking the immutable stream
    /// certificate. This checks bounded bytes, not every historical event.
    pub(crate) fn restore_trusted(stored: Value) -> R<Self> {
        strict(&stored, &["body", "sha256"])?;
        let body = &stored["body"];
        strict(body, &["validator_version", "head", "context"])?;
        if body["validator_version"] != BAR_PREFIX_VERSION || stored["sha256"] != digest(body) {
            return Err("incremental prefix version/checksum mismatch".into());
        }
        let c = &body["context"];
        strict(
            c,
            &[
                "sequence",
                "last_event",
                "last_quote",
                "coverage",
                "prefix_sha256",
            ],
        )?;
        let context = BarContext {
            sequence: int(c, "sequence")?,
            last_event: c.get("last_event").filter(|v| !v.is_null()).cloned(),
            last_quote: c.get("last_quote").filter(|v| !v.is_null()).cloned(),
            coverage: c.get("coverage").filter(|v| !v.is_null()).cloned(),
            prefix_sha256: txt(c, "prefix_sha256")?.to_owned(),
        };
        let value = Self {
            head: body["head"].clone(),
            context,
        };
        value.validate_context()?;
        Ok(value)
    }

    fn validate_context(&self) -> R<()> {
        if self.head.get("ledger").is_some() {
            return Err("incremental head must not embed a ledger".into());
        }
        validate_head(&self.head)?;
        if tick_mode(&self.head) {
            return Err("incremental execution supports BAR snapshots only".into());
        }
        if int(&self.head, "event_sequence")? != self.context.sequence
            || !hash_valid(&self.context.prefix_sha256)
        {
            return Err("incremental prefix sequence/hash mismatch".into());
        }
        let pending = &self.head["pending_market_order"];
        let position = &self.head["position"];
        if !pending.is_null()
            && (!position.is_null()
                || if entry::conditional(pending) {
                    int(pending, "submitted_cursor_index")? > int(&self.head, "cursor_index")?
                } else {
                    int(pending, "submitted_cursor_index")? != int(&self.head, "cursor_index")?
                })
        {
            return Err("incremental pending order differs from canonical cursor/state".into());
        }
        if !position.is_null()
            && int(position, "opened_cursor_index")? > int(&self.head, "cursor_index")?
        {
            return Err("incremental position opens beyond canonical cursor".into());
        }
        if self.context.sequence == 0 {
            if self.context.last_event.is_some()
                || self.context.last_quote.is_some()
                || self.context.coverage.is_some()
                || self.context.prefix_sha256 != BarContext::empty().prefix_sha256
                || !position.is_null()
                || dec(&self.head, "floating_pl")? != zero()
                || dec(&self.head, "balance")? != dec(&self.head, "starting_balance")?
            {
                return Err("empty incremental prefix has historical context".into());
            }
        } else {
            let event = self
                .context
                .last_event
                .as_ref()
                .ok_or("incremental prefix lacks its tip")?;
            validate_envelope(&self.head, event, self.context.sequence)?;
            for key in ["balance", "floating_pl", "equity"] {
                if dec(&self.head, key)? != dec(event, key)? {
                    return Err("incremental head differs from canonical tip".into());
                }
            }
            if event["details"].get("open_position").is_some()
                && event["details"]["open_position"] != *position
            {
                return Err("incremental position differs from canonical tip".into());
            }
            let prior_pending = &event["details"]["pending_market_order"];
            if prior_pending != pending
                && !(prior_pending.is_null() && !pending.is_null() && position.is_null())
            {
                return Err("incremental pending order differs from canonical tip".into());
            }
            if event["kind"] == "price_mark"
                && self.context.coverage.as_ref()
                    != Some(
                        event["details"]
                            .get("intrabar_equity_coverage")
                            .unwrap_or(&json!("insufficient")),
                    )
            {
                return Err("incremental coverage differs from canonical tip".into());
            }
        }
        if let Some(coverage) = &self.context.coverage {
            if !["complete", "insufficient"].contains(&coverage.as_str().unwrap_or("")) {
                return Err("incremental coverage is invalid".into());
            }
        }
        if let Some(quote) = &self.context.last_quote {
            validate_envelope(&self.head, quote, int(quote, "sequence")?)?;
            if int(quote, "sequence")? > self.context.sequence
                || quote["details"].get("bid").is_none()
            {
                return Err("incremental quote context is invalid".into());
            }
        }
        Ok(())
    }

    pub fn transition(
        &self,
        action: &str,
        args: Value,
        operations: &dyn OperationLookup,
    ) -> R<BarTransition> {
        self.validate_context()?;
        operations.ensure_prefix(&self.head, &self.context.prefix_sha256)?;
        let mut head = self.head.clone();
        let mut context = self.context.clone();
        let mut events = vec![];
        {
            let mut history = History::Prefix {
                context: &mut context,
                events: &mut events,
                operations,
            };
            match action {
                "queue" => entry::queue_market(&mut head, &args, &mut history)?,
                "queue_entry" => entry::queue(&mut head, &args, &mut history)?,
                "queue_current_quote" => {
                    entry::queue_market(&mut head, &args, &mut history)?;
                    fill(&mut head, &args, &mut history)?;
                }
                "fill_current_quote" => fill(&mut head, &args, &mut history)?,
                "protection" => protect(&mut head, &args, &mut history)?,
                "close" => close(&mut head, &args, &mut history)?,
                "advance" => advance(&mut head, &args, &mut history)?,
                "advance_many" => {
                    let steps = args["steps"].as_array().ok_or("steps must be an array")?;
                    if steps.is_empty() || steps.len() > 10000 {
                        return Err("batch must contain 1 to 10000 replay steps".into());
                    }
                    for step in steps {
                        advance(&mut head, step, &mut history)?;
                    }
                }
                _ => return Err(format!("unsupported incremental BAR action: {action}")),
            }
        }
        let mut previous = self.context.last_event.as_ref();
        for (offset, event) in events.iter().enumerate() {
            validate_envelope(&head, event, self.context.sequence + offset as i64 + 1)?;
            validate_event_with_previous(&head, event, previous)?;
            previous = Some(event);
        }
        let next = Self { head, context };
        next.validate_context()?;
        Ok(BarTransition {
            validated_events: events.len(),
            next,
            events,
        })
    }
}

fn validate_envelope(head: &Value, event: &Value, sequence: i64) -> R<()> {
    if int(event, "sequence")? != sequence {
        return Err("incremental event sequence is not contiguous".into());
    }
    for key in [
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
    ] {
        if event[key] != head[key] {
            return Err("incremental event lineage differs from head".into());
        }
    }
    if int(event, "cursor_index")? > int(head, "cursor_index")? {
        return Err("incremental event cursor exceeds head".into());
    }
    int(event, "virtual_time_utc")?;
    if dec(event, "equity")? != py(dec(event, "balance")? + dec(event, "floating_pl")?) {
        return Err("event equity must equal balance plus floating_pl".into());
    }
    if int(event, "open_positions")? > 1 || int(event, "pending_orders")? > 1 {
        return Err("invalid event position count".into());
    }
    if v2(head) && event["schema_version"] != "replay-execution-event-v2" {
        return Err("v2 replay requires explicitly versioned v2 events".into());
    }
    Ok(())
}

pub(super) enum History<'a> {
    Full,
    Prefix {
        context: &'a mut BarContext,
        events: &'a mut Vec<Value>,
        operations: &'a dyn OperationLookup,
    },
}
impl History<'_> {
    pub(super) fn fresh(&self, head: &Value, id: &str) -> R<()> {
        match self {
            Self::Full => super::fresh(head, id),
            Self::Prefix { operations, .. } => {
                if id.trim().is_empty() || id.len() > 128 {
                    return Err("operation_id must be a bounded nonempty identifier".into());
                }
                operations.ensure_fresh(
                    txt(head, "replay_session_id")?,
                    txt(head, "branch_id")?,
                    txt(head, "dataset_id")?,
                    id,
                )
            }
        }
    }
    pub(super) fn last_event<'a>(&'a self, head: &'a Value) -> Option<&'a Value> {
        match self {
            Self::Full => head["ledger"].as_array().and_then(|l| l.last()),
            Self::Prefix { context, .. } => context.last_event.as_ref(),
        }
    }
    pub(super) fn coverage(&self, head: &Value, default: &str) -> Value {
        match self {
            Self::Full => super::coverage(head, default),
            Self::Prefix { context, .. } => context.coverage.clone().unwrap_or(json!(default)),
        }
    }
    pub(super) fn append(&mut self, head: &mut Value, event: Value) -> R<()> {
        match self {
            Self::Full => head["ledger"]
                .as_array_mut()
                .ok_or("ledger must be array")?
                .push(event),
            Self::Prefix {
                context, events, ..
            } => {
                context.append(&event)?;
                events.push(event);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, collections::HashSet};

    #[derive(Default)]
    struct IndexedFixture {
        consumed: HashSet<String>,
        reads: Cell<usize>,
    }
    impl OperationLookup for IndexedFixture {
        fn ensure_prefix(&self, _head: &Value, _prefix_sha256: &str) -> R<()> {
            Ok(())
        }
        fn ensure_fresh(&self, session: &str, branch: &str, dataset: &str, id: &str) -> R<()> {
            self.reads.set(self.reads.get() + 1);
            if (session, branch, dataset) != ("session", "branch", "dataset") {
                return Err("operation permit lineage mismatch".into());
            }
            if self.consumed.contains(id) {
                return Err("operation_id was already consumed".into());
            }
            Ok(())
        }
    }
    fn initial(margin: bool) -> Value {
        let mut args = json!({"replay_session_id":"session","branch_id":"branch","dataset_id":"dataset",
            "dataset_sha256":"d".repeat(64),"instrument_spec":{"instrument_id":"EURUSD","asset_class":"fx",
            "base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD","tick_size":"0.0001","pip_size":"0.0001",
            "contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2026-01-01"},
            "cost_model":{"version":"cost-v1","spread_basis":"bid_ask_embedded","account_ccy":"USD",
            "commission_per_side_account":"1","rounding_decimals":2},"spread_price":"0.0002",
            "timeframe_seconds":60,"starting_balance":"1000","cursor_index":0});
        if margin {
            args["research_margin"] =
                json!({"version":"fixed-starting-balance-leverage-v1","leverage":"1"});
        }
        transform(&json!({"action":"initialize","args":args})).unwrap()["snapshot"].clone()
    }
    fn bar(cursor: i64) -> Value {
        json!({"cursor_index":cursor,"bar":{"timestamp":1000+(cursor-1)*60,
            "open":"1.1000","high":"1.1005","low":"1.0995","close":"1.1000"}})
    }
    struct Pair {
        full: Value,
        prefix: ValidatedBarPrefix,
        index: IndexedFixture,
    }
    impl Pair {
        fn new(margin: bool) -> Self {
            let full = initial(margin);
            let prefix = ValidatedBarPrefix::import(full.clone()).unwrap();
            Self {
                full,
                prefix,
                index: IndexedFixture::default(),
            }
        }
        fn run(&mut self, action: &str, args: Value) -> Vec<Value> {
            let legacy =
                transform(&json!({"action":action,"snapshot":self.full,"args":args})).unwrap();
            let next = self
                .prefix
                .transition(action, args.clone(), &self.index)
                .unwrap();
            assert_eq!(&next.events, legacy["events"].as_array().unwrap());
            let mut head = legacy["snapshot"].clone();
            head.as_object_mut().unwrap().remove("ledger");
            assert_eq!(next.next.head(), &head);
            assert_eq!(next.validated_events, next.events.len());
            assert_eq!(
                ValidatedBarPrefix::restore_trusted(next.next.export())
                    .unwrap()
                    .head(),
                &head
            );
            if matches!(
                action,
                "queue" | "queue_entry" | "queue_current_quote" | "protection" | "close"
            ) {
                self.index
                    .consumed
                    .insert(args["operation_id"].as_str().unwrap().to_owned());
            }
            self.full = legacy["snapshot"].clone();
            self.prefix = next.next;
            next.events
        }
    }
    fn order(side: &str, id: &str) -> Value {
        json!({"operation_id":id,"side":side,"quantity":"0.01","stop_loss":null,"take_profit":null,
            "mid_close":"1.1","virtual_time_utc":1060})
    }
    #[test]
    fn pending_entry_compact_prefix_matches_full_across_wait_fill_and_cancel() {
        for kind in ["limit", "stop"] {
            let mut pair = Pair::new(false);
            pair.run("advance", bar(1));
            let level = if kind == "limit" { "1.0990" } else { "1.1010" };
            pair.run("queue_entry",json!({"operation_id":"conditional","side":"BUY","quantity":"0.01","order_type":kind,"entry_price":level,"mid_close":"1.1000","virtual_time_utc":1060}));
            pair.run("advance", bar(2));
            assert!(pair.full["position"].is_null());
            let mut touch = bar(3);
            touch["bar"][if kind == "limit" { "low" } else { "high" }] =
                json!(if kind == "limit" { "1.0989" } else { "1.1011" });
            pair.run("advance", touch);
            assert_eq!(pair.full["position"]["entry_order_type"], kind);
            let mut cancelled = Pair::new(true);
            cancelled.run("advance", bar(1));
            cancelled.run("queue_entry",json!({"operation_id":"conditional","side":"BUY","quantity":"0.01","order_type":kind,"entry_price":level,"mid_close":"1.1000","virtual_time_utc":1060}));
            cancelled.run("advance", bar(2));
            cancelled.run("close",json!({"operation_id":"cancel","target_id":"conditional","mid_close":"1.1000","virtual_time_utc":1120}));
            assert!(cancelled.full["pending_market_order"].is_null());
        }
    }
    #[test]
    fn current_fill_amend_close_both_sides_match_full_financial_events() {
        for side in ["BUY", "SELL"] {
            let mut p = Pair::new(false);
            p.run("advance", bar(1));
            assert_eq!(p.run("queue_current_quote", order(side, "open")).len(), 2);
            let target = p.full["position"]["position_id"].clone();
            p.run("protection",json!({"operation_id":"amend","target_id":target,"stop_loss":if side=="BUY"{"1.09"}else{"1.11"},
                "take_profit":if side=="BUY"{"1.11"}else{"1.09"},"mid_close":"1.1","virtual_time_utc":1060}));
            p.run("close",json!({"operation_id":"close","target_id":target,"mid_close":"1.1","virtual_time_utc":1060}));
            assert!(p.full["position"].is_null());
            assert_eq!(p.index.reads.get(), 3);
        }
    }
    #[test]
    fn partial_targets_execute_and_restore_identically_in_full_and_compact() {
        for side in ["BUY", "SELL"] {
            let mut pair = Pair::new(false);
            pair.run("advance", bar(1));
            let mut open = order(side, "split");
            open["quantity"] = json!("0.04");
            let prices = if side == "BUY" {
                ["1.1010", "1.1020"]
            } else {
                ["1.0990", "1.0980"]
            };
            open["take_profits"] = json!([{"target_id":"tp1","price":prices[0],"quantity":"0.02"},{"target_id":"tp2","price":prices[1],"quantity":"0.02"}]);
            pair.run("queue_current_quote", open);
            let mut first = bar(2);
            first["bar"][if side == "BUY" { "high" } else { "low" }] =
                json!(if side == "BUY" { "1.1015" } else { "1.0985" });
            let events = pair.run("advance", first);
            assert_eq!(
                events
                    .iter()
                    .filter(|e| e["kind"] == "protective_fill")
                    .count(),
                1
            );
            assert_eq!(pair.full["position"]["quantity"], "0.02");
            assert_eq!(pair.full["position"]["take_profits"][0]["target_id"], "tp2");
            validate(&pair.full).unwrap();
            let restored = transform(
                &json!({"action":"reconstruct","snapshot":pair.full,"args":{"cursor_index":2}}),
            )
            .unwrap();
            assert_eq!(restored["snapshot"]["position"], pair.full["position"]);
            let mut second = bar(3);
            second["bar"][if side == "BUY" { "high" } else { "low" }] =
                json!(if side == "BUY" { "1.1025" } else { "1.0975" });
            pair.run("advance", second);
            assert!(pair.full["position"].is_null());
            assert_eq!(
                dec(&pair.full, "balance").unwrap(),
                d(&json!("1003.60")).unwrap()
            );
            for cursor in [1, 2, 3] {
                let mut restored = transform(&json!({"action":"reconstruct","snapshot":pair.full,"args":{"cursor_index":cursor}})).unwrap()["snapshot"].clone();
                restored.as_object_mut().unwrap().remove("ledger");
                assert_eq!(
                    super::super::reconstruct_validated(&pair.full, cursor).unwrap(),
                    restored
                );
            }
            for key in ["quantity", "net_pnl", "take_profit_target"] {
                let mut corrupt = pair.full.clone();
                corrupt["ledger"][3]["details"][key] = json!("bad");
                assert!(validate(&corrupt).is_err(), "{key}");
            }
        }
    }
    #[test]
    fn partial_targets_gap_multiple_fills_stop_and_manual_close() {
        for gap in [false, true] {
            let mut pair = Pair::new(false);
            pair.run("advance", bar(1));
            let mut open = order("BUY", "split");
            open["quantity"] = json!("0.04");
            open["take_profits"] = json!([{"target_id":"a","price":"1.1010","quantity":"0.02"},{"target_id":"b","price":"1.1020","quantity":"0.02"}]);
            pair.run("queue_current_quote", open);
            let mut next = bar(2);
            next["bar"]["high"] = json!("1.1030");
            if gap {
                next["bar"]["open"] = json!("1.1030");
            }
            let events = pair.run("advance", next);
            assert_eq!(
                events
                    .iter()
                    .filter(|e| e["kind"] == "protective_fill")
                    .count(),
                2
            );
            assert!(pair.full["position"].is_null());
            validate(&pair.full).unwrap();
        }
        let mut pair = Pair::new(false);
        pair.run("advance", bar(1));
        let mut open = order("BUY", "split");
        open["quantity"] = json!("0.04");
        open["stop_loss"] = json!("1.0990");
        open["take_profits"] = json!([{"target_id":"a","price":"1.1010","quantity":"0.02"},{"target_id":"b","price":"1.1020","quantity":"0.02"}]);
        pair.run("queue_current_quote", open);
        let id = pair.full["position"]["position_id"].clone();
        pair.run("close",json!({"operation_id":"manual","target_id":id,"quantity":"0.01","mid_close":"1.1","virtual_time_utc":1060}));
        assert_eq!(pair.full["position"]["take_profits"][1]["quantity"], "0.01");
        let mut ambiguous = bar(2);
        ambiguous["bar"]["low"] = json!("1.0980");
        ambiguous["bar"]["high"] = json!("1.1030");
        assert!(
            transform(&json!({"action":"advance","snapshot":pair.full,"args":ambiguous})).is_err()
        );
        let mut stop = bar(2);
        stop["bar"]["low"] = json!("1.0980");
        pair.run("advance", stop);
        assert!(pair.full["position"].is_null());
        validate(&pair.full).unwrap();
    }
    #[test]
    fn partial_target_then_stop_preserves_session_slippage_and_per_lot_fees() {
        for side in ["BUY", "SELL"] {
            let mut pair = Pair::new(false);
            let c = &mut pair.full["cost_model"];
            c["version"] = json!("session-cost-v2");
            c["commission_per_side_account"] = json!("0");
            c["commission_per_lot_account"] = json!("5");
            c["commission_charge"] = json!("per_side");
            c["slippage_model"] = json!({"version":"deterministic-adverse-fill-v1","mode":"fixed","fixed_steps":1,"unit":"pip","unit_price":"0.0001","seed":"partial-stop"});
            pair.prefix = ValidatedBarPrefix::import(pair.full.clone()).unwrap();
            pair.run("advance", bar(1));
            let mut open = order(side, "split");
            open["quantity"] = json!("0.04");
            open["stop_loss"] = json!(if side == "BUY" { "1.0990" } else { "1.1010" });
            let prices = if side == "BUY" {
                ["1.1010", "1.1020"]
            } else {
                ["1.0990", "1.0980"]
            };
            open["take_profits"] = json!([{"target_id":"a","price":prices[0],"quantity":"0.02"},{"target_id":"b","price":prices[1],"quantity":"0.02"}]);
            pair.run("queue_current_quote", open);
            assert_eq!(
                pair.full["position"]["entry_fill"],
                if side == "BUY" { "1.1002" } else { "1.0998" }
            );
            let mut first = bar(2);
            first["bar"][if side == "BUY" { "high" } else { "low" }] =
                json!(if side == "BUY" { "1.1015" } else { "1.0985" });
            let events = pair.run("advance", first);
            let fill = events
                .iter()
                .find(|e| e["kind"] == "protective_fill")
                .unwrap();
            assert_eq!(
                dec(&fill["details"], "net_pnl").unwrap(),
                d(&json!("1.4")).unwrap()
            );
            assert_eq!(fill["details"]["fill_slippage"]["offset_ticks"], 0);
            let mut stop = bar(3);
            stop["bar"][if side == "BUY" { "low" } else { "high" }] =
                json!(if side == "BUY" { "1.0980" } else { "1.1020" });
            let events = pair.run("advance", stop);
            let fill = events
                .iter()
                .find(|e| e["kind"] == "protective_fill")
                .unwrap();
            assert_eq!(fill["details"]["quantity"], "0.02");
            assert_eq!(fill["details"]["fill_slippage"]["offset_ticks"], 1);
            assert_eq!(
                dec(&fill["details"], "net_pnl").unwrap(),
                d(&json!("-2.8")).unwrap()
            );
            assert!(pair.full["position"].is_null());
            assert_eq!(
                dec(&pair.full, "balance").unwrap(),
                d(&json!("998.6")).unwrap()
            );
            validate(&pair.full).unwrap();
        }
    }
    #[test]
    fn conditional_entry_retains_partial_targets_until_later_candles() {
        let mut pair = Pair::new(false);
        pair.run("advance", bar(1));
        let targets = json!([{"target_id":"a","price":"1.1020","quantity":"0.02"},{"target_id":"b","price":"1.1030","quantity":"0.02"}]);
        pair.run("queue_entry", json!({"operation_id":"conditional","side":"BUY","quantity":"0.04","order_type":"stop","entry_price":"1.1010","take_profits":targets,"mid_close":"1.1","virtual_time_utc":1060}));
        let mut touch = bar(2);
        touch["bar"]["high"] = json!("1.1012");
        pair.run("advance", touch);
        assert_eq!(pair.full["position"]["take_profits"], targets);
        let mut first = bar(3);
        first["bar"]["high"] = json!("1.1025");
        pair.run("advance", first);
        assert_eq!(pair.full["position"]["quantity"], "0.02");
        assert_eq!(pair.full["position"]["take_profits"][0]["target_id"], "b");
        validate(&pair.full).unwrap();
    }
    #[test]
    fn partial_targets_reject_invalid_allocations_without_changing_state() {
        let mut pair = Pair::new(false);
        pair.run("advance", bar(1));
        for targets in [
            json!([]),
            json!([{"target_id":"a","price":"1.1010","quantity":"0.01"},{"target_id":"b","price":"1.1020","quantity":"0.01"}]),
            json!([{"target_id":"a","price":"1.1010","quantity":"0.015"},{"target_id":"b","price":"1.1020","quantity":"0.025"}]),
            json!([{"target_id":"a","price":"1.1020","quantity":"0.02"},{"target_id":"b","price":"1.1010","quantity":"0.02"}]),
            json!([{"target_id":"a","price":"1.1010","quantity":"0.02"},{"target_id":"a","price":"1.1020","quantity":"0.02"}]),
        ] {
            let mut open = order("BUY", "bad");
            open["quantity"] = json!("0.04");
            open["take_profits"] = targets;
            if open["take_profits"].as_array().unwrap().is_empty() {
                continue;
            }
            assert!(
                transform(
                    &json!({"action":"queue_current_quote","snapshot":pair.full,"args":open})
                )
                .is_err()
            );
            assert!(
                pair.prefix
                    .transition("queue_current_quote", open, &pair.index)
                    .is_err()
            );
        }
    }
    #[test]
    fn partial_close_preserves_remaining_position_and_allocates_legacy_fees() {
        for side in ["BUY", "SELL"] {
            let mut p = Pair::new(false);
            p.run("advance", bar(1));
            let mut open = order(side, "open");
            open["quantity"] = json!("0.04");
            p.run("queue_current_quote", open);
            let target = p.full["position"]["position_id"].clone();
            let balance = dec(&p.full, "balance").unwrap();
            for (index, left) in [(1, "0.03"), (2, "0.02"), (3, "0.01")] {
                let events = p.run(
                    "close",
                    json!({"operation_id":format!("partial-{index}"),"target_id":target,
                    "quantity":"0.01","mid_close":"1.1","virtual_time_utc":1060}),
                );
                assert_eq!(
                    dec(&p.full["position"], "quantity").unwrap(),
                    d(&json!(left)).unwrap()
                );
                assert_eq!(p.full["position"]["original_quantity"], "0.04");
                assert_eq!(events[0]["open_positions"], 1);
                assert_eq!(
                    events[0]["details"]["cost_breakdown"]["commission_account"],
                    0.5
                );
                validate(&p.full).unwrap();
            }
            p.run("close",json!({"operation_id":"final","target_id":target,"mid_close":"1.1","virtual_time_utc":1060}));
            assert!(p.full["position"].is_null());
            assert_eq!(
                balance - dec(&p.full, "balance").unwrap(),
                d(&json!("2.80")).unwrap()
            );
            validate(&p.full).unwrap();
        }
    }
    #[test]
    fn partial_close_rejects_oversize_off_step_and_invalid_remainder() {
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        let mut open = order("BUY", "open");
        open["quantity"] = json!("0.04");
        p.run("queue_current_quote", open);
        for quantity in ["0", "-0.01", "0.05", "0.015", "0.035"] {
            let args = json!({"operation_id":"invalid","target_id":p.full["position"]["position_id"],
                "quantity":quantity,"mid_close":"1.1","virtual_time_utc":1060});
            assert!(transform(&json!({"action":"close","snapshot":p.full,"args":args})).is_err());
            assert!(p.prefix.transition("close", args, &p.index).is_err());
        }
    }
    #[test]
    fn partial_close_allocates_minimum_fee_and_financing_once() {
        let mut p = Pair::new(false);
        p.full["cost_model"]["minimum_fee_account"] = json!("5");
        p.full["cost_model"]["financing_account"] = json!("3");
        p.prefix = ValidatedBarPrefix::import(p.full.clone()).unwrap();
        p.run("advance", bar(1));
        let mut open = order("BUY", "open");
        open["quantity"] = json!("0.04");
        p.run("queue_current_quote", open);
        let target = p.full["position"]["position_id"].clone();
        let events=p.run("close",json!({"operation_id":"partial","target_id":target,"quantity":"0.01","mid_close":"1.1","virtual_time_utc":1060}));
        assert_eq!(
            events[0]["details"]["cost_breakdown"]["commission_account"],
            1.25
        );
        assert_eq!(
            events[0]["details"]["cost_breakdown"]["financing_account"],
            0.75
        );
        let last=p.run("close",json!({"operation_id":"final","target_id":target,"mid_close":"1.1","virtual_time_utc":1060}));
        assert_eq!(
            last[0]["details"]["cost_breakdown"]["commission_account"],
            3.75
        );
        assert_eq!(
            last[0]["details"]["cost_breakdown"]["financing_account"],
            2.25
        );
        assert_eq!(
            dec(&p.full, "balance").unwrap(),
            d(&json!("991.2")).unwrap()
        );
    }
    #[test]
    fn queue_without_event_pending_amend_cancel_and_reuse_guard() {
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        let base = p.prefix.event_sequence();
        assert!(p.run("queue", order("SELL", "queued")).is_empty());
        assert_eq!(p.prefix.event_sequence(), base);
        p.run(
            "protection",
            json!({"operation_id":"pending-amend","target_id":"queued","stop_loss":"1.11",
            "take_profit":"1.09","mid_close":"1.1","virtual_time_utc":1060}),
        );
        p.run("close",json!({"operation_id":"cancel","target_id":"queued","mid_close":"1.1","virtual_time_utc":1060}));
        let saved = p.prefix.export();
        assert!(
            p.prefix
                .transition("queue", order("SELL", "queued"), &p.index)
                .is_err()
        );
        assert_eq!(p.prefix.export(), saved);
    }
    #[test]
    fn queued_next_bar_fill_protective_exit_and_batch_match_full() {
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        p.run("queue", order("BUY", "queued"));
        p.run("advance", bar(2));
        let target = p.full["position"]["position_id"].clone();
        p.run(
            "protection",
            json!({"operation_id":"protect","target_id":target,"stop_loss":"1.09",
            "take_profit":"1.1010","mid_close":"1.1","virtual_time_utc":1120}),
        );
        let mut exit = bar(3);
        exit["bar"]["high"] = json!("1.1020");
        let events = p.run("advance_many", json!({"steps":[exit,bar(4)]}));
        assert!(events.iter().any(|e| e["kind"] == "protective_fill"));
        assert!(p.full["position"].is_null());
    }
    #[test]
    fn margin_rejection_and_explicit_fill_match_full() {
        let mut p = Pair::new(true);
        p.run("advance", bar(1));
        let mut a = order("SELL", "margin");
        a["quantity"] = json!("1");
        let events = p.run("queue_current_quote", a);
        assert_eq!(events[0]["kind"], "order_rejected");
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        p.run("queue", order("BUY", "queued"));
        p.run(
            "fill_current_quote",
            json!({"mid_close":"1.1","virtual_time_utc":1060}),
        );
    }
    #[test]
    fn invalid_amend_quote_and_unsupported_actions_leave_prefix_unchanged() {
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        p.run("queue_current_quote", order("SELL", "open"));
        let before = p.prefix.export();
        let target = p.full["position"]["position_id"].clone();
        for args in [
            json!({"operation_id":"bad","target_id":target,"stop_loss":null,"take_profit":"1.2","mid_close":"1.1","virtual_time_utc":1060}),
            json!({"operation_id":"bad","target_id":"wrong-target","mid_close":"1.1","virtual_time_utc":1060}),
        ] {
            let legacy = transform(&json!({"action":"protection","snapshot":p.full,"args":args}));
            let compact = p.prefix.transition("protection", args, &p.index);
            assert_eq!(legacy.unwrap_err(), compact.err().unwrap());
            assert_eq!(p.prefix.export(), before);
        }
        for action in ["fork", "reconstruct", "transition", "unknown"] {
            assert!(p.prefix.transition(action, json!({}), &p.index).is_err());
        }
        assert!(p.prefix.transition("close",json!({"operation_id":"bad","target_id":target,"mid_close":"1.1","virtual_time_utc":1061}),&p.index).is_err());
        assert_eq!(p.prefix.export(), before);
    }
    #[test]
    fn import_and_persisted_context_corruption_fail_closed() {
        let mut p = Pair::new(false);
        p.run("advance", bar(1));
        let mut corrupt = p.full.clone();
        corrupt["ledger"][0]["equity"] = json!("999");
        assert!(ValidatedBarPrefix::import(corrupt).is_err());
        let stored = p.prefix.export();
        for path in ["head", "context"] {
            let mut corrupt = stored.clone();
            corrupt["body"][path]["balance"] = json!("99");
            assert!(ValidatedBarPrefix::restore_trusted(corrupt).is_err());
        }
        for change in 0..5 {
            let mut corrupt = stored.clone();
            match change {
                0 => corrupt["body"]["validator_version"] = json!("future-validator"),
                1 => {
                    corrupt["body"]["head"]["balance"] = json!("99");
                    corrupt["body"]["head"]["equity"] = json!("99");
                }
                2 => corrupt["body"]["context"]["last_event"]["sequence"] = json!(0),
                3 => corrupt["body"]["context"]["coverage"] = json!("invented"),
                _ => corrupt["body"]["context"]["prefix_sha256"] = json!("bad"),
            }
            corrupt["sha256"] = json!(digest(&corrupt["body"]));
            assert!(ValidatedBarPrefix::restore_trusted(corrupt).is_err());
        }
    }
    #[test]
    fn prefix_length_does_not_change_mutation_event_visits_or_index_reads() {
        let mut sizes = vec![];
        for length in [1, 100, 5000] {
            let mut full = initial(false);
            for cursor in 1..=length {
                advance(&mut full, &bar(cursor), &mut History::Full).unwrap();
            }
            let prefix = ValidatedBarPrefix::import(full).unwrap();
            let index = IndexedFixture::default();
            let mut a = order("SELL", "open");
            a["virtual_time_utc"] = json!(1000 + length * 60);
            let next = prefix.transition("queue_current_quote", a, &index).unwrap();
            assert_eq!(next.validated_events, 2);
            assert_eq!(index.reads.get(), 1);
            sizes.push(serde_json::to_vec(&prefix.export()).unwrap().len());
        }
        assert!(sizes.iter().max().unwrap() - sizes.iter().min().unwrap() < 100);
    }
    #[test]
    fn tick_and_wrong_scope_operation_permits_are_explicitly_rejected() {
        let mut tick = initial(true);
        tick["schema_version"] = json!("replay-execution-tick-v1");
        tick["tick_snapshot_id"] = json!("tick-snapshot");
        tick["tick_snapshot_sha256"] = json!("a".repeat(64));
        tick["quote_source"] = json!("broker_bid_ask");
        tick["spread_price"] = json!("0");
        tick["last_bid"] = Value::Null;
        tick["last_ask"] = Value::Null;
        assert!(
            ValidatedBarPrefix::import(tick)
                .unwrap_err()
                .contains("BAR snapshots only")
        );
        let mut snapshot = initial(false);
        snapshot["branch_id"] = json!("other-branch");
        let prefix = ValidatedBarPrefix::import(snapshot).unwrap();
        assert!(
            prefix
                .transition("queue", order("SELL", "open"), &IndexedFixture::default())
                .err()
                .unwrap()
                .contains("permit lineage mismatch")
        );
    }
    #[test]
    fn commitments_survive_jsonb_equivalent_numeric_spelling() {
        let a: Value = serde_json::from_str(r#"{"z":-0.0,"n":1.00,"text":"1.00"}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"text":"1.00","n":1,"z":0}"#).unwrap();
        assert_eq!(digest(&a), digest(&b));
        let mut c = b.clone();
        c["text"] = json!("1");
        assert_ne!(digest(&b), digest(&c));
        assert_eq!(
            extend_prefix_sha256(&empty_prefix_sha256(), &a).unwrap(),
            extend_prefix_sha256(&empty_prefix_sha256(), &b).unwrap()
        );
    }
}
