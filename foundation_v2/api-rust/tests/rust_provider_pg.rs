//! Explicit disposable cluster only; never uses owner provider data/executables.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{
    config::Config,
    provider_routes::{self, DownloadEngine, ProviderRuntime},
    state::AppState,
};

async fn request(
    app: axum::Router,
    method: &str,
    path: &str,
    workspace: &str,
    body: Option<Value>,
    key: Option<&str>,
) -> (u16, Value, Option<String>) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("x-workspace-id", workspace);
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    if let Some(key) = key {
        request = request.header("idempotency-key", key)
    }
    let response = app
        .oneshot(
            request
                .body(
                    body.map(|v| Body::from(v.to_string()))
                        .unwrap_or(Body::empty()),
                )
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let id = response
        .headers()
        .get("x-command-id")
        .map(|v| v.to_str().unwrap().to_owned());
    (
        status,
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap(),
        id,
    )
}

#[tokio::test]
#[ignore = "requires rust_metadata_parity.py's owned disposable PostgreSQL"]
async fn source_local_catalog_and_absent_runtime() {
    let config = Config::from_environment().unwrap();
    let state = AppState::connect(config.clone()).await.unwrap();
    let connection = state.pool.get().await.unwrap();
    let db: String = connection
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(db.starts_with("rust_metadata_"), "refuse owner database");
    let root = config
        .artifact_root
        .join(format!("provider-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let qdm_home = root.join("qdm");
    std::fs::create_dir_all(qdm_home.join("internal/plugins/DataSourceDukascopy")).unwrap();
    // A marker file allows is_file capability checks; it is never executed.
    std::fs::write(qdm_home.join("qdmcli.exe"), b"not executable").unwrap();
    let catalog_path = qdm_home.join("internal/plugins/DataSourceDukascopy/dukascopy.csv");
    std::fs::write(&catalog_path,b"EURUSD;Euro;Forex;Majors;01.01.2000;01.01.2003;;;;;;\nXAUUSD;Gold;Forex;Metals;01.01.2000;01.01.2003;;;;;;").unwrap();
    let runtime =
        ProviderRuntime::load(root.clone(), DownloadEngine::Qdm { home: qdm_home }).unwrap();
    assert!(provider_routes::absent_download_routes(runtime.clone()).is_err());
    let app = provider_routes::routes_with_runtime(runtime.clone())
        .merge(provider_routes::qdm_refresh_routes(runtime.clone()).unwrap())
        .with_state(state.clone());
    let id = format!("provider-{}", uuid::Uuid::new_v4().simple());
    let artifact = format!("tenant-a/datasets/{id}.parquet");
    std::fs::create_dir_all(root.join("tenant-a/datasets")).unwrap();
    std::fs::write(root.join(&artifact), b"immutable fixture bytes").unwrap();
    let manifest = json!({"contract_version":"foundation-v2.1","workspace_id":"tenant-a","dataset_id":id,"source":{"source_id":"fixture","provider":"QuantDataManager","instrument_mapping":{"EUR/USD":"EURUSD"},"license_use":"qa-only","retrieved_at_utc":"2026-01-01Z","export_settings":"{\"library\":\"qdm-cli-v1\",\"price\":\"provider_default\",\"timeframe\":\"m1\",\"requested_from\":\"2003-01-01\",\"requested_to\":\"2026-01-01\"}"},"instrument_id":"EUR/USD","timeframe":"M1","row_count":2,"first_timestamp":0,"last_timestamp":60,"artifact_path":artifact,"artifact_sha256":"fixture","instrument_spec":null,"timeframe_seconds":60,"quality":{},"holdout_policy":{"mode":"none"},"created_at_utc":"2026-01-01T00:00:00Z"});
    connection.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('tenant-a','now'),('tenant-b','now') ON CONFLICT DO NOTHING",&[]).await.unwrap();
    connection.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES('tenant-a',$1,$2,'fixture','2026-01-01')",&[&id,&manifest]).await.unwrap();
    let (status, listed, _) = request(
        app.clone(),
        "GET",
        "/api/v2/data/datasets",
        "tenant-a",
        None,
        None,
    )
    .await;
    assert_eq!(status, 200, "{listed}");
    let item = listed["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["dataset_id"] == id)
        .unwrap();
    assert_eq!(item["provider_id"], "local-catalog");
    assert_eq!(item["size_bytes"], 23);
    assert_eq!(item["asset_class"], "fx");
    assert_eq!(item["update_available"], true);
    assert_eq!(item["replay_instrument_spec"]["contract_size"], "100000");
    assert_eq!(listed["catalog_items"].as_array().unwrap().len(), 2);
    let job_id = uuid::Uuid::new_v4().simple().to_string();
    let payload = json!({"workspace_id":"tenant-a","job_id":job_id,"instrument_id":"EUR/USD","status":"running","error":null,"private_file":"must not be projected"});
    let snapshot =
        json!({"job_id":job_id,"instrument_id":"EUR/USD","status":"running","error":null});
    connection.execute("INSERT INTO download_jobs(workspace_id,provider,job_id,payload,public_snapshot,owner_lock_key,created_at_utc) VALUES('tenant-a','QuantDataManager',$1,$2,$3,919191,CURRENT_TIMESTAMP)",&[&job_id,&payload,&snapshot]).await.unwrap();
    let jobs = request(
        app.clone(),
        "GET",
        "/api/v2/data/downloads",
        "tenant-a",
        None,
        None,
    )
    .await;
    assert_eq!(jobs.0, 200);
    assert_eq!(jobs.1["available"], true);
    assert_eq!(jobs.1["supports_pause"], false);
    assert_eq!(jobs.1["supports_cancel"], false);
    let job = jobs.1["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["job_id"] == job_id)
        .unwrap();
    assert_eq!(job["status"], "paused");
    assert_eq!(job["error"], "download_interrupted");
    assert!(job.get("private_file").is_none());
    let other_jobs = request(
        app.clone(),
        "GET",
        "/api/v2/data/downloads",
        "tenant-b",
        None,
        None,
    )
    .await;
    assert!(
        !other_jobs.1["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["job_id"] == job_id)
    );
    let (_, other, _) = request(
        app.clone(),
        "GET",
        "/api/v2/data/datasets",
        "tenant-b",
        None,
        None,
    )
    .await;
    assert!(
        !other["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["dataset_id"] == id)
    );
    let key = format!("provider-refresh-{id}");
    let refresh = request(
        app.clone(),
        "POST",
        "/api/v2/data/catalog/refresh",
        "tenant-a",
        None,
        Some(&key),
    )
    .await;
    assert_eq!(refresh.0, 200);
    let retry = request(
        app.clone(),
        "POST",
        "/api/v2/data/catalog/refresh",
        "tenant-a",
        None,
        Some(&key),
    )
    .await;
    assert_eq!(refresh, retry);
    std::fs::write(&catalog_path, b"corrupt").unwrap();
    let failed_refresh = request(
        app.clone(),
        "POST",
        "/api/v2/data/catalog/refresh",
        "tenant-a",
        None,
        None,
    )
    .await;
    assert_eq!(failed_refresh.0, 200);
    assert_eq!(
        failed_refresh.1["catalog_state"]["error"],
        "qdm_catalog_invalid"
    );
    assert_eq!(
        failed_refresh.1["catalog_items"].as_array().unwrap().len(),
        2
    );
    assert_eq!(failed_refresh.1["download_state"]["available"], false);
    let absent = ProviderRuntime::load(root.clone(), DownloadEngine::None).unwrap();
    let app = provider_routes::routes_with_runtime(absent.clone())
        .merge(provider_routes::absent_download_routes(absent).unwrap())
        .merge(provider_routes::absent_market_routes())
        .with_state(state.clone());
    let live = request(
        app.clone(),
        "GET",
        "/api/v2/live/status",
        "tenant-a",
        None,
        None,
    )
    .await;
    assert_eq!(
        live.1,
        json!({"status":"unavailable","execution_capability":false})
    );
    let valid = json!({"instrument_id":"EUR/USD","from_date":"2026-01-01","to_date":"2026-01-02"});
    let download = request(
        app.clone(),
        "POST",
        "/api/v2/data/downloads",
        "tenant-a",
        Some(valid.clone()),
        Some("provider-disabled"),
    )
    .await;
    assert_eq!(download.0, 503);
    assert_eq!(download.1["detail"], "worker_unavailable");
    assert!(download.2.is_some());
    assert_eq!(
        download,
        request(
            app.clone(),
            "POST",
            "/api/v2/data/downloads",
            "tenant-a",
            Some(valid),
            Some("provider-disabled")
        )
        .await
    );
    let malformed = request(
        app.clone(),
        "POST",
        "/api/v2/data/downloads",
        "tenant-a",
        Some(json!({})),
        None,
    )
    .await;
    assert_eq!(malformed.0, 422);
    let denied = request(
        app.clone(),
        "GET",
        "/api/v2/data/providers",
        "unknown",
        None,
        None,
    )
    .await;
    assert_eq!(denied.0, 403);
    connection
        .execute(
            "DELETE FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",
            &[&id],
        )
        .await
        .unwrap();
    std::fs::remove_dir_all(&root).unwrap();
}
