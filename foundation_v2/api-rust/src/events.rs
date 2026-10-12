use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
    routing::get,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Arc, Mutex, atomic::Ordering},
    time::Duration,
};
use tokio::sync::{Semaphore, watch};

type Snapshot = Option<Result<Arc<Value>, &'static str>>;
pub struct EventHub {
    workspaces: Mutex<HashMap<String, watch::Sender<Snapshot>>>,
    connections: Arc<Semaphore>,
}
impl Default for EventHub {
    fn default() -> Self {
        Self {
            workspaces: Mutex::new(HashMap::new()),
            connections: Arc::new(Semaphore::new(64)),
        }
    }
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v2/events", get(events))
}

impl EventHub {
    fn subscribe(
        &self,
        state: Arc<AppState>,
        workspace: String,
    ) -> Result<watch::Receiver<Snapshot>, ApiError> {
        let mut hubs = self.workspaces.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(sender) = hubs.get(&workspace) {
            if sender.receiver_count() >= 8 {
                return Err(ApiError::detail(
                    StatusCode::TOO_MANY_REQUESTS,
                    "event_connection_limit",
                ));
            }
            return Ok(sender.subscribe());
        }
        let (sender, receiver) = watch::channel(None);
        hubs.insert(workspace.clone(), sender.clone());
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(2));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                if state.draining.load(Ordering::Acquire) {
                    sender.send_replace(Some(Err("server_draining")));
                    break;
                }
                if sender.receiver_count() == 0 {
                    // Subscription and removal share the lock: reconnect cannot lose its newly acquired poller.
                    let mut hubs = state
                        .event_hub
                        .workspaces
                        .lock()
                        .unwrap_or_else(|p| p.into_inner());
                    if sender.receiver_count() == 0 {
                        hubs.remove(&workspace);
                        break;
                    }
                }
                let snapshot = tokio::time::timeout(
                    state.config.pool_timeout + Duration::from_secs(2),
                    snapshot(&state, &workspace),
                )
                .await;
                let value = match snapshot {
                    Ok(Ok(value)) => Ok(Arc::new(value)),
                    _ => Err("event_snapshot_unavailable"),
                };
                let previous = sender.borrow().clone();
                if previous.as_ref() != Some(&value) {
                    sender.send_replace(Some(value));
                }
            }
        });
        Ok(receiver)
    }
}

