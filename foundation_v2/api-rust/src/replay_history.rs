//! Read-only forward history transport; cache admission validates a complete immutable revision.
use super::*;
use std::{collections::VecDeque, sync::Mutex};

const MAX_BYTES: usize = 96 * 1024 * 1024;
const MAX_ENTRIES: usize = 3;
type Key = (String, String, i64);

struct Entry { key: Key, record: Arc<Value>, bytes: usize }
#[derive(Default)]
pub struct HistoryCache(Mutex<VecDeque<Entry>>);

// Conservative retained JSON allocation estimate, including map nodes. This is
// a cache budget, not a bound on total request/process memory.
fn allocated(value: &Value) -> usize {
    std::mem::size_of::<Value>() + match value {
        Value::String(s) => s.capacity(),
        Value::Array(a) => a.capacity() * std::mem::size_of::<Value>() + a.iter().map(allocated).sum::<usize>(),
        Value::Object(o) => o.iter().map(|(k,v)| k.capacity() + 96 + allocated(v)).sum(),
        _ => 0,
    }
}
impl HistoryCache {
    fn get(&self, key: &Key) -> Option<Arc<Value>> {
        let mut entries = self.0.lock().ok()?;
        let index = entries.iter().position(|e| &e.key == key)?;
        let entry = entries.remove(index)?;
        let record = entry.record.clone();
        entries.push_back(entry);
        Some(record)
    }
    fn insert(&self, key: Key, record: Arc<Value>) {
        let bytes = allocated(&record);
        if bytes > MAX_BYTES { return; }
        let Ok(mut entries) = self.0.lock() else { return; };
        entries.retain(|e| e.key.0 != key.0 || e.key.1 != key.1);
        while entries.len() >= MAX_ENTRIES || entries.iter().map(|e|e.bytes).sum::<usize>() + bytes > MAX_BYTES {
            entries.pop_front();
        }
        entries.push_back(Entry { key, record, bytes });
    }
}

pub(super) fn eligible(p: &Value) -> bool {
    let eligible = |e: &Value| bar_execution(e) && (e.is_null() || e["phase_index"] == 1);
    eligible(&p["execution"]) && p["asset_states"].as_object().is_none_or(|assets|
        assets.values().all(|a| eligible(&a["execution"])))
}
fn ledger_paths(p: &Value) -> Vec<String> {
    let mut paths = vec!["/execution".to_owned(), "/portfolio_execution".to_owned()];
    if let Some(assets) = p["asset_states"].as_object() {
        paths.extend(assets.keys().map(|id| format!("/asset_states/{}/execution", id.replace('~',"~0").replace('/',"~1"))));
    }
    paths.retain(|path| p.pointer(path).is_some_and(|v| v.is_object() && v["event_sequence"].is_i64()));
    paths
}

fn without(value: &Value, keys: &[&str]) -> Value {
    Value::Object(value.as_object().unwrap().iter().filter(|(key,_)| !keys.contains(&key.as_str()))
        .map(|(k,v)|(k.clone(),v.clone())).collect())
}

fn local_head(source: &Value, cursor: i64) -> Result<Value,ApiError> {
    if source.is_null() { return Ok(Value::Null); }
    let mut head = crate::replay_core::reconstruct_validated(source,cursor).map_err(bad)?;
    let end = integer(&head,"event_sequence")? as usize;
    // Portfolio projection needs closed-trade cursors and the last coverage
    // observation; phase changes use the full reader until separately promoted.
    let events = source["ledger"].as_array().ok_or_else(||internal("history ledger missing"))?;
    let prefix = &events[..end];
    let coverage = prefix.iter().rposition(|e|e["details"].get("intrabar_equity_coverage").is_some());
    head["ledger"] = json!(prefix.iter().enumerate().filter(|(i,e)|Some(*i)==coverage ||
        matches!(e["kind"].as_str(),Some("manual_close"|"protective_fill"))).map(|(_,e)|e).collect::<Vec<_>>());
    Ok(head)
}

