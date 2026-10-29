//! Owned acceptance harness: wire identity/size and Router time, never owner data.
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::io::{self, BufRead, Write};
use tower::ServiceExt;
use trading_workspace_api::{config::Config, state::AppState};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_writer(std::io::stderr)
        .with_env_filter("info")
        .init();
    let state = AppState::connect(Config::from_environment().expect("probe configuration"))
        .await
        .expect("probe state");
    let router = trading_workspace_api::router(state, trading_workspace_api::domain_routes());
    for line in io::stdin().lock().lines() {
        let input: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let mut builder = Request::builder()
            .method(input["method"].as_str().unwrap())
            .uri(input["path"].as_str().unwrap())
            .header("x-workspace-id", input["workspace"].as_str().unwrap())
            .header("content-type", "application/json");
        if let Some(key) = input["key"].as_str() {
            builder = builder.header("idempotency-key", key);
        }
        let request = builder
            .body(Body::from(
                input
                    .get("body")
                    .map(|body| serde_json::to_string(body).unwrap())
                    .unwrap_or_default(),
            ))
            .unwrap();
        let started = std::time::Instant::now();
        let response = router.clone().oneshot(request).await.unwrap();
        let status = response.status().as_u16();
        let command = response
            .headers()
            .get("x-command-id")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let bytes = to_bytes(response.into_body(), 32 * 1024 * 1024)
            .await
            .unwrap();
        let elapsed = started.elapsed().as_micros() as u64;
        let result = json!({"status":status, "body":serde_json::from_slice::<Value>(&bytes).unwrap(),
            "command_id":command, "response_bytes":bytes.len(),
            "response_sha256":format!("{:x}", Sha256::digest(&bytes)), "router_elapsed_us":elapsed});
        println!("{}", result);
        io::stdout().flush().unwrap();
    }
}
