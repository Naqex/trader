use super::*;
use axum::{
    Router,
    response::IntoResponse,
    routing::{get, post},
};
use std::sync::atomic::{AtomicU8, AtomicUsize};
mod foundation;

#[tokio::test]
#[ignore = "requires the owned disposable PostgreSQL runner"]
async fn postgres_ai_lifecycle() {
    assert_eq!(
        std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
        Ok("1")
    );
    let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").unwrap();
    let (mut client, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
        .await
        .unwrap();
    let db_task = tokio::spawn(connection);
    let identity = client
        .query_one("SELECT current_user,current_database()", &[])
        .await
        .unwrap();
    assert_eq!(identity.get::<_, String>(0), "rust_runtime_fixture");
    assert_eq!(identity.get::<_, String>(1), "rust_runtime_fixture");
    assert_eq!(
        crate::rust_runtime::apply_migrations(&mut client, false)
            .await
            .unwrap()
            .len(),
        crate::rust_runtime::MIGRATIONS.len()
    );
    assert!(
        crate::rust_runtime::apply_migrations(&mut client, false)
            .await
            .unwrap()
            .is_empty()
    );
    client
        .execute("INSERT INTO workspaces VALUES('a','now'),('b','now')", &[])
        .await
        .unwrap();
    let pool = Pool::builder(deadpool_postgres::Manager::new(
        dsn.parse().unwrap(),
        tokio_postgres::NoTls,
    ))
    .max_size(8)
    .runtime(deadpool_postgres::Runtime::Tokio1)
    .build()
    .unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let mode = Arc::new(AtomicU8::new(0));
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (n, a, p, m, s) = (
        count.clone(),
        active.clone(),
        peak.clone(),
        mode.clone(),
        seen.clone(),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener,Router::new().route("/v1/models",get(||async {Json(json!({"data":[{"id":"pro"},{"id":"fast"}]}))}))
            .route("/v1/responses",post(move |Json(payload):Json<Value>| {
                let(n,a,p,m,s)=(n.clone(),a.clone(),p.clone(),m.clone(),s.clone());
                async move {
                    n.fetch_add(1,Ordering::SeqCst);s.lock().await.push(payload.clone());
                    let current=a.fetch_add(1,Ordering::SeqCst)+1;p.fetch_max(current,Ordering::SeqCst);
                    let mode=m.load(Ordering::SeqCst);
                    if mode==3 || mode==4 {
                        assert_eq!(payload["stream"],true);
                        a.fetch_sub(1,Ordering::SeqCst);
                        let stream=async_stream::stream! {
                            if mode==4 {
                                yield Ok::<_,std::convert::Infallible>(format!("data: {}\n\ndata: {}\n\n",json!({"type":"response.reasoning_text.delta","delta":"private reasoning"}),json!({"type":"response.output_text.delta","delta":"Đang viết "})));
                                tokio::time::sleep(Duration::from_secs(10)).await;
                            }
                            for _ in 0..2 {
                                tokio::time::sleep(Duration::from_millis(300)).await;
                                yield Ok::<_,std::convert::Infallible>(format!("data: {}\n\n",json!({"type":"response.output_text.delta","delta":"đ".repeat(600)})));
                            }
                            tokio::time::sleep(Duration::from_millis(300)).await;
                            yield Ok(format!("data: {}\n\n",json!({"type":"response.completed","response":{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"đ".repeat(1200)}]}]}})));
                        };
                        return axum::http::Response::builder().header("content-type","text/event-stream").body(axum::body::Body::from_stream(stream)).unwrap();
                    }
                    tokio::time::sleep(Duration::from_millis(if mode==2 {10000}else{150})).await;
                    a.fetch_sub(1,Ordering::SeqCst);
                    if mode==1 { return (StatusCode::TOO_MANY_REQUESTS,Json(json!({"private":"secret upstream body"}))).into_response(); }
                    (StatusCode::OK,Json(json!({"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":format!("{} result",payload["model"].as_str().unwrap())}]}]}))).into_response()
                }
            }))).await.unwrap();
    });
    let key = std::env::temp_dir().join(format!("ai-run-{}.key", Uuid::new_v4()));
    std::fs::write(&key, "synthetic-gateway-fixture-key-0001").unwrap();
    let assistant = AiAssistant::fixture_gateway(&format!("http://{address}/v1"), key.clone());
    let engine = Engine::new(pool.clone(), assistant.clone());
    let scope = Workspace {
        workspace_id: "a".into(),
        subject: "owner".into(),
    };
    let foreign = Workspace {
        subject: "foreign".into(),
        ..scope.clone()
    };
    let body = |conversation: Uuid, key: Uuid, model: &str| json!({"conversation_id":conversation,"idempotency_key":key,"expected_selection":{"provider":"local-gateway","model":model,"effort":null},"messages":[{"role":"user","content":"fixture only"}],"context":{"screen":"trade","locale":"en"}});
    async fn finish(engine: &Engine, scope: &Workspace, id: Uuid) -> Value {
        tokio::time::timeout(Duration::from_secs(12), async {
            loop {
                let v = engine.read(scope, id, false).await.unwrap();
                if terminal(&v) {
                    return v;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap()
    }
    let (conversation, k) = (Uuid::new_v4(), Uuid::new_v4());
    let input = body(conversation, k, "pro");
    let first = engine.submit(&scope, input.clone(), false).await.unwrap();
    let id = identifier(first["id"].as_str().unwrap()).unwrap();
    let second = engine.submit(&scope, input.clone(), false).await.unwrap();
    assert_eq!(first["id"], second["id"]);
    let mut changed = input.clone();
    changed["messages"][0]["content"] = json!("changed");
    assert_eq!(
        engine.submit(&scope, changed, false).await.unwrap_err().1["detail"],
        "ai_idempotency_conflict"
    );
    assert_eq!(
        engine.read(&foreign, id, false).await.unwrap_err().0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        engine
            .read(
                &Workspace {
                    workspace_id: "b".into(),
                    ..scope.clone()
                },
                id,
                true
            )
            .await
            .unwrap_err()
            .0,
        StatusCode::NOT_FOUND
    );
    let other = engine
        .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "fast"), false)
        .await
        .unwrap();
    let other_id = identifier(other["id"].as_str().unwrap()).unwrap();
    let (done, other_done) = tokio::join!(
        finish(&engine, &scope, id),
        finish(&engine, &scope, other_id)
    );
    assert_eq!(done["text"], "pro result");
    assert_eq!(other_done["text"], "fast result");
    assert_eq!(done["selection"]["model"], "pro");
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    let events = engine.events(&scope, id, 0).await.unwrap();
    assert_eq!(
        events
            .iter()
            .map(|v| v["sequence"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(engine.events(&scope, id, 2).await.unwrap().len(), 1);
    assert_eq!(count.load(Ordering::SeqCst), 2, "reconnect is read-only");
    assert_eq!(
        engine.read(&scope, id, true).await.unwrap()["status"],
        "completed",
        "late cancel cannot erase a result"
    );
    let restart = Engine::new(pool.clone(), assistant.clone());
    assert_eq!(
        restart.read(&scope, id, false).await.unwrap()["text"],
        "pro result"
    );
    assert_eq!(
        restart.submit(&scope, input.clone(), false).await.unwrap()["id"],
        first["id"],
        "restart idempotency"
    );
    mode.store(1, Ordering::SeqCst);
    let failure = engine
        .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "pro"), false)
        .await
        .unwrap();
    let failure = finish(
        &engine,
        &scope,
        identifier(failure["id"].as_str().unwrap()).unwrap(),
    )
    .await;
    assert_eq!(failure["status"], "failed");
    assert_eq!(failure["error"], "ai_gateway_rate_limited");
    assert_eq!(failure["outcome"], "rejected");
    assert!(!failure.to_string().contains("secret"));
    mode.store(3, Ordering::SeqCst);
    let streaming = engine
        .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "pro"), false)
        .await
        .unwrap();
    let streaming_id = identifier(streaming["id"].as_str().unwrap()).unwrap();
    let completed = finish(&engine, &scope, streaming_id).await;
    assert_eq!(completed["text"], "đ".repeat(1200));
    let events = engine.events(&scope, streaming_id, 0).await.unwrap();
    let deltas = events
        .iter()
        .filter(|v| v["delta"].is_string())
        .collect::<Vec<_>>();
    assert_eq!(deltas.len(), 2);
    assert_eq!(deltas[0]["offset"], 0);
    assert_eq!(deltas[1]["offset"], 1200);
    assert!(
        deltas.iter().all(|v| v.get("text").is_none()),
        "progress events store deltas, not quadratic text copies"
    );
    assert_eq!(
        deltas
            .iter()
            .map(|v| v["delta"].as_str().unwrap().len())
            .sum::<usize>(),
        2400
    );
    mode.store(2, Ordering::SeqCst);
    let pending = engine
        .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "fast"), false)
        .await
        .unwrap();
    let pending_id = identifier(pending["id"].as_str().unwrap()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while count.load(Ordering::SeqCst) < 5 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        engine.read(&scope, pending_id, true).await.unwrap()["status"],
        "cancelling"
    );
    let stopped = finish(&engine, &scope, pending_id).await;
    assert_eq!(stopped["status"], "cancelled");
    assert_eq!(stopped["outcome"], "unknown");
    // Simulate a lost owner after dispatch. Recovery fences it and never sends again.
    client.execute("UPDATE ai_runs SET status='running',outcome='sent',lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",&[&pending_id]).await.unwrap();
    let before = count.load(Ordering::SeqCst);
    restart.claim().await.unwrap();
    assert_eq!(
        restart.read(&scope, pending_id, false).await.unwrap()["status"],
        "interrupted"
    );
    assert_eq!(
        restart.read(&scope, pending_id, false).await.unwrap()["outcome"],
        "unknown"
    );
    assert_eq!(count.load(Ordering::SeqCst), before);
    let mut fenced = pool.get().await.unwrap();
    let tx = fenced.transaction().await.unwrap();
    assert!(
        transition(
            &tx,
            pending_id,
            Some(engine.owner),
            "completed",
            json!({"text":"late stale result","outcome":"completed"})
        )
        .await
        .is_err()
    );
    tx.rollback().await.unwrap();
    assert_eq!(
        restart.read(&scope, pending_id, false).await.unwrap()["status"],
        "interrupted"
    );
    mode.store(4, Ordering::SeqCst);
    let continuation_conversation = Uuid::new_v4();
    let partial = engine
        .submit(
            &scope,
            body(continuation_conversation, Uuid::new_v4(), "pro"),
            false,
        )
        .await
        .unwrap();
    let partial_id = identifier(partial["id"].as_str().unwrap()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if engine.read(&scope, partial_id, false).await.unwrap()["text"] == "Đang viết " {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    engine.read(&scope, partial_id, true).await.unwrap();
    let stopped = finish(&engine, &scope, partial_id).await;
    assert_eq!(stopped["text"], "Đang viết ");
    assert_eq!(stopped["partial"], true);
    assert!(!stopped.to_string().contains("private reasoning"));
    let terminal_event = engine
        .events(&scope, partial_id, 0)
        .await
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(
        terminal_event["text"], "Đang viết ",
        "terminal events retain the full stopped snapshot"
    );
    mode.store(0, Ordering::SeqCst);
    let mut next = body(continuation_conversation, Uuid::new_v4(), "pro");
    next["continuation_of"] = json!(partial_id);
    next["messages"] = json!([{"role":"user","content":"fixture only"},{"role":"assistant","content":"Đang viết "},{"role":"user","content":"Continue without repetition"}]);
    let continued = engine.submit(&scope, next.clone(), false).await.unwrap();
    let continued_id = identifier(continued["id"].as_str().unwrap()).unwrap();
    assert_eq!(continued["continuation_of"], partial["id"]);
    assert_eq!(
        engine.submit(&scope, next.clone(), false).await.unwrap()["id"],
        continued["id"]
    );
    finish(&engine, &scope, continued_id).await;
    next["idempotency_key"] = json!(Uuid::new_v4());
    assert_eq!(
        engine.submit(&scope, next, false).await.unwrap_err().1["detail"],
        "invalid_ai_continuation",
        "a stale Continue cannot target an older reply"
    );
    let payloads = seen.lock().await;
    assert!(
        payloads
            .iter()
            .all(|p| p["store"] == false && p.get("tools").is_none())
    );
    assert!(
        payloads[0]["instructions"]
            .as_str()
            .unwrap()
            .contains("WMREPLAY")
    );
    drop(payloads);
    engine.shutdown().await;
    restart.shutdown().await;
    // Exercise the public handlers against the actual database and origin/identity middleware.
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let mut state = crate::tests::fixture(10000);
    let mutable = Arc::get_mut(&mut state).unwrap();
    mutable.pool = pool.clone();
    mutable.ai_assistant = assistant.clone();
    mutable.ai_runs = Engine::new(pool.clone(), assistant.clone());
    mutable.config.request_timeout = Duration::from_secs(5);
    mutable.config.max_body_bytes = 65536;
    mutable.config.artifact_root =
        std::path::PathBuf::from(std::env::var("TW_RUST_RUNTIME_TEST_ARTIFACTS").unwrap());
    mutable.artifact_data =
        Arc::new(crate::artifact_data::ArtifactData::new(&mutable.config.artifact_root).unwrap());
    let app = crate::router(state.clone(), crate::ai_assistant::routes());
    let http = |method: &str, path: String, body: Value| {
        let app = app.clone();
        let method = method.to_string();
        async move {
            let mut req = axum::http::Request::builder()
                .method(method.as_str())
                .uri(path)
                .header("host", "localhost:5180")
                .header("origin", "http://localhost:5180")
                .header("x-workspace-id", "a")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap();
            req.extensions_mut().insert(axum::extract::ConnectInfo(
                "127.0.0.1:1000".parse::<std::net::SocketAddr>().unwrap(),
            ));
            let response = app.oneshot(req).await.unwrap();
            let status = response.status();
            assert_eq!(response.headers()["cache-control"], "no-store");
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            (status, String::from_utf8(bytes.to_vec()).unwrap())
        }
    };
    let profile =
        json!({"selection":{"provider":"local-gateway","model":"pro","effort":null},"revision":0});
    assert_eq!(
        http(
            "PUT",
            "/api/v2/ai/assistant/profiles/system/default".into(),
            profile.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        http(
            "PUT",
            "/api/v2/ai/assistant/profiles/system/default".into(),
            profile.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        crate::ai_profiles::resolve(&pool, &scope, "evidence-review", "analyst")
            .await
            .unwrap()
            .unwrap()["selection"]["model"],
        "pro"
    );
    let mut override_profile = profile.clone();
    override_profile["selection"]["model"] = json!("fast");
    assert_eq!(
        http(
            "PUT",
            "/api/v2/ai/assistant/profiles/evidence-review/analyst".into(),
            override_profile.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        crate::ai_profiles::resolve(&pool, &scope, "evidence-review", "analyst")
            .await
            .unwrap()
            .unwrap()["selection"]["model"],
        "fast"
    );
    assert!(
        crate::ai_profiles::resolve(&pool, &foreign, "evidence-review", "analyst")
            .await
            .unwrap()
            .is_none()
    );
    override_profile["revision"] = json!(1);
    override_profile["selection"]["model"] = json!("pro");
    assert_eq!(
        http(
            "PUT",
            "/api/v2/ai/assistant/profiles/evidence-review/analyst".into(),
            override_profile
        )
        .await
        .0,
        StatusCode::OK
    );
    let before = count.load(Ordering::SeqCst);
    assert_eq!(
        http(
            "GET",
            format!("/api/v2/ai/assistant/chat/{id}/events?after=2"),
            Value::Null
        )
        .await
        .1
        .matches("event: run")
        .count(),
        1
    );
    assert_eq!(
        count.load(Ordering::SeqCst),
        before,
        "HTTP reconnect never calls inference"
    );
    let (status, page) = http(
        "GET",
        "/api/v2/ai/assistant/conversations?limit=1".into(),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let page: Value = serde_json::from_str(&page).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert!(page["next"].is_object());
    let response = http(
        "GET",
        format!("/api/v2/ai/assistant/conversations/{conversation}"),
        Value::Null,
    )
    .await;
    assert_eq!(response.0, StatusCode::OK);
    let detail: Value = serde_json::from_str(&response.1).unwrap();
    assert_eq!(detail["run"]["text"], "pro result");
    let continued_detail = http(
        "GET",
        format!("/api/v2/ai/assistant/conversations/{continuation_conversation}"),
        Value::Null,
    )
    .await;
    assert_eq!(continued_detail.0, StatusCode::OK);
    let continued_detail: Value = serde_json::from_str(&continued_detail.1).unwrap();
    assert_eq!(
        continued_detail["messages"].as_array().unwrap().len(),
        2,
        "continuation is one visible assistant reply"
    );
    assert_eq!(
        continued_detail["messages"][1]["content"],
        "Đang viết pro result"
    );
    assert_eq!(continued_detail["messages"][1]["id"], json!(continued_id));
    assert_eq!(
        http(
            "PATCH",
            format!("/api/v2/ai/assistant/conversations/{conversation}"),
            json!({"title":"Renamed","revision":detail["revision"]})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        http(
            "DELETE",
            format!("/api/v2/ai/assistant/conversations/{conversation}"),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        engine.read(&scope, id, false).await.is_err(),
        "delete cascades transcripts/events"
    );
    mode.store(0, Ordering::SeqCst);
    let mut default_body = body(Uuid::new_v4(), Uuid::new_v4(), "unused");
    default_body
        .as_object_mut()
        .unwrap()
        .remove("expected_selection");
    let original = state
        .ai_runs
        .submit(&scope, default_body.clone(), false)
        .await
        .unwrap();
    let original_id = identifier(original["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        finish(&state.ai_runs, &scope, original_id).await["selection"]["model"],
        "pro"
    );
    let updated =
        json!({"revision":1,"selection":{"provider":"local-gateway","model":"fast","effort":null}});
    assert_eq!(
        http(
            "PUT",
            "/api/v2/ai/assistant/profiles/system/default".into(),
            updated
        )
        .await
        .0,
        StatusCode::OK
    );
    let replay = state
        .ai_runs
        .submit(&scope, default_body, false)
        .await
        .unwrap();
    assert_eq!(replay["id"], original["id"]);
    assert_eq!(
        replay["selection"]["model"], "pro",
        "default changes cannot alter an idempotent replay"
    );
    #[cfg(windows)]
    if state.ai_runs.workflows.configured() {
        let baseline = count.load(Ordering::SeqCst);
        let workflow_body = json!({"idempotency_key":Uuid::new_v4(),"text":"Synthetic evidence only: sample A, no broker data.","locale":"vi"});
        let (status, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            workflow_body.clone(),
        )
        .await;
        assert_eq!(status, StatusCode::ACCEPTED, "{wire}");
        let submitted: Value = serde_json::from_str(&wire).unwrap();
        let workflow_id = identifier(submitted["id"].as_str().unwrap()).unwrap();
        let result = finish(&state.ai_runs, &scope, workflow_id).await;
        assert_eq!(result["status"], "completed", "{result}");
        assert_eq!(result["text"], "fast result");
        assert_eq!(result["grounding"]["data_access"], "user-supplied-text");
        assert_eq!(
            count.load(Ordering::SeqCst),
            baseline + 3,
            "two branches and one reviewer"
        );
        let steps = client
            .query(
                "SELECT node,selection,status FROM ai_run_steps WHERE run_id=$1 ORDER BY node",
                &[&workflow_id],
            )
            .await
            .unwrap();
        assert_eq!(steps.len(), 3);
        assert!(steps.iter().all(|s| s.get::<_, String>(2) == "completed"));
        assert_eq!(steps[0].get::<_, Value>(1)["model"], "pro");
        assert_eq!(steps[2].get::<_, Value>(1)["model"], "fast");
        let first_pid = state.ai_runs.workflows.idle_ids().await;
        assert_eq!(first_pid.len(), 1);
        let (_, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            workflow_body.clone(),
        )
        .await;
        assert_eq!(
            serde_json::from_str::<Value>(&wire).unwrap()["id"],
            submitted["id"]
        );
        assert_eq!(
            count.load(Ordering::SeqCst),
            baseline + 3,
            "graph replay does not infer"
        );
        let mut next_body = workflow_body.clone();
        next_body["idempotency_key"] = json!(Uuid::new_v4());
        let (_, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            next_body.clone(),
        )
        .await;
        let next_id = identifier(
            serde_json::from_str::<Value>(&wire).unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            finish(&state.ai_runs, &scope, next_id).await["status"],
            "completed"
        );
        assert_eq!(
            state.ai_runs.workflows.idle_ids().await,
            first_pid,
            "reuse a warm worker"
        );
        assert_eq!(
            state
                .ai_runs
                .read(&foreign, next_id, false)
                .await
                .unwrap_err()
                .0,
            StatusCode::NOT_FOUND
        );
        let (_, list) = http(
            "GET",
            "/api/v2/ai/assistant/conversations".into(),
            Value::Null,
        )
        .await;
        assert!(
            !serde_json::from_str::<Value>(&list).unwrap()["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["id"] == next_body["idempotency_key"]),
            "workflow does not pollute chat history"
        );
        mode.store(2, Ordering::SeqCst);
        let before_cancel = count.load(Ordering::SeqCst);
        next_body["idempotency_key"] = json!(Uuid::new_v4());
        let (_, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            next_body,
        )
        .await;
        let cancel_id = identifier(
            serde_json::from_str::<Value>(&wire).unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        tokio::time::timeout(Duration::from_secs(8), async {
            while count.load(Ordering::SeqCst) < before_cancel + 2 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            client
                .query_one(
                    "SELECT count(*) FROM ai_model_calls WHERE run_id=$1",
                    &[&cancel_id]
                )
                .await
                .unwrap()
                .get::<_, i64>(0),
            2,
            "parent holds no model permit"
        );
        state.ai_runs.read(&scope, cancel_id, true).await.unwrap();
        let cancelled = finish(&state.ai_runs, &scope, cancel_id).await;
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["outcome"], "unknown");
        assert!(
            state.ai_runs.workflows.idle_ids().await.is_empty(),
            "cancel discards the in-flight pipe session"
        );
        assert_eq!(
            client
                .query_one(
                    "SELECT count(*) FROM ai_model_calls WHERE run_id=$1",
                    &[&cancel_id]
                )
                .await
                .unwrap()
                .get::<_, i64>(0),
            0
        );
        assert_eq!(client.query_one("SELECT count(*) FROM ai_run_steps WHERE run_id=$1 AND status='interrupted' AND outcome='unknown'",&[&cancel_id]).await.unwrap().get::<_,i64>(0),2);
        mode.store(0, Ordering::SeqCst);
        let recover_body = json!({"idempotency_key":Uuid::new_v4(),"text":"Fresh run after cancellation.","locale":"en"});
        let (_, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            recover_body,
        )
        .await;
        let recover_id = identifier(
            serde_json::from_str::<Value>(&wire).unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            finish(&state.ai_runs, &scope, recover_id).await["status"],
            "completed"
        );
        assert_ne!(
            state.ai_runs.workflows.idle_ids().await,
            first_pid,
            "a cancelled worker is replaced for a new logical run only"
        );
        mode.store(1, Ordering::SeqCst);
        let rejected_body = json!({"idempotency_key":Uuid::new_v4(),"text":"Synthetic quota failure.","locale":"en"});
        let (_, wire) = http(
            "POST",
            "/api/v2/ai/assistant/workflows/evidence-review".into(),
            rejected_body,
        )
        .await;
        let rejected_id = identifier(
            serde_json::from_str::<Value>(&wire).unwrap()["id"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let rejected = finish(&state.ai_runs, &scope, rejected_id).await;
        assert_eq!(rejected["status"], "failed");
        assert_eq!(rejected["error"], "ai_gateway_rate_limited");
        assert_eq!(
            client
                .query_one(
                    "SELECT count(*) FROM ai_run_steps WHERE run_id=$1 AND node='reviewer'",
                    &[&rejected_id]
                )
                .await
                .unwrap()
                .get::<_, i64>(0),
            0,
            "failed branch cannot reach join/reviewer"
        );
        let requests_after_failure = count.load(Ordering::SeqCst);
        state
            .ai_runs
            .read(&scope, rejected_id, false)
            .await
            .unwrap();
        assert_eq!(
            count.load(Ordering::SeqCst),
            requests_after_failure,
            "reading failure does not retry"
        );
        mode.store(0, Ordering::SeqCst);
        println!(
            "AI_WORKFLOW_PIPE_HTTP_PG_PASS: role snapshots, branch/join, 3 admitted calls, replay, warm reuse, scope, cancel/unknown"
        );
    }
    foundation::verify(&state, &client).await;
    // Agent configuration survives reads, is tenant scoped and reaches provider input as data.
    let agent_body = json!({"name":"Breakout","description":"One strategy","instructions":"Explain the setup first","knowledge":[{"name":"rules.md","text":"Risk per trade: 0.5%. No trade during news."}]});
    let created = http(
        "POST",
        "/api/v2/ai/assistant/agents".into(),
        agent_body.clone(),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    let agent: Value = serde_json::from_str(&created.1).unwrap();
    let agent_uuid = identifier(agent["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        http(
            "PATCH",
            "/api/v2/ai/assistant/agents/mentor".into(),
            agent_body.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let roster: Value = serde_json::from_str(
        &http("GET", "/api/v2/ai/assistant/agents".into(), Value::Null)
            .await
            .1,
    )
    .unwrap();
    assert_eq!(roster["items"].as_array().unwrap().len(), 2);
    assert!(roster["items"][1].get("knowledge").is_none());
    let mut agent_run = body(Uuid::new_v4(), Uuid::new_v4(), "pro");
    agent_run["agent"] = json!({"id":agent["id"],"revision":1});
    assert_eq!(
        state
            .ai_runs
            .submit(&foreign, agent_run.clone(), false)
            .await
            .unwrap_err()
            .0,
        StatusCode::NOT_FOUND
    );
    let submitted = state
        .ai_runs
        .submit(&scope, agent_run.clone(), false)
        .await
        .unwrap();
    let agent_run_id = identifier(submitted["id"].as_str().unwrap()).unwrap();
    let mut edit = agent_body.clone();
    edit["revision"] = json!(1);
    edit["instructions"] = json!("Updated instruction");
    assert_eq!(
        http(
            "PATCH",
            format!("/api/v2/ai/assistant/agents/{agent_uuid}"),
            edit.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        http(
            "PATCH",
            format!("/api/v2/ai/assistant/agents/{agent_uuid}"),
            edit
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        finish(&state.ai_runs, &scope, agent_run_id).await["status"],
        "completed"
    );
    let agent_payload = seen.lock().await.last().unwrap().clone();
    let packed: Value = serde_json::from_str(
        agent_payload["input"].as_array().unwrap().last().unwrap()["content"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        packed["agent_configuration"]["instructions"],
        "Explain the setup first"
    );
    assert_eq!(
        packed["agent_configuration"]["knowledge"][0]["name"],
        "rules.md"
    );
    assert!(agent_payload.get("tools").is_none());
    // Idempotent replay keeps the old immutable snapshot after editing the agent.
    assert_eq!(
        state
            .ai_runs
            .submit(&scope, agent_run.clone(), false)
            .await
            .unwrap()["id"],
        submitted["id"]
    );
    agent_run["idempotency_key"] = json!(Uuid::new_v4());
    assert_eq!(
        state
            .ai_runs
            .submit(&scope, agent_run.clone(), false)
            .await
            .unwrap_err()
            .1["detail"],
        "ai_agent_changed"
    );
    // Continue must not re-resolve an edited agent before restoring the pinned configuration.
    client
        .execute(
            "UPDATE ai_runs SET status='cancelled' WHERE run_id=$1",
            &[&agent_run_id],
        )
        .await
        .unwrap();
    let mut agent_continue = agent_run.clone();
    agent_continue["continuation_of"] = json!(agent_run_id);
    let resumed = state
        .ai_runs
        .submit(&scope, agent_continue, false)
        .await
        .unwrap();
    let resumed_id = identifier(resumed["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        finish(&state.ai_runs, &scope, resumed_id).await["status"],
        "completed"
    );
    let pinned: Value = client
        .query_one(
            "SELECT config->'agent' FROM ai_runs WHERE run_id=$1",
            &[&resumed_id],
        )
        .await
        .unwrap()
        .get(0);
    assert_eq!(pinned["instructions"], "Explain the setup first");
    agent_run["idempotency_key"] = json!(Uuid::new_v4());
    agent_run["agent"]["revision"] = json!(2);
    agent_run["agent"]["id"] = json!("mentor");
    agent_run["agent"]["revision"] = json!(0);
    assert_eq!(
        state
            .ai_runs
            .submit(&scope, agent_run, false)
            .await
            .unwrap_err()
            .1["detail"],
        "ai_agent_mismatch"
    );
    let custom_history: Value = serde_json::from_str(
        &http(
            "GET",
            format!("/api/v2/ai/assistant/conversations?agent_id={agent_uuid}"),
            Value::Null,
        )
        .await
        .1,
    )
    .unwrap();
    assert_eq!(custom_history["items"].as_array().unwrap().len(), 1);
    println!(
        "AI_AGENT_HTTP_PG_PASS: CRUD, scope, immutable snapshot, provider grounding, history separation, idempotency"
    );
    state.ai_runs.shutdown().await;
    let before = count.load(Ordering::SeqCst);
    let paused = Engine::new(pool.clone(), assistant.clone());
    paused.stopped.store(true, Ordering::Release);
    for _ in 0..16 {
        paused
            .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "pro"), false)
            .await
            .unwrap();
    }
    assert_eq!(
        paused
            .submit(&scope, body(Uuid::new_v4(), Uuid::new_v4(), "pro"), false)
            .await
            .unwrap_err()
            .1["detail"],
        "ai_queue_full"
    );
    assert_eq!(
        count.load(Ordering::SeqCst),
        before,
        "queue admission does no inference"
    );
    let queued=client.query_one("SELECT run_id,conversation_id,idempotency_key,input FROM ai_runs WHERE status='queued' LIMIT 1",&[]).await.unwrap();
    let queued_id: Uuid = queued.get(0);
    let queued_conversation: Uuid = queued.get(1);
    assert_eq!(
        paused.read(&scope, queued_id, true).await.unwrap()["status"],
        "cancelled"
    );
    let sequence = paused.read(&scope, queued_id, true).await.unwrap()["sequence"].clone();
    assert_eq!(
        paused.read(&scope, queued_id, true).await.unwrap()["sequence"],
        sequence
    );
    let replacement = body(queued_conversation, Uuid::new_v4(), "pro");
    paused.submit(&scope, replacement, false).await.unwrap();
    let ledger=client.query_one("DELETE FROM tw_schema_migrations WHERE version='0013_ai_workflows.sql' RETURNING sha256",&[]).await.unwrap();
    assert!(
        crate::rust_runtime::apply_migrations(&mut client, true)
            .await
            .unwrap_err()
            .contains("active AI work")
    );
    client
        .execute(
            "INSERT INTO tw_schema_migrations(version,sha256) VALUES('0013_ai_workflows.sql',$1)",
            &[&ledger.get::<_, String>(0)],
        )
        .await
        .unwrap();
    let competitor = Engine::new(pool.clone(), assistant.clone());
    let (left, right) = tokio::join!(paused.claim(), competitor.claim());
    assert!(left.unwrap().is_some() && right.unwrap().is_some());
    assert!(paused.claim().await.unwrap().is_some());
    assert!(
        competitor.claim().await.unwrap().is_none(),
        "route/workspace cap applies across instances"
    );
    assert_eq!(
        client
            .query_one("SELECT count(*) FROM ai_model_calls", &[])
            .await
            .unwrap()
            .get::<_, i64>(0),
        3
    );
    // Cancelled parents cannot accept an in-flight progress checkpoint.
    let claimed = client
        .query_one(
            "SELECT run_id,owner FROM ai_runs WHERE status='running' LIMIT 1",
            &[],
        )
        .await
        .unwrap();
    let claimed_id: Uuid = claimed.get(0);
    let claimed_owner: Uuid = claimed.get(1);
    paused.read(&scope, claimed_id, true).await.unwrap();
    let tx = fenced.transaction().await.unwrap();
    assert!(
        transition(
            &tx,
            claimed_id,
            Some(claimed_owner),
            "running",
            json!({"text":"late progress"})
        )
        .await
        .is_err()
    );
    tx.rollback().await.unwrap();
    competitor.shutdown().await;
    state.ai_runs.shutdown().await;
    paused.shutdown().await;
    assistant.shutdown().await;
    server.abort();
    pool.close();
    db_task.abort();
    let _ = std::fs::remove_file(key);
}
