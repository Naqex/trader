//! Run only against the owned disposable fixture created by live_ledger_pg.py.
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
    key: &str,
) -> (u16, Value, Option<String>) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if !workspace.is_empty() {
        builder = builder.header("x-workspace-id", workspace);
    }
    if !key.is_empty() {
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
        .map(|v| v.to_str().unwrap().to_owned());
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
        command,
    )
}
fn account() -> Value {
    json!({"kind":"account","payload":{"name":"Fixture","currency":"USD","opening_balance":"10000.00"}})
}
fn trade(account: &Value) -> Value {
    json!({"kind":"trade","payload":{"account_id":account["record_id"],"symbol":"EURUSD","side":"SELL","quantity":"0.10","opened_at_utc":"2026-10-01T10:00:00Z","closed_at_utc":"2026-10-01T11:00:00Z","entry_price":"1.10","exit_price":"1.11","gross_pnl":"-100","commission":"-0.70","swap":"-1","fee":"-0.30","tags":["Trend"]}})
}

#[tokio::test]
#[ignore = "owned disposable PostgreSQL via live_ledger_pg.py only"]
async fn live_records_are_scoped_immutable_revisioned_and_idempotent() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let db = state.pool.get().await.unwrap();
    let row = db
        .query_one(
            "SELECT current_database(),current_setting('data_directory')",
            &[],
        )
        .await
        .unwrap();
    assert!(
        row.get::<_, String>(0).starts_with("rust_live_ledger_"),
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
            .starts_with("live-ledger-fixture-")
    );
    drop(db);
    let app = trading_workspace_api::router(state.clone(), trading_workspace_api::domain_routes());
    let base = "/api/v2/live/records";
    assert_eq!(request(&app, "GET", base, "", Value::Null, "").await.0, 422);
    assert_eq!(
        request(&app, "GET", base, "tenant-z", Value::Null, "")
            .await
            .0,
        403
    );
    assert_eq!(
        request(&app, "HEAD", base, "tenant-a", Value::Null, "")
            .await
            .0,
        405
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v2/live/records?unexpected=1",
            "tenant-a",
            Value::Null,
            ""
        )
        .await
        .0,
        422
    );
    let empty = request(&app, "GET", base, "tenant-a", Value::Null, "").await;
    assert_eq!(empty.0, 200);
    assert_eq!(empty.1["items"], json!([]));

    let created = request(&app, "POST", base, "tenant-a", account(), "account-create").await;
    assert_eq!(created.0, 201, "{}", created.1);
    let replay = request(&app, "POST", base, "tenant-a", account(), "account-create").await;
    assert_eq!(created, replay);
    let mut different = account();
    different["payload"]["name"] = json!("Other");
    assert_eq!(
        request(&app, "POST", base, "tenant-a", different, "account-create")
            .await
            .0,
        409
    );
    let mut wrong = trade(&created.1);
    wrong["payload"]["account_id"] = json!(uuid::Uuid::new_v4().to_string());
    let invalid = request(
        &app,
        "POST",
        base,
        "tenant-a",
        wrong.clone(),
        "missing-parent",
    )
    .await;
    assert_eq!(invalid.0, 422);
    assert_eq!(
        invalid,
        request(&app, "POST", base, "tenant-a", wrong, "missing-parent").await
    );
    assert_eq!(
        request(
            &app,
            "POST",
            base,
            "tenant-b",
            trade(&created.1),
            "cross-parent"
        )
        .await
        .0,
        422
    );

    // An older exact playbook revision remains a valid provenance reference.
    let db = state.pool.get().await.unwrap();
    db.batch_execute("INSERT INTO workspace_records(workspace_id,kind,record_id,current_revision,created_at_utc,updated_at_utc) VALUES('tenant-a','playbook','strategy-fixture',2,'2026-10-01','2026-10-02'); INSERT INTO workspace_record_revisions(workspace_id,kind,record_id,revision,payload_json,created_at_utc) VALUES('tenant-a','playbook','strategy-fixture',1,'{}','2026-10-01'),('tenant-a','playbook','strategy-fixture',2,'{}','2026-10-02');").await.unwrap();
    drop(db);
    let mut draft = trade(&created.1);
    draft["payload"]["playbook_id"] = json!("strategy-fixture");
    draft["payload"]["playbook_revision"] = json!(99);
    assert_eq!(
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            draft.clone(),
            "bad-strategy"
        )
        .await
        .0,
        422
    );
    draft["payload"]["playbook_revision"] = json!(1);
    let closed = request(&app, "POST", base, "tenant-a", draft, "trade-create").await;
    assert_eq!(closed.0, 201, "{}", closed.1);
    assert_eq!(closed.1["payload"]["quantity"], "0.10");
    let path = format!(
        "{base}/{}/revisions",
        closed.1["record_id"].as_str().unwrap()
    );
    let mut revision = json!({"kind":"trade","expected_revision":1,"payload":closed.1["payload"]});
    revision["payload"]["note"] = json!("Correction");
    let (left, right) = tokio::join!(
        request(
            &app,
            "POST",
            &path,
            "tenant-a",
            revision.clone(),
            "revision-left"
        ),
        request(
            &app,
            "POST",
            &path,
            "tenant-a",
            revision.clone(),
            "revision-right"
        )
    );
    assert!(
        (left.0 == 200 && right.0 == 409) || (left.0 == 409 && right.0 == 200),
        "{left:?} {right:?}"
    );
    revision["expected_revision"] = json!(2);
    revision["kind"] = json!("note");
    revision["payload"] = json!({"title":"Bad change","note":"Bad change"});
    assert_eq!(
        request(&app, "POST", &path, "tenant-a", revision, "kind-change")
            .await
            .0,
        409
    );
    let account_path = format!(
        "{base}/{}/revisions",
        created.1["record_id"].as_str().unwrap()
    );
    let mut revised_account =
        json!({"kind":"account","expected_revision":1,"payload":created.1["payload"]});
    revised_account["payload"]["currency"] = json!("EUR");
    assert_eq!(
        request(
            &app,
            "POST",
            &account_path,
            "tenant-a",
            revised_account,
            "currency-change"
        )
        .await
        .0,
        409
    );
    let note=request(&app,"POST",base,"tenant-a",json!({"kind":"note","payload":{"account_id":created.1["record_id"],"title":"Review","note":"Loss reviewed","tags":["Trend"]}}),"note-create").await;
    assert_eq!(note.0, 201, "{}", note.1);
    let listed = request(&app, "GET", base, "tenant-a", Value::Null, "").await;
    assert_eq!(listed.0, 200);
    assert_eq!(listed.1["items"].as_array().unwrap().len(), 3);
    assert_eq!(
        request(&app, "GET", base, "tenant-b", Value::Null, "")
            .await
            .1["items"],
        json!([])
    );
    let db = state.pool.get().await.unwrap();
    let rows=db.query("SELECT payload_json FROM live_record_revisions WHERE workspace_id='tenant-a' AND record_id=$1 ORDER BY revision", &[&closed.1["record_id"].as_str().unwrap()]).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].get::<_, Value>(0)["note"], "");
    assert_eq!(rows[1].get::<_, Value>(0)["note"], "Correction");
    let metadata = json!({"kind":"account","expected_revision":1,"payload":{"name":"Fixture revised","currency":"USD","opening_balance":"9000.25","account_type":"prop","opening_at_utc":"2026-09-01T12:34:00Z"}});
    let revised = request(
        &app,
        "POST",
        &account_path,
        "tenant-a",
        metadata,
        "metadata-revision",
    )
    .await;
    assert_eq!(revised.0, 200, "{}", revised.1);
    assert_eq!(revised.1["payload"]["account_type"], "prop");
    assert_eq!(
        revised.1["payload"]["opening_at_utc"],
        "2026-09-01T12:34:00Z"
    );
    let mut archived =
        json!({"kind":"account","expected_revision":2,"payload":revised.1["payload"]});
    archived["payload"]["archived"] = json!(true);
    assert_eq!(
        request(
            &app,
            "POST",
            &account_path,
            "tenant-b",
            archived.clone(),
            "cross-archive"
        )
        .await
        .0,
        404
    );
    let removed = request(
        &app,
        "POST",
        &account_path,
        "tenant-a",
        archived.clone(),
        "archive",
    )
    .await;
    assert_eq!(removed.0, 200, "{}", removed.1);
    assert_eq!(
        request(&app, "POST", &account_path, "tenant-a", archived, "archive").await,
        removed
    );
    assert_eq!(
        request(&app, "GET", base, "tenant-a", Value::Null, "")
            .await
            .1["items"],
        json!([])
    );
    assert_eq!(
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            trade(&created.1),
            "archived-parent-trade"
        )
        .await
        .0,
        422
    );
    let hidden_note = json!({"kind":"note","payload":{"account_id":created.1["record_id"],"title":"Hidden?","note":"No"}});
    assert_eq!(
        request(
            &app,
            "POST",
            base,
            "tenant-a",
            hidden_note,
            "archived-parent-note"
        )
        .await
        .0,
        422
    );
    let detached_note = json!({"kind":"note","expected_revision":1,"payload":{"title":"Escape","note":"Must stay archived","account_id":null}});
    let note_path = format!("{base}/{}/revisions", note.1["record_id"].as_str().unwrap());
    assert_eq!(
        request(
            &app,
            "POST",
            &note_path,
            "tenant-a",
            detached_note,
            "archived-note-detach"
        )
        .await
        .0,
        422
    );
    let unarchive = json!({"kind":"account","expected_revision":3,"payload":revised.1["payload"]});
    assert_eq!(
        request(
            &app,
            "POST",
            &account_path,
            "tenant-a",
            unarchive,
            "reject-implicit-restore"
        )
        .await
        .0,
        409
    );
    assert_eq!(
        db.query_one(
            "SELECT count(*) FROM live_records WHERE workspace_id='tenant-a'",
            &[]
        )
        .await
        .unwrap()
        .get::<_, i64>(0),
        3
    );
}
