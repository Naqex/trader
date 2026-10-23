use super::*;
use crate::state::AppState;
use http_body_util::BodyExt;
use tower::ServiceExt;

pub(super) async fn verify(state: &Arc<AppState>, client: &tokio_postgres::Client) {
    let app = crate::router(state.clone(), crate::ai_assistant::routes());
    let http = |method: &str, path: String, body: String| {
        let app = app.clone();
        let method = method.to_owned();
        async move {
            let mut req = axum::http::Request::builder()
                .method(method.as_str())
                .uri(path)
                .header("host", "localhost:5180")
                .header("origin", "http://localhost:5180")
                .header("x-workspace-id", "a")
                .header("content-type", "text/plain")
                .body(axum::body::Body::from(body))
                .unwrap();
            req.extensions_mut().insert(axum::extract::ConnectInfo(
                "127.0.0.1:1000".parse::<std::net::SocketAddr>().unwrap(),
            ));
            let response = app.oneshot(req).await.unwrap();
            let status = response.status();
            (
                status,
                String::from_utf8(
                    response
                        .into_body()
                        .collect()
                        .await
                        .unwrap()
                        .to_bytes()
                        .to_vec(),
                )
                .unwrap(),
            )
        }
    };
    let scope = Workspace {
        workspace_id: "a".into(),
        subject: "owner".into(),
    };
    let content = "padding rules\n".repeat(6000) + "\nCRIMSON482 capital preservation rule.";
    assert!(content.len() > 65536);
    let (status, wire) = http(
        "POST",
        "/api/v2/ai/assistant/documents?name=strategy.md".into(),
        content.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{wire}");
    let document: Value = serde_json::from_str(&wire).unwrap();
    let (status, wire) = http(
        "POST",
        "/api/v2/ai/assistant/documents?name=strategy.md".into(),
        content.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&wire).unwrap()["id"],
        document["id"]
    );
    let path = format!(
        "/api/v2/ai/assistant/documents/{}",
        document["id"].as_str().unwrap()
    );
    assert_eq!(
        http("GET", path.clone(), String::new()).await.1,
        content,
        "lossless download"
    );
    let mut conn = state.pool.get().await.unwrap();
    let tx = conn.transaction().await.unwrap();
    assert!(
        crate::ai_documents::references(
            &tx,
            &Workspace {
                subject: "other".into(),
                ..scope.clone()
            },
            &json!([{"id":document["id"]}])
        )
        .await
        .is_err()
    );
    let refs = crate::ai_documents::references(&tx, &scope, &json!([{"id":document["id"]}]))
        .await
        .unwrap();
    let excerpts = crate::ai_documents::ground(&tx, &scope, &refs, "CRIMSON482")
        .await
        .unwrap();
    assert!(excerpts.to_string().contains("CRIMSON482"));
    assert_eq!(excerpts[0]["retrieval"], "keyword-match");
    assert!(
        excerpts
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["text"].as_str().unwrap().len())
            .sum::<usize>()
            <= 24576
    );
    assert_eq!(
        crate::ai_documents::ground(&tx, &scope, &refs, "unmatched999")
            .await
            .unwrap()[0]["retrieval"],
        "document-intro"
    );
    let agent_id = Uuid::new_v4();
    let config =
        json!({"name":"Document fixture","description":"","instructions":"","knowledge":refs});
    tx.execute(
        "INSERT INTO ai_agents(workspace_id,subject,agent_id,config) VALUES('a','owner',$1,$2)",
        &[&agent_id, &config],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    drop(conn);
    assert_eq!(
        http("DELETE", path.clone(), String::new()).await.0,
        StatusCode::CONFLICT
    );
    client
        .execute("DELETE FROM ai_agents WHERE agent_id=$1", &[&agent_id])
        .await
        .unwrap();
    assert_eq!(
        http("DELETE", path.clone(), String::new()).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        http("GET", path, String::new()).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        http(
            "POST",
            "/api/v2/ai/assistant/documents?name=bad.txt".into(),
            "\0".into()
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Exactly 10 MiB reaches the raw upload handler despite the ordinary JSON body budget.
    let large = "padding ".repeat(10 * 1024 * 1024 / 8);
    let (status, wire) = http(
        "POST",
        "/api/v2/ai/assistant/documents?name=ten-megabytes.txt".into(),
        large,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{wire}");
    let large: Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(large["bytes"], 10 * 1024 * 1024);
    assert_eq!(
        http(
            "POST",
            "/api/v2/ai/assistant/documents?name=oversized.txt".into(),
            "a".repeat(10 * 1024 * 1024 + 1)
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    http(
        "DELETE",
        format!(
            "/api/v2/ai/assistant/documents/{}",
            large["id"].as_str().unwrap()
        ),
        String::new(),
    )
    .await;

    let bars:Vec<Value>=(0..5).map(|i|json!({"timestamp":1600000020_i64+i*60,"open":10.0,"high":12.0,"low":9.0,"close":11.0,"volume":5.0})).collect();
    let (artifact_path, hash) = state
        .artifact_data
        .write_dataset("a", "ai-source", &bars)
        .unwrap();
    let manifest = json!({"artifact_path":artifact_path,"artifact_sha256":hash,"symbol":"TEST","timeframe_seconds":60});
    client
        .execute(
            "INSERT INTO datasets VALUES('a','ai-source',$1,$2,'now')",
            &[&manifest, &hash],
        )
        .await
        .unwrap();
    client
        .execute(
            "INSERT INTO workspace_records VALUES('a','replay','ai-session',NULL,1,'now','now')",
            &[],
        )
        .await
        .unwrap();
    client.execute("INSERT INTO workspace_record_revisions VALUES('a','replay','ai-session',1,$1,false,'now')",&[&json!({"dataset_id":"ai-source","cursor_index":2})]).await.unwrap();
    for (name, cursor, note) in [
        ("current", Some(2), "Visible observation"),
        ("future", Some(4), "Must not reach provider"),
        ("unknown", None, "No anchor"),
    ] {
        client
            .execute(
                "INSERT INTO workspace_records VALUES('a','journal',$1,NULL,1,'now','now')",
                &[&name],
            )
            .await
            .unwrap();
        client.execute("INSERT INTO workspace_record_revisions VALUES('a','journal',$1,1,$2,false,'now')",&[&name,&json!({"note":note,"actual_result":"Future outcome never included","source":{"session_id":"ai-session","dataset_id":"ai-source","cursor_index":cursor}})]).await.unwrap();
    }
    let source = json!({"kind":"journal","id":"ai-session"});
    let research = json!({"contract_version":crate::CONTRACT_VERSION,"workspace_id":"a","job_id":"ai-research","dataset_id":"ai-source","dataset_sha256":hash,"created_at_utc":"now","strategy_version":"close-delta-v1","metrics_schema_version":"metrics-v2","trade_count":2,"metrics":{"starting_balance":10000.0,"return_pct":1.5}});
    let result_bytes = serde_json::to_vec(&research).unwrap();
    let result_hash = format!("{:x}", Sha256::digest(&result_bytes));
    let result_dir = state.config.artifact_root.join("a/results");
    std::fs::create_dir_all(&result_dir).unwrap();
    std::fs::write(result_dir.join("ai-research.json"), &result_bytes).unwrap();
    client.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc,result_path,result_sha256) VALUES('a','ai-research','ai-source','close-delta-v1',10000,'completed','now','now','a/results/ai-research.json',$1)",&[&result_hash]).await.unwrap();
    let research_source = json!({"kind":"research","id":"ai-research"});
    let research_snapshot = crate::ai_context::snapshot(state, &scope, &research_source)
        .await
        .unwrap();
    assert_eq!(research_snapshot["data"]["metrics"]["return_pct"], 1.5);
    assert_eq!(research_snapshot["data"]["result_sha256"], result_hash);
    std::fs::write(result_dir.join("ai-research.json"), b"tampered").unwrap();
    assert!(
        crate::ai_context::snapshot(state, &scope, &research_source)
            .await
            .is_err()
    );
    std::fs::write(result_dir.join("ai-research.json"), result_bytes).unwrap();
    client
        .execute(
            "UPDATE research_jobs SET status='running' WHERE job_id='ai-research'",
            &[],
        )
        .await
        .unwrap();
    assert!(
        crate::ai_context::snapshot(state, &scope, &research_source)
            .await
            .is_err()
    );
    client
        .execute(
            "UPDATE research_jobs SET status='completed' WHERE job_id='ai-research'",
            &[],
        )
        .await
        .unwrap();
    let snapshot = crate::ai_context::snapshot(state, &scope, &source)
        .await
        .unwrap();
    assert_eq!(snapshot["data"]["bars"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["data"]["entries"].as_array().unwrap().len(), 1);
    assert_eq!(
        snapshot["data"]["entries"][0]["note"],
        "Visible observation"
    );
    assert!(!snapshot.to_string().contains("Future outcome"));
    assert!(
        crate::ai_context::snapshot(
            state,
            &Workspace {
                workspace_id: "b".into(),
                ..scope.clone()
            },
            &source
        )
        .await
        .is_err()
    );
    let request = json!({"conversation_id":Uuid::new_v4(),"idempotency_key":Uuid::new_v4(),"messages":[{"role":"user","content":"Review these candles"}],"expected_selection":{"provider":"local-gateway","model":"pro","effort":null},"context":{"screen":"replay","locale":"en","source":source}});
    let admitted = state
        .ai_runs
        .submit_with_state(&scope, request.clone(), false, false, Some(state))
        .await
        .unwrap();
    let id = identifier(admitted["id"].as_str().unwrap()).unwrap();
    client.execute("INSERT INTO workspace_record_revisions VALUES('a','replay','ai-session',2,$1,true,'later')",&[&json!({"dataset_id":"ai-source","cursor_index":4})]).await.unwrap();
    client.execute("UPDATE workspace_records SET current_revision=2 WHERE kind='replay' AND record_id='ai-session'",&[]).await.unwrap();
    assert_eq!(
        state
            .ai_runs
            .submit_with_state(&scope, request, false, false, Some(state))
            .await
            .unwrap()["id"],
        admitted["id"],
        "replay cannot resnapshot a deleted or advanced source"
    );
    let config: Value = client
        .query_one("SELECT config FROM ai_runs WHERE run_id=$1", &[&id])
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        config["snapshot"]["data"]["bars"].as_array().unwrap().len(),
        3
    );
    assert_eq!(config["snapshot"]["provenance"]["revision"], 1);
    tokio::time::timeout(Duration::from_secs(8), async {
        while !terminal(&state.ai_runs.read(&scope, id, false).await.unwrap()) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    println!(
        "AI_FOUNDATION_HTTP_PG_PASS: 10MiB upload, 64KiB+ retrieval, scope, dedup, delete guard, causal chart/journal snapshot, checksum-bound completed research, immutable replay"
    );
}
