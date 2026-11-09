//! Workspace labels only: a disposable DB with synthetic saved MT5 data, no collector.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, state::AppState};

async fn request(app: &Router, workspace: &str, body: Option<Value>) -> (u16, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(if body.is_some() { "POST" } else { "GET" })
                .uri("/api/v2/trade-labels")
                .header("x-workspace-id", workspace)
                .header("content-type", "application/json")
                .body(body.map_or_else(Body::empty, |v| Body::from(v.to_string())))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn save(app: &Router, body: Value) -> Value {
    let result = request(app, "tenant-a", Some(body)).await;
    assert_eq!(result.0, 200, "{}", result.1);
    result.1
}

#[tokio::test]
#[ignore = "owned disposable PostgreSQL via trade_labels_pg.py"]
async fn groups_shared_catalog_live_labels_revisions_and_isolation() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let mut db = state.pool.get().await.unwrap();
    assert_eq!(
        db.query_one("SELECT current_database()", &[])
            .await
            .unwrap()
            .get::<_, String>(0),
        "rust_trade_labels_fixture"
    );
    let app = trading_workspace_api::router(
        state.clone(),
        trading_workspace_api::runtime_domain_routes(&state).unwrap(),
    );
    let group = save(&app, json!({"action":"create_group","name":"Trade Rating"})).await;
    let group_id = group["groups"][0]["id"].as_str().unwrap();
    let created = save(
        &app,
        json!({"action":"create","name":"Good","color":"green","group_id":group_id}),
    )
    .await;
    let label_id = created["items"][0]["id"].as_str().unwrap();
    assert_eq!(created["items"][0]["group_id"], group_id);
    assert_eq!(created["items"][0]["archived"], false);
    assert_eq!(
        request(
            &app,
            "tenant-a",
            Some(json!({"action":"archive_group","id":label_id,"expected_revision":1}))
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "tenant-a",
            Some(json!({"action":"delete","id":group_id,"expected_revision":1}))
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "tenant-a",
            Some(json!({"action":"create","name":"Bad group","color":"red","group_id":"missing"}))
        )
        .await
        .0,
        422
    );

    let connection = uuid::Uuid::new_v4();
    let snapshot = json!({"deals":[{"position_id":123,"type":0},{"position_id":456,"type":1}],"positions":[{"identifier":789,"ticket":790}],"account":{"balance":1000}});
    db.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,status,snapshot) VALUES('tenant-a',$1,$2,'synthetic','Fixture','Fixture-Demo','1234567','2026-01-01','connected',$3)", &[&connection,&uuid::Uuid::new_v4(),&snapshot]).await.unwrap();
    let session = format!("live:{connection}");
    let assignment = json!({"action":"assign","session_id":session,"trade_id":"position:123","expected_revision":0,"tags":["Good"]});
    assert_eq!(
        request(&app, "tenant-b", Some(assignment.clone())).await.0,
        404
    );
    assert_eq!(request(&app, "tenant-a", Some(json!({"action":"assign","session_id":session,"trade_id":"position:999","expected_revision":0,"tags":["Good"]}))).await.0, 404);
    let assigned = save(&app, assignment.clone()).await;
    assert_eq!(assigned["assignment"]["tags"], json!(["Good"]));
    assert_eq!(assigned["assignment"]["revision"], 1);
    assert_eq!(request(&app, "tenant-a", Some(assignment)).await.0, 409);
    assert_eq!(
        request(&app, "tenant-b", None).await.1["assignments"],
        json!([])
    );

    let renamed = save(&app, json!({"action":"update","id":label_id,"expected_revision":1,"name":"Excellent","color":"blue"})).await;
    assert_eq!(
        renamed["items"][0]["group_id"], group_id,
        "legacy edits without group_id retain membership"
    );
    assert_eq!(renamed["assignments"][0]["tags"], json!(["Excellent"]));
    assert_eq!(renamed["items"][0]["color"], "blue");
    let tx = db.transaction().await.unwrap();
    let mut practice =
        vec![json!({"session_id":"practice-fixture","trade_id":"trade-1","tags":["Good"]})];
    trading_workspace_api::trade_labels::project(&tx, "tenant-a", &mut practice, None)
        .await
        .unwrap();
    assert_eq!(practice[0]["tags"], json!(["Excellent"]));
    tx.commit().await.unwrap();
    assert_eq!(request(&app, "tenant-a", Some(json!({"action":"update","id":label_id,"expected_revision":1,"name":"Stale","color":"green"}))).await.0, 409);
    let ungrouped = save(&app, json!({"action":"update","id":label_id,"expected_revision":2,"name":"Excellent","color":"blue","group_id":null})).await;
    assert!(ungrouped["items"][0]["group_id"].is_null());
    save(&app, json!({"action":"update","id":label_id,"expected_revision":3,"name":"Excellent","color":"blue","group_id":group_id})).await;
    let archived = save(
        &app,
        json!({"action":"archive_group","id":group_id,"expected_revision":1}),
    )
    .await;
    assert_eq!(archived["groups"][0]["archived"], true);
    assert_eq!(archived["items"][0]["archived"], true);
    assert_eq!(
        archived["assignments"][0]["tags"],
        json!(["Excellent"]),
        "archiving retains history"
    );
    assert_eq!(request(&app, "tenant-a", Some(json!({"action":"assign","session_id":session,"trade_id":"position:456","expected_revision":0,"tags":["Excellent"]}))).await.0, 422);
    save(&app, json!({"action":"assign","session_id":session,"trade_id":"position:123","expected_revision":1,"tags":["Excellent"]})).await;
    save(&app, json!({"action":"assign","session_id":session,"trade_id":"position:789","expected_revision":0,"tags":[]})).await;
    let stored: Value = db.query_one("SELECT snapshot FROM mt5_connections WHERE workspace_id='tenant-a' AND connection_id=$1", &[&connection]).await.unwrap().get(0);
    assert_eq!(
        stored, snapshot,
        "tag metadata never mutates execution data"
    );
    state.pool.close();
}