async fn project(
    tx: &Transaction<'_>, state: &AppState, workspace: &str, cached: &Value, cursor: i64,
) -> Result<Value,ApiError> {
    let original = &cached["payload"];
    let canonical = integer(original,"cursor_index")?;
    let mut record = without(cached,&["payload"]);
    let mut p = without(original,&["execution","asset_states","portfolio_execution"]);
    let m = snapshot_manifest(tx,workspace,text(original,"dataset_id")?).await?;
    let multi = original["asset_states"].is_object();
    if multi {
        let clock = integer(&times(state,&m,cursor,None).await?,"index_utc")? + integer(&m,"timeframe_seconds")?;
        let mut assets = Map::new();
        for (id,asset) in original["asset_states"].as_object().unwrap() {
            let am = snapshot_manifest(tx,workspace,id).await?;
            let target = if cursor == canonical { integer(asset,"cursor_index")? } else {
                integer(&times(state,&am,0,Some(clock-integer(&am,"timeframe_seconds")?)).await?,"cursor_index")?
            };
            let source = &asset["execution"];
            if !source.is_null() && source["ledger"].as_array().and_then(|events|events.first())
                .and_then(|e|e["cursor_index"].as_i64()).is_some_and(|first|first>target) {
                return Err(bad("history initialization cutoff requires full replay view"));
            }
            assets.insert(id.clone(),json!({"cursor_index":target,"execution":local_head(source,target)?}));
        }
        p["asset_states"] = Value::Object(assets);
        if cursor != canonical { p["replay_clock_utc"] = json!(clock); }
        let portfolio = &original["portfolio_execution"];
        p["portfolio_execution"] = if cursor == canonical || portfolio["event_sequence"] == 0 {
            without(portfolio,&["ledger"])
        } else { crate::replay_portfolio::checkpoint_head(portfolio,&p,clock).map_err(bad)? };
        let active = text(&p,"dataset_id")?.to_owned();
        p["execution"] = p["asset_states"][&active]["execution"].clone();
        p["cursor_index"] = json!(cursor);
        if cursor != canonical {
            record["canonical_execution_event_sequence"] = Value::Null;
            record["portfolio_trade_cursors"] = portfolio_trade_cursors(tx,state,workspace,&p,&m).await?;
        }
    } else {
        if original.get("execution").is_some() { p["execution"] = local_head(&original["execution"],cursor)?; }
        for key in ["asset_states","portfolio_execution"] {
            if let Some(value) = original.get(key) { p[key] = value.clone(); }
        }
        if !p["execution"].is_null() {
            p["cursor_index"] = json!(cursor);
            if cursor != canonical { record["canonical_execution_event_sequence"] = original["execution"]["event_sequence"].clone(); }
        }
    }
    for path in ledger_paths(&p) { p.pointer_mut(&path).unwrap().as_object_mut().unwrap().remove("ledger"); }
    record["payload"] = p;
    let q = HashMap::from([("cursor_index".to_owned(),cursor.to_string())]);
    let mut result = view_inner(tx,state,workspace,record,&q,true,Some(canonical)).await?;
    if multi {
        // The full API reports whether the canonical portfolio clock can move,
        // even while the selected chart is showing an earlier checkpoint.
        result["has_future_rows"] = json!(integer(original,"replay_clock_utc")? < integer(original,"replay_end_utc")?);
    }
    Ok(result)
}
fn sequences(p: &Value) -> Value {
    Value::Object(ledger_paths(p).into_iter().map(|path| {
        let sequence = p.pointer(&path).unwrap()["event_sequence"].clone();
        (path, sequence)
    }).collect())
}

