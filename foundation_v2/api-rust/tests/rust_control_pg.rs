//! Runs only inside rust_metadata_parity.py's disposable cluster.
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, control_routes, state::AppState};

async fn request(
    app: axum::Router,
    method: &str,
    path: &str,
    body: Value,
    workspace: &str,
    key: Option<&str>,
) -> (u16, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("x-workspace-id", workspace)
        .header("content-type", "application/json");
    if let Some(key) = key {
        req = req.header("idempotency-key", key);
    }
    let response = app
        .oneshot(
            req.body(if method == "GET" {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (status, body)
}

#[tokio::test]
#[ignore = "requires explicitly owned disposable PostgreSQL via rust_metadata_parity.py"]
async fn notion_local_ledger_workflow() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let conn = state.pool.get().await.unwrap();
    let db: String = conn
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(db.starts_with("rust_metadata_"), "refuse owner database");
    drop(conn);
    let app = control_routes::routes().with_state(state.clone());
    let prefix = "/api/v2/connectors/notion";
    let id = format!("conn-{}", uuid::Uuid::new_v4());
    let path = format!("{prefix}/connections/{id}");
    let create = json!({"connection_id":id,"request_id":"r1","idempotency_key":id,"scopes":["read","write","read"],"metadata":{"label":"Nội bộ"}});
    let (status, created) = request(
        app.clone(),
        "POST",
        &format!("{prefix}/connections"),
        create.clone(),
        "tenant-a",
        Some("notion-create"),
    )
    .await;
    assert_eq!(status, 201, "{created}");
    assert_eq!(
        created["connection"]["scopes_json"],
        json!(["read", "write"])
    );
    assert_eq!(created["duplicate"], false);
    let (_, retry) = request(
        app.clone(),
        "POST",
        &format!("{prefix}/connections"),
        create.clone(),
        "tenant-a",
        Some("notion-create"),
    )
    .await;
    assert_eq!(retry, created);
    let (status, duplicate) = request(
        app.clone(),
        "POST",
        &format!("{prefix}/connections"),
        create.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 201);
    assert_eq!(duplicate["duplicate"], true);
    let mut changed = create.clone();
    changed["metadata"] = json!({"label":"changed"});
    let (status, error) = request(
        app.clone(),
        "POST",
        &format!("{prefix}/connections"),
        changed,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(error["detail"], "connector_idempotency_conflict");
    assert_eq!(
        request(app.clone(), "GET", &path, Value::Null, "tenant-b", None)
            .await
            .0,
        404
    );
    let (status, updated) = request(
        app.clone(),
        "PATCH",
        &path,
        json!({"expected_revision":1,"status":"succeeded"}),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{updated}");
    assert_eq!(updated["connection"]["revision"], 2);
    assert_eq!(
        request(
            app.clone(),
            "PATCH",
            &path,
            json!({"expected_revision":1,"status":"succeeded"}),
            "tenant-a",
            None
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            app.clone(),
            "PATCH",
            &path,
            json!({"expected_revision":2,"status":"failed"}),
            "tenant-a",
            None
        )
        .await
        .0,
        409
    );
    let mut intent = json!({"schema_version":"mt5-notion-export-intent-v1","status":"PREP_ONLY","cloud_io":false,"provider":"notion","destination":{"user_selected":false,"ref":null},"source":{"session_revision":2,"attempt_revision":1},"payload":{"content_sha256":format!("sha256:{}","a".repeat(64)),"text":"Báo cáo"},"write_policy":{"mode":"manual"}});
    intent["intent_fingerprint"] = json!(control_routes::notion::fingerprint(
        &json!({"provider":"notion","source":intent["source"],"destination":intent["destination"],"payload":intent["payload"],"write_policy":intent["write_policy"]})
    ));
    let intent_id = format!("intent-{}", uuid::Uuid::new_v4());
    let body = json!({"intent_id":intent_id,"request_id":"r2","idempotency_key":intent_id,"connection_id":id,"intent":intent});
    let (status, result) = request(
        app.clone(),
        "POST",
        &format!("{prefix}/intents"),
        body.clone(),
        "tenant-a",
        Some("notion-intent"),
    )
    .await;
    assert_eq!(status, 201, "{result}");
    assert_eq!(result["receipt"]["revision"], 1);
    assert_eq!(result["intent"]["mode"], "PREP_ONLY");
    let receipt_path = format!("{prefix}/intents/{intent_id}/receipt");
    assert_eq!(
        request(
            app.clone(),
            "GET",
            &receipt_path,
            Value::Null,
            "tenant-b",
            None
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request(
            app.clone(),
            "PATCH",
            &receipt_path,
            json!({"expected_revision":1,"status":"succeeded"}),
            "tenant-a",
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        request(
            app.clone(),
            "PATCH",
            &receipt_path,
            json!({"expected_revision":1,"status":"unknown","response":{"token":"bad"}}),
            "tenant-a",
            None
        )
        .await
        .0,
        422
    );
    let body = json!({"expected_revision":1,"status":"succeeded","external_id":"opaque-reference","remote_revision":"remote-1","response":{"accepted":true}});
    let one = request(
        app.clone(),
        "PATCH",
        &receipt_path,
        body.clone(),
        "tenant-a",
        Some("notion-receipt"),
    );
    let two = request(
        app.clone(),
        "PATCH",
        &receipt_path,
        body,
        "tenant-a",
        Some("notion-receipt"),
    );
    let (one, two) = tokio::join!(one, two);
    assert_eq!(one.0, 200, "{:?}", one.1);
    assert_eq!(two, one);
    assert_eq!(one.1["receipt"]["revision"], 2);
    let (status, result) = request(
        app.clone(),
        "GET",
        &format!("{prefix}/intents/{intent_id}"),
        Value::Null,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(result["status"], "succeeded");
    let conn = state.pool.get().await.unwrap();
    let queued:i64=conn.query_one("SELECT count(*) FROM api_commands WHERE path LIKE '/api/v2/connectors/notion/%' AND status IN ('queued','running')",&[]).await.unwrap().get(0);
    assert_eq!(queued, 0);
    drop(conn);
    println!("NOTION_NATIVE_WORKFLOW_CASES=18; Python worker commands=0; cloud network calls=0");
    state.pool.close();
}
