pub mod auth;
pub mod catalog;
pub mod commands;
pub mod config;
pub mod events;
pub mod jobs;
pub mod middleware;
pub mod native_mutation;
pub mod native_contracts;
pub mod metadata_mutations;
pub mod replay_core;
pub mod replay_service;
pub mod session_trading_options;
pub mod session_presets;
pub mod live_ledger;
pub mod mt5_connector;
pub mod demo_trading;
pub mod replay_portfolio;
pub mod replay_storage;
pub mod prop_core;
pub mod prop_service;
pub mod artifact_data;
mod ai_documents;
mod ai_context;
pub mod data_routes;
pub mod analytics;
pub mod control_routes;
pub mod context_routes;
pub mod provider_routes;
pub mod notion_oauth;
pub mod ai_assistant;
pub mod ai_runs;
mod ai_profiles;
mod ai_agents;
mod ai_response;
mod ai_workflows;
mod ai_gateway;
mod ai_gateway_runtime;
pub mod research_jobs;
pub mod research_execution;
pub mod rust_runtime;
pub mod owned_process;
pub mod state;
pub mod telemetry;

use auth::ApiError;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;
use state::AppState;
use std::sync::{Arc, atomic::Ordering};

pub const CONTRACT_VERSION: &str = "foundation-v2.1";

pub fn domain_routes() -> Router<Arc<AppState>> {
    domain_routes_for(false)
}
fn domain_routes_for(native_runtime: bool) -> Router<Arc<AppState>> {
    catalog::routes()
        .merge(jobs::routes())
        .merge(events::routes())
        .merge(commands::routes_for(native_runtime))
        .merge(metadata_mutations::routes())
        .merge(session_presets::routes())
        .merge(live_ledger::routes())
        .merge(mt5_connector::routes())
        .merge(demo_trading::routes())
        .merge(replay_service::routes())
        .merge(prop_service::routes())
        .merge(analytics::routes())
        .merge(context_routes::routes())
        .merge(notion_oauth::routes())
        .merge(ai_assistant::routes())
        .merge(control_routes::routes())
        .merge(research_jobs::routes())
        .merge(data_routes::routes())
        .merge(provider_routes::routes())
}

pub fn runtime_domain_routes(state: &Arc<AppState>) -> Result<Router<Arc<AppState>>, String> {
    let routes = domain_routes_for(state.native_runtime);
    if state.native_runtime {
        Ok(routes.merge(provider_routes::runtime_routes(state.providers.clone())?))
    } else {
        Ok(routes)
    }
}