pub(super) async fn read(
    tx: &Transaction<'_>, state: &AppState, workspace: &str, id: &str, q: &HashMap<String,String>,
) -> Result<Value, ApiError> {
    let expected = qint(q,"expected_revision")?.ok_or_else(||bad("history expected_revision is required"))?;
    let base = qint(q,"base_cursor_index")?.ok_or_else(||bad("history base_cursor_index is required"))?;
    let cutoff = qint(q,"base_cutoff_timestamp")?.ok_or_else(||bad("history base_cutoff_timestamp is required"))?;
    let base_sequences: Value = q.get("base_event_sequences").and_then(|s|serde_json::from_str(s).ok())
        .filter(Value::is_object).ok_or_else(||bad("history base_event_sequences is required"))?;
    if base < 0 || qint(q,"cursor_index")? != Some(base) || q.contains_key("cutoff_timestamp") {
        return Err(bad("history reads must advance from their base cursor"));
    }
    // Always consult the scoped current head and deletion marker, even on a warm
    // cache hit. A queue-only revision must invalidate history just like a fill.
    let row = tx.query_opt("SELECT r.current_revision,v.deleted FROM workspace_records r JOIN workspace_record_revisions v ON v.workspace_id=r.workspace_id AND v.kind=r.kind AND v.record_id=r.record_id AND v.revision=r.current_revision WHERE r.workspace_id=$1 AND r.kind='replay' AND r.record_id=$2", &[&workspace,&id])
        .await.map_err(|_|ApiError::database())?.ok_or_else(||ApiError::detail(StatusCode::NOT_FOUND,"replay_not_found"))?;
    if row.get::<_,bool>("deleted") { return Err(ApiError::detail(StatusCode::NOT_FOUND,"replay_not_found")); }
    let revision = i64::from(row.get::<_,i32>("current_revision"));
    if revision != expected { return Err(conflict("history revision changed; reload replay")); }
    let key = (workspace.to_owned(),id.to_owned(),revision);
    let cached = if let Some(record) = state.replay_history.get(&key) { record } else {
        let mut record = load_record(tx,workspace,id,false).await?;
        if integer(&record,"revision")? != revision { return Err(conflict("history revision changed; reload replay")); }
        if !eligible(&record["payload"]) { return view(tx,state,workspace,record,q).await; }
        ensure_portfolio(tx,workspace,id,&mut record["payload"]).await?;
        let record = tokio::task::spawn_blocking(move || {
            crate::replay_portfolio::update(&mut record["payload"]).map_err(bad)?;
            if !record["payload"]["asset_states"].is_object() && !record["payload"]["execution"].is_null() {
                crate::replay_core::validate(&record["payload"]["execution"]).map_err(bad)?;
            }
            for path in ledger_paths(&record["payload"]) {
                let events = record["payload"].pointer(&path).unwrap()["ledger"].as_array().ok_or_else(||internal("history ledger missing"))?;
                if events.windows(2).any(|pair| pair[0]["cursor_index"].as_i64()>pair[1]["cursor_index"].as_i64()) {
                    return Err(internal("history cursor order is invalid"));
                }
            }
            Ok::<_,ApiError>(Arc::new(record))
        }).await.map_err(|_|internal("history_validation_failed"))??;
        state.replay_history.insert(key,record.clone());
        record
    };
    let canonical = integer(&cached["payload"],"cursor_index")?;
    if base >= canonical { return view(tx,state,workspace,(*cached).clone(),q).await; }
    let previous = match project(tx,state,workspace,&cached,base).await {
        Ok(value) => value,
        Err(_) => return view(tx,state,workspace,(*cached).clone(),q).await,
    };
    if previous["cutoff_timestamp"] != cutoff || sequences(&previous["payload"]) != base_sequences {
        return Err(conflict("history base checkpoint changed; reload replay"));
    }
    let m = snapshot_manifest(tx,workspace,text(&cached["payload"],"dataset_id")?).await?;
    let cursor = step_window(state,&m,base,1,qint(q,"advance_interval_seconds")?,canonical).await?.1;
    let mut result = match project(tx,state,workspace,&cached,cursor).await {
        Ok(value) => value,
        Err(_) => return view(tx,state,workspace,(*cached).clone(),q).await,
    };
    let cursor = integer(&result,"view_cursor_index")?;
    let paths = ledger_paths(&result["payload"]);
    if cursor <= base || cursor-base > 1000 || paths != ledger_paths(&previous["payload"]) {
        return view(tx,state,workspace,(*cached).clone(),q).await;
    }
    let mut deltas = Vec::new();
    for path in paths {
        let before = previous["payload"].pointer(&path).unwrap();
        let snapshot = result["payload"].pointer(&path).unwrap();
        let ledger = cached["payload"].pointer(&path).unwrap()["ledger"].as_array().unwrap();
        let count = integer(before,"event_sequence")? as usize;
        let end = integer(snapshot,"event_sequence")? as usize;
        if end < count || end > ledger.len() || end-count > 3000 {
            return view(tx,state,workspace,(*cached).clone(),q).await;
        }
        deltas.push(json!({"path":path,"base_event_sequence":count,"appended_events":&ledger[count..end]}));
    }
    for delta in &deltas {
        result["payload"].pointer_mut(delta["path"].as_str().unwrap()).unwrap().as_object_mut().unwrap().remove("ledger");
    }
    let rows = result["visible_rows"].as_array().unwrap().iter()
        .filter(|row| row["timestamp"].as_i64().is_some_and(|time|time>cutoff)).cloned().collect::<Vec<_>>();
    if rows.len() as i64 != cursor-base { return Err(internal("history row suffix is incomplete")); }
    result.as_object_mut().unwrap().remove("visible_rows");
    result["schema_version"] = json!("replay-history-v1");
    result["workspace_id"] = json!(workspace);
    result["base_revision"] = json!(revision);
    result["base_cursor_index"] = json!(base);
    result["base_cutoff_timestamp"] = json!(cutoff);
    result["ledger_deltas"] = json!(deltas);
    result["appended_rows"] = json!(rows);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(workspace: &str, id: &str, revision: i64) -> Key {
        (workspace.into(), id.into(), revision)
    }
    #[test]
    fn cache_is_scoped_to_workspace_and_exact_revision_and_evicts_superseded_heads() {
        let cache = HistoryCache::default();
        cache.insert(key("a","session",1),Arc::new(json!({"tenant":"a"})));
        cache.insert(key("b","session",1),Arc::new(json!({"tenant":"b"})));
        assert_eq!(cache.get(&key("a","session",1)).unwrap()["tenant"],"a");
        assert_eq!(cache.get(&key("b","session",1)).unwrap()["tenant"],"b");
        assert!(cache.get(&key("a","session",2)).is_none());
        cache.insert(key("a","session",2),Arc::new(json!({"tenant":"a","queued":true})));
        assert!(cache.get(&key("a","session",1)).is_none());
        assert!(cache.get(&key("b","session",1)).is_some());
    }
    #[test]
    fn least_recently_used_entries_are_evicted_and_budget_is_conservative() {
        let cache = HistoryCache::default();
        for id in ["one","two","three"] { cache.insert(key("a",id,1),Arc::new(json!({}))); }
        cache.get(&key("a","one",1));
        cache.insert(key("a","four",1),Arc::new(json!({})));
        assert!(cache.get(&key("a","two",1)).is_none());
        assert!(cache.get(&key("a","one",1)).is_some());
        let value = json!({"ledger":[{"balance":"100000","sequence":1}]});
        assert!(allocated(&value) > serde_json::to_vec(&value).unwrap().len());
    }
}
