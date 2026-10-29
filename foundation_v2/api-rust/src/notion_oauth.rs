//! Process-local OAuth ownership; the PREP_ONLY connector ledger never owns tokens.
use crate::{
    auth::{ApiError, LocalAuthorization, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, Uri},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;

const PREFIX: &str = "/api/v2/connectors/notion/oauth";
const CALLBACK: &str = "/api/v2/connectors/notion/oauth/callback";
const AUTHORIZE_URL: &str = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_URL: &str = "https://api.notion.com/v1/oauth/token";

// These types deliberately do not implement Debug or Serialize: secrets must not
// accidentally enter a trace, command receipt, ledger or generic JSON response.
pub struct NotionOAuthConfig {
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    redirect_origin: LocalOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct LocalOrigin {
    host: String,
    port: Option<u16>,
}

impl NotionOAuthConfig {
    pub fn new(
        client_id: String,
        client_secret: String,
        redirect_uri: String,
    ) -> Result<Self, String> {
        // Keep validation order/error names of the Python boundary, including an
        // explicitly missing or malformed port before path validation.
        let (scheme, rest) = redirect_uri
            .split_once("://")
            .ok_or("notion_oauth_redirect_must_be_loopback")?;
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
        if scheme.to_ascii_lowercase() != "http"
            || !matches!(
                host.to_ascii_lowercase().as_str(),
                "127.0.0.1" | "localhost"
            )
            || authority.contains('@')
        {
            return Err("notion_oauth_redirect_must_be_loopback".into());
        }
        if port.parse::<u16>().is_err() {
            return Err("notion_oauth_redirect_port_invalid".into());
        }
        let origin = parse_http_origin(&format!("http://{authority}"))
            .map_err(|_| "notion_oauth_redirect_must_be_loopback")?;
        if !matches!(origin.host.as_str(), "127.0.0.1" | "localhost") {
            return Err("notion_oauth_redirect_must_be_loopback".into());
        }
        if origin.port.is_none() {
            return Err("notion_oauth_redirect_port_invalid".into());
        }
        let uri: Uri = redirect_uri
            .split('#')
            .next()
            .unwrap_or("")
            .parse()
            .map_err(|_| "notion_oauth_redirect_path_invalid")?;
        if uri.path() != CALLBACK
            || uri.query().is_some_and(|v| !v.is_empty())
            || redirect_uri
                .split_once('#')
                .is_some_and(|(_, fragment)| !fragment.is_empty())
        {
            return Err("notion_oauth_redirect_path_invalid".into());
        }
        Ok(Self {
            client_id,
            client_secret,
            redirect_uri,
            redirect_origin: origin,
        })
    }

    pub fn from_environment() -> Result<Option<Self>, String> {
        let values: Vec<String> = [
            "TW_V2_NOTION_CLIENT_ID",
            "TW_V2_NOTION_CLIENT_SECRET",
            "TW_V2_NOTION_REDIRECT_URI",
        ]
        .map(|key| std::env::var(key).unwrap_or_default().trim().to_owned())
        .into();
        if values.iter().all(String::is_empty) {
            return Ok(None);
        }
        if values.iter().any(String::is_empty) {
            return Err("notion_oauth_configuration_incomplete".into());
        }
        Self::new(values[0].clone(), values[1].clone(), values[2].clone()).map(Some)
    }
}

struct Pending {
    workspace: String,
    identity: String,
    generation: uuid::Uuid,
    expires_at: DateTime<Utc>,
}
struct Connection {
    id: String,
    _access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<DateTime<Utc>>,
}
#[derive(Default)]
struct Memory {
    pending: HashMap<String, Pending>,
    connections: HashMap<(String, String), Connection>,
    generations: HashMap<(String, String), uuid::Uuid>,
}

pub struct NotionOAuthService {
    config: Option<NotionOAuthConfig>,
    client: reqwest::Client,
    token_url: String,
    memory: Mutex<Memory>,
}

impl NotionOAuthService {
    pub fn from_environment() -> Result<Self, String> {
        Self::new(NotionOAuthConfig::from_environment()?)
    }

    pub fn new(config: Option<NotionOAuthConfig>) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(|_| "notion_oauth_client_initialization_failed")?;
        Ok(Self {
            config,
            client,
            token_url: TOKEN_URL.into(),
            memory: Mutex::new(Memory::default()),
        })
    }

    fn begin_at(
        &self,
        workspace: &str,
        identity: &str,
        now: DateTime<Utc>,
    ) -> Result<String, String> {
        let config = self.config.as_ref().ok_or("notion_oauth_not_configured")?;
        let nonce = random_urlsafe(32)?;
        {
            let mut memory = self.memory.lock().unwrap_or_else(|p| p.into_inner());
            memory.pending.retain(|_, value| value.expires_at > now);
            let generation = memory
                .generations
                .get(&(workspace.into(), identity.into()))
                .copied()
                .unwrap_or_default();
            memory.pending.insert(
                nonce.clone(),
                Pending {
                    workspace: workspace.into(),
                    identity: identity.into(),
                    generation,
                    expires_at: now + Duration::minutes(10),
                },
            );
        }
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &config.client_id)
            .append_pair("response_type", "code")
            .append_pair("owner", "user")
            .append_pair("redirect_uri", &config.redirect_uri)
            .append_pair("state", &nonce)
            .finish();
        Ok(format!("{AUTHORIZE_URL}?{query}"))
    }

    async fn complete_at(
        &self,
        nonce: &str,
        code: &str,
        auth: &LocalAuthorization,
        now: DateTime<Utc>,
    ) -> Result<Value, ApiError> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| bad("notion_oauth_not_configured"))?;
        // Consume before authorization/exchange. A failed attempt never permits code replay.
        let pending = self
            .memory
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .pending
            .remove(nonce)
            .filter(|pending| pending.expires_at > now)
            .ok_or_else(|| bad("notion_oauth_state_invalid_or_expired"))?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-workspace-id",
            HeaderValue::from_str(&pending.workspace)
                .map_err(|_| forbidden("notion_oauth_workspace_access_denied"))?,
        );
        let scope = auth
            .authorize(&headers)
            .map_err(|_| forbidden("notion_oauth_workspace_access_denied"))?;
        if !bool::from(scope.subject.as_bytes().ct_eq(pending.identity.as_bytes())) {
            return Err(bad("notion_oauth_identity_changed"));
        }
        if code.is_empty() || code.chars().count() > 2048 {
            return Err(bad("notion_oauth_code_invalid"));
        }
        let response = self.client.post(&self.token_url)
            .basic_auth(&config.client_id, Some(&config.client_secret))
            .header("accept", "application/json")
            .json(&json!({"grant_type":"authorization_code","code":code,"redirect_uri":config.redirect_uri}))
            .send().await.map_err(|_| bad("notion_oauth_exchange_failed"))?;
        // error_for_status accepts redirects; Python raise_for_status rejects them.
        if !response.status().is_success() {
            return Err(bad("notion_oauth_exchange_failed"));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| bad("notion_oauth_exchange_failed"))?
        {
            if bytes.len().saturating_add(chunk.len()) > 128 * 1024 {
                return Err(bad("notion_oauth_exchange_failed"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let payload: Value =
            serde_json::from_slice(&bytes).map_err(|_| bad("notion_oauth_exchange_failed"))?;
        let access = payload
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|v| valid_token(v))
            .ok_or_else(|| bad("notion_oauth_token_missing"))?;
        let refresh = match payload.get("refresh_token") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .filter(|v| valid_token(v))
                    .ok_or_else(|| bad("notion_oauth_token_invalid"))?
                    .to_owned(),
            ),
        };
        let expires_at = match payload.get("expires_in") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let seconds = value
                    .as_i64()
                    .filter(|v| (1..=31_536_000).contains(v))
                    .ok_or_else(|| bad("notion_oauth_token_invalid"))?;
                Some(now + Duration::seconds(seconds))
            }
        };
        let id = format!(
            "notion-{}",
            random_urlsafe(18).map_err(|_| bad("notion_oauth_random_unavailable"))?
        );
        let mut memory = self.memory.lock().unwrap_or_else(|p| p.into_inner());
        let key = (pending.workspace, pending.identity);
        // Disconnect may happen while the token endpoint is responding. The
        // same lock fences that exchange from recreating a canceled connection.
        if memory.generations.get(&key).copied().unwrap_or_default() != pending.generation {
            return Err(ApiError::detail(
                StatusCode::CONFLICT,
                "notion_oauth_connection_canceled",
            ));
        }
        memory.connections.insert(
            key,
            Connection {
                id: id.clone(),
                _access_token: access.into(),
                refresh_token: refresh,
                expires_at,
            },
        );
        Ok(json!({"status":"connected","connection_id":id}))
    }

    fn status_at(&self, workspace: &str, identity: &str, now: DateTime<Utc>) -> Value {
        let memory = self.memory.lock().unwrap_or_else(|p| p.into_inner());
        let connection = memory.connections.get(&(workspace.into(), identity.into()));
        let status = match connection {
            None => "disconnected",
            Some(value) if value.expires_at.is_some_and(|at| at <= now) => {
                if value.refresh_token.is_some() {
                    "reconnect_required"
                } else {
                    "expired"
                }
            }
            Some(_) => "connected",
        };
        json!({"provider":"notion","oauth_available":self.config.is_some(),"status":status,
            "connection_id":connection.map(|v| &v.id),"token_persistence":"process_memory_only",
            "provider_identity_verified":false,"provider_permission_verified":false,"export_mode":"PREP_ONLY","cloud_write":false})
    }

    fn disconnect(&self, workspace: &str, identity: &str) {
        let mut memory = self.memory.lock().unwrap_or_else(|p| p.into_inner());
        let key = (workspace.into(), identity.into());
        memory.connections.remove(&key);
        memory.generations.insert(key, uuid::Uuid::new_v4());
        memory
            .pending
            .retain(|_, pending| pending.workspace != workspace || pending.identity != identity);
    }
}

