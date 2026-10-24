//! Shared, bounded market snapshots. Streaming never grants execution authority.
use super::*;
use axum::response::{
    Sse,
    sse::{Event, KeepAlive},
};
use std::{
    convert::Infallible,
    sync::{Mutex as StdMutex, atomic::Ordering},
    time::Instant,
};
use tokio::sync::{Semaphore, watch};

type Feed = Option<Arc<Value>>;
pub(crate) struct MarketHub {
    feeds: StdMutex<HashMap<String, watch::Sender<Feed>>>,
    connections: Arc<Semaphore>,
}
impl Default for MarketHub {
    fn default() -> Self {
        Self {
            feeds: StdMutex::new(HashMap::new()),
            connections: Arc::new(Semaphore::new(32)),
        }
    }
}

// ISO UTC timestamps are ordered by the SDK. Replace the tail, retain bounded history.
fn merge_tail(previous: &Value, mut next: Value) -> Value {
    if previous["status"] != "ready"
        || next["status"] != "ready"
        || previous["account"]["login"] != next["account"]["login"]
        || previous["account"]["server"] != next["account"]["server"]
        || previous["symbol"] != next["symbol"]
    {
        return next;
    }
    if let (Some(old), Some(tail)) = (previous["bars"].as_array(), next["bars"].as_array()) {
        let mut bars = std::collections::BTreeMap::new();
        for bar in old.iter().chain(tail) {
            if let Some(time) = bar["timestamp"].as_str() {
                bars.insert(time.to_owned(), bar.clone());
            }
        }
        let skip = bars.len().saturating_sub(300);
        next["bars"] = json!(bars.into_values().skip(skip).collect::<Vec<_>>());
    }
    next
}

fn delta(previous: &Value, next: &Value) -> Value {
    let mut fields = serde_json::Map::new();
    for (key, value) in next.as_object().into_iter().flatten() {
        if previous.get(key) == Some(value) {
            continue;
        }
        if key == "bars" && previous["status"] == "ready" && next["status"] == "ready" {
            let old: HashMap<_, _> = previous["bars"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|bar| bar["timestamp"].as_str().map(|time| (time, bar)))
                .collect();
            let changes: Vec<_> = value
                .as_array()
                .into_iter()
                .flatten()
                .filter(|bar| {
                    old.get(bar["timestamp"].as_str().unwrap_or("")).copied() != Some(*bar)
                })
                .cloned()
                .collect();
            // An authoritative full read can remove history; then send a replacement.
            let times: std::collections::HashSet<_> = value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|bar| bar["timestamp"].as_str())
                .collect();
            let removes = old.keys().any(|time| !times.contains(time));
            if removes {
                fields.insert("replace_bars".into(), json!(true));
                fields.insert(key.clone(), value.clone());
            } else {
                fields.insert(key.clone(), json!(changes));
            }
        } else {
            fields.insert(key.clone(), value.clone());
        }
    }
    Value::Object(fields)
}

impl MarketHub {
    fn subscribe(
        &self,
        state: Arc<AppState>,
        scope: Workspace,
        query: HashMap<String, String>,
    ) -> Result<watch::Receiver<Feed>, ApiError> {
        let key = serde_json::to_string(&(
            &scope.workspace_id,
            &scope.subject,
            &query["connection_id"],
            &query["symbol"],
            &query["timeframe"],
        ))
        .unwrap();
        let mut feeds = self.feeds.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(sender) = feeds.get(&key) {
            if sender.receiver_count() >= 8 {
                return Err(error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "market_connection_limit",
                ));
            }
            return Ok(sender.subscribe());
        }
        if feeds.len() >= 8 {
            return Err(error(StatusCode::TOO_MANY_REQUESTS, "market_feed_limit"));
        }
        let (sender, receiver) = watch::channel(None);
        feeds.insert(key.clone(), sender.clone());
        tokio::spawn(async move {
            let mut full_at = Instant::now() - Duration::from_secs(10);
            let mut previous = json!(null);
            loop {
                if state.draining.load(Ordering::Acquire) {
                    break;
                }
                {
                    let mut feeds = state
                        .market_hub
                        .feeds
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    if sender.receiver_count() == 0 {
                        feeds.remove(&key);
                        return;
                    }
                }
                let started = Instant::now();
                let full =
                    previous["status"] != "ready" || full_at.elapsed() >= Duration::from_secs(5);
                let result =
                    read_snapshot(&state, &scope, &query, if full { 300 } else { 3 }).await;
                let next = match result {
                    Ok(value) => {
                        if full {
                            full_at = Instant::now();
                            value
                        } else {
                            merge_tail(&previous, value)
                        }
                    }
                    Err(ApiError(status, value)) => read_failure(
                        status,
                        value["detail"].as_str().unwrap_or("demo_response_invalid"),
                    ),
                };
                if previous != next {
                    sender.send_replace(Some(Arc::new(next.clone())));
                }
                let delay = if next["status"] == "ready" {
                    Duration::from_millis(500)
                } else {
                    Duration::from_secs(2)
                };
                previous = next;
                // No overlapping SDK calls or catch-up bursts after slow/cold reads.
                tokio::time::sleep(
                    delay
                        .saturating_sub(started.elapsed())
                        .max(Duration::from_millis(50)),
                )
                .await;
            }
            let mut feeds = state
                .market_hub
                .feeds
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            feeds.remove(&key);
        });
        Ok(receiver)
    }
}