async fn events(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let permit = state
        .event_hub
        .connections
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::detail(StatusCode::TOO_MANY_REQUESTS, "event_connection_limit"))?;
    let mut receiver = state
        .event_hub
        .subscribe(state.clone(), scope.workspace_id.clone())?;
    // A reconnect is a full current snapshot, not replay of volatile process-local event IDs.
    if receiver.borrow().is_none() {
        tokio::time::timeout(
            state.config.pool_timeout + Duration::from_secs(3),
            receiver.changed(),
        )
        .await
        .map_err(|_| ApiError::database())?
        .map_err(|_| ApiError::database())?;
    }
    if receiver.borrow().as_ref().is_some_and(Result::is_err) {
        return Err(ApiError::database());
    }
    let stream = async_stream::stream! {
        let _permit=permit;
        let deadline=tokio::time::Instant::now()+Duration::from_secs(600);
        loop {
            let value=receiver.borrow_and_update().clone();
            match value {
                Some(Ok(value)) => {
                    let revision=value["revision"].as_str().unwrap_or("");
                    yield Ok(Event::default().event("snapshot").id(revision).data(value.to_string()));
                },
                Some(Err(error)) => { yield Ok(Event::default().event("resync").data(json!({"reason":error}).to_string())); break; },
                None => {}
            }
            tokio::select! {
                changed=receiver.changed()=> { if changed.is_err() { break; } },
                _=tokio::time::sleep_until(deadline)=> { yield Ok(Event::default().event("resync").data("{\"reason\":\"reconnect_required\"}")); break; }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}

async fn snapshot(state: &AppState, workspace: &str) -> Result<Value, ApiError> {
    let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
    // Bounded public projections only: no commands' payloads/results, research protocols, or lease tokens.
    let research=conn.query("SELECT status,count(*)::bigint AS n,max(updated_at_utc) AS updated FROM research_jobs WHERE workspace_id=$1 GROUP BY status",&[&workspace]).await.map_err(|_|ApiError::database())?;
    let recent=conn.query("SELECT job_id,status,updated_at_utc FROM research_jobs WHERE workspace_id=$1 ORDER BY updated_at_utc DESC,job_id DESC LIMIT 20",&[&workspace]).await.map_err(|_|ApiError::database())?;
    let downloads=conn.query("(SELECT provider,CASE WHEN octet_length(snapshot::text)<=6144 THEN snapshot ELSE NULL END AS snapshot FROM download_job_snapshots WHERE workspace_id=$1 AND provider='QuantDataManager' ORDER BY created_at_utc DESC,job_id DESC LIMIT 20) UNION ALL (SELECT provider,CASE WHEN octet_length(snapshot::text)<=6144 THEN snapshot ELSE NULL END AS snapshot FROM download_job_snapshots WHERE workspace_id=$1 AND provider='Dukascopy' ORDER BY created_at_utc DESC,job_id DESC LIMIT 20)",&[&workspace]).await.map_err(|_|ApiError::database())?;
    let commands=conn.query("SELECT status,count(*)::bigint AS n,max(updated_at_utc)::text AS updated FROM api_commands WHERE workspace_id=$1 AND expires_at_utc>CURRENT_TIMESTAMP GROUP BY status",&[&workspace]).await.map_err(|_|ApiError::database())?;
    let mut value = empty_snapshot(workspace);
    value["resources"] = resource_revisions(&conn, workspace).await?;
    for row in research {
        let status = row.get::<_, String>("status");
        value["research"]["status_counts"][&status] = json!(row.get::<_, i64>("n"));
        value["research"]["updated_by_status"][status] =
            json!(row.get::<_, Option<String>>("updated"));
    }
    value["research"]["recent_jobs"]=json!(recent.iter().map(|row|json!({"job_id":row.get::<_,String>("job_id"),"status":row.get::<_,String>("status"),"updated_at_utc":row.get::<_,String>("updated_at_utc")})).collect::<Vec<_>>());
    for row in downloads {
        let provider: String = row.get("provider");
        let snapshot: Option<Value> = row.get("snapshot");
        let snapshot = snapshot.ok_or_else(|| {
            ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "event_snapshot_too_large")
        })?;
        if let Some(key) = provider_key(&provider) {
            value["downloads"][key]["jobs"]
                .as_array_mut()
                .expect("known provider")
                .push(snapshot);
        }
    }
    for row in commands {
        let status = row.get::<_, String>("status");
        value["commands"]["status_counts"][&status] = json!(row.get::<_, i64>("n"));
        value["commands"]["updated_by_status"][status] =
            json!(row.get::<_, Option<String>>("updated"));
    }
    seal_snapshot(value)
}

// Fixed-size results across the complete workspace, rather than a recent-ID window:
// revisions outside the visible page and tombstones must invalidate reports too.
// The scan is O(metadata rows), not constant work, and never reads replay payloads.
const RESOURCE_REVISIONS_SQL: &str = r#"
WITH session_marks AS (
    SELECT jsonb_build_array('session',r.record_id,r.current_revision,v.deleted)::text AS token,
           NOT v.deleted AS visible
    FROM workspace_records r
    JOIN LATERAL (
        SELECT deleted FROM workspace_record_revisions
        WHERE workspace_id=r.workspace_id AND kind=r.kind
          AND record_id=r.record_id AND revision=r.current_revision
        LIMIT 1
    ) v ON true
    WHERE r.workspace_id=$1 AND r.kind='replay'
    UNION ALL
    SELECT jsonb_build_array('activity',session_id,event_id,started_at_utc,ended_at_utc)::text,
           false
    FROM replay_activity_intervals WHERE workspace_id=$1
)
SELECT 'sessions' AS resource,count(*) FILTER (WHERE visible)::bigint AS n,count(*)::bigint AS marks,
       COALESCE(sum(hashtextextended(token,0)::numeric),0)::text AS checksum_a,
       COALESCE(sum(hashtextextended(token,1)::numeric),0)::text AS checksum_b
FROM session_marks
UNION ALL
SELECT 'datasets',count(*)::bigint,count(*)::bigint,
       COALESCE(sum(hashtextextended(token,0)::numeric),0)::text,
       COALESCE(sum(hashtextextended(token,1)::numeric),0)::text
FROM (
    SELECT jsonb_build_array(dataset_id,artifact_sha256,md5(manifest_json::text))::text AS token
    FROM datasets WHERE workspace_id=$1
) dataset_marks
"#;

async fn resource_revisions(
    conn: &tokio_postgres::Client,
    workspace: &str,
) -> Result<Value, ApiError> {
    let rows = conn
        .query(RESOURCE_REVISIONS_SQL, &[&workspace])
        .await
        .map_err(|_| ApiError::database())?;
    let mut resources = empty_resources(workspace);
    for row in rows {
        let resource: String = row.get("resource");
        resources[&resource] = resource_revision(
            workspace,
            &resource,
            row.get("n"),
            row.get("marks"),
            &row.get::<_, String>("checksum_a"),
            &row.get::<_, String>("checksum_b"),
        );
    }
    Ok(resources)
}

fn resource_revision(
    workspace: &str,
    resource: &str,
    count: i64,
    marks: i64,
    checksum_a: &str,
    checksum_b: &str,
) -> Value {
    // Opaque equality token, never an ordered event ID or an authorization proof.
    let stamp = serde_json::to_vec(&(workspace, resource, count, marks, checksum_a, checksum_b))
        .expect("scalar resource fingerprint");
    json!({"count":count,"revision":format!("{:x}",Sha256::digest(stamp))})
}

fn empty_resources(workspace: &str) -> Value {
    json!({
        "sessions":resource_revision(workspace,"sessions",0,0,"0","0"),
        "datasets":resource_revision(workspace,"datasets",0,0,"0","0")
    })
}

fn empty_snapshot(workspace: &str) -> Value {
    json!({"schema_version":"workspace-events-v1","workspace_id":workspace,
        "downloads":{"qdm":{"jobs":[]},"dukascopy":{"jobs":[]}},
        "research":{"status_counts":{},"updated_by_status":{},"recent_jobs":[]},"commands":{"status_counts":{},"updated_by_status":{}},
        "resources":empty_resources(workspace)})
}
fn provider_key(provider: &str) -> Option<&'static str> {
    match provider {
        "QuantDataManager" => Some("qdm"),
        "Dukascopy" => Some("dukascopy"),
        _ => None,
    }
}
fn seal_snapshot(mut value: Value) -> Result<Value, ApiError> {
    let bytes = serde_json::to_vec(&value).map_err(|_| ApiError::database())?;
    if bytes.len() > 256 * 1024 {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "event_snapshot_too_large",
        ));
    }
    value["revision"] = json!(format!("{:x}", Sha256::digest(bytes)));
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_snapshot_is_scoped_unknown_progress_stays_absent() {
        assert_eq!(provider_key("QuantDataManager"), Some("qdm"));
        assert_eq!(provider_key("Dukascopy"), Some("dukascopy"));
        let a = seal_snapshot(empty_snapshot("a")).unwrap();
        let b = seal_snapshot(empty_snapshot("b")).unwrap();
        assert_eq!(a["downloads"]["qdm"]["jobs"], json!([]));
        assert_eq!(a["research"]["recent_jobs"], json!([]));
        assert_eq!(a["resources"]["sessions"]["count"], 0);
        assert_eq!(a["resources"]["datasets"]["count"], 0);
        assert_ne!(
            a["resources"]["sessions"]["revision"],
            b["resources"]["sessions"]["revision"]
        );
        assert_ne!(a["revision"], b["revision"]);
        assert!(a.get("downloaded_bytes").is_none());
        assert_eq!(
            seal_snapshot(empty_snapshot("a")).unwrap()["revision"],
            a["revision"]
        );
    }
    #[test]
    fn resource_tokens_are_scoped_and_include_all_aggregate_marks() {
        let base = resource_revision("a", "sessions", 2, 3, "100", "200");
        for changed in [
            resource_revision("b", "sessions", 2, 3, "100", "200"),
            resource_revision("a", "datasets", 2, 3, "100", "200"),
            resource_revision("a", "sessions", 1, 3, "100", "200"),
            resource_revision("a", "sessions", 2, 4, "100", "200"),
            resource_revision("a", "sessions", 2, 3, "101", "200"),
            resource_revision("a", "sessions", 2, 3, "100", "201"),
        ] {
            assert_ne!(base["revision"], changed["revision"]);
        }
        assert_eq!(base.as_object().unwrap().len(), 2);
        assert_eq!(base["revision"].as_str().unwrap().len(), 64);
    }
    #[tokio::test]
    #[ignore = "owned disposable database from run_events_parity.py only"]
    async fn postgres_resource_metadata_scan_measurement() {
        fn assert_metadata_plan(value: &Value) {
            match value {
                Value::Object(node) => {
                    assert_ne!(node.get("Node Type"), Some(&json!("Sort")));
                    if node.get("Relation Name") == Some(&json!("workspace_record_revisions")) {
                        let condition = node["Index Cond"].as_str().unwrap();
                        assert!(condition.contains("record_id"));
                        assert!(condition.contains("revision"));
                    }
                    for child in node.values() {
                        assert_metadata_plan(child);
                    }
                }
                Value::Array(children) => {
                    for child in children {
                        assert_metadata_plan(child);
                    }
                }
                _ => {}
            }
        }
        let dsn = std::env::var("TW_V2_DATABASE_URL").unwrap();
        let (conn, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
            .await
            .unwrap();
        let connection = tokio::spawn(connection);
        let database: String = conn
            .query_one("SELECT current_database()", &[])
            .await
            .unwrap()
            .get(0);
        assert!(database.starts_with("events_parity_"), "refuse owner DB");
        conn.batch_execute("BEGIN; INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('signal-benchmark','2026-10-01T00:00:00Z')").await.unwrap();
        let mut measurements = Vec::new();
        let mut inserted = 0_i32;
        for target in [1000_i32, 10000] {
            conn.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) SELECT 'signal-benchmark','replay',n::text,1,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z' FROM generate_series($1::int,$2::int) n",&[&(inserted+1),&target]).await.unwrap();
            conn.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) SELECT 'signal-benchmark','replay',n::text,1,'{}','2026-10-01T00:00:00Z' FROM generate_series($1::int,$2::int) n",&[&(inserted+1),&target]).await.unwrap();
            inserted = target;
            let resources = resource_revisions(&conn, "signal-benchmark").await.unwrap();
            assert_eq!(resources["sessions"]["count"], target);
            assert!(resources.to_string().len() < 256);
            let plan: Value = conn
                .query_one(
                    &format!("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {RESOURCE_REVISIONS_SQL}"),
                    &[&"signal-benchmark"],
                )
                .await
                .unwrap()
                .get(0);
            assert_metadata_plan(&plan);
            measurements.push(json!({"metadata_rows":target,"resource_bytes":resources.to_string().len(),"plan":plan}));
        }
        conn.batch_execute("ROLLBACK").await.unwrap();
        println!("RESOURCE_SCAN_MEASUREMENTS={}", json!(measurements));
        drop(conn);
        connection.await.unwrap().unwrap();
    }
    #[tokio::test]
    async fn latest_value_is_bounded_and_disconnect_releases_permit() {
        let hub = EventHub::default();
        let permit = hub.connections.clone().try_acquire_owned().unwrap();
        let (sender, mut receiver) = watch::channel::<Snapshot>(None);
        sender.send_replace(Some(Ok(Arc::new(
            seal_snapshot(empty_snapshot("a")).unwrap(),
        ))));
        for i in 0..100 {
            let mut value = empty_snapshot("a");
            value["test"] = json!(i);
            sender.send_replace(Some(Ok(Arc::new(seal_snapshot(value).unwrap()))));
        }
        assert_eq!(
            receiver
                .borrow_and_update()
                .as_ref()
                .unwrap()
                .as_ref()
                .unwrap()["test"],
            99
        );
        drop(receiver);
        assert_eq!(sender.receiver_count(), 0);
        drop(permit);
        assert_eq!(hub.connections.available_permits(), 64);
        let mut huge = empty_snapshot("a");
        huge["test"] = json!("x".repeat(300 * 1024));
        assert!(seal_snapshot(huge).is_err());
    }
}
