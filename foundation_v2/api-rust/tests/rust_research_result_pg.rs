//! Stored result ownership checks, only in the disposable metadata harness.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, context_routes, jobs, state::AppState};

fn write(root: &Path, relative: &str, result: &Value) -> String {
    let bytes = serde_json::to_vec(result).unwrap();
    let target = root.join(relative);
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(target, &bytes).unwrap();
    format!("{:x}", Sha256::digest(bytes))
}
async fn endpoints(app: axum::Router, job: &str, expected: u16) -> Vec<Value> {
    let mut values = Vec::new();
    for tail in ["", "/analytics", "/analytics.csv"] {
        let path = format!("/api/v2/research/jobs/{job}{tail}");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(&path)
                    .header("x-workspace-id", "tenant-a")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status().as_u16();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            status,
            expected,
            "{path}: {}",
            String::from_utf8_lossy(&bytes)
        );
        if !tail.ends_with(".csv") || expected != 200 {
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            if expected == 503 {
                assert!(matches!(
                    value["detail"].as_str(),
                    Some(
                        "result_untrusted"
                            | "stored_contract_untrusted"
                            | "analytics_result_unavailable"
                    )
                ));
            }
            values.push(value);
        }
    }
    values
}
async fn point(state: &Arc<AppState>, job: &str, path: Option<&str>, hash: Option<&str>) {
    state.pool.get().await.unwrap().execute("UPDATE research_jobs SET result_path=$2,result_sha256=$3 WHERE workspace_id='tenant-a' AND job_id=$1",&[&job,&path,&hash]).await.unwrap();
}

