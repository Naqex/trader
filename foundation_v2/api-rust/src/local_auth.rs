//! Local owner sign-in only. No account/provider creation or automation grant.
use crate::{auth::ApiError, state::AppState};
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

pub const ROUTES: &[(&str, &str)] = &[
    ("POST", "/api/v2/auth/local/bootstrap"),
    ("POST", "/api/v2/auth/local/session"),
    ("GET", "/api/v2/auth/local/login"),
];
pub fn native(method: &str, path: &str) -> bool {
    ROUTES.contains(&(method, path))
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/auth/local/bootstrap", post(bootstrap))
        .route("/api/v2/auth/local/session", post(session))
        .route("/api/v2/auth/local/login", get(login))
}

pub(crate) fn public_route(method: &str, matched: &str) -> bool {
    matches!(
        (method, matched),
        (
            "POST",
            "/api/v2/auth/local/bootstrap" | "/api/v2/auth/local/session"
        ) | ("GET", "/api/v2/auth/local/login")
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bootstrap {
    nonce: String,
}

async fn bootstrap(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    if bytes.len() > 1024
        || !headers.get("content-type").is_some_and(|v| {
            v.to_str()
                .is_ok_and(|s| s.split(';').next() == Some("application/json"))
        })
    {
        return Err(ApiError::detail(
            StatusCode::UNPROCESSABLE_ENTITY,
            "local_bootstrap_invalid",
        ));
    }
    let body: Bootstrap = serde_json::from_slice(&bytes).map_err(|_| {
        ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "local_bootstrap_invalid")
    })?;
    let session = state
        .authorization
        .exchange_bootstrap(&headers, &body.nonce)?;
    let mut response = Json(
        json!({"mode":"local-capability", "csrf_token":session.csrf_token,
        "expires_at_utc":session.expires_at_utc}),
    )
    .into_response();
    response.headers_mut().insert(
        "set-cookie",
        HeaderValue::from_str(&session.set_cookie).map_err(|_| {
            ApiError::detail(StatusCode::INTERNAL_SERVER_ERROR, "local_cookie_invalid")
        })?,
    );
    Ok(response)
}

async fn session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !state.authorization.is_capability_mode() {
        return Ok(Json(json!({"mode":"local-trusted-identity"})));
    }
    let session = state.authorization.owner_session(&headers)?;
    Ok(Json(
        json!({"mode":"local-capability", "csrf_token":session.csrf_token,
        "expires_at_utc":session.expires_at_utc}),
    ))
}

