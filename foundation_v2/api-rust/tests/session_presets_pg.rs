//! Explicit disposable PostgreSQL only; exercise the same auth and receipt boundary as HTTP.
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
    key: Option<&str>,
) -> (u16, Value, Vec<u8>, Option<String>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if !workspace.is_empty() {
        builder = builder.header("x-workspace-id", workspace);
    }
    if let Some(key) = key {
        builder = builder.header("idempotency-key", key);
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(if method == "GET" || method == "HEAD" {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let command = response
        .headers()
        .get("x-command-id")
        .map(|value| value.to_str().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, value, bytes, command)
}
fn config() -> Value {
    json!({"balance":"100000","datasets":["dataset-a"],"strategy":"",
    "propDraft":{"profileKind":"generic","targetPercent":"10","dailyLoss":"500","overallLoss":"1000","durationDays":""},
    "tradingOptions":{"version":"session-trading-options-v2","costs_enabled":true,"assets":{"dataset-a":{"spread_price":"0.00020","commission_per_lot":"7","commission_charge":"round_trip","slippage":{"mode":"fixed","fixed_steps":2}}}}})
}

#[tokio::test]
#[ignore = "owned disposable PostgreSQL via session_presets_pg.py only"]
async fn workspace_presets_are_persisted_atomic_scoped_and_revision_checked() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let connection = state.pool.get().await.unwrap();
    let row = connection
        .query_one(
            "SELECT current_database(),current_setting('data_directory')",
            &[],
        )
        .await
        .unwrap();
    assert!(
        row.get::<_, String>(0).starts_with("rust_session_presets_"),
        "refuse owner database"
    );
    let directory = std::path::PathBuf::from(row.get::<_, String>(1));
    assert!(
        directory
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("session-presets-fixture-")
    );
    drop(connection);
    let app = trading_workspace_api::router(state.clone(), trading_workspace_api::domain_routes());
    let base = "/api/v2/session-presets";
    let source = json!({"csv_text":"time,open,high,low,close\n1767268800,1.1,1.11,1.09,1.1\n1767268860,1.1,1.11,1.09,1.1\n1767268920,1.1,1.11,1.09,1.1\n",
        "source":{"source_id":"preset-fixture","provider":"CSV","instrument_mapping":{"EURUSD":"EURUSD"},"license_use":"generated fixture","retrieved_at_utc":"2026-10-18","export_settings":"UTC"},
        "instrument":{"instrument_id":"EURUSD","asset_class":"forex","base_ccy":"EUR","quote_ccy":"USD","account_ccy":"USD","tick_size":"0.00001","pip_size":"0.0001","contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":"2020-01-01"},"timeframe_seconds":60});
    let imported = request(
        &app,
        "POST",
        "/api/v2/data/csv/import",
        "tenant-a",
        source,
        None,
    )
    .await;
    assert_eq!(imported.0, 201, "{}", imported.1);
    let replay = request(
        &app,
        "POST",
        "/api/v2/replay/sessions",
        "tenant-a",
        json!({"dataset_id":imported.1["dataset"]["dataset_id"],"starting_balance":"100000"}),
        None,
    )
    .await;
    assert_eq!(replay.0, 201, "{}", replay.1);
    let replay_path = format!(
        "/api/v2/replay/sessions/{}",
        replay.1["record_id"].as_str().unwrap()
    );
    assert_eq!(
        request(&app, "GET", base, "tenant-a", Value::Null, None)
            .await
            .0,
        422
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=backtest"),
            "",
            Value::Null,
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=backtest"),
            "tenant-other",
            Value::Null,
            None
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "HEAD",
            &format!("{base}?mode=backtest"),
            "tenant-a",
            Value::Null,
            None
        )
        .await
        .0,
        405
    );
    let initial = request(
        &app,
        "GET",
        &format!("{base}?mode=backtest"),
        "tenant-a",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(initial.0, 200);
    assert_eq!(
        initial.1,
        json!({"version":"session-presets-v1","items":[]})
    );

    let body = json!({"mode":"backtest","name":"  PHIÊN chuẩn  ","config":config()});
    let created = request(
        &app,
        "POST",
        base,
        "tenant-a",
        body.clone(),
        Some("session-preset-import-v1:backtest:old-id"),
    )
    .await;
    assert_eq!(created.0, 201, "{}", created.1);
    assert_eq!(created.1["revision"], 1);
    assert_eq!(created.1["name"], "PHIÊN chuẩn");
    assert_eq!(
        created.1["config"]["tradingOptions"]["assets"]["dataset-a"]["spread_price"],
        "0.00020"
    );
    let id = created.1["id"].as_str().unwrap();
    let revise = format!("{base}/{id}/revisions");
    let delete = format!("{base}/{id}/delete");
    let retry = request(
        &app,
        "POST",
        base,
        "tenant-a",
        body.clone(),
        Some("session-preset-import-v1:backtest:old-id"),
    )
    .await;
    assert_eq!(created, retry);
    let mut other = body.clone();
    other["name"] = json!("changed");
    assert_eq!(
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            other,
            Some("session-preset-import-v1:backtest:old-id")
        )
        .await
        .0,
        409
    );
    let mut duplicate = body.clone();
    duplicate["name"] = json!("phiên CHUẨN");
    let error = request(
        &app,
        "POST",
        base,
        "tenant-a",
        duplicate,
        Some("duplicate-name"),
    )
    .await;
    assert_eq!(error.0, 409);
    assert_eq!(error.1["detail"], "session_preset_name_exists");
    let mut prop = body.clone();
    prop["mode"] = json!("prop");
    assert_eq!(
        request(&app, "POST", base, "tenant-a", prop, None).await.0,
        201
    );
    assert_eq!(
        request(&app, "POST", base, "tenant-b", body.clone(), None)
            .await
            .0,
        201
    );
    let change =
        json!({"mode":"backtest","expected_revision":1,"name":"Renamed","config":config()});
    let mut wrong_mode = change.clone();
    wrong_mode["mode"] = json!("prop");
    assert_eq!(
        request(&app, "POST", &revise, "tenant-a", wrong_mode, None)
            .await
            .0,
        404
    );
    assert_eq!(
        request(&app, "POST", &revise, "tenant-b", change.clone(), None)
            .await
            .0,
        404
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{revise}?mode=prop"),
            "tenant-a",
            change.clone(),
            None
        )
        .await
        .0,
        422
    );
    let revised = request(
        &app,
        "POST",
        &revise,
        "tenant-a",
        change.clone(),
        Some("revise"),
    )
    .await;
    assert_eq!(revised.0, 200, "{}", revised.1);
    assert_eq!(revised.1["revision"], 2);
    assert_eq!(
        request(
            &app,
            "POST",
            &revise,
            "tenant-a",
            change.clone(),
            Some("revise")
        )
        .await,
        revised
    );
    let stale = request(
        &app,
        "POST",
        &revise,
        "tenant-a",
        change.clone(),
        Some("stale"),
    )
    .await;
    assert_eq!(stale.0, 409);
    assert_eq!(stale.1["detail"], "session_preset_revision_conflict");
    assert_eq!(
        request(&app, "POST", &revise, "tenant-a", change, Some("stale")).await,
        stale
    );
    let mut invalid = config();
    invalid["tradingOptions"]["assets"]["dataset-a"]["slippage"]["fixed_steps"] = json!(21);
    assert_eq!(
        request(
            &app,
            "POST",
            &revise,
            "tenant-a",
            json!({"mode":"backtest","expected_revision":2,"name":"bad","config":invalid}),
            None
        )
        .await
        .0,
        422
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=backtest"),
            "tenant-a",
            Value::Null,
            None
        )
        .await
        .1["items"],
        json!([revised.1])
    );
    let peer = request(
        &app,
        "POST",
        &format!("{base}?mode=backtest"),
        "tenant-a",
        json!({"name":"Peer","config":config()}),
        None,
    )
    .await;
    assert_eq!(peer.0, 201);
    let collision = request(
        &app,
        "POST",
        &revise,
        "tenant-a",
        json!({"mode":"backtest","expected_revision":2,"name":" peer ","config":config()}),
        None,
    )
    .await;
    assert_eq!(collision.0, 409);
    assert_eq!(collision.1["detail"], "session_preset_name_exists");
    let removed_peer = request(
        &app,
        "POST",
        &format!("{base}/{}/delete", peer.1["id"].as_str().unwrap()),
        "tenant-a",
        json!({"mode":"backtest","expected_revision":1}),
        None,
    )
    .await;
    assert_eq!(removed_peer.0, 200);

    let concurrent =
        json!({"mode":"backtest","expected_revision":2,"name":"Concurrent","config":config()});
    let (a, b) = tokio::join!(
        request(
            &app,
            "POST",
            &revise,
            "tenant-a",
            concurrent.clone(),
            Some("edit-a")
        ),
        request(
            &app,
            "POST",
            &revise,
            "tenant-a",
            concurrent,
            Some("edit-b")
        )
    );
    let mut codes = [a.0, b.0];
    codes.sort();
    assert_eq!(codes, [200, 409]);
    assert_eq!(
        request(
            &app,
            "POST",
            &delete,
            "tenant-a",
            json!({"mode":"backtest","expected_revision":2}),
            None
        )
        .await
        .0,
        409
    );
    let deletion = json!({"mode":"backtest","expected_revision":3});
    let deleted = request(
        &app,
        "POST",
        &delete,
        "tenant-a",
        deletion.clone(),
        Some("delete"),
    )
    .await;
    assert_eq!(deleted.0, 200);
    assert_eq!(
        deleted.1,
        json!({"id":id,"mode":"backtest","revision":4,"deleted":true})
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &delete,
            "tenant-a",
            deletion.clone(),
            Some("delete")
        )
        .await,
        deleted
    );
    assert_eq!(
        request(&app, "POST", &delete, "tenant-a", deletion, None)
            .await
            .0,
        404
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=backtest"),
            "tenant-a",
            Value::Null,
            None
        )
        .await
        .1["items"],
        json!([])
    );
    let replacement = json!({"mode":"backtest","name":"Concurrent","config":config()});
    let replacement = request(&app, "POST", base, "tenant-a", replacement, None).await;
    assert_eq!(replacement.0, 201);
    assert_ne!(replacement.1["id"], id);

    // The existing Prop preset leaves 48 slots before two simultaneous contenders.
    for n in 0..48 {
        let result = request(
            &app,
            "POST",
            base,
            "tenant-a",
            json!({"mode":"prop","name":format!("limit-{n}"),"config":config()}),
            None,
        )
        .await;
        assert_eq!(result.0, 201, "{}", result.1);
    }
    let (a, b) = tokio::join!(
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            json!({"mode":"prop","name":"last-a","config":config()}),
            None
        ),
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            json!({"mode":"prop","name":"last-b","config":config()}),
            None
        )
    );
    let mut codes = [a.0, b.0];
    codes.sort();
    assert_eq!(codes, [201, 409]);
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=prop"),
            "tenant-a",
            Value::Null,
            None
        )
        .await
        .1["items"]
            .as_array()
            .unwrap()
            .len(),
        50
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{base}?mode=prop"),
            "tenant-b",
            Value::Null,
            None
        )
        .await
        .1["items"],
        json!([])
    );
    let connection = state.pool.get().await.unwrap();
    let count: i64 = connection
        .query_one(
            "SELECT count(*) FROM api_commands WHERE status IN ('queued','running')",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(count, 0);
    drop(connection);

    let new_state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let new_app =
        trading_workspace_api::router(new_state.clone(), trading_workspace_api::domain_routes());
    let loaded = request(
        &new_app,
        "GET",
        &format!("{base}?mode=backtest"),
        "tenant-a",
        Value::Null,
        None,
    )
    .await;
    assert_eq!(loaded.0, 200);
    assert_eq!(loaded.1["items"], json!([replacement.1]));
    let recovered = request(
        &new_app,
        "POST",
        base,
        "tenant-a",
        body,
        Some("session-preset-import-v1:backtest:old-id"),
    )
    .await;
    assert_eq!(recovered, created); // Exact receipt survives deletion and a new AppState.
    assert_eq!(
        request(&new_app, "GET", &replay_path, "tenant-a", Value::Null, None)
            .await
            .1,
        replay.1
    );
    new_state.pool.close();
    state.pool.close();
}
