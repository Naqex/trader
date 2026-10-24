use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};
use tower::ServiceExt;
use trading_workspace_api::{catalog, config::Config, events, jobs, state::AppState};

struct Wire {
    status: u16,
    reader: BufReader<TcpStream>,
    pending: String,
}
impl Wire {
    fn connect(address: SocketAddr, workspace: Option<&str>) -> Self {
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        let scope = workspace
            .map(|v| format!("X-Workspace-Id: {v}\r\n"))
            .unwrap_or_default();
        write!(socket,"GET /api/v2/events HTTP/1.1\r\nHost: {address}\r\n{scope}Accept: text/event-stream\r\n\r\n").unwrap();
        let mut reader = BufReader::new(socket);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let status = line.split_whitespace().nth(1).unwrap().parse().unwrap();
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        Self {
            status,
            reader,
            pending: String::new(),
        }
    }
    fn snapshot(&mut self) -> Value {
        assert_eq!(self.status, 200);
        loop {
            if let Some(end) = self.pending.find("\n\n") {
                let frame = self.pending[..end].to_owned();
                self.pending = self.pending[end + 2..].to_owned();
                if frame.lines().any(|line| line == "event: snapshot") {
                    return serde_json::from_str(
                        frame
                            .lines()
                            .find_map(|line| line.strip_prefix("data: "))
                            .unwrap(),
                    )
                    .unwrap();
                }
                continue;
            }
            let mut size = String::new();
            self.reader.read_line(&mut size).unwrap();
            let size = usize::from_str_radix(size.trim().split(';').next().unwrap(), 16).unwrap();
            assert!(size > 0);
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut crlf = [0; 2];
            self.reader.read_exact(&mut crlf).unwrap();
            assert_eq!(&crlf, b"\r\n");
            self.pending.push_str(std::str::from_utf8(&bytes).unwrap());
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires owned fixture PostgreSQL from run_events_parity.py"]
async fn native_jobs_and_sse_durable_http_contract() {
    let golden: Value =
        serde_json::from_slice(&std::fs::read(std::env::var("TW_EVENTS_GOLDEN").unwrap()).unwrap())
            .unwrap();
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let conn = state.pool.get().await.unwrap();
    let database: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("events_parity_"),
        "refuse non-fixture DB"
    );
    let config = state.config.clone();
    let digest: String = conn
        .query_one(
            "SELECT sha256 FROM tw_schema_migrations WHERE version='0004_download_jobs.sql'",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    conn.execute(
        "UPDATE tw_schema_migrations SET sha256='tampered' WHERE version='0004_download_jobs.sql'",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("checksum mismatch")
    );
    conn.execute(
        "DELETE FROM tw_schema_migrations WHERE version='0004_download_jobs.sql'",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("migration missing")
    );
    conn.execute(
        "INSERT INTO tw_schema_migrations(version,sha256) VALUES('0004_download_jobs.sql',$1)",
        &[&digest],
    )
    .await
    .unwrap();
    conn.execute(
        "INSERT INTO tw_schema_migrations(version,sha256) VALUES('9999_future.sql','future')",
        &[],
    )
    .await
    .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("newer")
    );
    conn.execute(
        "DELETE FROM tw_schema_migrations WHERE version='9999_future.sql'",
        &[],
    )
    .await
    .unwrap();
    conn.batch_execute("ALTER TABLE tw_schema_migrations RENAME TO fixture_saved_migrations")
        .await
        .unwrap();
    assert!(
        AppState::connect(config.clone())
            .await
            .err()
            .unwrap()
            .contains("ledger unavailable")
    );
    conn.batch_execute("ALTER TABLE fixture_saved_migrations RENAME TO tw_schema_migrations")
        .await
        .unwrap();
    let restored = AppState::connect(config).await.unwrap();
    restored.pool.close();
    let app = trading_workspace_api::router(
        state.clone(),
        catalog::routes()
            .merge(jobs::routes())
            .merge(events::routes()),
    );
    for case in golden["cases"].as_array().unwrap() {
        if !case["checkpoint"].is_null() {
            conn.execute("UPDATE research_jobs SET checkpoint_json=$1 WHERE workspace_id='tenant-a' AND job_id=$2",&[&case["checkpoint"],&case["job_id"].as_str().unwrap()]).await.unwrap();
        }
        let mut req = Request::builder().uri(case["path"].as_str().unwrap());
        if let Some(workspace) = case["workspace"].as_str() {
            req = req.header("x-workspace-id", workspace)
        }
        let response = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            case["status"].as_u64().unwrap() as u16,
            "{}",
            case["path"]
        );
        let actual: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(actual, case["body"], "{}", case["path"]);
    }
    // Corrupt completed artifacts fail closed; no unchecked or partial result is published.
    let id = golden["completed_id"].as_str().unwrap();
    conn.execute("UPDATE research_jobs SET result_sha256=repeat('0',64) WHERE workspace_id='tenant-a' AND job_id=$1",&[&id]).await.unwrap();
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v2/research/jobs/{id}"))
                .header("x-workspace-id", "tenant-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 503);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    // Actual socket HTTP, including middleware authentication before stream subscription.
    assert_eq!(Wire::connect(address, None).status, 422);
    assert_eq!(Wire::connect(address, Some("denied")).status, 403);
    let mut a = Wire::connect(address, Some("tenant-a"));
    let initial = a.snapshot();
    assert_eq!(initial["workspace_id"], "tenant-a");
    assert_eq!(
        initial["downloads"]["qdm"]["jobs"][0]["transferred_bytes"],
        Value::Null
    );
    assert!(initial.to_string().find("private-secret").is_none());
    let mut b = Wire::connect(address, Some("tenant-b"));
    let other = b.snapshot();
    assert_eq!(other["downloads"]["qdm"]["jobs"], json!([]));
    assert_eq!(initial["resources"]["sessions"]["count"], 0);
    assert_eq!(initial["resources"]["datasets"]["count"], 1);
    // More than a recent-ID window, with deliberately large secret payloads:
    // only current metadata contributes to the bounded invalidation projection.
    conn.batch_execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) SELECT 'tenant-a','replay','signal-'||n,1,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z' FROM generate_series(1,30) n; INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) SELECT 'tenant-a','replay','signal-'||n,1,jsonb_build_object('secret',repeat('private-secret',10000)),'2026-10-01T00:00:00Z' FROM generate_series(1,30) n").await.unwrap();
    let inserted = a.snapshot();
    assert_eq!(inserted["resources"]["sessions"]["count"], 30);
    assert_ne!(
        inserted["resources"]["sessions"],
        initial["resources"]["sessions"]
    );
    assert_eq!(
        inserted["resources"]["datasets"],
        initial["resources"]["datasets"]
    );
    assert!(!inserted.to_string().contains("private-secret"));
    assert!(!inserted.to_string().contains("signal-"));
    assert!(inserted.to_string().len() < 16 * 1024);
    conn.batch_execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) VALUES('tenant-a','replay','signal-1',2,'{\"closed_trade\":true}','2026-10-01T00:00:00Z'); UPDATE workspace_records SET current_revision=2 WHERE workspace_id='tenant-a' AND kind='replay' AND record_id='signal-1'").await.unwrap();
    let revised = a.snapshot();
    assert_ne!(
        revised["resources"]["sessions"],
        inserted["resources"]["sessions"]
    );
    conn.batch_execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,deleted,created_at_utc) VALUES('tenant-a','replay','signal-2',2,'{}',true,'2026-10-01T00:00:00Z'); UPDATE workspace_records SET current_revision=2 WHERE workspace_id='tenant-a' AND kind='replay' AND record_id='signal-2'").await.unwrap();
    let deleted = a.snapshot();
    assert_eq!(deleted["resources"]["sessions"]["count"], 29);
    assert_ne!(
        deleted["resources"]["sessions"],
        revised["resources"]["sessions"]
    );
    conn.batch_execute("INSERT INTO replay_activity_intervals(workspace_id,session_id,event_id,started_at_utc,ended_at_utc) VALUES('tenant-a','signal-3','00000000-0000-4000-8000-000000000001','2026-10-01T00:00:00Z','2026-10-01T00:00:20Z')").await.unwrap();
    let activity = a.snapshot();
    assert_eq!(activity["resources"]["sessions"]["count"], 29);
    assert_ne!(
        activity["resources"]["sessions"],
        deleted["resources"]["sessions"]
    );
    conn.batch_execute("UPDATE datasets SET manifest_json=jsonb_set(manifest_json,'{row_count}','3') WHERE workspace_id='tenant-a' AND dataset_id='data'").await.unwrap();
    let metadata = a.snapshot();
    assert_ne!(
        metadata["resources"]["datasets"],
        activity["resources"]["datasets"]
    );
    assert_eq!(
        metadata["resources"]["sessions"],
        activity["resources"]["sessions"]
    );
    conn.batch_execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES('tenant-a','signal-data','{}',repeat('1',64),'2026-10-01T00:00:00Z')").await.unwrap();
    let dataset_added = a.snapshot();
    assert_eq!(dataset_added["resources"]["datasets"]["count"], 2);
    conn.batch_execute(
        "DELETE FROM datasets WHERE workspace_id='tenant-a' AND dataset_id='signal-data'",
    )
    .await
    .unwrap();
    let dataset_deleted = a.snapshot();
    assert_eq!(
        dataset_deleted["resources"]["datasets"],
        metadata["resources"]["datasets"]
    );
    conn.batch_execute("INSERT INTO api_commands(command_id,contract_version,workspace_id,identity_id,method,path,request_hash,deadline_at_utc,expires_at_utc) VALUES('00000000-0000-4000-8000-000000000002','api-command-v1','tenant-a','fixture','GET','/api/v2/replay/sessions',repeat('0',64),CURRENT_TIMESTAMP+interval '1 hour',CURRENT_TIMESTAMP+interval '2 hours')").await.unwrap();
    let read_command = a.snapshot();
    assert_eq!(read_command["resources"], dataset_deleted["resources"]);
    assert_ne!(read_command["commands"], dataset_deleted["commands"]);
    conn.batch_execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES('tenant-b','replay','other-workspace',1,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'); INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) VALUES('tenant-b','replay','other-workspace',1,'{}','2026-10-01T00:00:00Z')").await.unwrap();
    let isolated = b.snapshot();
    assert_eq!(isolated["resources"]["sessions"]["count"], 1);
    assert_ne!(
        isolated["resources"]["sessions"],
        read_command["resources"]["sessions"]
    );
    let mut same_workspace = Wire::connect(address, Some("tenant-a"));
    assert_eq!(
        same_workspace.snapshot()["resources"],
        read_command["resources"]
    );
    drop(same_workspace);
    let job = golden["active_id"].as_str().unwrap();
    conn.execute("WITH research AS (UPDATE research_jobs SET status='failed',updated_at_utc='2026-10-09T20:01:00Z' WHERE workspace_id='tenant-a' AND job_id=$1 RETURNING job_id) UPDATE download_jobs SET payload=jsonb_set(payload,'{status}','\"completed\"'),public_snapshot=jsonb_set(public_snapshot,'{status}','\"completed\"'),revision=revision+1 WHERE workspace_id='tenant-a'",&[&job]).await.unwrap();
    let updated = a.snapshot();
    assert_ne!(updated["revision"], initial["revision"]);
    assert_eq!(
        updated["downloads"]["qdm"]["jobs"][0]["status"],
        "completed"
    );
    assert!(
        updated["research"]["recent_jobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["job_id"] == job && item["status"] == "failed")
    );
    drop(a);
    drop(b);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut reconnected = Wire::connect(address, Some("tenant-a"));
    assert_eq!(reconnected.snapshot()["revision"], updated["revision"]);
    drop(reconnected);
    tokio::time::sleep(Duration::from_millis(100)).await;
    // Body-lifetime resource admission: 8/workspace, 64 total, released on socket disconnect.
    let mut streams = Vec::new();
    for workspace in 0..8 {
        for _ in 0..8 {
            let stream = Wire::connect(address, Some(&format!("limit-{workspace}")));
            assert_eq!(stream.status, 200);
            streams.push(stream)
        }
    }
    assert_eq!(Wire::connect(address, Some("limit-0")).status, 429);
    assert_eq!(Wire::connect(address, Some("limit-8")).status, 429);
    streams.pop();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut released = Wire::connect(address, Some("limit-8"));
    assert_eq!(released.status, 200);
    assert_eq!(released.snapshot()["workspace_id"], "limit-8");
    drop(released);
    drop(streams);
    server.abort();
    state.pool.close();
    println!(
        "{} job/checkpoint parity cases + startup migration fail-closed + SSE session create/off-page revision/tombstone/activity, dataset metadata/create/delete, read-command exclusion, tenant isolation, bounded payload, durable job updates, reconnect, 8/64 limits and disconnect release passed",
        golden["cases"].as_array().unwrap().len()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "owned fixture PostgreSQL from run_events_parity.py only"]
async fn native_background_resource_events() {
    let golden: Value = serde_json::from_slice(&std::fs::read(std::env::var("TW_EVENTS_GOLDEN").unwrap()).unwrap()).unwrap();
    let state = AppState::connect(Config::from_environment().unwrap()).await.unwrap();
    let conn = state.pool.get().await.unwrap();
    let database: String = conn.query_one("SELECT current_database()", &[]).await.unwrap().get(0);
    assert!(database.starts_with("events_parity_"), "refuse owner database");
    let app = trading_workspace_api::router(state.clone(), events::routes());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    let mut a = Wire::connect(address, Some("tenant-a"));
    let initial = a.snapshot();
    let mut b = Wire::connect(address, Some("tenant-b"));
    let other = b.snapshot();
    drop(b);
    conn.batch_execute("INSERT INTO prop_sessions(workspace_id,session_id,current_revision,snapshot_json,created_at_utc,updated_at_utc) VALUES('tenant-a','signal-prop',1,'{\"secret\":\"private-secret\"}','now','now'); INSERT INTO prop_attempts(workspace_id,session_id,attempt_id,current_revision,snapshot_json,phase_json,created_at_utc,updated_at_utc) VALUES('tenant-a','signal-prop','attempt-1',1,'{}','{}','now','now')").await.unwrap();
    let prop_added = a.snapshot();
    assert_eq!(prop_added["resources"]["prop"]["count"], 1);
    assert_eq!(prop_added["resources"]["sessions"], initial["resources"]["sessions"]);
    assert!(!prop_added.to_string().contains("signal-prop"));
    assert!(!prop_added.to_string().contains("private-secret"));
    conn.batch_execute("UPDATE prop_attempts SET current_revision=2 WHERE workspace_id='tenant-a' AND session_id='signal-prop'").await.unwrap();
    let prop_attempt = a.snapshot();
    assert_ne!(prop_attempt["resources"]["prop"], prop_added["resources"]["prop"]);
    conn.batch_execute("UPDATE prop_sessions SET current_revision=2 WHERE workspace_id='tenant-a' AND session_id='signal-prop'").await.unwrap();
    let prop_session = a.snapshot();
    assert_ne!(prop_session["resources"]["prop"], prop_attempt["resources"]["prop"]);
    // The job is deliberately outside recent_jobs, even after its metadata changes.
    let job = golden["active_id"].as_str().unwrap();
    conn.batch_execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc) SELECT 'tenant-a','signal-old-'||n,'data','close-delta-v1',10000,'completed','1900-01-03T00:00:00Z','1900-01-03T00:00:00Z' FROM generate_series(1,21) n").await.unwrap();
    conn.execute("UPDATE research_jobs SET updated_at_utc='1900-01-01T00:00:00Z' WHERE workspace_id='tenant-a' AND job_id=$1", &[&job]).await.unwrap();
    let research_before = a.snapshot();
    assert!(!research_before["research"]["recent_jobs"].as_array().unwrap().iter().any(|item|item["job_id"]==job));
    conn.execute("UPDATE research_jobs SET updated_at_utc='1900-01-02T00:00:00Z' WHERE workspace_id='tenant-a' AND job_id=$1", &[&job]).await.unwrap();
    let research_after = a.snapshot();
    assert_eq!(research_before["research"]["recent_jobs"], research_after["research"]["recent_jobs"]);
    assert_ne!(research_before["resources"]["research"], research_after["resources"]["research"]);
    assert_eq!(research_before["resources"]["prop"], research_after["resources"]["prop"]);
    let mut unchanged_other = Wire::connect(address, Some("tenant-b"));
    assert_eq!(unchanged_other.snapshot()["resources"], other["resources"]);
    let mut reconnected = Wire::connect(address, Some("tenant-a"));
    assert_eq!(reconnected.snapshot()["resources"], research_after["resources"]);
    assert!(research_after.to_string().len() < 16 * 1024);
    drop(a); drop(unchanged_other); drop(reconnected);
    server.abort(); state.pool.close();
    println!("Prop session/attempt metadata, off-page research progress, tenant isolation, bounded payload and reconnect passed");
}
