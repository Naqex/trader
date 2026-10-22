//! Owned disposable DB only. No SDK import, adapter invocation or terminal launch.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, state::AppState};

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    workspace: &str,
    body: Value,
) -> (u16, Value) {
    let result = app
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
    let status = result.status().as_u16();
    let bytes = to_bytes(result.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
#[ignore = "owned disposable PostgreSQL via demo_trading_pg.py"]
async fn locked_policy_durable_unknown_retries_controls_and_scopes() {
    unsafe {
        std::env::set_var("TW_V2_RUNTIME_PROFILE", "native");
    }
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let db = state.pool.get().await.unwrap();
    assert_eq!(
        db.query_one("SELECT current_database()", &[])
            .await
            .unwrap()
            .get::<_, String>(0),
        "rust_demo_trading_fixture"
    );
    db.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('tenant-a',CURRENT_TIMESTAMP::text),('tenant-b',CURRENT_TIMESTAMP::text) ON CONFLICT DO NOTHING",&[]).await.unwrap();
    let app = trading_workspace_api::router(
        state.clone(),
        trading_workspace_api::runtime_domain_routes(&state).unwrap(),
    );
    let base = "/api/v2/live/trading";
    unsafe {
        std::env::remove_var("TW_V2_MT5_DEMO_POLICY");
    }
    assert_eq!(
        request(&app, "GET", base, "tenant-z", Value::Null).await.0,
        403
    );
    let locked = request(&app, "GET", base, "tenant-a", Value::Null).await;
    assert_eq!(locked.0, 200);
    assert_eq!(locked.1["status"], "locked");
    assert_eq!(locked.1["account"], Value::Null);
    // Read-only summaries use persisted account metadata without launching a
    // terminal. Their identity binding cannot authorize preview or commands.
    let connection_id = uuid::Uuid::new_v4();
    let saved = json!({"account":{"currency":"USD","balance":1234.5,"equity":1234.5},
        "account_binding":{"login":"789","server":"Fixture-Read","account_environment":"demo","generation":1},
        "verified_permissions":{"read":true,"trade":false},"captured_at_utc":"2026-10-23T00:00:00Z"});
    db.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,credential,status,requested_mode,snapshot) VALUES('tenant-a',$1,$1,'read-fixture','Read account','Fixture-Read','789','2026-10-01','fixture-not-a-secret','connected','read_only',$2)",&[&connection_id,&saved]).await.unwrap();
    let summary_path = format!("{base}?connection_id={connection_id}&summary=true");
    let summary = request(&app,"GET",&summary_path,"tenant-a",Value::Null).await;
    assert_eq!(summary.0,200);
    assert_eq!(summary.1["account"]["balance"],1234.5);
    assert_eq!(summary.1["execution_enabled"],false);
    assert_eq!(summary.1["summary"],true);
    assert_eq!(summary.1["bars"],json!([]));
    assert!(!summary.1.to_string().contains("fixture-not-a-secret"));
    let read_draft = json!({"request_id":uuid::Uuid::new_v4(),"action":"place","connection_id":connection_id,"mode":"demo","account_id":"789","server":"Fixture-Read","symbol":"EURUSD","side":"BUY","order_type":"market","volume":0.01});
    for endpoint in ["preview","commands"] {
        let result=request(&app,"POST",&format!("{base}/{endpoint}"),"tenant-a",read_draft.clone()).await;
        assert_eq!(result.0,423);
        assert_eq!(result.1["detail"],"mt5_trading_access_required");
    }
    assert_eq!(request(&app,"GET",&summary_path,"tenant-b",Value::Null).await.1["account"],Value::Null);
    db.execute("UPDATE mt5_connections SET generation=2 WHERE connection_id=$1",&[&connection_id]).await.unwrap();
    assert_eq!(request(&app,"GET",&summary_path,"tenant-a",Value::Null).await.1["reason"],"mt5_permissions_unverified");
    db.execute("DELETE FROM mt5_connections WHERE connection_id=$1",&[&connection_id]).await.unwrap();
    let id = uuid::Uuid::new_v4();
    let draft = json!({"request_id":id,"mode":"demo","account_id":"12345","server":"Fixture-Demo","action":"place","symbol":"EURUSD","side":"BUY","order_type":"market","volume":0.01,"entry_price":null,"stop_loss":1.0,"take_profit":null,"ticket":null});
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            draft.clone()
        )
        .await
        .0,
        423
    );
    let temp = std::env::temp_dir().join(format!("demo-policy-fixture-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp).unwrap();
    // Deliberately invalid executable: control-only requests must never spawn it.
    let terminal = temp.join("terminal64.exe");
    std::fs::write(&terminal, b"NOT AN EXECUTABLE").unwrap();
    let policy_path = temp.join("policy.json");
    let policy = json!({"enabled":true,"mode":"demo","workspace_id":"tenant-a","terminal_path":terminal,"login":"12345","server":"Fixture-Demo","symbols":["EURUSD"],"max_risk_amount":100.0,"max_risk_pct":2.0,"max_positions":3,"max_volume":0.5,"max_quote_age_ms":2000,"deviation_points":5,"cost_buffer_per_lot":10.0,"magic":44556});
    std::fs::write(&policy_path, policy.to_string()).unwrap();
    unsafe {
        std::env::set_var("TW_V2_MT5_DEMO_POLICY", &policy_path);
    }
    assert_eq!(
        request(&app, "GET", base, "tenant-b", Value::Null).await.1["account"],
        Value::Null
    );
    let pause = json!({"request_id":uuid::Uuid::new_v4(),"mode":"demo","account_id":"12345","server":"Fixture-Demo","action":"pause"});
    let first = request(
        &app,
        "POST",
        &format!("{base}/commands"),
        "tenant-a",
        pause.clone(),
    )
    .await;
    assert_eq!(first.0, 200, "{}", first.1);
    assert_eq!(first.1["reason"], "demo_paused");
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/reconcile"),
            "tenant-a",
            json!({"request_id":pause["request_id"]})
        )
        .await,
        first
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            pause.clone()
        )
        .await,
        first
    );
    let mut conflict = pause.clone();
    conflict["action"] = json!("resume");
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            conflict.clone()
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            draft.clone()
        )
        .await
        .1["detail"],
        "demo_paused"
    );
    conflict["request_id"] = json!(uuid::Uuid::new_v4());
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            conflict
        )
        .await
        .1["reason"],
        "demo_resumed"
    );
    let key: String = db
        .query_one("SELECT terminal_key FROM mt5_demo_controls", &[])
        .await
        .unwrap()
        .get(0);
    // A reader must acquire the terminal lock before any adapter/SDK launch.
    // The fake terminal below must remain untouched while another process owns it.
    let lock = i64::from_be_bytes(Sha256::digest(key.as_bytes())[..8].try_into().unwrap());
    db.query_one("SELECT pg_advisory_lock($1)", &[&lock])
        .await
        .unwrap();
    let busy = request(&app, "GET", base, "tenant-a", Value::Null).await;
    assert_eq!(busy.1["reason"], "demo_terminal_busy");
    assert_eq!(busy.1["execution_enabled"], false);
    db.query_one("SELECT pg_advisory_unlock($1)", &[&lock])
        .await
        .unwrap();
    // Fingerprint matches Draft's normalized JSON (optional fields explicitly null).
    let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&draft).unwrap()));
    let unknown = json!({"request_id":id,"status":"unknown","reason":"demo_submission_in_progress_or_unknown","action":"place"});
    db.execute("INSERT INTO mt5_demo_requests(workspace_id,request_id,terminal_key,fingerprint,status,result,command_body) VALUES('tenant-a',$1,$2,$3,'unknown',$4,$5)",&[&id,&key,&fingerprint,&unknown,&draft]).await.unwrap();
    let command_path = format!("{base}/commands");
    let (a, b) = tokio::join!(
        request(&app, "POST", &command_path, "tenant-a", draft.clone()),
        request(&app, "POST", &command_path, "tenant-a", draft.clone())
    );
    assert_eq!(a, (200, unknown.clone()));
    assert_eq!(a, b);
    // Forged/legacy receipts without exact account+magic binding cannot invoke
    // the read-only adapter or unlock an uncertain request.
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/reconcile"),
            "tenant-a",
            json!({"request_id":id})
        )
        .await
        .1["detail"],
        "demo_identity_mismatch"
    );
    let mut next = draft.clone();
    next["request_id"] = json!(uuid::Uuid::new_v4());
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{base}/commands"),
            "tenant-a",
            next.clone()
        )
        .await
        .1["detail"],
        "demo_unresolved_request"
    );
    next["action"] = json!("close");
    next["ticket"] = json!(77);
    assert_eq!(
        request(&app, "POST", &format!("{base}/commands"), "tenant-a", next)
            .await
            .1["detail"],
        "demo_unresolved_request"
    );
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM mt5_demo_requests WHERE request_id=$1",
            &[&id]
        )
        .await
        .unwrap()
        .get::<_, i64>(0),
        1
    );
    // Even policy revocation returns the durable known receipt, never resends.
    unsafe {
        std::env::remove_var("TW_V2_MT5_DEMO_POLICY");
    }
    assert_eq!(
        request(&app, "POST", &format!("{base}/commands"), "tenant-a", draft).await,
        (200, unknown)
    );
    std::fs::remove_file(policy_path).unwrap();
    std::fs::remove_file(terminal).unwrap();
    std::fs::remove_dir(temp).unwrap();
}