pub fn router(state: Arc<AppState>, domain: Router<Arc<AppState>>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/health/live", get(health))
        .route("/health/ready", get(readiness))
        .route("/internal/metrics", get(metrics))
        .route("/openapi.json", get(openapi))
        .merge(domain)
        .fallback(|| async { ApiError::detail(StatusCode::NOT_FOUND, "Not Found") })
        .layer(DefaultBodyLimit::max(state.config.max_body_bytes))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::boundary,
        ))
        .with_state(state)
}
async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(
        json!({"ok":true,"contract_version":CONTRACT_VERSION,"execution_capability":false,"authorization":state.authorization.status()}),
    )
}
async fn readiness(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if state.draining.load(Ordering::Acquire) {
        return Err(ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "server_draining",
        ));
    }
    let probe = async {
        let conn = state.pool.get().await.map_err(|_| ApiError::database())?;
        let required = commands::required_worker_manifest_for(state.native_runtime);
        let needs_worker = required.as_array().is_none_or(|routes| !routes.is_empty());
        if state.native_runtime && !state.providers.worker_ready() {
            return Err(ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "native_provider_worker_unavailable"));
        }
        if needs_worker && state.native_runtime {
            return Err(ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, "native_route_coverage_incomplete"));
        }
        if needs_worker {
        let worker=conn.query_one("SELECT EXISTS(SELECT 1 FROM api_command_workers WHERE contract_version='api-command-v1' AND heartbeat_at_utc>CURRENT_TIMESTAMP-interval '20 seconds' AND route_manifest @> $1::jsonb)", &[&required])
            .await
            .map_err(|_| ApiError::database())?;
        if !worker.get::<_, bool>(0) {
            return Err(ApiError::detail(
                StatusCode::SERVICE_UNAVAILABLE,
                "command_worker_unavailable",
            ));
        }
        }
        if state.openapi_schema.is_none() {
            return Err(ApiError::detail(
                StatusCode::SERVICE_UNAVAILABLE,
                "contract_schema_unavailable",
            ));
        }
        Ok::<_, ApiError>(Json(
            json!({"ok":true,"database":"ready","command_worker":if needs_worker {"ready"} else {"not_required"},"contract_version":CONTRACT_VERSION}),
        ))
    };
    tokio::time::timeout(state.config.pool_timeout, probe)
        .await
        .map_err(|_| ApiError::database())?
}
async fn metrics(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let expected = state.config.metrics_token.as_deref();
    let actual = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let permitted = match (expected, actual) {
        (Some(a), Some(b)) => secret_matches(a.as_bytes(), b.as_bytes()),
        _ => false,
    };
    if !permitted {
        return ApiError::detail(StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    let status = state.pool.status();
    (
        [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
        state
            .telemetry
            .render(status.size, status.available, status.waiting),
    )
        .into_response()
}
fn secret_matches(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    bool::from(a.ct_eq(b))
}
async fn openapi(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>, ApiError> {
    state.openapi_schema.clone().map(Json).ok_or_else(|| {
        ApiError::detail(
            StatusCode::SERVICE_UNAVAILABLE,
            "contract_schema_unavailable",
        )
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use std::{
        collections::HashMap,
        path::PathBuf,
        sync::{Mutex, atomic::AtomicBool},
        time::Duration,
    };
    use tower::ServiceExt;
    pub(crate) fn fixture(rate: u32) -> Arc<AppState> {
        let config = config::Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            database_url: "host=127.0.0.1 port=1 user=test".into(),
            artifact_root: PathBuf::from("."),
            pool_size: 1,
            pool_timeout: Duration::from_millis(50),
            request_timeout: Duration::from_millis(10),
            drain_timeout: Duration::from_millis(50),
            command_wait_timeout: Duration::from_millis(5),
            max_concurrency: 1,
            max_body_bytes: 1024,
            requests_per_minute: rate,
            local_identity: "owner".into(),
            local_workspaces: Some(vec!["a".into()]),
            metrics_token: Some("a".repeat(32)),
            openapi_path: PathBuf::from("missing"),
        };
        let db = config.database_url.parse().unwrap();
        let pool = deadpool_postgres::Pool::builder(deadpool_postgres::Manager::new(
            db,
            tokio_postgres::NoTls,
        ))
        .max_size(1)
        .build()
        .unwrap();
        let ai_assistant = Arc::new(crate::ai_assistant::AiAssistant::from_environment().unwrap());
        let ai_runs = crate::ai_runs::Engine::new(pool.clone(), ai_assistant.clone());
        Arc::new(AppState {
            ai_assistant,
            ai_runs,
            config,
            pool,
            authorization: auth::LocalAuthorization::new("owner".into(), vec!["a".into()]),
            telemetry: telemetry::Telemetry::default(),
            admission: Arc::new(tokio::sync::Semaphore::new(1)),
            artifact_reads: Arc::new(tokio::sync::Semaphore::new(2)),
            artifact_data: Arc::new(crate::artifact_data::ArtifactData::new(".").unwrap()),
            analytics_cache: Default::default(),
            replay_history: Default::default(),
            notion_oauth: Arc::new(crate::notion_oauth::NotionOAuthService::new(None).unwrap()),
            providers: crate::provider_routes::ProviderRuntime::load(std::path::PathBuf::from("."), crate::provider_routes::DownloadEngine::None).unwrap(),
            event_hub: crate::events::EventHub::default(),
            market_hub: crate::demo_trading::market_stream::MarketHub::default(),
            draining: AtomicBool::new(false),
            rate_windows: Mutex::new(HashMap::new()),
            openapi_schema: None,
            native_runtime: false,
        })
    }
    fn request(path: &str, workspace: Option<&str>) -> Request<Body> {
        let mut req = Request::builder().uri(path);
        if let Some(workspace) = workspace {
            req = req.header("x-workspace-id", workspace);
        }
        req.body(Body::empty()).unwrap()
    }
    #[tokio::test]
    async fn health_and_all_domain_paths_obey_identity_contract() {
        let app = router(
            fixture(10),
            Router::new().route(
                "/api/v2/example",
                get(|| async { Json(json!({"ok":true})) }),
            ),
        );
        let response = app.clone().oneshot(request("/health", None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().contains_key("x-request-id"));
        let value: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["contract_version"], CONTRACT_VERSION);
        assert_eq!(value["execution_capability"], false);
        assert_eq!(
            app.clone()
                .oneshot(request("/api/v2/example", None))
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            app.clone()
                .oneshot(request("/api/v2/example", Some("b")))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            app.oneshot(request("/api/v2/example", Some("a")))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
    }
    #[tokio::test]
    async fn overload_deadline_and_rate_are_explicit() {
        let state = fixture(2);
        let app = router(
            state.clone(),
            Router::new().route(
                "/api/v2/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    "done"
                }),
            ),
        );
        let permit = state.admission.clone().acquire_owned().await.unwrap();
        assert_eq!(
            app.clone()
                .oneshot(request("/api/v2/slow", Some("a")))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(
            app.clone()
                .oneshot(request("/health/live", None))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        drop(permit);
        assert_eq!(
            app.clone()
                .oneshot(request("/api/v2/slow", Some("a")))
                .await
                .unwrap()
                .status(),
            StatusCode::GATEWAY_TIMEOUT
        );
        let response = app
            .oneshot(request("/api/v2/slow", Some("a")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()["retry-after"], "60");
        assert_eq!(state.admission.available_permits(), 1);
    }
    #[tokio::test]
    async fn metrics_is_protected_and_readiness_is_separate() {
        let mut state = fixture(10);
        Arc::get_mut(&mut state).unwrap().config.request_timeout = Duration::from_millis(100);
        let app = router(state, Router::new());
        assert_eq!(
            app.clone()
                .oneshot(request("/internal/metrics", None))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        let mut req = request("/internal/metrics", None);
        req.headers_mut().insert(
            "authorization",
            format!("Bearer {}", "a".repeat(32)).parse().unwrap(),
        );
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(
            app.oneshot(request("/health/ready", None))
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    #[tokio::test]
    async fn oauth_callback_is_exact_and_only_the_nonce_handler_selects_scope() {
        async fn callback(scope: Option<axum::extract::Extension<auth::Workspace>>) -> Json<serde_json::Value> {
            Json(json!({"injected_workspace":scope.map(|s| s.0.workspace_id)}))
        }
        let app = router(
            fixture(10),
            Router::new().route("/api/v2/connectors/notion/oauth/callback", get(callback)),
        );
        let response = app
            .clone()
            .oneshot(request(
                "/api/v2/connectors/notion/oauth/callback?state=nonce",
                Some("b"),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        let value: serde_json::Value = serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(value["injected_workspace"], serde_json::Value::Null);
        assert_eq!(
            app.oneshot(request(
                "/api/v2/connectors/notion/oauth/callback/extra",
                None
            ))
            .await
            .unwrap()
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut state = fixture(10);
        Arc::get_mut(&mut state).unwrap().config.local_workspaces =
            Some(vec!["a".into(), "b".into()]);
        let response = router(
            state,
            Router::new().route("/api/v2/connectors/notion/oauth/callback", get(callback)),
        )
        .oneshot(request("/api/v2/connectors/notion/oauth/callback", None))
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    #[tokio::test]
    async fn unreviewed_head_has_no_domain_or_worker_side_effect() {
        let app = router(fixture(10), domain_routes());
        let req = Request::builder()
            .method("HEAD")
            .uri("/api/v2/replay/sessions")
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        let allow = response.headers()["allow"].to_str().unwrap();
        assert!(allow.contains("GET"));
        assert!(allow.contains("POST"));
        assert!(!allow.contains("HEAD"));
    }
}