async fn login() -> Response {
    let nonce = uuid::Uuid::new_v4().to_string();
    let page = format!(
        r#"<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập Naqex Trader</title>
<style nonce="{nonce}">body{{font:16px system-ui;max-width:28rem;margin:12vh auto;padding:0 24px;color:#222;background:#fafafa}}h1{{font-size:24px}}label,input,button{{display:block}}input{{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 16px;font:inherit}}button{{padding:10px 18px;font:inherit;cursor:pointer}}#state{{min-height:3em}}</style>
<main><h1>Đăng nhập Owner</h1><p>Dùng mã đăng nhập trong file owner-secrets.json của phiên local.</p><form id="login"><label for="nonce">Mã đăng nhập</label><input id="nonce" type="password" autocomplete="off" required><button>Đăng nhập</button></form><p id="state" role="status"></p><a href="/">Về Trader</a></main>
<script nonce="{nonce}">document.getElementById('login').addEventListener('submit',async(e)=>{{e.preventDefault();const input=document.getElementById('nonce'),status=document.getElementById('state'),button=e.target.querySelector('button');button.disabled=true;status.textContent='Đang đăng nhập…';try{{const response=await fetch('/api/v2/auth/local/bootstrap',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{nonce:input.value}})}});input.value='';if(!response.ok)throw new Error('Mã không hợp lệ, đã dùng hoặc hết hạn.');status.textContent='Đã đăng nhập. Bạn có thể quay lại Trader.';e.target.hidden=true;}}catch(error){{status.textContent=error.message;}}finally{{button.disabled=false;}}}});</script></html>"#
    );
    let mut response = Html(page).into_response();
    response.headers_mut().insert("content-security-policy", HeaderValue::from_str(&format!(
        "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    )).expect("generated UUID CSP"));
    response
        .headers_mut()
        .insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use tower::ServiceExt;

    fn app() -> Router {
        let mut state = crate::tests::fixture(100);
        let now = chrono::Utc::now();
        let config=serde_json::from_value(json!({
            "allowed_origins":["http://127.0.0.1:5180"],
            "owner_bearer":{"token_sha256":format!("{:x}",Sha256::digest("o".repeat(64).as_bytes())),
                "expires_at_utc":now+chrono::Duration::hours(1)},
            "bootstrap":{"nonce_sha256":format!("{:x}",Sha256::digest("n".repeat(64).as_bytes())),
                "expires_at_utc":now+chrono::Duration::minutes(5),"session_token":"s".repeat(64),
                "csrf_token":"c".repeat(64),"session_expires_at_utc":now+chrono::Duration::hours(1)}
        })).unwrap();
        Arc::get_mut(&mut state).unwrap().authorization =
            crate::auth::LocalAuthorization::with_capabilities(
                "owner".into(),
                vec!["a".into()],
                config,
            )
            .unwrap();
        crate::router(
            state,
            routes().route(
                "/api/v2/owner-check",
                post(|| async { Json(json!({"ok":true})) }),
            ),
        )
    }
    async fn call(
        app: &Router,
        path: &str,
        body: Value,
        cookie: Option<&str>,
        csrf: bool,
    ) -> Response {
        let mut request = Request::builder()
            .method("POST")
            .uri(path)
            .header("x-workspace-id", "a")
            .header("origin", "http://127.0.0.1:5180")
            .header("content-type", "application/json");
        if let Some(cookie) = cookie {
            request = request.header("cookie", cookie);
        }
        if csrf {
            request = request.header("x-naqex-csrf", "c".repeat(64));
        }
        app.clone()
            .oneshot(
                request
                    .body(Body::from(serde_json::to_vec(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn browser_bootstrap_cookie_session_and_csrf_obey_the_real_middleware() {
        let app = app();
        assert_eq!(
            call(&app, "/api/v2/owner-check", json!({}), None, false)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let response = call(
            &app,
            "/api/v2/auth/local/bootstrap",
            json!({"nonce":"n".repeat(64)}),
            None,
            false,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let header = response.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .to_owned();
        assert!(header.contains("Path=/api/v2; HttpOnly; SameSite=Strict"));
        assert_eq!(response.headers()["cache-control"], "no-store");
        let cookie = header.split(';').next().unwrap();
        let response = call(
            &app,
            "/api/v2/auth/local/session",
            json!({}),
            Some(cookie),
            false,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(body["csrf_token"], "c".repeat(64));
        assert_eq!(
            call(&app, "/api/v2/owner-check", json!({}), Some(cookie), false)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&app, "/api/v2/owner-check", json!({}), Some(cookie), true)
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            call(
                &app,
                "/api/v2/auth/local/bootstrap",
                json!({"nonce":"n".repeat(64)}),
                None,
                false
            )
            .await
            .status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn foreign_origin_and_self_declared_actor_cannot_bootstrap_or_bypass_owner() {
        let app = app();
        let request = Request::builder()
            .method("POST")
            .uri("/api/v2/auth/local/bootstrap")
            .header("origin", "https://example.com")
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::to_vec(&json!({"nonce":"n".repeat(64)})).unwrap(),
            ))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let request = Request::builder()
            .method("POST")
            .uri("/api/v2/owner-check")
            .header("x-workspace-id", "a")
            .header("x-user-id", "owner")
            .header("x-actor", "Owner")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(request).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }
}