fn random_urlsafe(size: usize) -> Result<String, String> {
    let mut bytes = vec![0; size];
    getrandom::fill(&mut bytes).map_err(|_| "notion_oauth_random_unavailable")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 16_384 && token.bytes().all(|b| (33..=126).contains(&b))
}
fn bad(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::BAD_REQUEST, detail)
}
fn forbidden(detail: &str) -> ApiError {
    ApiError::detail(StatusCode::FORBIDDEN, detail)
}

fn parse_http_origin(value: &str) -> Result<LocalOrigin, ()> {
    let uri: Uri = value.parse().map_err(|_| ())?;
    if uri.scheme_str() != Some("http") || value.contains('@') || value.contains('#') {
        return Err(());
    }
    let authority = uri.authority().ok_or(())?;
    let host = authority
        .host()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    // http::Authority accepts nonnumeric ports but port_u16() reports None;
    // distinguishing them from a missing port prevents malformed-host bypass.
    let raw = authority.as_str();
    let port = if raw.ends_with(']') {
        None
    } else {
        match raw.rsplit_once(':') {
            Some((_, "")) => None,
            Some((_, port)) => Some(port.parse::<u16>().map_err(|_| ())?),
            None => None,
        }
    };
    Ok(LocalOrigin { host, port })
}
fn loopback(host: &str) -> bool {
    host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn guard(
    request: &Request,
    service: &NotionOAuthService,
    callback: bool,
    mutation: bool,
) -> Result<(), ApiError> {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|v| v.0);
    if !peer.is_some_and(|peer| peer.ip().is_loopback()) {
        return Err(forbidden("notion_oauth_local_only"));
    }
    let uri = request.uri();
    let scheme = uri.scheme_str().unwrap_or("http");
    let authority = uri
        .authority()
        .map(|v| v.as_str())
        .or_else(|| request.headers().get("host").and_then(|v| v.to_str().ok()))
        .ok_or_else(|| forbidden("notion_oauth_local_only"))?;
    let origin = parse_http_origin(&format!("{scheme}://{authority}"))
        .map_err(|_| forbidden("notion_oauth_local_only"))?;
    if !loopback(&origin.host) {
        return Err(forbidden("notion_oauth_local_only"));
    }
    if callback {
        let config = service.config.as_ref().ok_or_else(|| {
            ApiError::detail(
                StatusCode::SERVICE_UNAVAILABLE,
                "notion_oauth_not_configured",
            )
        })?;
        if origin != config.redirect_origin {
            return Err(forbidden("notion_oauth_callback_origin_invalid"));
        }
    }
    if mutation {
        let value = request
            .headers()
            .get("origin")
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| forbidden("notion_oauth_origin_required"))?;
        let parsed =
            parse_http_origin(value).map_err(|_| forbidden("notion_oauth_origin_invalid"))?;
        let authority_end = value
            .find("://")
            .map(|i| i + 3)
            .ok_or_else(|| forbidden("notion_oauth_origin_invalid"))?;
        if value[authority_end..].contains(['/', '?', '#']) || parsed != origin {
            return Err(forbidden("notion_oauth_origin_invalid"));
        }
    }
    Ok(())
}

