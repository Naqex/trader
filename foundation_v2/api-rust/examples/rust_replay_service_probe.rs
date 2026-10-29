use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, state::AppState};

async fn invoke(router: axum::Router, input: Value) -> Value {
    let mut builder = Request::builder()
        .method(input["method"].as_str().unwrap())
        .uri(input["path"].as_str().unwrap())
        .header("x-workspace-id", input["workspace"].as_str().unwrap())
        .header("content-type", "application/json");
    if let Some(key) = input["key"].as_str() {
        builder = builder.header("idempotency-key", key);
    }
    let req = builder
        .body(Body::from(
            input
                .get("body")
                .map(|v| serde_json::to_string(v).unwrap())
                .unwrap_or_default(),
        ))
        .unwrap();
    let started = std::time::Instant::now();
    let response = router.oneshot(req).await.unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 32 * 1024 * 1024)
        .await
        .unwrap();
    let router_elapsed_us = started.elapsed().as_micros() as u64;
    let body = serde_json::from_slice::<Value>(&bytes)
        .unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes).to_string()));
    json!({"status": status, "body": body, "router_elapsed_us": router_elapsed_us})
}

#[tokio::main]
async fn main() {
    let cfg = Config::from_environment().expect("probe configuration");
    let state = AppState::connect(cfg).await.expect("probe state");
    let router = trading_workspace_api::router(state, trading_workspace_api::domain_routes());
    for line in io::stdin().lock().lines() {
        let input: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let result = if let Some(batch) = input.get("batch").and_then(Value::as_array) {
            assert!(
                !batch.is_empty() && batch.len() <= 32,
                "bounded probe batch required"
            );
            let mut tasks = tokio::task::JoinSet::new();
            for (index, request) in batch.iter().cloned().enumerate() {
                let router = router.clone();
                tasks.spawn(async move {
                    let started = std::time::Instant::now();
                    let mut response = invoke(router, request).await;
                    response["elapsed_us"] = json!(started.elapsed().as_micros() as u64);
                    (index, response)
                });
            }
            let mut responses = vec![Value::Null; batch.len()];
            while let Some(result) = tasks.join_next().await {
                let (index, response) = result.unwrap();
                responses[index] = response;
            }
            json!({"batch": responses})
        } else {
            invoke(router.clone(), input).await
        };
        println!("{}", result);
        io::stdout().flush().unwrap();
    }
}
