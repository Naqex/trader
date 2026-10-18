//! Immutable PostgreSQL BAR event prefixes and exact per-revision execution heads.
//!
//! Incremental restores trust application-owned immutable PostgreSQL rows. The
//! hash chain binds a checked tip; it does not detect an administrator replacing
//! an unread prefix. Cold reads/imports validate the complete canonical ledger.
use crate::replay_core::history::{
    BAR_PREFIX_VERSION, BarTransition, OperationLookup, ValidatedBarPrefix, empty_prefix_sha256,
    equivalent_json, extend_prefix_sha256,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use tokio_postgres::{GenericClient, Transaction};

pub const FULL_FORMAT: &str = "full_snapshot";
pub const STORAGE_FORMAT: &str = "replay-execution-v1";
type Result<T> = std::result::Result<T, String>;

fn revision(value: i64) -> Result<i32> {
    i32::try_from(value)
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(|| "invalid replay revision".into())
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("invalid execution {key}"))
}

// The initial compact slice deliberately excludes portfolio/tick storage.
fn execution(payload: &Value) -> Result<Option<Value>> {
    let mut snapshots = BTreeMap::new();
    if let Some(snapshot) = payload.get("execution").filter(|v| !v.is_null()) {
        snapshots.insert(text(snapshot, "dataset_id")?.to_owned(), snapshot.clone());
    }
    if let Some(states) = payload["asset_states"].as_object() {
        for (dataset, state) in states {
            if let Some(snapshot) = state.get("execution").filter(|v| !v.is_null()) {
                if text(snapshot, "dataset_id")? != dataset {
                    return Err("asset execution dataset mismatch".into());
                }
                if let Some(prior) = snapshots.insert(dataset.clone(), snapshot.clone()) {
                    if !equivalent_json(&prior, snapshot) {
                        return Err("active and asset execution snapshots differ".into());
                    }
                }
            }
        }
    }
    if snapshots.len() > 1 {
        return Err("compact execution storage supports one BAR dataset".into());
    }
    Ok(snapshots.into_values().next())
}

fn check_scope(id: &str, payload: &Value, head: &Value) -> Result<()> {
    let dataset = text(head, "dataset_id")?;
    if text(head, "replay_session_id")? != id || payload["dataset_id"] != dataset {
        return Err("compact execution session/dataset differs from record".into());
    }
    if let Some(branch) = payload.get("branch_id").filter(|v| !v.is_null()) {
        if branch != &head["branch_id"] {
            return Err("compact execution branch differs from record".into());
        }
    }
    let cursor = head["cursor_index"]
        .as_i64()
        .ok_or("execution cursor missing")?;
    if payload["cursor_index"].as_i64() != Some(cursor) {
        return Err("compact execution cursor differs from record".into());
    }
    if let Some(state) = payload["asset_states"].get(dataset) {
        if state["cursor_index"].as_i64() != Some(cursor) {
            return Err("compact asset cursor differs from execution".into());
        }
    }
    Ok(())
}

/// Preserve all replay metadata while replacing the two aliases of its execution
/// snapshot. A supplied snapshot must already equal the prefix head (with or
/// without its ledger); no stale head is silently substituted.
pub fn compact_payload(mut payload: Value, prefix: &ValidatedBarPrefix) -> Result<Value> {
    check_scope(
        text(prefix.head(), "replay_session_id")?,
        &payload,
        prefix.head(),
    )?;
    let snapshot = execution(&payload)?.ok_or("execution snapshot missing")?;
    let mut supplied_head = snapshot;
    supplied_head
        .as_object_mut()
        .ok_or("execution must be object")?
        .remove("ledger");
    if !equivalent_json(&supplied_head, prefix.head()) {
        return Err("payload execution differs from validated head".into());
    }
    if !payload["execution"].is_null() {
        payload["execution"] = prefix.head().clone();
    }
    let dataset = text(prefix.head(), "dataset_id")?;
    if !payload["asset_states"][dataset]["execution"].is_null() {
        payload["asset_states"][dataset]["execution"] = prefix.head().clone();
    }
    Ok(payload)
}

