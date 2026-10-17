//! Runs only against rust_metadata_parity.py's explicitly disposable cluster.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{analytics, config::Config, state::AppState};

async fn get(app: axum::Router, path: &str, workspace: &str) -> Value {
    let response = app
        .oneshot(
            Request::builder()
                .uri(path)
                .header("x-workspace-id", workspace)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(status.as_u16(), 200, "{path}: {value}");
    value
}

#[tokio::test]
#[ignore = "requires explicitly owned disposable PostgreSQL via rust_metadata_parity.py"]
async fn analytics_cache_does_not_cross_appstate_restore_boundaries() {
    let mut config = Config::from_environment().unwrap();
    let workspace = format!("analytics-cache-{}", uuid::Uuid::new_v4());
    config.local_workspaces = Some(vec![workspace.clone()]);
    let state_a = AppState::connect(config.clone()).await.unwrap();
    let conn = state_a.pool.get().await.unwrap();
    let database: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("rust_metadata_"),
        "refuse owner database"
    );

    let oracle: Value =
        serde_json::from_str(include_str!("../src/analytics/oracle_cases.json")).unwrap();
    let before = &oracle["inputs"][13][0];
    let after = &oracle["inputs"][14][0];
    assert_eq!(before["record_id"], after["record_id"]);
    assert_eq!(before["revision"], after["revision"]);
    assert_eq!(
        before["payload"]["execution"]["ledger"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        after["payload"]["execution"]["ledger"]
            .as_array()
            .unwrap()
            .len(),
        6
    );
    let id = before["record_id"].as_str().unwrap();
    let rev = before["revision"].as_i64().unwrap() as i32;
    let timestamp = "2026-10-17T00:00:00Z";
    conn.execute(
        "INSERT INTO workspaces(workspace_id,created_at_utc) VALUES($1,$2)",
        &[&workspace, &timestamp],
    )
    .await
    .unwrap();
    conn.execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES($1,'replay',$2,$3,$4,$4)", &[&workspace,&id,&rev,&timestamp]).await.unwrap();
    conn.execute("INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) VALUES($1,'replay',$2,$3,$4,$5)", &[&workspace,&id,&rev,&before["payload"],&timestamp]).await.unwrap();

    let app_a = analytics::routes().with_state(state_a.clone());
    let first = get(app_a.clone(), "/api/v2/replay/trades", &workspace).await;
    assert_eq!(first["metrics"]["closed_trade_count"], 1);
    let first_page = get(app_a, "/api/v2/replay/trades?page=1", &workspace).await;
    assert_eq!(first_page["ledger"].as_array().unwrap().len(), 1);
    assert_eq!(first_page["ledger"][0]["net_pnl"], json!(17.0));

    // Restore is simulated only inside this owned fixture: identical immutable
    // head IDs/revisions now refer to a different database image. A second API
    // state must not inherit the first API state's cached financial projection.
    conn.execute("UPDATE workspace_record_revisions SET payload_json=$4 WHERE workspace_id=$1 AND kind='replay' AND record_id=$2 AND revision=$3", &[&workspace,&id,&rev,&after["payload"]]).await.unwrap();
    drop(conn);
    let state_b = AppState::connect(config).await.unwrap();
    let app_b = analytics::routes().with_state(state_b);
    let second = get(app_b.clone(), "/api/v2/replay/trades", &workspace).await;
    assert_eq!(
        second["metrics"]["closed_trade_count"], 2,
        "new AppState reused the old AppState's financial cache"
    );
    let second_page = get(app_b, "/api/v2/replay/trades?page=1", &workspace).await;
    assert_eq!(
        second_page["ledger"].as_array().unwrap().len(),
        2,
        "new AppState reused the old AppState's page cache"
    );
    assert_eq!(second_page["ledger"][0]["net_pnl"], json!(36.0));
    assert_ne!(first_page["snapshot_key"], second_page["snapshot_key"]);
}
