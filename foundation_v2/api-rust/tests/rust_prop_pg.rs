use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use trading_workspace_api::{catalog, config::Config, prop_core, prop_service, state::AppState};

async fn request(
    app: axum::Router,
    method: &str,
    path: &str,
    body: Value,
    workspace: &str,
    key: Option<&str>,
) -> (u16, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("x-workspace-id", workspace)
        .header("content-type", "application/json");
    if let Some(k) = key {
        builder = builder.header("idempotency-key", k)
    }
    let response = app
        .oneshot(
            builder
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
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes))),
    )
}
#[tokio::test]
#[ignore = "requires explicitly owned disposable PostgreSQL via rust_metadata_parity.py"]
async fn canonical_prop_session_workflow() {
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
    let app = prop_service::routes()
        .merge(catalog::routes())
        .with_state(state.clone());
    let cases: Value = serde_json::from_str(include_str!(
        "../../evidence/rust-native-20261017/prop/fixtures.json"
    ))
    .unwrap();
    let case = cases
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["op"] == "event")
        .unwrap();
    let args = case["args"].as_array().unwrap();
    let mut session = args[0].clone();
    let mut attempt = args[1].clone();
    let mut phase = args[2].clone();
    let id = format!("prop-{}", uuid::Uuid::new_v4());
    session["session_id"] = json!(id);
    session["status"] = json!("ready");
    attempt["session_id"] = json!(id);
    attempt["status"] = json!("ready");
    attempt["revision"] = json!(1);
    phase["session_id"] = json!(id);
    phase["last_event_sequence"] = json!(0);
    let resume = json!({"cursor":{"bar_index":0,"timestamp_utc":phase["virtual_time_utc"]},"open_positions":[],"pending_orders":[]});
    let body = json!({"session":session,"attempt":attempt,"phase":phase,"resume_state":resume});
    let (status, created) = request(
        app.clone(),
        "POST",
        "/api/v2/prop/session-bundles",
        body.clone(),
        "tenant-a",
        Some("prop-bundle"),
    )
    .await;
    assert_eq!(status, 201, "{created}");
    assert_eq!(created["duplicate"], false);
    let (status, retry) = request(
        app.clone(),
        "POST",
        "/api/v2/prop/session-bundles",
        body.clone(),
        "tenant-a",
        Some("prop-bundle"),
    )
    .await;
    assert_eq!(status, 201, "{retry}");
    assert_eq!(retry, created);
    let (status, duplicate) = request(
        app.clone(),
        "POST",
        "/api/v2/prop/session-bundles",
        body.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 201, "{duplicate}");
    assert_eq!(duplicate["duplicate"], true);
    let mut changed = body.clone();
    changed["phase"]["daily_anchor"] = json!("99999");
    let (status, error) = request(
        app.clone(),
        "POST",
        "/api/v2/prop/session-bundles",
        changed,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 409, "{error}");
    let (status, error) = request(
        app.clone(),
        "POST",
        "/api/v2/prop/session-bundles",
        body.clone(),
        "tenant-b",
        None,
    )
    .await;
    assert_eq!(status, 403, "{error}");
    let base = format!(
        "/api/v2/prop/sessions/{id}/attempts/{}",
        attempt["attempt_id"].as_str().unwrap()
    );
    let mut intent = json!({"workspace_id":"tenant-a","session_id":id,"attempt_id":attempt["attempt_id"],"profile_hash":attempt["profile_hash"],"intent_id":"start","expected_revision":1,"event_sequence":0,"action":"start"});
    let (status, started) = request(
        app.clone(),
        "POST",
        &format!("{base}/transitions"),
        intent.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{started}");
    assert_eq!(started["attempt"]["status"], "running");
    assert_eq!(started["attempt"]["revision"], 2);
    assert_eq!(started["session"]["revision"], 2);
    let (status, dupe) = request(
        app.clone(),
        "POST",
        &format!("{base}/transitions"),
        intent.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{dupe}");
    assert_eq!(dupe["duplicate"], true);
    intent["action"] = json!("abandon");
    let (status, error) = request(
        app.clone(),
        "POST",
        &format!("{base}/transitions"),
        intent.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 409, "{error}");
    intent["intent_id"] = json!("forged-pass");
    intent["expected_revision"] = json!(2);
    intent["action"] = json!("complete_pass");
    let (status, error) = request(
        app.clone(),
        "POST",
        &format!("{base}/transitions"),
        intent.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 409, "{error}");
    let mut resumed_attempt = started["attempt"].clone();
    resumed_attempt["revision"] = json!(3);
    let save = json!({"attempt":resumed_attempt,"phase":started["phase"],"resume_state":started["resume_state"],"expected_revision":2,"operation_id":"save"});
    let (status, saved) = request(
        app.clone(),
        "PUT",
        &format!("{base}/resume"),
        save.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{saved}");
    assert_eq!(saved["attempt"]["revision"], 3);
    let (status, saved_dupe) = request(
        app.clone(),
        "PUT",
        &format!("{base}/resume"),
        save.clone(),
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{saved_dupe}");
    assert_eq!(saved_dupe["duplicate"], true);
    // Feed the pure evaluator through the same transactional helper used by replay.
    let mut e = args[3].clone();
    e["session_id"] = json!(id);
    e["expected_revision"] = json!(3);
    e["event_sequence"] = json!(1);
    e["balance_before_separate_costs"] = json!("110000");
    let mut conn = state.pool.get().await.unwrap();
    let tx = conn.transaction().await.unwrap();
    let mut feed_resume = saved["resume_state"].clone();
    feed_resume["cursor"] = json!({"bar_index":1,"timestamp_utc":e["virtual_time_utc"]});
    let fed = prop_service::apply_lifecycle_event(&tx, "tenant-a", &e, Some(&feed_resume))
        .await
        .unwrap();
    tx.commit().await.unwrap();
    drop(conn);
    assert_eq!(fed["attempt"]["status"], "completed_pass");
    assert_eq!(fed["attempt"]["revision"], 4);
    let mut conn = state.pool.get().await.unwrap();
    let tx = conn.transaction().await.unwrap();
    let dupe = prop_service::apply_lifecycle_event(&tx, "tenant-a", &e, Some(&feed_resume))
        .await
        .unwrap();
    assert_eq!(dupe["duplicate"], true);
    assert_eq!(dupe["attempt"], fed["attempt"]);
    tx.commit().await.unwrap();
    drop(conn);
    let (status, report) = request(
        app.clone(),
        "GET",
        &format!("{base}/report"),
        Value::Null,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{report}");
    let expected = prop_core::report::build_prop_attempt_report(
        &fed["session"],
        &fed["attempt"],
        &fed["phase"],
        &fed["resume_state"],
    )
    .unwrap();
    assert_eq!(report, expected);
    let (status, csv) = request(
        app.clone(),
        "GET",
        &format!("{base}/report.csv"),
        Value::Null,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{csv}");
    assert_eq!(csv, prop_core::report::prop_attempt_report_csv(&report));
    let (status, list) = request(
        app.clone(),
        "GET",
        "/api/v2/prop/reports?status=completed_pass",
        Value::Null,
        "tenant-a",
        None,
    )
    .await;
    assert_eq!(status, 200, "{list}");
    assert!(list["items"].as_array().unwrap().contains(&report));
    let (status, error) = request(
        app.clone(),
        "GET",
        &format!("{base}/report"),
        Value::Null,
        "tenant-b",
        None,
    )
    .await;
    assert_eq!(status, 404, "{error}");

    // Collection reads must reject the same corrupt stored state as a detail read.
    let conn = state.pool.get().await.unwrap();
    conn.execute("UPDATE prop_attempts SET phase_json=jsonb_set(phase_json,'{equity}','\"123456.78\"'::jsonb) WHERE workspace_id='tenant-a' AND session_id=$1", &[&id]).await.unwrap();
    drop(conn);
    for path in [
        format!("{base}/report"),
        "/api/v2/prop/reports?status=completed_pass".to_owned(),
    ] {
        let (status, error) =
            request(app.clone(), "GET", &path, Value::Null, "tenant-a", None).await;
        assert_eq!(status, 503, "{path}: {error}");
        assert_eq!(error["detail"], "stored_contract_untrusted");
    }
}
