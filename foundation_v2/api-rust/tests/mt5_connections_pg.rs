//! Never starts the collector or logs into a broker. Own disposable DB only.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, state::AppState};
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    workspace: &str,
    body: Value,
) -> (u16, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("x-workspace-id", workspace)
                .header("content-type", "application/json")
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[tokio::test]
#[ignore = "owned disposable PostgreSQL via mt5_connections_pg.py"]
async fn secrets_retries_isolation_and_lifecycle() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let db = state.pool.get().await.unwrap();
    assert_eq!(
        db.query_one("SELECT current_database()", &[])
            .await
            .unwrap()
            .get::<_, String>(0),
        "rust_mt5_connections_fixture"
    );
    let app = trading_workspace_api::router(
        state.clone(),
        trading_workspace_api::runtime_domain_routes(&state).unwrap(),
    );
    let base = "/api/v2/live/connections";
    let draft = json!({"request_id":uuid::Uuid::new_v4(),"name":"Fixture","server":"Fixture-Demo","login":"1234567","password":"synthetic-private-value","start_date":"2026-01-01"});
    assert_eq!(
        request(&app, "GET", base, "tenant-z", Value::Null).await.0,
        403
    );
    let mut invalid = draft.clone();
    invalid["login"] = json!("../../secret");
    let rejected = request(&app, "POST", base, "tenant-a", invalid).await;
    assert_eq!(rejected.0, 422);
    assert!(!rejected.1.to_string().contains("secret"));
    let created = request(&app, "POST", base, "tenant-a", draft.clone()).await;
    assert_eq!(created.0, 202, "{}", created.1);
    assert_eq!(created.1["status"], "queued");
    assert_eq!(created.1["requested_mode"], "read_only");
    assert_eq!(created.1["login_hint"], "…4567");
    assert!(!created.1.to_string().contains("synthetic-private"));
    assert!(created.1.get("credential").is_none());
    let id = created.1["id"].as_str().unwrap();
    assert_eq!(
        request(&app, "POST", base, "tenant-a", draft.clone()).await,
        created
    );
    let row = db
        .query_one(
            "SELECT credential,generation FROM mt5_connections WHERE workspace_id='tenant-a'",
            &[],
        )
        .await
        .unwrap();
    let sealed: String = row.get(0);
    assert!(!sealed.contains("synthetic-private"));
    assert_eq!(row.get::<_, i64>(1), 1);
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM api_commands WHERE body::text LIKE '%synthetic-private%'",
            &[]
        )
        .await
        .unwrap()
        .get::<_, i64>(0),
        0
    );
    assert_eq!(
        request(&app, "GET", base, "tenant-b", Value::Null).await.1["items"],
        json!([])
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/{id}/disconnect"),
            "tenant-b",
            Value::Null
        )
        .await
        .0,
        404
    );
    let mut reconnected = draft.clone();
    reconnected["request_id"] = json!(uuid::Uuid::new_v4());
    reconnected["name"] = json!("Renamed");
    reconnected["password"] = json!("new-synthetic-private");
    reconnected["requested_mode"] = json!("trading");
    assert_eq!(
        request(&app, "POST", base, "tenant-a", reconnected).await.0,
        202
    );
    let replay = request(&app, "POST", base, "tenant-a", draft.clone()).await;
    assert_eq!(replay.1["name"], "Renamed");
    assert_eq!(replay.1["requested_mode"], "trading");
    assert_eq!(
        db.query_one(
            "SELECT generation FROM mt5_connections WHERE workspace_id='tenant-a'",
            &[]
        )
        .await
        .unwrap()
        .get::<_, i64>(0),
        2
    );
    let mut conflict = draft;
    conflict["name"] = json!("Changed old request");
    assert_eq!(
        request(&app, "POST", base, "tenant-a", conflict).await.0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/{id}/pause"),
            "tenant-a",
            Value::Null
        )
        .await
        .1["status"],
        "paused"
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/{id}/resume"),
            "tenant-a",
            Value::Null
        )
        .await
        .1["status"],
        "queued"
    );
    let status = request(
        &app,
        "GET",
        &format!("/api/v2/live/status?connection_id={id}"),
        "tenant-a",
        Value::Null,
    )
    .await;
    assert_eq!(status.0, 200);
    assert_eq!(status.1["status"], "unavailable");
    assert_eq!(status.1["connections"].as_array().unwrap().len(), 1);
    let snapshot = json!({"status":"ready","source":"Fixture","captured_at_utc":"2026-10-21T00:00:00Z","account":{"balance":1000,"currency":"USD"},"account_binding":{"login":"1234567","server":"Fixture-Demo","generation":2},"account_environment":"demo","deals":(1..=1000).map(|ticket|json!({"ticket":ticket,"profit":1,"time_msc":ticket})).collect::<Vec<_>>(),"cashflows":[]});
    let connection_id = uuid::Uuid::parse_str(id).unwrap();
    let generation: i64 = db.query_one("SELECT generation FROM mt5_connections WHERE workspace_id='tenant-a' AND connection_id=$1", &[&connection_id]).await.unwrap().get(0);
    assert_eq!(trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-a", connection_id, generation - 1, &snapshot).await.unwrap(), 0);
    assert_eq!(trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-b", connection_id, generation, &snapshot).await.unwrap(), 0);
    assert_eq!(trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-a", connection_id, generation, &snapshot).await.unwrap(), 1);
    let mut updated_snapshot = snapshot.clone();
    updated_snapshot["account"]["balance"] = json!(2000);
    updated_snapshot["captured_at_utc"] = json!("2026-10-22T00:00:00Z");
    trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-a", connection_id, generation, &updated_snapshot).await.unwrap();
    let full = request(
        &app,
        "GET",
        &format!("/api/v2/live/status?connection_id={id}"),
        "tenant-a",
        Value::Null,
    )
    .await;
    let summary = request(
        &app,
        "GET",
        &format!("/api/v2/live/status?connection_id={id}&summary=true"),
        "tenant-a",
        Value::Null,
    )
    .await;
    let listed = request(&app, "GET", base, "tenant-a", Value::Null).await;
    assert_eq!(listed.1["items"][0]["account_login"], "1234567");
    assert_eq!(listed.1["items"][0]["account_environment"], "demo");
    let baseline = json!({"amount":1000,"currency":"USD","captured_at_utc":"2026-10-21T00:00:00Z","source":"first_sync"});
    assert_eq!(listed.1["items"][0]["balance_baseline"], baseline);
    assert_eq!(summary.1["balance_baseline"], baseline);
    assert_eq!(full.1["balance_baseline"], baseline);
    assert_eq!(full.1["account"]["balance"], 2000);
    assert_eq!(summary.1["connections"][0]["account_login"], "1234567");
    assert!(listed.1["items"][0].get("account_binding").is_none());
    assert!(listed.1["items"][0].get("deals").is_none());
    assert!(!listed.1.to_string().contains("synthetic-private"));
    assert_eq!(request(&app, "GET", base, "tenant-b", Value::Null).await.1["items"], json!([]));
    let renamed = request(&app, "POST", &format!("{base}/{id}/rename"), "tenant-a", json!({"name":"Standard"})).await;
    assert_eq!(renamed.1["account_login"], "1234567");
    assert!(summary.1.get("deals").is_none());
    assert_eq!(full.1["deals"].as_array().unwrap().len(), 1000);
    let full_bytes = full.1.to_string().len();
    let summary_bytes = summary.1.to_string().len();
    assert!(summary_bytes * 10 < full_bytes);
    println!("full_bytes={full_bytes}; summary_bytes={summary_bytes}");
    let path = format!("/api/v2/live/status?connection_id={id}");
    let first = app
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
    let etag = first.headers()["etag"].clone();
    let unchanged = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&path)
                .header("x-workspace-id", "tenant-a")
                .header("if-none-match", etag.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unchanged.status(), 304);
    assert!(
        to_bytes(unchanged.into_body(), 1024)
            .await
            .unwrap()
            .is_empty()
    );
    // Placement metadata is independent of the snapshot sync revision, but
    // must invalidate the full-history validator and remain tenant scoped.
    let terminal_key = format!(
        "{:x}",
        Sha256::digest(format!("mt5-managed:tenant-a:{id}").as_bytes())
    );
    let command = json!({"action":"place","account_id":"1234567","server":"Fixture-Demo","symbol":"EURUSD","side":"BUY","order_type":"market","volume":0.01,"stop_loss":1.1,"take_profit":1.2});
    let receipt = json!({"status":"filled","deal":1,"order":10,"volume":0.01,"scope":{"account_id":"1234567","server":"Fixture-Demo"},"estimate":{"estimated_stop_risk":10.0,"currency":"USD"}});
    db.execute("UPDATE mt5_connections SET snapshot=jsonb_set(snapshot,'{deals,0,entry}','0') WHERE workspace_id='tenant-a' AND connection_id=$1", &[&connection_id]).await.unwrap();
    db.execute("INSERT INTO mt5_demo_requests(workspace_id,request_id,terminal_key,fingerprint,status,command_body,result) VALUES('tenant-a',$1,$2,'journal-fixture','filled',$3,$4)", &[&uuid::Uuid::new_v4(),&terminal_key,&command,&receipt]).await.unwrap();
    let changed = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&path)
                .header("x-workspace-id", "tenant-a")
                .header("if-none-match", etag.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(changed.status(), 200);
    assert_ne!(changed.headers()["etag"], etag);
    let enriched: Value =
        serde_json::from_slice(&to_bytes(changed.into_body(), 1024 * 1024).await.unwrap()).unwrap();
    assert!(
        enriched["trade_placements"][0]
            .get("planned_risk")
            .is_none()
    );
    assert_eq!(enriched["trade_placements"][0]["stop_loss"], 1.1);
    assert!(
        enriched["trade_placements"][0]
            .get("command_body")
            .is_none()
    );
    let isolated = request(&app, "GET", &path, "tenant-b", Value::Null).await;
    assert!(isolated.1.get("trade_placements").is_none());
    let other = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&path)
                .header("x-workspace-id", "tenant-b")
                .header("if-none-match", etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(other.status(), 200);
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("/api/v2/live/status?connection_id={id}"),
            "tenant-b",
            Value::Null
        )
        .await
        .1["connections"],
        json!([])
    );
    // Changing history/permissions invalidates history, but not the saved baseline.
    let reconfigured = request(&app, "POST", base, "tenant-a", json!({"request_id":uuid::Uuid::new_v4(),"name":"Changed history","server":"Fixture-Demo","login":"1234567","password":"synthetic-private-value","start_date":"2026-02-01","requested_mode":"read_only"})).await;
    assert_eq!(reconfigured.0, 202);
    assert_eq!(reconfigured.1["balance_baseline"], baseline);
    assert!(reconfigured.1["account"].is_null());
    assert_eq!(trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-a", connection_id, generation, &snapshot).await.unwrap(), 0);
    trading_workspace_api::mt5_connector::persist_snapshot(&db, "tenant-a", connection_id, generation + 1, &updated_snapshot).await.unwrap();
    assert_eq!(request(&app, "GET", base, "tenant-a", Value::Null).await.1["items"][0]["balance_baseline"], baseline);
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/{id}/disconnect"),
            "tenant-a",
            Value::Null
        )
        .await
        .1["status"],
        "disconnected"
    );
    assert!(
        db.query_one(
            "SELECT credential FROM mt5_connections WHERE workspace_id='tenant-a'",
            &[]
        )
        .await
        .unwrap()
        .get::<_, Option<String>>(0)
        .is_none()
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/{id}/resume"),
            "tenant-a",
            Value::Null
        )
        .await
        .0,
        404
    );
    let rename_path = format!("{base}/{id}/rename");
    assert_eq!(
        request(
            &app,
            "POST",
            &rename_path,
            "tenant-b",
            json!({"name":"Denied"})
        )
        .await
        .0,
        422
    );
    assert_eq!(
        request(&app, "POST", &rename_path, "tenant-a", json!({"name":"  "}))
            .await
            .0,
        422
    );
    let renamed = request(
        &app,
        "POST",
        &rename_path,
        "tenant-a",
        json!({"name":"Renamed locally"}),
    )
    .await;
    assert_eq!(renamed.0, 200, "{}", renamed.1);
    assert_eq!(renamed.1["name"], "Renamed locally");
    assert_eq!(renamed.1["execution_capability"], false);
    let remove_path = format!("{base}/{id}/remove");
    use sha2::{Digest, Sha256};
    let key = Sha256::digest(format!("mt5-managed:tenant-a:{id}").as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let receipt = uuid::Uuid::new_v4();
    db.execute("INSERT INTO mt5_demo_requests(workspace_id,request_id,terminal_key,fingerprint,command_body,status,result) VALUES('tenant-a',$1,$2,'fixture','{}','unknown','{\"status\":\"unknown\"}')",&[&receipt,&key]).await.unwrap();
    let blocked = request(&app, "POST", &remove_path, "tenant-a", Value::Null).await;
    assert_eq!(blocked.0, 423);
    assert_eq!(blocked.1["detail"], "mt5_reconciliation_required");
    db.execute(
        "DELETE FROM mt5_demo_requests WHERE request_id=$1",
        &[&receipt],
    )
    .await
    .unwrap();
    assert_eq!(
        request(&app, "POST", &remove_path, "tenant-b", Value::Null)
            .await
            .0,
        200
    );
    assert_eq!(
        request(&app, "GET", base, "tenant-a", Value::Null).await.1["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        request(&app, "POST", &remove_path, "tenant-a", Value::Null)
            .await
            .1["removed"],
        true
    );
    assert_eq!(
        request(&app, "POST", &remove_path, "tenant-a", Value::Null)
            .await
            .1["removed"],
        true
    );
    assert_eq!(
        request(&app, "GET", base, "tenant-a", Value::Null).await.1["items"],
        json!([])
    );
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM mt5_connection_requests WHERE workspace_id='tenant-a'",
            &[]
        )
        .await
        .unwrap()
        .get::<_, i64>(0),
        0
    );
    state.pool.close();
}