pub fn native(method: &str, path: &str) -> bool {
    matches!(
        (method, path),
        ("GET", "/api/v2/connectors/notion/oauth/status" | CALLBACK)
            | (
                "POST",
                "/api/v2/connectors/notion/oauth/start"
                    | "/api/v2/connectors/notion/oauth/disconnect"
            )
    )
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route(&format!("{PREFIX}/status"), get(status))
        .route(&format!("{PREFIX}/start"), post(start))
        .route(CALLBACK, get(callback))
        .route(&format!("{PREFIX}/disconnect"), post(disconnect))
        .layer(middleware::from_fn(protect_response))
}

async fn protect_response(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    for (key, value) in [
        ("cache-control", "no-store"),
        ("pragma", "no-cache"),
        (
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        ),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
    ] {
        response
            .headers_mut()
            .insert(key, HeaderValue::from_static(value));
    }
    response
}

async fn status(
    State(state): State<Arc<AppState>>,
    workspace: Workspace,
    request: Request,
) -> Result<Json<Value>, ApiError> {
    let service = &state.notion_oauth;
    guard(&request, &service, false, false)?;
    Ok(Json(service.status_at(
        &workspace.workspace_id,
        &workspace.subject,
        Utc::now(),
    )))
}
async fn start(
    State(state): State<Arc<AppState>>,
    workspace: Workspace,
    request: Request,
) -> Result<Json<Value>, ApiError> {
    let service = &state.notion_oauth;
    guard(&request, &service, false, true)?;
    let url = service
        .begin_at(&workspace.workspace_id, &workspace.subject, Utc::now())
        .map_err(|error| ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, &error))?;
    Ok(Json(json!({"authorization_url":url})))
}
async fn disconnect(
    State(state): State<Arc<AppState>>,
    workspace: Workspace,
    request: Request,
) -> Result<Json<Value>, ApiError> {
    let service = &state.notion_oauth;
    guard(&request, &service, false, true)?;
    service.disconnect(&workspace.workspace_id, &workspace.subject);
    Ok(Json(service.status_at(
        &workspace.workspace_id,
        &workspace.subject,
        Utc::now(),
    )))
}
async fn callback(
    State(state): State<Arc<AppState>>,
    request: Request,
) -> Result<&'static str, ApiError> {
    let service = &state.notion_oauth;
    guard(&request, &service, true, false)?;
    let query: HashMap<_, _> =
        form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes())
            .into_owned()
            .collect();
    if query.get("error").is_some_and(|error| !error.is_empty()) {
        return Err(bad("notion_oauth_provider_denied"));
    }
    service
        .complete_at(
            query.get("state").map(String::as_str).unwrap_or(""),
            query.get("code").map(String::as_str).unwrap_or(""),
            &state.authorization,
            Utc::now(),
        )
        .await?;
    Ok("Notion connected to this local project session. Return to the project tab.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request as HttpRequest,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    fn config() -> NotionOAuthConfig {
        NotionOAuthConfig::new(
            "public-client".into(),
            "fixture-client-secret".into(),
            format!("http://127.0.0.1:8010{CALLBACK}"),
        )
        .unwrap()
    }
    fn now() -> DateTime<Utc> {
        "2026-09-29T00:00:00Z".parse().unwrap()
    }
    fn auth() -> LocalAuthorization {
        LocalAuthorization::new("owner".into(), vec!["a".into(), "b".into()])
    }
    fn nonce(url: &str) -> String {
        form_urlencoded::parse(url.split_once('?').unwrap().1.as_bytes())
            .find(|(key, _)| key == "state")
            .unwrap()
            .1
            .into_owned()
    }

    async fn fixture(
        payload: Value,
    ) -> (
        NotionOAuthService,
        Arc<AtomicUsize>,
        tokio::task::JoinHandle<()>,
    ) {
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let app = Router::new().route(
            "/token",
            post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let payload = payload.clone();
                let calls = calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    assert!(
                        headers["authorization"]
                            .to_str()
                            .unwrap()
                            .starts_with("Basic ")
                    );
                    assert_eq!(headers["accept"], "application/json");
                    assert_eq!(body["grant_type"], "authorization_code");
                    assert_eq!(
                        body["redirect_uri"],
                        format!("http://127.0.0.1:8010{CALLBACK}")
                    );
                    Json(payload)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let mut service = NotionOAuthService::new(Some(config())).unwrap();
        // Endpoint override is test-private. Production always uses Notion HTTPS.
        service.token_url = format!("http://{address}/token");
        service.client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap();
        (service, count, task)
    }

    #[test]
    fn config_preserves_loopback_port_path_boundary() {
        for (url, expected) in [
            (
                "https://127.0.0.1:8010/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_must_be_loopback",
            ),
            (
                "http://example.com:8010/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_must_be_loopback",
            ),
            (
                "http://user@127.0.0.1:8010/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_must_be_loopback",
            ),
            (
                "http://127.0.0.1/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_port_invalid",
            ),
            (
                "http://127.0.0.1:bad/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_port_invalid",
            ),
            (
                "http://127.0.0.1:99999/api/v2/connectors/notion/oauth/callback",
                "notion_oauth_redirect_port_invalid",
            ),
            (
                "http://127.0.0.1:8010/wrong",
                "notion_oauth_redirect_path_invalid",
            ),
            (
                "http://127.0.0.1:8010/api/v2/connectors/notion/oauth/callback?x=1",
                "notion_oauth_redirect_path_invalid",
            ),
            (
                "http://127.0.0.1:8010/api/v2/connectors/notion/oauth/callback#fragment",
                "notion_oauth_redirect_path_invalid",
            ),
        ] {
            assert_eq!(
                NotionOAuthConfig::new("id".into(), "secret".into(), url.into())
                    .err()
                    .unwrap(),
                expected,
                "{url}"
            );
        }
        assert!(
            NotionOAuthConfig::new(
                "id".into(),
                "secret".into(),
                format!("http://localhost:8010{CALLBACK}")
            )
            .is_ok()
        );
        assert!(loopback("::1"));
        assert!(!loopback("example.com"));
    }

    #[test]
    fn unconfigured_and_nonce_entropy_are_explicit() {
        let service = NotionOAuthService::new(None).unwrap();
        assert_eq!(
            service.begin_at("a", "owner", now()).unwrap_err(),
            "notion_oauth_not_configured"
        );
        assert_eq!(
            service.status_at("a", "owner", now()),
            json!({"provider":"notion","oauth_available":false,
            "status":"disconnected","connection_id":null,"token_persistence":"process_memory_only",
            "provider_identity_verified":false,"provider_permission_verified":false,"export_mode":"PREP_ONLY","cloud_write":false})
        );
        let service = NotionOAuthService::new(Some(config())).unwrap();
        let first = service.begin_at("a", "owner", now()).unwrap();
        let second = service.begin_at("a", "owner", now()).unwrap();
        let first_nonce = nonce(&first);
        assert_eq!(URL_SAFE_NO_PAD.decode(&first_nonce).unwrap().len(), 32);
        assert_ne!(first_nonce, nonce(&second));
        assert!(!first.contains("fixture-client-secret"));
        assert!(first.starts_with(&format!(
            "{AUTHORIZE_URL}?client_id=public-client&response_type=code&owner=user&redirect_uri="
        )));
    }

    #[tokio::test]
    async fn consume_once_expiry_identity_membership_and_invalid_code_precede_exchange() {
        let (service, count, task) = fixture(json!({"access_token":"fixture-access"})).await;
        for (kind, expected) in [
            ("expired", "notion_oauth_state_invalid_or_expired"),
            ("identity", "notion_oauth_identity_changed"),
            ("membership", "notion_oauth_workspace_access_denied"),
            ("empty", "notion_oauth_code_invalid"),
            ("oversize", "notion_oauth_code_invalid"),
        ] {
            let state = nonce(&service.begin_at("a", "owner", now()).unwrap());
            let other = match kind {
                "identity" => LocalAuthorization::new("changed".into(), vec!["a".into()]),
                "membership" => LocalAuthorization::new("owner".into(), vec!["b".into()]),
                _ => auth(),
            };
            let time = if kind == "expired" {
                now() + Duration::minutes(10)
            } else {
                now()
            };
            let code = match kind {
                "empty" => String::new(),
                "oversize" => "a".repeat(2049),
                _ => "fixture-code".into(),
            };
            assert_eq!(
                service
                    .complete_at(&state, &code, &other, time)
                    .await
                    .unwrap_err()
                    .1["detail"],
                expected
            );
            assert_eq!(
                service
                    .complete_at(&state, "fixture-code", &auth(), now())
                    .await
                    .unwrap_err()
                    .1["detail"],
                "notion_oauth_state_invalid_or_expired"
            );
        }
        assert_eq!(count.load(Ordering::SeqCst), 0);
        task.abort();
    }

    #[tokio::test]
    async fn exchange_expiry_disconnect_and_workspace_isolation_never_expose_tokens() {
        for refresh in [None, Some("fixture-refresh")] {
            let (service, count, task) = fixture(
                json!({"access_token":"fixture-access","refresh_token":refresh,"expires_in":30}),
            )
            .await;
            let state = nonce(&service.begin_at("a", "owner", now()).unwrap());
            let result = service
                .complete_at(&state, "fixture-code", &auth(), now())
                .await
                .unwrap();
            assert_eq!(result["status"], "connected");
            assert!(
                result["connection_id"]
                    .as_str()
                    .unwrap()
                    .starts_with("notion-")
            );
            let status = service.status_at("a", "owner", now() + Duration::seconds(29));
            assert_eq!(status["status"], "connected");
            assert_eq!(
                service.status_at("a", "owner", now() + Duration::seconds(30))["status"],
                if refresh.is_some() {
                    "reconnect_required"
                } else {
                    "expired"
                }
            );
            assert_eq!(
                service.status_at("b", "owner", now())["status"],
                "disconnected"
            );
            assert_eq!(
                service.status_at("a", "another", now())["status"],
                "disconnected"
            );
            for token in ["fixture-access", "fixture-refresh", "fixture-client-secret"] {
                assert!(!format!("{result}{status}").contains(token));
            }
            service.disconnect("a", "owner");
            assert_eq!(
                service.status_at("a", "owner", now())["status"],
                "disconnected"
            );
            assert_eq!(count.load(Ordering::SeqCst), 1);
            task.abort();
        }
    }

    #[tokio::test]
    async fn disconnect_invalidates_pending_and_inflight_exchanges_only_for_its_owner() {
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let server = Router::new().route(
            "/token",
            post({
                let entered = entered.clone();
                let release = release.clone();
                let calls = calls.clone();
                move || {
                    let entered = entered.clone();
                    let release = release.clone();
                    let calls = calls.clone();
                    async move {
                        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                            entered.notify_one();
                            release.notified().await;
                        }
                        Json(json!({"access_token":"fixture-access"}))
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, server).await.unwrap() });
        let mut service = NotionOAuthService::new(Some(config())).unwrap();
        service.token_url = format!("http://{address}/token");
        service.client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let service = Arc::new(service);
        let inflight = nonce(&service.begin_at("a", "owner", now()).unwrap());
        let pending = nonce(&service.begin_at("a", "owner", now()).unwrap());
        let other = nonce(&service.begin_at("b", "owner", now()).unwrap());
        let exchange = tokio::spawn({
            let service = service.clone();
            async move {
                service
                    .complete_at(&inflight, "fixture-code", &auth(), now())
                    .await
            }
        });
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
            .await
            .unwrap();
        service.disconnect("a", "owner");
        assert_eq!(
            service.status_at("a", "owner", now())["status"],
            "disconnected"
        );
        assert_eq!(
            service
                .complete_at(&pending, "fixture-code", &auth(), now())
                .await
                .unwrap_err()
                .1["detail"],
            "notion_oauth_state_invalid_or_expired"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        release.notify_one();
        let error = exchange.await.unwrap().unwrap_err();
        assert_eq!(error.0, StatusCode::CONFLICT);
        assert_eq!(error.1["detail"], "notion_oauth_connection_canceled");
        assert_eq!(
            service.status_at("a", "owner", now())["status"],
            "disconnected"
        );
        service
            .complete_at(&other, "fixture-code", &auth(), now())
            .await
            .unwrap();
        let fresh = nonce(&service.begin_at("a", "owner", now()).unwrap());
        service
            .complete_at(&fresh, "fixture-code", &auth(), now())
            .await
            .unwrap();
        assert_eq!(
            service.status_at("a", "owner", now())["status"],
            "connected"
        );
        assert_eq!(
            service.status_at("b", "owner", now())["status"],
            "connected"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        server.abort();
    }

    #[tokio::test]
    async fn malformed_payloads_match_python_error_without_creating_connection() {
        for (payload, error) in [
            (json!(null), "notion_oauth_token_missing"),
            (
                json!({"access_token":"bad token"}),
                "notion_oauth_token_missing",
            ),
            (
                json!({"access_token":"valid","refresh_token":""}),
                "notion_oauth_token_invalid",
            ),
            (
                json!({"access_token":"valid","expires_in":true}),
                "notion_oauth_token_invalid",
            ),
            (
                json!({"access_token":"valid","expires_in":-1}),
                "notion_oauth_token_invalid",
            ),
            (
                json!({"access_token":"valid","expires_in":1.0}),
                "notion_oauth_token_invalid",
            ),
            (
                json!({"access_token":"valid","expires_in":31_536_001}),
                "notion_oauth_token_invalid",
            ),
        ] {
            let (service, _, task) = fixture(payload).await;
            let state = nonce(&service.begin_at("a", "owner", now()).unwrap());
            assert_eq!(
                service
                    .complete_at(&state, "fixture-code", &auth(), now())
                    .await
                    .unwrap_err()
                    .1["detail"],
                error
            );
            assert_eq!(
                service.status_at("a", "owner", now())["status"],
                "disconnected"
            );
            task.abort();
        }
    }

    #[tokio::test]
    async fn generated_python_config_and_exchange_oracle() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../evidence/rust-native-20261017/oauth/python-oracle.json"
        ))
        .unwrap();
        for case in corpus["config"].as_array().unwrap() {
            let url = case["url"].as_str().unwrap();
            let error =
                NotionOAuthConfig::new("public-client".into(), "fixture-secret".into(), url.into())
                    .err();
            assert_eq!(json!(error), case["error"], "config {url}");
        }
        for case in corpus["exchange"].as_array().unwrap() {
            let (service, _, task) = fixture(case["payload"].clone()).await;
            let nonce = nonce(&service.begin_at("a", "owner", now()).unwrap());
            let error = service
                .complete_at(&nonce, "fixture-code", &auth(), now())
                .await
                .err()
                .map(|error| error.1["detail"].clone());
            assert_eq!(json!(error), case["error"], "payload {}", case["payload"]);
            let mut status = service.status_at("a", "owner", now() + Duration::seconds(30));
            if !status["connection_id"].is_null() {
                status["connection_id"] = json!("<connection>");
            }
            assert_eq!(status, case["status"], "payload {}", case["payload"]);
            task.abort();
        }
    }

    #[tokio::test]
    async fn exchange_never_follows_redirect_retries_or_exposes_provider_body() {
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let server = Router::new()
            .route(
                "/redirect",
                post(move || {
                    let calls = calls.clone();
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        (
                            StatusCode::TEMPORARY_REDIRECT,
                            [("location", "/secret-sink")],
                            "fixture-provider-secret",
                        )
                    }
                }),
            )
            .route(
                "/secret-sink",
                post(|| async {
                    panic!("OAuth token exchange must never follow redirects");
                    #[allow(unreachable_code)]
                    ""
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, server).await.unwrap();
        });
        let mut service = NotionOAuthService::new(Some(config())).unwrap();
        service.token_url = format!("http://{address}/redirect");
        service.client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .unwrap();
        let state = nonce(&service.begin_at("a", "owner", now()).unwrap());
        let error = service
            .complete_at(&state, "fixture-code", &auth(), now())
            .await
            .unwrap_err();
        assert_eq!(error.1, json!({"detail":"notion_oauth_exchange_failed"}));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(
            service
                .complete_at(&state, "fixture-code", &auth(), now())
                .await
                .unwrap_err()
                .1["detail"],
            "notion_oauth_state_invalid_or_expired"
        );
        assert_eq!(
            service.status_at("a", "owner", now())["status"],
            "disconnected"
        );
        task.abort();
    }

    fn request(
        path: &str,
        host: &str,
        peer: Option<&str>,
        origin: Option<&str>,
        method: &str,
    ) -> Request {
        let mut request = HttpRequest::builder()
            .method(method)
            .uri(path)
            .header("host", host)
            .header("x-workspace-id", "a");
        if let Some(origin) = origin {
            request = request.header("origin", origin);
        }
        let mut request = request.body(Body::empty()).unwrap();
        if let Some(peer) = peer {
            request
                .extensions_mut()
                .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
        }
        request
    }

    fn app(service: Arc<NotionOAuthService>) -> Router {
        let mut state = crate::tests::fixture(1000);
        Arc::get_mut(&mut state).unwrap().notion_oauth = service;
        routes().with_state(state)
    }

    #[tokio::test]
    async fn actual_router_enforces_peer_origin_and_no_store_on_every_oauth_response() {
        let service = Arc::new(NotionOAuthService::new(None).unwrap());
        let app = app(service);
        for (method, path, host, peer, origin, status, detail) in [
            (
                "GET",
                "status",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                None,
                200,
                None,
            ),
            (
                "POST",
                "start",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                None,
                403,
                Some("notion_oauth_origin_required"),
            ),
            (
                "POST",
                "start",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                Some("http://evil.test"),
                403,
                Some("notion_oauth_origin_invalid"),
            ),
            (
                "POST",
                "start",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                Some("http://127.0.0.1:8010/"),
                403,
                Some("notion_oauth_origin_invalid"),
            ),
            (
                "POST",
                "start",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                Some("http://127.0.0.1:8010"),
                503,
                Some("notion_oauth_not_configured"),
            ),
            (
                "GET",
                "status",
                "127.0.0.1:8010",
                Some("192.0.2.1:50000"),
                None,
                403,
                Some("notion_oauth_local_only"),
            ),
            (
                "GET",
                "status",
                "127.0.0.1:8010",
                None,
                None,
                403,
                Some("notion_oauth_local_only"),
            ),
            (
                "GET",
                "status",
                "evil.test:8010",
                Some("127.0.0.1:50000"),
                None,
                403,
                Some("notion_oauth_local_only"),
            ),
            (
                "GET",
                "status",
                "127.0.0.1:bad",
                Some("127.0.0.1:50000"),
                None,
                403,
                Some("notion_oauth_local_only"),
            ),
            (
                "POST",
                "disconnect",
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                Some("http://127.0.0.1:8010"),
                200,
                None,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(request(
                    &format!("{PREFIX}/{path}"),
                    host,
                    peer,
                    origin,
                    method,
                ))
                .await
                .unwrap();
            assert_eq!(
                response.status().as_u16(),
                status,
                "{path} {origin:?} {peer:?}"
            );
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(response.headers()["referrer-policy"], "no-referrer");
            assert_eq!(response.headers()["pragma"], "no-cache");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert!(
                response.headers()["content-security-policy"]
                    .to_str()
                    .unwrap()
                    .starts_with("default-src 'none'")
            );
            if let Some(detail) = detail {
                let body: Value =
                    serde_json::from_slice(&to_bytes(response.into_body(), 10000).await.unwrap())
                        .unwrap();
                assert_eq!(body["detail"], detail);
            }
        }
    }

    #[tokio::test]
    async fn callback_exact_origin_guard_does_not_consume_nonce() {
        let (service, count, task) = fixture(json!({"access_token":"fixture-access"})).await;
        let service = Arc::new(service);
        let nonce = nonce(&service.begin_at("a", "owner", Utc::now()).unwrap());
        let app = app(service.clone());
        let path = format!("{CALLBACK}?state={nonce}&code=fixture-code");
        for host in ["127.0.0.1:8011", "localhost:8010"] {
            let response = app
                .clone()
                .oneshot(request(&path, host, Some("127.0.0.1:50000"), None, "GET"))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        assert_eq!(count.load(Ordering::SeqCst), 0);
        let response = app
            .clone()
            .oneshot(request(
                &path,
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                None,
                "GET",
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 10000).await.unwrap();
        assert_eq!(
            &body[..],
            b"Notion connected to this local project session. Return to the project tab."
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let response = app
            .oneshot(request(
                &path,
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                None,
                "GET",
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        task.abort();
    }

    #[tokio::test]
    async fn socket_peer_and_full_boundary_callback_use_nonce_membership_in_multiworkspace_app() {
        let (service, count, provider_task) =
            fixture(json!({"access_token":"fixture-access"})).await;
        let service = Arc::new(service);
        let nonce = nonce(&service.begin_at("b", "owner", Utc::now()).unwrap());
        let mut state = crate::tests::fixture(1000);
        {
            let state = Arc::get_mut(&mut state).unwrap();
            state.authorization = auth();
            state.config.local_workspaces = Some(vec!["a".into(), "b".into()]);
            state.config.request_timeout = std::time::Duration::from_secs(5);
            state.notion_oauth = service.clone();
        }
        let app = crate::router(state, routes());
        let response = app
            .clone()
            .oneshot(request(
                &format!("{CALLBACK}?state={nonce}&code=fixture-code"),
                "127.0.0.1:8010",
                Some("127.0.0.1:50000"),
                None,
                "GET",
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            service.status_at("b", "owner", Utc::now())["status"],
            "connected"
        );
        assert_eq!(
            service.status_at("a", "owner", Utc::now())["status"],
            "disconnected"
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("http://{address}{PREFIX}/status"))
            .header("x-workspace-id", "b")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<Value>().await.unwrap()["status"],
            "connected"
        );
        task.abort();
        provider_task.abort();
    }
}