pub(super) async fn events(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    headers: HeaderMap,
    Query(input): Query<HashMap<String, String>>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    local_origin(&headers)?;
    let id = input
        .get("connection_id")
        .and_then(|v| Uuid::parse_str(v).ok())
        .ok_or_else(|| {
            error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "mt5_connection_id_invalid",
            )
        })?;
    let symbol = input.get("symbol").map(String::as_str).unwrap_or("");
    let timeframe = input.get("timeframe").map(String::as_str).unwrap_or("M1");
    if (!symbol.is_empty() && !plain(symbol, 64))
        || !matches!(timeframe, "M1" | "M5" | "M15" | "H1" | "H4" | "D1")
    {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "demo_timeframe_unsupported",
        ));
    }
    let permit = state
        .market_hub
        .connections
        .clone()
        .try_acquire_owned()
        .map_err(|_| error(StatusCode::TOO_MANY_REQUESTS, "market_connection_limit"))?;
    let query = HashMap::from([
        ("connection_id".into(), id.to_string()),
        ("symbol".into(), symbol.into()),
        ("timeframe".into(), timeframe.into()),
    ]);
    let mut receiver = state.market_hub.subscribe(state.clone(), scope, query)?;
    let stream = async_stream::stream! {
        let _permit = permit;
        let deadline = tokio::time::Instant::now()+Duration::from_secs(600);
        let mut previous: Option<Arc<Value>> = None;
        loop {
            let next = receiver.borrow_and_update().clone();
            if let Some(value) = next {
                let (kind,data) = match &previous {
                    Some(old) if old["status"] == "ready" && value["status"] == "ready" => ("update",delta(old,&value)),
                    _ => ("snapshot",(*value).clone()),
                };
                if data.as_object().is_some_and(|fields|!fields.is_empty()) {
                    yield Ok(Event::default().event(kind).data(data.to_string()));
                }
                previous=Some(value);
            }
            tokio::select! {
                changed=receiver.changed()=>if changed.is_err(){break;},
                _=tokio::time::sleep_until(deadline)=>break,
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(2))
            .text("market"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value(bars: Value) -> Value {
        json!({"status":"ready","account":{"login":"1","server":"demo"},"symbol":"EURUSD","bars":bars})
    }
    #[test]
    fn tail_updates_and_historical_corrections_are_lossless() {
        let old = value(json!([{"timestamp":"a","close":1},{"timestamp":"b","close":2}]));
        let next = merge_tail(
            &old,
            value(json!([{"timestamp":"b","close":3},{"timestamp":"c","close":4}])),
        );
        assert_eq!(next["bars"].as_array().unwrap().len(), 3);
        assert_eq!(
            delta(&old, &next)["bars"],
            json!([{"timestamp":"b","close":3},{"timestamp":"c","close":4}])
        );
        let replaced = value(json!([{"timestamp":"c","close":4}]));
        assert_eq!(delta(&next, &replaced)["replace_bars"], true);
        let locked = json!({"status":"locked","bars":[]});
        assert_eq!(merge_tail(&next, locked.clone()), locked);
    }
    #[test]
    fn revoked_authority_clears_visual_cache_but_temporary_outage_does_not() {
        for reason in [
            "mt5_connection_revoked",
            "mt5_connection_not_available",
            "mt5_permissions_unverified",
        ] {
            assert_eq!(
                read_failure(StatusCode::LOCKED, reason)["access_denied"],
                true
            );
        }
        assert_eq!(
            read_failure(StatusCode::LOCKED, "mt5_connection_not_ready")["access_denied"],
            false
        );
        assert_eq!(
            read_failure(StatusCode::UNAUTHORIZED, "unauthorized")["access_denied"],
            true
        );
    }
    #[tokio::test]
    async fn subscribers_share_only_the_same_scope_and_idle_feeds_are_removed() {
        let state = crate::tests::fixture(100);
        let scope = Workspace {
            workspace_id: "tenant-a".into(),
            subject: "fixture".into(),
        };
        let query = HashMap::from([
            ("connection_id".into(), Uuid::new_v4().to_string()),
            ("symbol".into(), "EURUSD".into()),
            ("timeframe".into(), "M1".into()),
        ]);
        let first = state
            .market_hub
            .subscribe(state.clone(), scope.clone(), query.clone())
            .unwrap();
        let second = state
            .market_hub
            .subscribe(state.clone(), scope.clone(), query.clone())
            .unwrap();
        assert_eq!(state.market_hub.feeds.lock().unwrap().len(), 1);
        let mut receivers = vec![first, second];
        for _ in 0..6 {
            receivers.push(
                state
                    .market_hub
                    .subscribe(state.clone(), scope.clone(), query.clone())
                    .unwrap(),
            );
        }
        assert!(
            state
                .market_hub
                .subscribe(state.clone(), scope.clone(), query.clone())
                .is_err()
        );
        let other = state
            .market_hub
            .subscribe(
                state.clone(),
                Workspace {
                    workspace_id: "tenant-b".into(),
                    ..scope
                },
                query,
            )
            .unwrap();
        assert_eq!(state.market_hub.feeds.lock().unwrap().len(), 2);
        drop(receivers);
        drop(other);
        // The runtime has not yielded, so no SDK or database read can start.
        tokio::task::yield_now().await;
        assert!(state.market_hub.feeds.lock().unwrap().is_empty());
    }
}