async fn format<C: GenericClient + Sync>(
    client: &C,
    workspace: &str,
    id: &str,
    rev: i32,
) -> Result<String> {
    client.query_opt("SELECT storage_format FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3", &[&workspace,&id,&rev])
        .await.map_err(|_| "cannot read execution storage format")?
        .map(|row|row.get(0)).ok_or_else(|| "replay revision missing".into())
}

/// Restore a bounded trusted head only when the exact revision is compact.
pub async fn load_prefix<C: GenericClient + Sync>(
    client: &C,
    workspace: &str,
    id: &str,
    rev: i64,
    dataset: &str,
) -> Result<Option<ValidatedBarPrefix>> {
    let rev = revision(rev)?;
    match format(client, workspace, id, rev).await?.as_str() {
        FULL_FORMAT => return Ok(None),
        STORAGE_FORMAT => (),
        _ => return Err("unknown replay execution storage format".into()),
    }
    let row = client.query_opt("SELECT p.validator_version,p.event_sequence,p.prefix_sha256,p.prefix_json,p.branch_id,p.dataset_sha256,d.manifest_json->>'artifact_sha256' AS manifest_sha256 FROM replay_execution_revisions p LEFT JOIN datasets d ON d.workspace_id=p.workspace_id AND d.dataset_id=p.dataset_id WHERE p.workspace_id=$1 AND p.record_id=$2 AND p.revision=$3 AND p.dataset_id=$4", &[&workspace,&id,&rev,&dataset])
        .await.map_err(|_| "cannot read execution prefix")?.ok_or("execution prefix missing")?;
    if row.get::<_, String>("validator_version") != BAR_PREFIX_VERSION {
        return Err("unknown execution prefix validator".into());
    }
    let prefix = ValidatedBarPrefix::restore_trusted(row.get("prefix_json"))?;
    let head = prefix.head();
    if text(head, "replay_session_id")? != id
        || text(head, "dataset_id")? != dataset
        || text(head, "branch_id")? != row.get::<_, String>("branch_id")
        || text(head, "dataset_sha256")? != row.get::<_, String>("dataset_sha256")
        || Some(text(head, "dataset_sha256")?)
            != row.get::<_, Option<String>>("manifest_sha256").as_deref()
        || prefix.event_sequence() != row.get::<_, i64>("event_sequence")
        || prefix.prefix_sha256() != row.get::<_, String>("prefix_sha256")
    {
        return Err("execution prefix certificate scope mismatch".into());
    }
    if prefix.event_sequence() > 0 {
        let tip = client.query_opt("SELECT event_json,prefix_sha256 FROM replay_execution_events WHERE workspace_id=$1 AND record_id=$2 AND dataset_id=$3 AND sequence=$4", &[&workspace,&id,&dataset,&prefix.event_sequence()])
            .await.map_err(|_| "cannot read execution prefix tip")?.ok_or("execution prefix tip missing")?;
        if !prefix
            .last_event()
            .is_some_and(|event| equivalent_json(event, &tip.get::<_, Value>("event_json")))
            || prefix.prefix_sha256() != tip.get::<_, String>("prefix_sha256")
        {
            return Err("execution prefix tip differs from certificate".into());
        }
    }
    Ok(Some(prefix))
}

