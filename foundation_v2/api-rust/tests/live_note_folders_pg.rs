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
#[tokio::test]
#[ignore = "owned disposable PostgreSQL via live_note_folders_pg.py"]
async fn folders_empty_memberships_atomic_create_and_isolation() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let db = state.pool.get().await.unwrap();
    assert_eq!(
        db.query_one("SELECT current_database()", &[])
            .await
            .unwrap()
            .get::<_, String>(0),
        "rust_live_note_folders_fixture"
    );
    let app = trading_workspace_api::router(
        state.clone(),
        trading_workspace_api::runtime_domain_routes(&state).unwrap(),
    );
    let path = "/api/v2/live/note-folders";
    let empty = json!({"name":"Review","note_ids":[]});
    let created = request(
        &app,
        "POST",
        path,
        "tenant-a",
        empty.clone(),
        "empty-folder",
    )
    .await;
    assert_eq!(created.0, 201, "{}", created.1);
    assert_eq!(
        request(
            &app,
            "POST",
            path,
            "tenant-a",
            empty.clone(),
            "empty-folder"
        )
        .await
        .1,
        created.1
    );
    let folder = created.1["created_id"].as_str().unwrap();
    assert_eq!(
        request(&app, "POST", path, "tenant-a", empty, "").await.0,
        409
    );
    assert_eq!(
        request(
            &app,
            "POST",
            path,
            "tenant-a",
            json!({"name":"review","note_ids":[]}),
            ""
        )
        .await
        .0,
        409
    );
    for body in [
        json!({"name":"","note_ids":[]}),
        json!({"name":" Bad ","note_ids":[]}),
        json!({"name":"Invalid","note_ids":["missing"]}),
        json!({"name":"Invalid","note_ids":["a","a"]}),
    ] {
        assert_eq!(
            request(&app, "POST", path, "tenant-a", body, "").await.0,
            422
        );
    }
    let note = json!({"kind":"note","folder_id":folder,"payload":{"title":"Reflection","note":"Observation","tags":[]}});
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/v2/live/records",
            "tenant-b",
            note.clone(),
            ""
        )
        .await
        .0,
        422
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/api/v2/live/records",
            "tenant-b",
            Value::Null,
            ""
        )
        .await
        .1["items"],
        json!([]),
        "invalid folder rolls back note insertion"
    );
    let saved = request(
        &app,
        "POST",
        "/api/v2/live/records",
        "tenant-a",
        note,
        "folder-note",
    )
    .await;
    assert_eq!(saved.0, 201, "{}", saved.1);
    let list = request(&app, "GET", path, "tenant-a", Value::Null, "").await;
    assert_eq!(
        list.1["items"][0]["note_ids"],
        json!([saved.1["record_id"]])
    );
    let body = json!({"name":"Selected","note_ids":[saved.1["record_id"]]});
    assert_eq!(
        request(&app, "POST", path, "tenant-b", body.clone(), "")
            .await
            .0,
        422
    );
    assert_eq!(
        request(&app, "POST", path, "tenant-a", body, "").await.0,
        201
    );
    assert_eq!(
        request(&app, "GET", path, "tenant-b", Value::Null, "")
            .await
            .1["items"],
        json!([])
    );
    assert_eq!(request(&app, "GET", path, "", Value::Null, "").await.0, 422);
    assert_eq!(
        request(
            &app,
            "POST",
            path,
            "tenant-a",
            json!({"name":"Still empty","note_ids":[]}),
            ""
        )
        .await
        .0,
        201
    );
    db.execute("INSERT INTO live_note_folders(workspace_id,folder_id,name,created_at_utc) SELECT 'tenant-a','limit-'||n,'Limit '||n,'2026-10-29T00:00:00Z' FROM generate_series(1,196) n",&[]).await.unwrap();
    let (a, b) = tokio::join!(
        request(
            &app,
            "POST",
            path,
            "tenant-a",
            json!({"name":"Last A","note_ids":[]}),
            "limit-a"
        ),
        request(
            &app,
            "POST",
            path,
            "tenant-a",
            json!({"name":"Last B","note_ids":[]}),
            "limit-b"
        )
    );
    let mut statuses = vec![a.0, b.0];
    statuses.sort();
    assert_eq!(statuses, vec![201, 422]);
    assert_eq!(
        request(&app, "GET", path, "tenant-a", Value::Null, "")
            .await
            .1["items"]
            .as_array()
            .unwrap()
            .len(),
        200
    );
}
