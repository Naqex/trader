//! Local artifacts only, inside rust_metadata_parity.py's disposable PostgreSQL.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, data_routes, state::AppState};
fn fixture() -> Value {
    json!({"csv_text":"time,open,high,low,close,volume\n0,1,2,0,1.5,3\n60,1.5,2,1,1.7,4\n","source":{"source_id":"local","provider":"CSV","instrument_mapping":{"EURUSD":"EUR/USD"},"license_use":"owner fixture","retrieved_at_utc":"2026-10-17","export_settings":"UTF-8"},"instrument":{"instrument_id":"EURUSD","asset_class":"forex","base_ccy":"eur","quote_ccy":"usd","account_ccy":"usd","tick_size":"0.00001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2020-01-01"},"timeframe_seconds":60})
}
async fn request(
    app: axum::Router,
    method: &str,
    path: &str,
    body: Value,
    key: Option<&str>,
    workspace: &str,
) -> (u16, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("x-workspace-id", workspace)
        .header("content-type", "application/json");
    if let Some(k) = key {
        req = req.header("idempotency-key", k);
    }
    let r = app
        .oneshot(
            req.body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let code = r.status().as_u16();
    let body = serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (code, body)
}
#[tokio::test]
#[ignore = "owned disposable PG only"]
async fn import_recovery_and_removal_workflow() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let conn = state.pool.get().await.unwrap();
    let db: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(db.starts_with("rust_metadata_"));
    let app = data_routes::routes().with_state(state.clone());
    let body = fixture();
    if let Ok(path) = std::env::var("TW_DATA_LEGACY_ORACLE") {
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        for case in cases {
            let manifest = &case["manifest"];
            let id = manifest["dataset_id"].as_str().unwrap();
            for (key, source) in [
                ("artifact_path", "artifact_file"),
                ("raw_artifact_path", "raw_file"),
            ] {
                let target = state
                    .config
                    .artifact_root
                    .join(manifest[key].as_str().unwrap());
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::copy(case[source].as_str().unwrap(), target).unwrap();
            }
            conn.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('tenant-a','2026-10-17') ON CONFLICT DO NOTHING",&[]).await.unwrap();
            conn.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES('tenant-a',$1,$2,$3,$4)",&[&id,manifest,&manifest["artifact_sha256"].as_str().unwrap(),&manifest["created_at_utc"].as_str().unwrap()]).await.unwrap();
            let canonical = state
                .config
                .artifact_root
                .join(manifest["artifact_path"].as_str().unwrap());
            let bytes = std::fs::read(&canonical).unwrap();
            std::fs::write(&canonical, b"legacy-corrupt").unwrap();
            let (code, repaired) = request(
                app.clone(),
                "POST",
                &format!("/api/v2/data/datasets/{id}/repair"),
                Value::Null,
                None,
                "tenant-a",
            )
            .await;
            assert_eq!(code, 200, "{repaired}");
            assert_eq!(repaired["status"], "restored");
            assert_eq!(std::fs::read(&canonical).unwrap(), bytes);
            let stored:Value=conn.query_one("SELECT manifest_json FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",&[&id]).await.unwrap().get(0);
            assert_eq!(
                &stored, manifest,
                "repair must not change any pinned manifest fields"
            );
            let (code, removed) = request(
                app.clone(),
                "DELETE",
                &format!("/api/v2/data/datasets/{id}"),
                Value::Null,
                None,
                "tenant-a",
            )
            .await;
            assert_eq!(code, 200, "{removed}");
            eprintln!(
                "Legacy PyArrow {}-row pinned hash recovered exactly",
                manifest["row_count"]
            );
        }
    }
    // Provider locks use the same path-derived key as the existing download worker.
    use sha2::{Digest, Sha256};
    let provider = std::fs::canonicalize(&state.config.artifact_root)
        .unwrap()
        .join("qdm")
        .to_string_lossy()
        .to_string();
    let provider = provider.strip_prefix(r"\\?\").unwrap_or(&provider);
    let hash = Sha256::digest(provider.as_bytes());
    let key = i64::from_be_bytes(hash[..8].try_into().unwrap());
    conn.query_one("SELECT pg_advisory_lock($1)", &[&key])
        .await
        .unwrap();
    let (code, busy) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/import",
        body.clone(),
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 409, "{busy}");
    assert_eq!(busy["detail"], "download_busy");
    conn.query_one("SELECT pg_advisory_unlock($1)", &[&key])
        .await
        .unwrap();
    let (code, preview) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/preview",
        body.clone(),
        Some("data-preview"),
        "tenant-a",
    )
    .await;
    assert_eq!(code, 200, "{preview}");
    let dataset = preview["preview"]["dataset_id"].as_str().unwrap();
    let (code, imported) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/import",
        body.clone(),
        Some("data-import"),
        "tenant-a",
    )
    .await;
    assert_eq!(code, 201, "{imported}");
    assert_eq!(imported["dataset"]["dataset_id"], dataset);
    assert_eq!(imported["dataset"]["row_count"], 2);
    let (_, retry) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/import",
        body.clone(),
        Some("data-import"),
        "tenant-a",
    )
    .await;
    assert_eq!(retry, imported);
    let (code, duplicate) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/import",
        body.clone(),
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 422, "{duplicate}");
    let repair = format!("/api/v2/data/datasets/{dataset}/repair");
    let remove = format!("/api/v2/data/datasets/{dataset}");
    let (code, verified) =
        request(app.clone(), "POST", &repair, Value::Null, None, "tenant-a").await;
    assert_eq!((code, verified["status"].as_str()), (200, Some("verified")));
    let (code, missing) =
        request(app.clone(), "POST", &repair, Value::Null, None, "tenant-b").await;
    assert_eq!(code, 404, "{missing}");
    // HTTP cancellation cannot strand half-published files or release a lock
    // while the detached bounded mutation is still completing its receipt.
    let mut cancelled = body.clone();
    cancelled["source"]["source_id"] = json!("cancelled-http");
    let (id_preview, _) = data_routes::ingest::preview(&cancelled).unwrap();
    let id = id_preview["dataset_id"].as_str().unwrap();
    let lock = Sha256::digest(format!("dataset-mutation:tenant-a:{id}"));
    let lock = i64::from_be_bytes(lock[..8].try_into().unwrap());
    conn.query_one("SELECT pg_advisory_lock($1)", &[&lock])
        .await
        .unwrap();
    let cancelled_app = app.clone();
    let task = tokio::spawn(async move {
        request(
            cancelled_app,
            "POST",
            "/api/v2/data/csv/import",
            cancelled,
            Some("cancelled-data-import"),
            "tenant-a",
        )
        .await
    });
    let mut waiting = false;
    for _ in 0..100 {
        waiting = conn
            .query_one(
                "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted)",
                &[],
            )
            .await
            .unwrap()
            .get(0);
        if waiting {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(waiting, "mutation never reached owned lock");
    task.abort();
    conn.query_one("SELECT pg_advisory_unlock($1)", &[&lock])
        .await
        .unwrap();
    let mut completed = false;
    for _ in 0..100 {
        completed=conn.query_opt("SELECT 1 FROM api_commands WHERE workspace_id='tenant-a' AND idempotency_key='cancelled-data-import' AND status='completed'",&[]).await.unwrap().is_some();
        if completed {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(
        completed,
        "cancelled mutation did not finish its durable receipt"
    );
    assert!(
        conn.query_opt(
            "SELECT 1 FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",
            &[&id]
        )
        .await
        .unwrap()
        .is_some()
    );
    let (code, deleted) = request(
        app.clone(),
        "DELETE",
        &format!("/api/v2/data/datasets/{id}"),
        Value::Null,
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 200, "{deleted}");
    let canonical = state
        .config
        .artifact_root
        .join(imported["dataset"]["artifact_path"].as_str().unwrap());
    let raw = state
        .config
        .artifact_root
        .join(imported["dataset"]["raw_artifact_path"].as_str().unwrap());
    let bytes = std::fs::read(&canonical).unwrap();
    std::fs::write(&canonical, b"corrupt").unwrap();
    let (code, restored) =
        request(app.clone(), "POST", &repair, Value::Null, None, "tenant-a").await;
    assert_eq!(
        (code, restored["status"].as_str()),
        (200, Some("restored")),
        "{restored}"
    );
    assert_eq!(std::fs::read(&canonical).unwrap(), bytes);
    std::fs::write(&canonical, b"corrupt").unwrap();
    let raw_bytes = std::fs::read(&raw).unwrap();
    std::fs::write(&raw, b"tamper").unwrap();
    let (code, corrupt) =
        request(app.clone(), "POST", &repair, Value::Null, None, "tenant-a").await;
    assert_eq!(code, 409, "{corrupt}");
    assert_eq!(corrupt["detail"], "dataset_source_corrupt");
    std::fs::write(&raw, &raw_bytes).unwrap();
    request(app.clone(), "POST", &repair, Value::Null, None, "tenant-a").await;
    // A crash after file publication but before catalog commit is safely adoptable.
    conn.execute(
        "DELETE FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",
        &[&dataset],
    )
    .await
    .unwrap();
    let (code, adopted) = request(
        app.clone(),
        "POST",
        "/api/v2/data/csv/import",
        body.clone(),
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 201, "{adopted}");
    assert_eq!(
        adopted["dataset"]["artifact_sha256"],
        imported["dataset"]["artifact_sha256"]
    );
    // An existing replay pin prevents removal; no provider catalog is involved.
    let now = "2026-10-17T00:00:00Z";
    conn.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES('tenant-a','replay','data-pin',1,$1,$1)",&[&now]).await.unwrap();
    conn.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) VALUES('tenant-a','replay','data-pin',1,$1,$2)",&[&json!({"dataset_id":dataset}),&now]).await.unwrap();
    let (code, pinned) = request(
        app.clone(),
        "DELETE",
        &remove,
        Value::Null,
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 409, "{pinned}");
    assert!(canonical.is_file());
    conn.execute("DELETE FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND record_id='data-pin'",&[]).await.unwrap();
    conn.execute(
        "DELETE FROM workspace_records WHERE workspace_id='tenant-a' AND record_id='data-pin'",
        &[],
    )
    .await
    .unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let deny_delete = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&raw)
            .unwrap();
        let (code, pending) = request(
            app.clone(),
            "DELETE",
            &remove,
            Value::Null,
            Some("data-delete"),
            "tenant-a",
        )
        .await;
        assert_eq!(code, 503, "{pending}");
        assert_eq!(pending["detail"], "dataset_cleanup_pending");
        assert!(raw.exists());
        let exists = conn
            .query_opt(
                "SELECT 1 FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",
                &[&dataset],
            )
            .await
            .unwrap();
        assert!(exists.is_none());
        let (code, blocked) = request(
            app.clone(),
            "POST",
            "/api/v2/data/csv/import",
            body.clone(),
            None,
            "tenant-a",
        )
        .await;
        assert_eq!(code, 409, "{blocked}");
        assert_eq!(blocked["detail"], "dataset_cleanup_pending");
        drop(deny_delete);
    }
    let (code, deleted) = request(
        app.clone(),
        "DELETE",
        &remove.replace("dataset-","dataset%2D"),
        Value::Null,
        Some("data-delete-resume"),
        "tenant-a",
    )
    .await;
    assert_eq!(code, 200, "{deleted}");
    assert_eq!(deleted, json!({"dataset_id":dataset,"deleted":true}));
    assert!(!canonical.exists());
    assert!(!raw.exists());
    let (code, retry) = request(
        app.clone(),
        "DELETE",
        &remove,
        Value::Null,
        Some("data-delete"),
        "tenant-a",
    )
    .await;
    assert_eq!(code, 200);
    assert_eq!(retry, deleted);
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        use std::os::windows::fs::OpenOptionsExt;

        // A completed receipt belongs to the previous deletion. Reusing the
        // dataset ID must not let that receipt remove a newer pending journal.
        let (code, republished) = request(
            app.clone(), "POST", "/api/v2/data/csv/import", body.clone(),
            Some("data-import-generation-2"), "tenant-a",
        ).await;
        assert_eq!(code, 201, "{republished}");
        assert_eq!(republished["dataset"]["dataset_id"], dataset);
        let deny_delete = std::fs::OpenOptions::new().read(true).share_mode(1).open(&raw).unwrap();
        let (code, pending) = request(
            app.clone(), "DELETE", &remove, Value::Null,
            Some("data-delete-generation-2"), "tenant-a",
        ).await;
        assert_eq!(code, 503, "{pending}");
        assert_eq!(pending["detail"], "dataset_cleanup_pending");
        assert!(conn.query_opt("SELECT 1 FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1", &[&dataset]).await.unwrap().is_none());
        let digest = format!("{:x}", Sha256::digest(format!("tenant-a:{dataset}")));
        let journal = state.config.artifact_root.join("dataset-removals").join(format!("{digest}.json"));
        let pending_journal = std::fs::read(&journal).unwrap();
        let (code, old_retry) = request(
            app.clone(), "DELETE", &remove, Value::Null,
            Some("data-delete"), "tenant-a",
        ).await;
        assert_eq!(code, 200, "{old_retry}");
        assert_eq!(old_retry, deleted);
        assert_eq!(std::fs::read(&journal).expect("old receipt removed the newer deletion journal"), pending_journal);
        assert!(raw.exists());
        drop(deny_delete);
        let (code, completed) = request(
            app.clone(), "DELETE", &remove, Value::Null,
            Some("data-delete-generation-2"), "tenant-a",
        ).await;
        assert_eq!(code, 200, "{completed}");
        assert_eq!(completed, deleted);
        assert!(!canonical.exists());
        assert!(!raw.exists());
        assert!(!journal.exists());
    }
    let (code, missing) = request(
        app.clone(),
        "DELETE",
        &remove,
        Value::Null,
        None,
        "tenant-a",
    )
    .await;
    assert_eq!(code, 404, "{missing}");
    eprintln!(
        "Native local data import/retry/adoption/corruption/repair/workspace/pin/delete workflows passed"
    );
}