/// Exact historical hydration. Queue-only revisions may share an event cutoff
/// while carrying different pending commands, so the revision is mandatory.
pub async fn hydrate_payload<C: GenericClient + Sync>(
    client: &C,
    workspace: &str,
    id: &str,
    rev: i64,
    mut payload: Value,
) -> Result<Value> {
    match format(client, workspace, id, revision(rev)?)
        .await?
        .as_str()
    {
        FULL_FORMAT => return Ok(payload),
        STORAGE_FORMAT => (),
        _ => return Err("unknown replay execution storage format".into()),
    }
    let head = execution(&payload)?.ok_or("compact revision execution missing")?;
    let dataset = text(&head, "dataset_id")?.to_owned();
    let prefix = load_prefix(client, workspace, id, rev, &dataset)
        .await?
        .ok_or("compact prefix missing")?;
    check_scope(id, &payload, prefix.head())?;
    if !equivalent_json(&head, prefix.head()) {
        return Err("compact payload differs from immutable head".into());
    }
    let rows = client.query("SELECT sequence,event_json,prefix_sha256 FROM replay_execution_events WHERE workspace_id=$1 AND record_id=$2 AND dataset_id=$3 AND sequence<=$4 ORDER BY sequence", &[&workspace,&id,&dataset,&prefix.event_sequence()])
        .await.map_err(|_| "cannot hydrate execution events")?;
    let mut ledger = Vec::with_capacity(rows.len());
    let mut hash = empty_prefix_sha256();
    for (offset, row) in rows.into_iter().enumerate() {
        let event: Value = row.get("event_json");
        if row.get::<_, i64>("sequence") != offset as i64 + 1 {
            return Err("execution event prefix is incomplete".into());
        }
        hash = extend_prefix_sha256(&hash, &event)?;
        if hash != row.get::<_, String>("prefix_sha256") {
            return Err("execution event prefix checksum mismatch".into());
        }
        ledger.push(event);
    }
    if ledger.len() as i64 != prefix.event_sequence() || hash != prefix.prefix_sha256() {
        return Err("execution event cutoff differs from certificate".into());
    }
    let mut full = prefix.head().clone();
    full["ledger"] = json!(ledger);
    // Import verifies the full canonical history and regenerates every bounded
    // context field, including the most recent quote and causal coverage.
    if !equivalent_json(
        &ValidatedBarPrefix::import(full.clone())?.export(),
        &prefix.export(),
    ) {
        return Err("hydrated execution differs from validated certificate".into());
    }
    if !payload["execution"].is_null() {
        payload["execution"] = full.clone();
    }
    if !payload["asset_states"][&dataset]["execution"].is_null() {
        payload["asset_states"][&dataset]["execution"] = full;
    }
    Ok(payload)
}

/// A repository-created admission for exactly the requested IDs and one immutable
/// prefix. It is small enough to move into a blocking core transition.
pub struct OperationAdmission {
    session: String,
    branch: String,
    dataset: String,
    head: Value,
    prefix_sha256: String,
    admitted: HashMap<String, bool>,
}
impl OperationAdmission {
    pub async fn prepare(
        tx: &Transaction<'_>,
        workspace: &str,
        id: &str,
        rev: i64,
        prefix: &ValidatedBarPrefix,
        ids: &[&str],
    ) -> Result<Self> {
        if ids.len() > 16 {
            return Err("too many execution operation admissions".into());
        }
        let rev = revision(rev)?;
        let dataset = text(prefix.head(), "dataset_id")?;
        let persisted = load_prefix(tx, workspace, id, rev as i64, dataset)
            .await?
            .ok_or("operation admission requires compact revision")?;
        if !equivalent_json(&persisted.export(), &prefix.export()) {
            return Err("operation admission prefix differs from revision".into());
        }
        let mut admitted = HashMap::new();
        for operation_id in ids {
            if operation_id.trim().is_empty() || operation_id.len() > 128 {
                return Err("operation_id must be a bounded nonempty identifier".into());
            }
            let row = tx.query_one("SELECT EXISTS(SELECT 1 FROM replay_execution_operations WHERE workspace_id=$1 AND record_id=$2 AND dataset_id=$3 AND operation_id=$4 AND first_revision<=$5 AND first_event_sequence<=$6)", &[&workspace,&id,&dataset,operation_id,&rev,&prefix.event_sequence()])
                .await.map_err(|_| "cannot admit execution operation")?;
            admitted.insert((*operation_id).to_owned(), !row.get::<_, bool>(0));
        }
        Ok(Self {
            session: id.to_owned(),
            branch: text(prefix.head(), "branch_id")?.to_owned(),
            dataset: dataset.to_owned(),
            head: prefix.head().clone(),
            prefix_sha256: prefix.prefix_sha256().to_owned(),
            admitted,
        })
    }
}
impl OperationLookup for OperationAdmission {
    fn ensure_prefix(&self, head: &Value, prefix_sha256: &str) -> Result<()> {
        if !equivalent_json(head, &self.head) || prefix_sha256 != self.prefix_sha256 {
            return Err("execution operation admission belongs to a different prefix".into());
        }
        Ok(())
    }
    fn ensure_fresh(&self, session: &str, branch: &str, dataset: &str, id: &str) -> Result<()> {
        if session != self.session || branch != self.branch || dataset != self.dataset {
            return Err("execution operation admission scope mismatch".into());
        }
        match self.admitted.get(id) {
            Some(true) => Ok(()),
            Some(false) => Err("operation_id was already consumed".into()),
            None => Err("operation_id was not admitted for this transition".into()),
        }
    }
}