#[tokio::test]
#[ignore = "owned disposable PostgreSQL only"]
async fn completed_results_are_bound_to_the_selected_job() {
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
        database.starts_with("rust_metadata_"),
        "refuse owner database"
    );
    let job = format!("result-{}", uuid::Uuid::new_v4().simple());
    let dataset = format!("dataset-{job}");
    let dataset_sha = "a".repeat(64);
    conn.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('tenant-a','fixture') ON CONFLICT DO NOTHING",&[]).await.unwrap();
    conn.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES('tenant-a',$1,'{}',$2,'fixture')",&[&dataset,&dataset_sha]).await.unwrap();
    conn.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc) VALUES('tenant-a',$1,$2,'close-delta-v1',10000,'completed','fixture','fixture')",&[&job,&dataset]).await.unwrap();
    let app = jobs::routes()
        .merge(context_routes::routes())
        .with_state(state.clone());
    let legacy_path = format!("tenant-a/results/{job}.json");
    let candidate_path = format!("tenant-a/results/{job}/attempt-000001-0123456789abcdef.json");
    let legacy = json!({"contract_version":"foundation-v2.1","job_id":job,"workspace_id":"tenant-a","dataset_id":dataset,"dataset_sha256":dataset_sha,"strategy_version":"close-delta-v1","metrics_schema_version":"metrics-v2","metrics":{"starting_balance":10000,"net_pnl":5},"trade_count":1,"created_at_utc":"2026-10-17T00:00:00Z"});
    for path in [&legacy_path, &candidate_path] {
        let hash = write(&state.config.artifact_root, path, &legacy);
        point(&state, &job, Some(path), Some(&hash)).await;
        let values = endpoints(app.clone(), &job, 200).await;
        assert_eq!(values[0]["result"], legacy);
        assert_eq!(values[1]["provenance"]["job_id"], job);
    }
    for (field, value) in [
        ("workspace_id", json!("tenant-b")),
        ("job_id", json!("other")),
        ("dataset_id", json!("other")),
        ("dataset_sha256", json!("b".repeat(64))),
        ("strategy_version", json!("foreign")),
        ("metrics", json!([])),
        ("artifact_schema_version", json!("unknown")),
    ] {
        let mut corrupt = legacy.clone();
        corrupt[field] = value;
        let hash = write(&state.config.artifact_root, &candidate_path, &corrupt);
        point(&state, &job, Some(&candidate_path), Some(&hash)).await;
        endpoints(app.clone(), &job, 503).await;
    }
    for relative in [
        format!("tenant-b/results/{job}.json"),
        format!("tenant-a/results/other-{job}.json"),
        format!("tenant-a/quarantine/results/{job}/attempt-000001-0123456789abcdef.json"),
    ] {
        let hash = write(&state.config.artifact_root, &relative, &legacy);
        point(&state, &job, Some(&relative), Some(&hash)).await;
        endpoints(app.clone(), &job, 503).await;
    }
    point(&state, &job, None, None).await;
    endpoints(app.clone(), &job, 503).await;

    let protocol = json!({"starting_balance":10000,"dataset":{"dataset_id":dataset,"artifact_sha256":dataset_sha},"engine":{"code_sha256":"engine-fixture"},"playbook":{"record_id":"book","revision":1},"split":"baseline"});
    let mut canonical = serde_json::to_vec(&protocol).unwrap();
    canonical.push(b'\n');
    let protocol_sha = format!("{:x}", Sha256::digest(canonical));
    conn.execute("UPDATE research_jobs SET strategy_version='bar-breakout-v1',protocol_json=$2,protocol_sha256=$3 WHERE workspace_id='tenant-a' AND job_id=$1",&[&job,&protocol,&protocol_sha]).await.unwrap();
    let engine = json!({"artifact_schema_version":"research-engine-result-v1","contract_version":"foundation-v2.1","job_id":job,"workspace_id":"tenant-a","dataset_id":dataset,"dataset_sha256":dataset_sha,"protocol":protocol,"protocol_sha256":protocol_sha,"engine_version":"bar-breakout-v1","engine_code_sha256":"engine-fixture","playbook_id":"book","playbook_revision":1,"split":"baseline","assumptions":{},"signals":{},"ledger":[],"metrics":{"starting_balance":10000},"observed_range":{},"created_at_utc":"2026-10-17T00:00:00Z"});
    let hash = write(&state.config.artifact_root, &candidate_path, &engine);
    point(&state, &job, Some(&candidate_path), Some(&hash)).await;
    endpoints(app.clone(), &job, 200).await;
    for (field, value) in [
        ("protocol", json!({"starting_balance":999})),
        ("protocol_sha256", json!("foreign")),
        ("engine_version", json!("foreign")),
        ("playbook_revision", json!(2)),
        ("split", json!("train")),
    ] {
        let mut corrupt = engine.clone();
        corrupt[field] = value;
        let hash = write(&state.config.artifact_root, &candidate_path, &corrupt);
        point(&state, &job, Some(&candidate_path), Some(&hash)).await;
        endpoints(app.clone(), &job, 503).await;
    }
    conn.execute("UPDATE research_jobs SET protocol_sha256='corrupt' WHERE workspace_id='tenant-a' AND job_id=$1",&[&job]).await.unwrap();
    let hash = write(&state.config.artifact_root, &candidate_path, &engine);
    point(&state, &job, Some(&candidate_path), Some(&hash)).await;
    endpoints(app.clone(), &job, 503).await;
    conn.execute(
        "UPDATE research_jobs SET protocol_sha256=$2 WHERE workspace_id='tenant-a' AND job_id=$1",
        &[&job, &protocol_sha],
    )
    .await
    .unwrap();
    let mut oos = engine.clone();
    oos["artifact_schema_version"] = json!("research-oos-result-v1");
    oos["split"] = json!("validation");
    oos["validation_schema"] = json!("research-oos-validation-v1");
    oos["trials"] = json!([]);
    for field in [
        "selection",
        "walk_forward",
        "sweep",
        "outcome_summary",
        "source_range",
    ] {
        oos[field] = json!({});
    }
    let hash = write(&state.config.artifact_root, &candidate_path, &oos);
    point(&state, &job, Some(&candidate_path), Some(&hash)).await;
    endpoints(app.clone(), &job, 200).await;
    println!(
        "research result binding: legacy/candidate, engine/OOS, all identity fields, protocol/hash, path ownership and missing result passed"
    );
}
