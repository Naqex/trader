use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::collections::HashMap;
use tower::ServiceExt;
use trading_workspace_api::{config::Config, metadata_mutations, state::AppState};

fn substitute(value: &mut Value, ids: &HashMap<String, String>) {
    match value {
        Value::String(text) => {
            for (alias, id) in ids {
                *text = text.replace(&format!("${alias}"), id);
            }
        }
        Value::Array(items) => {
            for item in items {
                substitute(item, ids);
            }
        }
        Value::Object(map) => {
            for item in map.values_mut() {
                substitute(item, ids);
            }
        }
        _ => (),
    }
}

fn canonical(mut value: Value, ids: &HashMap<String, String>) -> Value {
    if let Some(map) = value.as_object_mut() {
        map.remove("record_id");
        map.remove("created_at_utc");
        map.remove("updated_at_utc");
        if let Some(parent) = map
            .get_mut("payload")
            .and_then(|p| p.get_mut("parent_playbook_id"))
        {
            if let Some((alias, _)) = ids
                .iter()
                .find(|(_, id)| parent.as_str() == Some(id.as_str()))
            {
                *parent = json!(format!("${alias}"));
            }
        }
    }
    value
}

#[tokio::test]
#[ignore = "run through rust_metadata_parity.py with disposable PostgreSQL"]
async fn python_reference_mutation_parity() {
    let state = AppState::connect(Config::from_environment().unwrap())
        .await
        .unwrap();
    let client = state.pool.get().await.unwrap();
    let database: String = client
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert!(
        database.starts_with("rust_metadata_"),
        "refuse owner database"
    );
    let cases: Value = serde_json::from_slice(
        &std::fs::read(std::env::var("TW_METADATA_GOLDEN").unwrap()).unwrap(),
    )
    .unwrap();
    let app = metadata_mutations::routes().with_state(state.clone());
    let mut ids = HashMap::new();
    for case in cases.as_array().unwrap() {
        let mut path = case["path"].clone();
        substitute(&mut path, &ids);
        let mut body = case["body"].clone();
        substitute(&mut body, &ids);
        let mut request = Request::builder()
            .method("POST")
            .uri(path.as_str().unwrap())
            .header("content-type", "application/json");
        if let Some(workspace) = case["workspace"].as_str() {
            request = request.header("x-workspace-id", workspace);
        }
        if let Some(key) = case["key"].as_str() {
            request = request.header("idempotency-key", key);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            case["status"].as_u64().unwrap() as u16,
            "case {}: {}",
            case["name"],
            path
        );
        let actual: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        if let Some(alias) = case["save"].as_str() {
            ids.insert(
                alias.to_owned(),
                actual["record_id"].as_str().unwrap().to_owned(),
            );
        }
        if case["status"] != 422 {
            assert_eq!(
                canonical(actual, &ids),
                case["expected"],
                "case {}",
                case["name"]
            );
        }
    }
    let rows: i64 = client
        .query_one(
            "SELECT count(*) FROM workspace_records WHERE workspace_id='tenant-a'",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(rows, 5, "retries must not create duplicates");
    let queued: i64 = client
        .query_one(
            "SELECT count(*) FROM api_commands WHERE status IN ('queued','running')",
            &[],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(queued, 0, "metadata must never enqueue a Python command");
    let id = &ids["fork"];
    let row = client.query_one("SELECT payload_json FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='playbook' AND record_id=$1 AND revision=1", &[id]).await.unwrap();
    let payload: Value = row.get(0);
    let body = json!({"expected_revision":1,"payload":payload}).to_string();
    let request = || {
        Request::builder()
            .method("POST")
            .uri(format!("/api/v2/playbooks/{id}/revisions"))
            .header("content-type", "application/json")
            .header("x-workspace-id", "tenant-a")
            .body(Body::from(body.clone()))
            .unwrap()
    };
    let (one, two) = tokio::join!(
        app.clone().oneshot(request()),
        app.clone().oneshot(request())
    );
    let mut statuses = [
        one.unwrap().status().as_u16(),
        two.unwrap().status().as_u16(),
    ];
    statuses.sort();
    assert_eq!(
        statuses,
        [200, 409],
        "one stale-revision winner across concurrent transactions"
    );
    let revisions: i64 = client.query_one("SELECT count(*) FROM workspace_record_revisions WHERE workspace_id='tenant-a' AND kind='playbook' AND record_id=$1", &[id]).await.unwrap().get(0);
    assert_eq!(revisions, 2);
    println!("METADATA_PARITY_CASES={}", cases.as_array().unwrap().len());
}