async fn append_events(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    dataset: &str,
    base_sequence: i64,
    base_hash: &str,
    events: &[Value],
) -> Result<String> {
    let mut hash = base_hash.to_owned();
    let mut batch = Vec::new();
    for (offset, event) in events.iter().enumerate() {
        let sequence = base_sequence
            .checked_add(offset as i64 + 1)
            .ok_or("execution sequence overflow")?;
        if event["sequence"].as_i64() != Some(sequence)
            || event["replay_session_id"] != id
            || event["dataset_id"] != dataset
        {
            return Err("persisted event scope/sequence mismatch".into());
        }
        hash = extend_prefix_sha256(&hash, event)?;
        batch.push(json!({"sequence":sequence,"event_json":event,"prefix_sha256":hash}));
        if batch.len() == 512 || offset + 1 == events.len() {
            let values = json!(batch);
            tx.execute("INSERT INTO replay_execution_events(workspace_id,record_id,dataset_id,sequence,event_json,prefix_sha256) SELECT $1,$2,$3,v.sequence,v.event_json,v.prefix_sha256 FROM jsonb_to_recordset($4::jsonb) AS v(sequence bigint,event_json jsonb,prefix_sha256 text) ON CONFLICT DO NOTHING", &[&workspace,&id,&dataset,&values])
                .await.map_err(|_| "cannot append execution events")?;
            let matches: i64 = tx.query_one("SELECT count(*) FROM jsonb_to_recordset($4::jsonb) AS v(sequence bigint,event_json jsonb,prefix_sha256 text) JOIN replay_execution_events e ON e.workspace_id=$1 AND e.record_id=$2 AND e.dataset_id=$3 AND e.sequence=v.sequence AND e.event_json=v.event_json AND e.prefix_sha256=v.prefix_sha256", &[&workspace,&id,&dataset,&values])
                .await.map_err(|_| "cannot verify execution event append")?.get(0);
            if matches != batch.len() as i64 {
                return Err("immutable execution event prefix conflict".into());
            }
            batch.clear();
        }
    }
    Ok(hash)
}

fn operation_ids(head: &Value, events: &[Value]) -> Result<BTreeMap<String, i64>> {
    let mut ids = BTreeMap::new();
    for event in events {
        let sequence = event["sequence"].as_i64().ok_or("event sequence missing")?;
        for field in ["operation_id", "command_operation_id"] {
            if let Some(id) = event["details"][field].as_str() {
                ids.entry(id.to_owned()).or_insert(sequence);
            }
        }
    }
    for (field, identifier) in [
        ("pending_market_order", "operation_id"),
        ("position", "source_operation_id"),
    ] {
        if let Some(id) = head[field][identifier].as_str() {
            ids.entry(id.to_owned()).or_insert(
                head["event_sequence"]
                    .as_i64()
                    .ok_or("head sequence missing")?,
            );
        }
    }
    if ids.keys().any(|id| id.trim().is_empty() || id.len() > 128) {
        return Err("invalid persisted operation identifier".into());
    }
    Ok(ids)
}

