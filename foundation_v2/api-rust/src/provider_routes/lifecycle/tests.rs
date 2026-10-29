use super::*;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn request(
    app: axum::Router,
    path: &str,
    workspace: &str,
    body: Value,
    key: &str,
) -> (u16, Value, String) {
    let response = app
        .oneshot(
            Request::post(path)
                .header("x-workspace-id", workspace)
                .header("content-type", "application/json")
                .header("idempotency-key", key)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let command = response
        .headers()
        .get("x-command-id")
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    (
        status,
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap(),
        command,
    )
}

#[tokio::test]
#[ignore = "requires rust_metadata_parity.py disposable PostgreSQL"]
async fn configured_http_lifecycle_preserves_receipts_cooldowns_scope_and_revisions() {
    let config = crate::config::Config::from_environment().unwrap();
    let state = AppState::connect(config.clone()).await.unwrap();
    let mut conn = state.pool.get().await.unwrap();
    let database: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("rust_metadata_"),
        "refuse owner database"
    );
    let root = config
        .artifact_root
        .join(format!("lifecycle-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("catalog")).unwrap();
    std::fs::write(
        root.join("catalog/dukascopy-instruments.json"),
        include_bytes!("../../../tests/rust_provider/cache.json"),
    )
    .unwrap();
    let runtime = ProviderRuntime::load(root.clone(),DownloadEngine::Dukascopy{
        metadata:json!({"version":"1.50.0","items":[{"name":"EUR/USD","code":"eurusd","startDayForMinuteCandles":"2003-01-01"}]}),adapter_present:true,
    }).unwrap();
    let app = crate::provider_routes::configured_download_routes(runtime.clone())
        .unwrap()
        .with_state(state.clone());
    let path = "/api/v2/data/downloads";
    let valid = json!({"instrument_id":"EUR/USD","from_date":"2026-01-01","to_date":"2026-01-02"});
    let disabled = request(app.clone(), path, "tenant-a", valid.clone(), "lc-disabled").await;
    assert_eq!(disabled.0, 503);
    assert_eq!(disabled.1["detail"], "worker_unavailable");
    assert!(!disabled.2.is_empty());
    // Only scheduler admission is enabled here. No executable or network worker runs.
    runtime.worker.store(true, Ordering::Release);
    assert_eq!(
        disabled,
        request(app.clone(), path, "tenant-a", valid.clone(), "lc-disabled").await
    );
    assert_eq!(
        request(app.clone(), path, "tenant-a", json!({}), "lc-invalid")
            .await
            .0,
        422
    );
    assert_eq!(
        request(app.clone(), path, "unknown", valid.clone(), "lc-denied")
            .await
            .0,
        403
    );
    let created = request(app.clone(), path, "tenant-a", valid.clone(), "lc-create").await;
    assert_eq!(created.0, 202, "{:?}", created);
    assert_eq!(created.1["status"], "queued");
    assert_eq!(
        created,
        request(app.clone(), path, "tenant-a", valid.clone(), "lc-create").await
    );
    let mut changed = valid.clone();
    changed["to_date"] = json!("2026-01-03");
    assert_eq!(
        request(app.clone(), path, "tenant-a", changed.clone(), "lc-create")
            .await
            .0,
        409
    );
    let id = created.1["job_id"].as_str().unwrap();
    let control = |action: &str| format!("{path}/{id}/{action}");
    assert_eq!(
        request(
            app.clone(),
            &control("pause"),
            "tenant-b",
            Value::Null,
            "lc-foreign"
        )
        .await
        .0,
        404
    );
    let paused = request(
        app.clone(),
        &control("pause"),
        "tenant-a",
        Value::Null,
        "lc-pause",
    )
    .await;
    assert_eq!(paused.0, 202);
    assert_eq!(paused.1["status"], "paused");
    assert_eq!(
        request(
            app.clone(),
            &control("pause"),
            "tenant-a",
            Value::Null,
            "lc-pause-again"
        )
        .await
        .1["revision"],
        paused.1["revision"]
    );
    std::fs::create_dir_all(base(&runtime)).unwrap();
    let policy_file = base(&runtime).join("cooldown.json");
    crate::provider_routes::execution::atomic_json(
        &policy_file,
        &json!({"until":Utc::now().timestamp()+300,"rate_limit_level":1}),
    )
    .unwrap();
    for (index, route) in [path.to_owned(), control("resume")].iter().enumerate() {
        let result = request(
            app.clone(),
            route,
            "tenant-a",
            if index == 0 {
                valid.clone()
            } else {
                Value::Null
            },
            &format!("lc-cooldown-{index}"),
        )
        .await;
        assert_eq!(result.0, 409);
        assert_eq!(result.1["detail"], "download_cooldown");
    }
    std::fs::remove_file(&policy_file).unwrap();
    let tx = conn.transaction().await.unwrap();
    let mut job = read(&tx, &runtime, "tenant-a", id, true).await.unwrap();
    job["retry_at"] = json!(Utc::now().timestamp() + 300);
    save(&tx, &runtime, &mut job).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(
        request(
            app.clone(),
            path,
            "tenant-a",
            valid.clone(),
            "lc-job-cooldown"
        )
        .await
        .1["detail"],
        "download_cooldown"
    );
    let tx = conn.transaction().await.unwrap();
    let mut job = read(&tx, &runtime, "tenant-a", id, true).await.unwrap();
    job.as_object_mut().unwrap().remove("retry_at");
    save(&tx, &runtime, &mut job).await.unwrap();
    tx.commit().await.unwrap();
    let resumed = request(app.clone(), path, "tenant-a", valid.clone(), "lc-retry").await;
    assert_eq!(resumed.1["status"], "queued");
    assert_eq!(resumed.1["job_id"], id);
    // A separate DB session holds actual worker locks, without any provider process.
    let owner = deadpool_postgres::Client::take(state.pool.get().await.unwrap());
    let owner_key = job_key(&runtime, "tenant-a", id).unwrap();
    owner
        .query_one("SELECT pg_advisory_lock($1)", &[&owner_key])
        .await
        .unwrap();
    assert_eq!(
        request(
            app.clone(),
            &control("pause"),
            "tenant-a",
            Value::Null,
            "lc-pausing"
        )
        .await
        .1["status"],
        "pausing"
    );
    let cancelled = request(
        app.clone(),
        &control("cancel"),
        "tenant-a",
        Value::Null,
        "lc-cancel",
    )
    .await;
    assert_eq!(cancelled.0, 200);
    assert_eq!(cancelled.1["status"], "cancelled");
    assert_eq!(
        cancelled.1,
        request(
            app.clone(),
            &control("cancel"),
            "tenant-a",
            Value::Null,
            "lc-cancel-again"
        )
        .await
        .1
    );
    assert_eq!(
        request(
            app.clone(),
            &control("resume"),
            "tenant-a",
            Value::Null,
            "lc-cancel-resume"
        )
        .await
        .1["detail"],
        "download_cancelled"
    );
    owner
        .query_one("SELECT pg_advisory_unlock($1)", &[&owner_key])
        .await
        .unwrap();
    let source = source_key(&runtime).unwrap();
    owner
        .query_one("SELECT pg_advisory_lock($1)", &[&source])
        .await
        .unwrap();
    assert_eq!(
        request(app.clone(), path, "tenant-a", changed.clone(), "lc-busy")
            .await
            .1["detail"],
        "download_busy"
    );
    owner
        .query_one("SELECT pg_advisory_unlock($1)", &[&source])
        .await
        .unwrap();
    let next = request(app.clone(), path, "tenant-a", changed, "lc-next").await;
    assert_eq!(next.0, 202);
    let tx = conn.transaction().await.unwrap();
    let mut current = read(
        &tx,
        &runtime,
        "tenant-a",
        next.1["job_id"].as_str().unwrap(),
        true,
    )
    .await
    .unwrap();
    let mut stale = current.clone();
    current["status"] = json!("failed");
    save(&tx, &runtime, &mut current).await.unwrap();
    assert_eq!(
        save(&tx, &runtime, &mut stale).await.unwrap_err().1["detail"],
        "download_revision_conflict"
    );
    tx.commit().await.unwrap();
    // A restarted catalog/runtime observes PostgreSQL snapshots and the cooldown file.
    let restarted = ProviderRuntime::load(root.clone(), runtime.engine.clone()).unwrap();
    let tx = conn.transaction().await.unwrap();
    assert_eq!(
        read(&tx, &restarted, "tenant-a", id, false).await.unwrap()["status"],
        "cancelled"
    );
    tx.commit().await.unwrap();
    std::fs::write(&policy_file, vec![b' '; 4097]).unwrap();
    assert_eq!(
        policy(&runtime).unwrap_err().1["detail"],
        "invalid_source_policy"
    );
    let qdm_home = root.join("qdm-home");
    std::fs::create_dir_all(&qdm_home).unwrap();
    let qdm = ProviderRuntime::load(root.clone(), DownloadEngine::Qdm { home: qdm_home }).unwrap();
    let qdm_app = crate::provider_routes::configured_download_routes(qdm)
        .unwrap()
        .with_state(state.clone());
    for action in ["pause", "cancel"] {
        assert_eq!(
            request(
                qdm_app.clone(),
                &control(action),
                "tenant-a",
                Value::Null,
                &format!("lc-qdm-{action}")
            )
            .await
            .1["detail"],
            "qdm_control_unsupported"
        );
    }
    conn.execute(
        "DELETE FROM download_jobs WHERE job_id=ANY($1)",
        &[&vec![
            id.to_owned(),
            next.1["job_id"].as_str().unwrap().to_owned(),
        ]],
    )
    .await
    .unwrap();
    state.pool.close();
    drop(owner);
    std::fs::remove_dir_all(root).unwrap();
}