async fn persist_certificate(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    rev: i32,
    prefix: &ValidatedBarPrefix,
    events: &[Value],
    payload: &Value,
) -> Result<Value> {
    check_scope(id, payload, prefix.head())?;
    let row = tx.query_opt("SELECT payload_json=$4::jsonb AS matches FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3 FOR UPDATE", &[&workspace,&id,&rev,&payload])
        .await.map_err(|_| "cannot verify execution persistence revision")?.ok_or("execution record revision missing")?;
    if !row.get::<_, bool>("matches") {
        return Err("execution persistence payload differs from record revision".into());
    }
    let compact = compact_payload(payload.clone(), prefix)?;
    let dataset = text(prefix.head(), "dataset_id")?;
    let branch = text(prefix.head(), "branch_id")?;
    let sha = text(prefix.head(), "dataset_sha256")?;
    let exported = prefix.export();
    tx.execute("INSERT INTO replay_execution_revisions(workspace_id,record_id,revision,dataset_id,branch_id,dataset_sha256,validator_version,event_sequence,prefix_sha256,prefix_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING", &[&workspace,&id,&rev,&dataset,&branch,&sha,&BAR_PREFIX_VERSION,&prefix.event_sequence(),&prefix.prefix_sha256(),&exported])
        .await.map_err(|_| "cannot persist execution prefix certificate")?;
    let actual: Value = tx.query_one("SELECT prefix_json FROM replay_execution_revisions WHERE workspace_id=$1 AND record_id=$2 AND revision=$3 AND dataset_id=$4", &[&workspace,&id,&rev,&dataset])
        .await.map_err(|_| "cannot verify execution certificate")?.get(0);
    if !equivalent_json(&actual, &exported) {
        return Err("immutable execution revision conflict".into());
    }
    let ids = operation_ids(prefix.head(), events)?;
    if !ids.is_empty() {
        let values = json!(
            ids.into_iter()
                .map(|(id, sequence)| json!({"operation_id":id,"sequence":sequence}))
                .collect::<Vec<_>>()
        );
        tx.execute("INSERT INTO replay_execution_operations(workspace_id,record_id,dataset_id,operation_id,first_revision,first_event_sequence) SELECT $1,$2,$3,v.operation_id,$4,v.sequence FROM jsonb_to_recordset($5::jsonb) AS v(operation_id text,sequence bigint) ON CONFLICT DO NOTHING", &[&workspace,&id,&dataset,&rev,&values])
            .await.map_err(|_| "cannot reserve execution operation identifiers")?;
    }
    let changed = tx.execute("UPDATE workspace_record_revisions SET payload_json=$4,storage_format=$5 WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3", &[&workspace,&id,&rev,&compact,&STORAGE_FORMAT])
        .await.map_err(|_| "cannot mark compact execution revision")?;
    if changed != 1 {
        return Err("execution record revision missing".into());
    }
    Ok(compact)
}

/// Cold migration of one existing full revision. It never trusts a sidecar for a
/// full marker, which is essential after compatibility writes during rollback.
pub async fn import_revision(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    rev: i64,
    payload: &Value,
) -> Result<Value> {
    let rev = revision(rev)?;
    let row = tx.query_opt("SELECT payload_json,storage_format FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3 FOR UPDATE", &[&workspace,&id,&rev])
        .await.map_err(|_| "cannot lock execution import revision")?.ok_or("execution import revision missing")?;
    let stored: Value = row.get("payload_json");
    match row.get::<_, String>("storage_format").as_str() {
        STORAGE_FORMAT => {
            if !equivalent_json(
                &hydrate_payload(tx, workspace, id, rev as i64, stored.clone()).await?,
                payload,
            ) {
                return Err("execution import payload differs from compact revision".into());
            }
            return Ok(stored);
        }
        FULL_FORMAT => (),
        _ => return Err("unknown replay execution storage format".into()),
    }
    if !equivalent_json(&stored, payload) {
        return Err("execution import payload differs from full revision".into());
    }
    let Some(snapshot) = execution(payload)? else {
        return Ok(payload.clone());
    };
    check_scope(id, payload, &snapshot)?;
    let prefix = ValidatedBarPrefix::import(snapshot.clone())?;
    let events = snapshot["ledger"]
        .as_array()
        .ok_or("execution ledger missing")?;
    let hash = append_events(
        tx,
        workspace,
        id,
        text(prefix.head(), "dataset_id")?,
        0,
        &empty_prefix_sha256(),
        events,
    )
    .await?;
    if hash != prefix.prefix_sha256() {
        return Err("execution import prefix mismatch".into());
    }
    persist_certificate(tx, workspace, id, rev, &prefix, events, payload).await
}

/// Append one validated bounded transition in the same transaction as the
/// already-inserted record revision and its exact-byte mutation receipt.
pub async fn persist_transition(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    base_revision: i64,
    new_revision: i64,
    base: &ValidatedBarPrefix,
    transition: &BarTransition,
    payload: &Value,
) -> Result<Value> {
    let next_revision = revision(new_revision)?;
    if new_revision
        != base_revision
            .checked_add(1)
            .ok_or("replay revision overflow")?
    {
        return Err("execution transition revision is not contiguous".into());
    }
    let dataset = text(base.head(), "dataset_id")?;
    let persisted = load_prefix(tx, workspace, id, base_revision, dataset)
        .await?
        .ok_or("base execution revision is not compact")?;
    if !equivalent_json(&persisted.export(), &base.export()) {
        return Err("base execution prefix differs from persisted revision".into());
    }
    for key in [
        "replay_session_id",
        "branch_id",
        "dataset_id",
        "dataset_sha256",
    ] {
        if transition.next.head()[key] != base.head()[key] {
            return Err("execution transition lineage changed".into());
        }
    }
    if transition.next.event_sequence()
        != base
            .event_sequence()
            .checked_add(transition.events.len() as i64)
            .ok_or("execution sequence overflow")?
    {
        return Err("execution transition event count mismatch".into());
    }
    let hash = append_events(
        tx,
        workspace,
        id,
        dataset,
        base.event_sequence(),
        base.prefix_sha256(),
        &transition.events,
    )
    .await?;
    if hash != transition.next.prefix_sha256() {
        return Err("execution transition prefix hash mismatch".into());
    }
    persist_certificate(
        tx,
        workspace,
        id,
        next_revision,
        &transition.next,
        &transition.events,
        payload,
    )
    .await
}

/// Restored-target rollback administration only. The caller supplies one outer
/// transaction for all historical/deleted/branch revisions; no receipt or record
/// timestamp is rewritten. Unknown formats/corruption abort that transaction.
pub async fn materialize_revision(
    tx: &Transaction<'_>,
    workspace: &str,
    id: &str,
    rev: i64,
) -> Result<bool> {
    let rev = revision(rev)?;
    let row = tx.query_opt("SELECT payload_json,storage_format FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3 FOR UPDATE", &[&workspace,&id,&rev])
        .await.map_err(|_| "cannot lock materialization revision")?.ok_or("materialization revision missing")?;
    if row.get::<_, String>("storage_format") == FULL_FORMAT {
        return Ok(false);
    }
    let full = hydrate_payload(tx, workspace, id, rev as i64, row.get("payload_json")).await?;
    tx.execute("UPDATE workspace_record_revisions SET payload_json=$4,storage_format=$5 WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3", &[&workspace,&id,&rev,&full,&FULL_FORMAT])
        .await.map_err(|_| "cannot materialize full execution revision")?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn admission_never_accepts_unrequested_or_cross_scope_ids() {
        let permit = OperationAdmission {
            session: "r".into(),
            branch: "b".into(),
            dataset: "d".into(),
            head: json!({"event_sequence":1}),
            prefix_sha256: "hash".into(),
            admitted: HashMap::from([("fresh".into(), true), ("used".into(), false)]),
        };
        assert!(
            permit
                .ensure_prefix(&json!({"event_sequence":1}), "hash")
                .is_ok()
        );
        assert!(
            permit
                .ensure_prefix(&json!({"event_sequence":2}), "hash")
                .is_err()
        );
        assert!(
            permit
                .ensure_prefix(&json!({"event_sequence":1}), "different")
                .is_err()
        );
        assert!(permit.ensure_fresh("r", "b", "d", "fresh").is_ok());
        for args in [
            ("x", "b", "d", "fresh"),
            ("r", "x", "d", "fresh"),
            ("r", "b", "x", "fresh"),
            ("r", "b", "d", "unknown"),
            ("r", "b", "d", "used"),
        ] {
            assert!(permit.ensure_fresh(args.0, args.1, args.2, args.3).is_err());
        }
    }
    #[test]
    fn consumed_source_ids_are_deduplicated_and_queue_reserves_zero_event_revision() {
        let ids = operation_ids(&json!({"event_sequence":3,"pending_market_order":{"operation_id":"pending"},"position":{"source_operation_id":"open"}}),&[
            json!({"sequence":1,"details":{"operation_id":"open"}}),
            json!({"sequence":2,"details":{"operation_id":"open","command_operation_id":"close"}}),
        ]).unwrap();
        assert_eq!(
            ids,
            BTreeMap::from([
                ("open".into(), 1),
                ("close".into(), 2),
                ("pending".into(), 3)
            ])
        );
    }
    #[test]
    fn revision_scope_rejects_overflow_and_zero() {
        assert!(revision(0).is_err());
        assert!(revision(i64::MAX).is_err());
        assert_eq!(revision(1).unwrap(), 1);
    }
}
