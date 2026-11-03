//! Opt-in local actor authentication. Grant storage remains the sole automation authority.
use super::{Actor, ApiError, AutomationIdentity};
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use subtle::ConstantTimeEq;

const COOKIE: &str = "naqex_owner_session";
const CSRF_HEADER: &str = "x-naqex-csrf";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerBearerCapability {
    pub token_sha256: String,
    pub expires_at_utc: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapCapability {
    pub nonce_sha256: String,
    pub expires_at_utc: DateTime<Utc>,
    pub session_token: String,
    pub csrf_token: String,
    pub session_expires_at_utc: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalCapabilityConfig {
    pub allowed_origins: Vec<String>,
    pub owner_bearer: Option<OwnerBearerCapability>,
    pub bootstrap: Option<BootstrapCapability>,
}

/// Sensitive response; the HTTP handler must return it with no-store and never log it.
pub struct BootstrapSession {
    pub set_cookie: String,
    pub csrf_token: String,
    pub expires_at_utc: DateTime<Utc>,
}

pub struct OwnerSessionStatus {
    pub csrf_token: String,
    pub expires_at_utc: DateTime<Utc>,
}

struct Session {
    token_sha256: String,
    csrf_token: String,
    expires_at_utc: DateTime<Utc>,
}

struct SessionState {
    bootstrap: Option<BootstrapCapability>,
    session: Option<Session>,
}

pub(super) struct LocalCapabilities {
    allowed_origins: Vec<String>,
    owner_bearer: Option<OwnerBearerCapability>,
    sessions: Mutex<SessionState>,
    consumption: Option<ConsumptionStore>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsumptionMarker {
    schema_version: String,
    binding_sha256: String,
    consumed_at_utc: DateTime<Utc>,
}

struct ConsumptionStore {
    path: PathBuf,
    binding_sha256: String,
}

fn no_links(path: &Path) -> bool {
    path.ancestors().all(|item| {
        fs::symlink_metadata(item).is_ok_and(|meta| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                !meta.file_type().is_symlink() && meta.file_attributes() & 0x400 == 0
            }
            #[cfg(not(windows))]
            {
                !meta.file_type().is_symlink()
            }
        })
    })
}

fn read_private_file(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    if !path.is_absolute()
        || !no_links(path)
        || !fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.len() <= max_bytes)
    {
        return Err("invalid local capability file".into());
    }
    let mut data = Vec::new();
    fs::File::open(path)
        .map_err(|_| "cannot read local capability file")?
        .take(max_bytes + 1)
        .read_to_end(&mut data)
        .map_err(|_| "cannot read local capability file")?;
    if data.len() as u64 > max_bytes {
        return Err("invalid local capability file".into());
    }
    Ok(data)
}

impl ConsumptionStore {
    fn load(&self, bootstrap: &BootstrapCapability, now: DateTime<Utc>) -> Result<bool, String> {
        match fs::symlink_metadata(&self.path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("cannot read local bootstrap consumption".into()),
            Ok(_) => {}
        }
        let marker: ConsumptionMarker =
            serde_json::from_slice(&read_private_file(&self.path, 2048)?)
                .map_err(|_| "invalid local bootstrap consumption")?;
        if marker.schema_version != "naqex-local-bootstrap-consumption-v1"
            || !equal(&marker.binding_sha256, &self.binding_sha256)
            || marker.consumed_at_utc > now
            || marker.consumed_at_utc >= bootstrap.expires_at_utc
            || marker.consumed_at_utc >= bootstrap.session_expires_at_utc
        {
            return Err("invalid local bootstrap consumption".into());
        }
        Ok(true)
    }

    fn claim(&self, now: DateTime<Utc>) -> Result<(), ApiError> {
        if !self.path.parent().is_some_and(no_links) {
            return Err(unauthorized());
        }
        // create_new is the cross-process claim; a loser never exchanges this nonce.
        // A crash while writing leaves an invalid marker, which fails closed on restart.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&self.path)
            .map_err(|_| unauthorized())?;
        let marker = ConsumptionMarker {
            schema_version: "naqex-local-bootstrap-consumption-v1".into(),
            binding_sha256: self.binding_sha256.clone(),
            consumed_at_utc: now,
        };
        let bytes = serde_json::to_vec(&marker).map_err(|_| unauthorized())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| unauthorized())?;
        #[cfg(unix)]
        fs::File::open(self.path.parent().ok_or_else(unauthorized)?)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| unauthorized())?;
        Ok(())
    }
}

fn unauthorized() -> ApiError {
    ApiError::detail(StatusCode::UNAUTHORIZED, "invalid_local_capability")
}
fn forbidden() -> ApiError {
    ApiError::detail(StatusCode::FORBIDDEN, "local_capability_denied")
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn equal(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && value.bytes().any(|c| c != b'0')
}
fn valid_secret(value: &str) -> bool {
    (43..=256).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
}
fn single<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, ApiError> {
    let mut values = headers.get_all(name).iter();
    let value = values.next();
    if values.next().is_some() {
        return Err(unauthorized());
    }
    value
        .map(|value| value.to_str().map_err(|_| unauthorized()))
        .transpose()
}

/// Both sources are inspected together so a bad bearer cannot fall back to a cookie.
fn credentials(headers: &HeaderMap) -> Result<(Option<&str>, Option<&str>), ApiError> {
    let bearer = single(headers, "authorization")?
        .map(|value| {
            value
                .strip_prefix("Bearer ")
                .filter(|value| valid_secret(value))
                .ok_or_else(unauthorized)
        })
        .transpose()?;
    let mut session = None;
    if let Some(cookies) = single(headers, "cookie")? {
        for cookie in cookies.split(';') {
            let cookie = cookie.trim();
            let Some((name, value)) = cookie.split_once('=') else {
                return Err(unauthorized());
            };
            if name == COOKIE {
                if session.is_some() || !valid_secret(value) {
                    return Err(unauthorized());
                }
                session = Some(value);
            }
        }
    }
    if bearer.is_some() && session.is_some() {
        return Err(unauthorized());
    }
    Ok((bearer, session))
}

fn valid_origin(origin: &str) -> bool {
    reqwest::Url::parse(origin).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default().is_some()
            && url.origin().ascii_serialization() == origin
    })
}

fn automation_route(method: &str, route: &str) -> bool {
    matches!(
        (method, route),
        ("POST", "/api/v2/automation/trading/commands")
            | ("POST", "/api/v2/automation/trading/reconcile")
            | ("GET", "/api/v2/automation/trading/requests/{request_id}")
    )
}

impl LocalCapabilities {
    pub(super) fn new(config: LocalCapabilityConfig) -> Result<Self, String> {
        Self::build(config, None)
    }

    pub(super) fn from_file(path: &Path) -> Result<Self, String> {
        let config: LocalCapabilityConfig =
            serde_json::from_slice(&read_private_file(path, 16384)?)
                .map_err(|_| "invalid local capability configuration")?;
        let consumption = config.bootstrap.as_ref().map(|bootstrap| {
            let mut name = path.file_name().ok_or("invalid local capability file")?.to_os_string();
            name.push(".bootstrap-spent.json");
            let binding = serde_json::json!({"nonce":bootstrap.nonce_sha256,"session":digest(&bootstrap.session_token),"csrf":digest(&bootstrap.csrf_token),"nonce_expires":bootstrap.expires_at_utc,"session_expires":bootstrap.session_expires_at_utc,"origins":config.allowed_origins});
            Ok::<_, String>(ConsumptionStore { path: path.with_file_name(name), binding_sha256: digest(&binding.to_string()) })
        }).transpose()?;
        Self::build(config, consumption)
    }

    fn build(
        config: LocalCapabilityConfig,
        consumption: Option<ConsumptionStore>,
    ) -> Result<Self, String> {
        let now = Utc::now();
        if config.allowed_origins.is_empty()
            || config.allowed_origins.len() > 16
            || config
                .allowed_origins
                .iter()
                .enumerate()
                .any(|(i, origin)| {
                    !valid_origin(origin) || config.allowed_origins[..i].contains(origin)
                })
            || config.owner_bearer.is_none() && config.bootstrap.is_none()
        {
            return Err("invalid local capability configuration".into());
        }
        if let Some(owner) = &config.owner_bearer {
            if !valid_hash(&owner.token_sha256) || owner.expires_at_utc > now + Duration::days(30) {
                return Err("invalid owner bearer configuration".into());
            }
        }
        if let Some(bootstrap) = &config.bootstrap {
            if !valid_hash(&bootstrap.nonce_sha256)
                || !valid_secret(&bootstrap.session_token)
                || !valid_secret(&bootstrap.csrf_token)
                || bootstrap.session_token == bootstrap.csrf_token
                || equal(&digest(&bootstrap.session_token), &bootstrap.nonce_sha256)
                || equal(&digest(&bootstrap.csrf_token), &bootstrap.nonce_sha256)
                || config.owner_bearer.as_ref().is_some_and(|owner| {
                    equal(&digest(&bootstrap.session_token), &owner.token_sha256)
                        || equal(&digest(&bootstrap.csrf_token), &owner.token_sha256)
                        || equal(&bootstrap.nonce_sha256, &owner.token_sha256)
                })
                || bootstrap.expires_at_utc > now + Duration::minutes(10)
                || bootstrap.session_expires_at_utc > now + Duration::hours(12)
                || bootstrap.session_expires_at_utc < bootstrap.expires_at_utc
            {
                return Err("invalid owner bootstrap configuration".into());
            }
        }
        let consumed = match (&consumption, &config.bootstrap) {
            (Some(store), Some(bootstrap)) => store.load(bootstrap, now)?,
            _ => false,
        };
        let session = config
            .bootstrap
            .as_ref()
            .filter(|bootstrap| consumed && bootstrap.session_expires_at_utc > now)
            .map(|bootstrap| Session {
                token_sha256: digest(&bootstrap.session_token),
                csrf_token: bootstrap.csrf_token.clone(),
                expires_at_utc: bootstrap.session_expires_at_utc,
            });
        let bootstrap = config.bootstrap.filter(|bootstrap| {
            !consumed && bootstrap.expires_at_utc > now && bootstrap.session_expires_at_utc > now
        });
        if !config
            .owner_bearer
            .as_ref()
            .is_some_and(|owner| owner.expires_at_utc > now)
            && session.is_none()
            && bootstrap.is_none()
        {
            return Err("no active local owner capability".into());
        }
        Ok(Self {
            allowed_origins: config.allowed_origins,
            owner_bearer: config.owner_bearer,
            sessions: Mutex::new(SessionState { bootstrap, session }),
            consumption,
        })
    }

    fn origin<'a>(&self, headers: &'a HeaderMap) -> Result<&'a str, ApiError> {
        let origin = single(headers, "origin")?.ok_or_else(forbidden)?;
        if !self.allowed_origins.iter().any(|allowed| allowed == origin)
            || single(headers, "sec-fetch-site")?.is_some_and(|site| site == "cross-site")
        {
            return Err(forbidden());
        }
        Ok(origin)
    }

    pub(super) fn automation_bearer_digest(
        &self,
        headers: &HeaderMap,
    ) -> Result<Option<String>, ApiError> {
        let (bearer, _) = credentials(headers)?;
        let Some(bearer) = bearer else {
            return Ok(None);
        };
        let token_hash = digest(bearer);
        if let Some(owner) = &self.owner_bearer {
            if equal(&token_hash, &owner.token_sha256) {
                return if owner.expires_at_utc > Utc::now() {
                    Ok(None)
                } else {
                    Err(unauthorized())
                };
            }
        }
        Ok(Some(token_hash))
    }

    pub(super) fn authorize(
        &self,
        headers: &HeaderMap,
        method: &str,
        route: &str,
        automation: Option<&AutomationIdentity>,
        workspace: &str,
    ) -> Result<Actor, ApiError> {
        let (bearer, cookie) = credentials(headers)?;
        let now = Utc::now();
        if let Some(bearer) = bearer {
            let hash = digest(bearer);
            if let Some(owner) = &self.owner_bearer {
                if equal(&hash, &owner.token_sha256) {
                    return if owner.expires_at_utc > now {
                        Ok(Actor::Owner)
                    } else {
                        Err(unauthorized())
                    };
                }
            }
            let identity = automation.ok_or_else(unauthorized)?;
            if !valid_hash(&identity.token_sha256)
                || !equal(&hash, &identity.token_sha256)
                || identity.workspace_id != workspace
                || !automation_route(method, route)
            {
                return Err(forbidden());
            }
            return Ok(Actor::Automation {
                grant_id: identity.grant_id,
                credential_id: identity.credential_id,
            });
        }
        let cookie = cookie.ok_or_else(unauthorized)?;
        let sessions = self.sessions.lock().map_err(|_| unauthorized())?;
        let session = sessions.session.as_ref().ok_or_else(unauthorized)?;
        if session.expires_at_utc <= now || !equal(&digest(cookie), &session.token_sha256) {
            return Err(unauthorized());
        }
        if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
            self.origin(headers)?;
            let csrf = single(headers, CSRF_HEADER)?.ok_or_else(forbidden)?;
            if !equal(&digest(csrf), &digest(&session.csrf_token)) {
                return Err(forbidden());
            }
        }
        Ok(Actor::Owner)
    }

    pub(super) fn exchange_bootstrap(
        &self,
        headers: &HeaderMap,
        nonce: &str,
    ) -> Result<BootstrapSession, ApiError> {
        let origin = self.origin(headers)?;
        let (bearer, _) = credentials(headers)?;
        // A proved new nonce can replace an expired/previous owner cookie.
        // The cookie is parsed for ambiguity, but grants no bootstrap authority.
        if bearer.is_some() || !valid_secret(nonce) {
            return Err(unauthorized());
        }
        let now = Utc::now();
        let mut state = self.sessions.lock().map_err(|_| unauthorized())?;
        let bootstrap = state.bootstrap.as_ref().ok_or_else(unauthorized)?;
        if bootstrap.expires_at_utc <= now
            || bootstrap.session_expires_at_utc <= now
            || !equal(&digest(nonce), &bootstrap.nonce_sha256)
        {
            return Err(unauthorized());
        }
        if let Some(store) = &self.consumption {
            store.claim(now)?;
        }
        let bootstrap = state.bootstrap.take().ok_or_else(unauthorized)?;
        let lifetime = (bootstrap.session_expires_at_utc - now).num_seconds();
        if lifetime <= 0 {
            return Err(unauthorized());
        }
        let response = BootstrapSession {
            set_cookie: format!(
                "{COOKIE}={}; Path=/api/v2; HttpOnly; SameSite=Strict; Max-Age={lifetime}{}",
                bootstrap.session_token,
                if origin.starts_with("https:") {
                    "; Secure"
                } else {
                    ""
                }
            ),
            csrf_token: bootstrap.csrf_token.clone(),
            expires_at_utc: bootstrap.session_expires_at_utc,
        };
        state.session = Some(Session {
            token_sha256: digest(&bootstrap.session_token),
            csrf_token: bootstrap.csrf_token,
            expires_at_utc: bootstrap.session_expires_at_utc,
        });
        Ok(response)
    }

    pub(super) fn owner_session(
        &self,
        headers: &HeaderMap,
    ) -> Result<OwnerSessionStatus, ApiError> {
        self.origin(headers)?;
        let (bearer, cookie) = credentials(headers)?;
        if bearer.is_some() {
            return Err(unauthorized());
        }
        let cookie = cookie.ok_or_else(unauthorized)?;
        let state = self.sessions.lock().map_err(|_| unauthorized())?;
        let session = state.session.as_ref().ok_or_else(unauthorized)?;
        if session.expires_at_utc <= Utc::now() || !equal(&digest(cookie), &session.token_sha256) {
            return Err(unauthorized());
        }
        Ok(OwnerSessionStatus {
            csrf_token: session.csrf_token.clone(),
            expires_at_utc: session.expires_at_utc,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::LocalAuthorization;
    use std::sync::Arc;
    use uuid::Uuid;

    fn owner_token() -> String {
        "o".repeat(64)
    }
    fn automation_token() -> String {
        "a".repeat(64)
    }
    fn nonce() -> String {
        "n".repeat(64)
    }
    fn cookie_token() -> String {
        "s".repeat(64)
    }
    fn csrf() -> String {
        "c".repeat(64)
    }
    fn config() -> LocalCapabilityConfig {
        let now = Utc::now();
        LocalCapabilityConfig {
            allowed_origins: vec!["http://127.0.0.1:5180".into()],
            owner_bearer: Some(OwnerBearerCapability {
                token_sha256: digest(&owner_token()),
                expires_at_utc: now + Duration::days(1),
            }),
            bootstrap: Some(BootstrapCapability {
                nonce_sha256: digest(&nonce()),
                expires_at_utc: now + Duration::minutes(5),
                session_token: cookie_token(),
                csrf_token: csrf(),
                session_expires_at_utc: now + Duration::hours(1),
            }),
        }
    }
    fn headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-workspace-id", "tenant-a".parse().unwrap());
        headers.insert("origin", "http://127.0.0.1:5180".parse().unwrap());
        headers
    }
    fn bearer(token: &str) -> HeaderMap {
        let mut headers = headers();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        headers
    }
    fn identity() -> AutomationIdentity {
        AutomationIdentity {
            workspace_id: "tenant-a".into(),
            grant_id: Uuid::from_u128(1),
            credential_id: Uuid::from_u128(2),
            token_sha256: digest(&automation_token()),
        }
    }
    fn session(capabilities: &LocalCapabilities) -> HeaderMap {
        let response = capabilities
            .exchange_bootstrap(&headers(), &nonce())
            .unwrap();
        assert!(
            response
                .set_cookie
                .contains("HttpOnly; SameSite=Strict; Max-Age=")
        );
        assert!(!response.set_cookie.contains("Secure"));
        let mut result = headers();
        result.insert(
            "cookie",
            format!("{COOKIE}={}", cookie_token()).parse().unwrap(),
        );
        result
    }

    #[test]
    fn secure_mode_never_uses_local_identity_without_proof() {
        let auth = LocalAuthorization::with_capabilities(
            "owner".into(),
            vec!["tenant-a".into()],
            config(),
        )
        .unwrap();
        assert!(auth.is_capability_mode());
        assert!(auth.authorize(&bearer(&owner_token())).is_err());
        assert!(
            auth.authorize_request(&headers(), "GET", "/api/v2/live/trading")
                .is_err()
        );
        let mut forged = headers();
        forged.insert("x-user-id", "owner".parse().unwrap());
        forged.insert("x-actor", "owner".parse().unwrap());
        assert!(
            auth.authorize_request(&forged, "POST", "/api/v2/live/trading/commands")
                .is_err()
        );
        let (_, actor) = auth
            .authorize_request(
                &bearer(&owner_token()),
                "POST",
                "/api/v2/live/trading/commands",
            )
            .unwrap();
        assert_eq!(actor, Actor::Owner);
        let mut duplicate = bearer(&owner_token());
        duplicate.append("x-workspace-id", "tenant-a".parse().unwrap());
        assert!(
            auth.authorize_request(&duplicate, "GET", "/api/v2/live/trading")
                .is_err()
        );
    }

    #[test]
    fn automation_is_db_resolved_and_default_deny() {
        let cap = LocalCapabilities::new(config()).unwrap();
        let headers = bearer(&automation_token());
        assert_eq!(
            cap.automation_bearer_digest(&headers).unwrap(),
            Some(digest(&automation_token()))
        );
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/automation/trading/commands",
                None,
                "tenant-a"
            )
            .is_err()
        );
        for (method, route) in [
            ("POST", "/api/v2/automation/trading/commands"),
            ("POST", "/api/v2/automation/trading/reconcile"),
            ("GET", "/api/v2/automation/trading/requests/{request_id}"),
        ] {
            assert_eq!(
                cap.authorize(&headers, method, route, Some(&identity()), "tenant-a")
                    .unwrap(),
                Actor::Automation {
                    grant_id: Uuid::from_u128(1),
                    credential_id: Uuid::from_u128(2)
                }
            );
        }
        for route in [
            "/api/v2/live/trading/commands",
            "/api/v2/live/trading/preview",
            "/api/v2/live/trading/reconcile",
            "/api/v2/live/connections",
            "/api/v2/live/connections/{id}/{action}",
            "/api/v2/execution/intents",
            "/api/v2/commands/{command_id}",
            "/api/v2/automation/grants",
            "/api/v2/ai/request",
            "/api/v2/future/route",
            "/api/v2/automation/trading/commands/",
            "/api/v2/automation/trading/%63ommands",
            "/api/v2/automation/trading/requests/00000000-0000-0000-0000-000000000001",
        ] {
            for method in ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"] {
                assert!(
                    cap.authorize(&headers, method, route, Some(&identity()), "tenant-a")
                        .is_err(),
                    "{method} {route}"
                );
            }
        }
        assert!(
            cap.authorize(
                &headers,
                "GET",
                "/api/v2/automation/trading/commands",
                Some(&identity()),
                "tenant-a"
            )
            .is_err()
        );
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/automation/trading/commands",
                Some(&identity()),
                "tenant-b"
            )
            .is_err()
        );
        let mut wrong = identity();
        wrong.token_sha256 = digest(&"x".repeat(64));
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/automation/trading/commands",
                Some(&wrong),
                "tenant-a"
            )
            .is_err()
        );
        assert!(
            Actor::Automation {
                grant_id: Uuid::from_u128(1),
                credential_id: Uuid::from_u128(2)
            }
            .require_owner()
            .is_err()
        );
    }

    #[test]
    fn malformed_ambiguous_credentials_never_fall_back_to_owner() {
        let cap = LocalCapabilities::new(config()).unwrap();
        let session_headers = session(&cap);
        let mut mixed = session_headers.clone();
        mixed.insert(
            "authorization",
            format!("Bearer {}", "x".repeat(64)).parse().unwrap(),
        );
        assert!(
            cap.authorize(&mixed, "GET", "/api/v2/live/trading", None, "tenant-a")
                .is_err()
        );
        assert!(cap.automation_bearer_digest(&mixed).is_err());
        for value in [
            "Basic xyz",
            "Bearer short",
            "bearer token",
            "Bearer  ",
            "Bearer",
        ] {
            let mut malformed = session_headers.clone();
            malformed.insert("authorization", value.parse().unwrap());
            assert!(
                cap.authorize(&malformed, "GET", "/api/v2/live/trading", None, "tenant-a")
                    .is_err()
            );
        }
        let mut duplicate = bearer(&owner_token());
        duplicate.append(
            "authorization",
            format!("Bearer {}", automation_token()).parse().unwrap(),
        );
        assert!(cap.automation_bearer_digest(&duplicate).is_err());
        let mut duplicate = session_headers.clone();
        duplicate.append(
            "cookie",
            format!("{COOKIE}={}", cookie_token()).parse().unwrap(),
        );
        assert!(
            cap.authorize(&duplicate, "GET", "/api/v2/live/trading", None, "tenant-a")
                .is_err()
        );
        let mut duplicate = session_headers;
        duplicate.insert(
            "cookie",
            format!("{COOKIE}={}; {COOKIE}={}", cookie_token(), cookie_token())
                .parse()
                .unwrap(),
        );
        assert!(
            cap.authorize(&duplicate, "GET", "/api/v2/live/trading", None, "tenant-a")
                .is_err()
        );
    }

    #[test]
    fn cookie_mutations_need_exact_origin_and_csrf() {
        let cap = LocalCapabilities::new(config()).unwrap();
        let mut headers = session(&cap);
        assert_eq!(
            cap.authorize(&headers, "GET", "/api/v2/live/trading", None, "tenant-a")
                .unwrap(),
            Actor::Owner
        );
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/live/trading/commands",
                None,
                "tenant-a"
            )
            .is_err()
        );
        headers.insert(CSRF_HEADER, csrf().parse().unwrap());
        assert_eq!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/live/trading/commands",
                None,
                "tenant-a"
            )
            .unwrap(),
            Actor::Owner
        );
        for origin in [
            "http://127.0.0.1:5180/",
            "http://localhost:5180",
            "http://127.0.0.1:5181",
            "https://example.org",
        ] {
            headers.insert("origin", origin.parse().unwrap());
            assert!(
                cap.authorize(
                    &headers,
                    "POST",
                    "/api/v2/live/trading/commands",
                    None,
                    "tenant-a"
                )
                .is_err()
            );
        }
        headers.remove("origin");
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/live/trading/commands",
                None,
                "tenant-a"
            )
            .is_err()
        );
        assert!(cap.owner_session(&headers).is_err());
        headers.insert("origin", "http://127.0.0.1:5180".parse().unwrap());
        assert_eq!(cap.owner_session(&headers).unwrap().csrf_token, csrf());
        headers.append(CSRF_HEADER, csrf().parse().unwrap());
        assert!(
            cap.authorize(
                &headers,
                "POST",
                "/api/v2/live/trading/commands",
                None,
                "tenant-a"
            )
            .is_err()
        );
    }

    #[test]
    fn bootstrap_is_one_use_atomic_and_failure_does_not_consume() {
        let cap = Arc::new(LocalCapabilities::new(config()).unwrap());
        assert!(cap.exchange_bootstrap(&headers(), &"x".repeat(64)).is_err());
        let mut foreign = headers();
        foreign.insert("origin", "http://localhost:5180".parse().unwrap());
        assert!(cap.exchange_bootstrap(&foreign, &nonce()).is_err());
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let cap = cap.clone();
                std::thread::spawn(move || cap.exchange_bootstrap(&headers(), &nonce()).is_ok())
            })
            .collect();
        let successes = handles
            .into_iter()
            .map(|handle| usize::from(handle.join().unwrap()))
            .sum::<usize>();
        assert_eq!(successes, 1);
        assert!(cap.exchange_bootstrap(&headers(), &nonce()).is_err());
    }

    #[test]
    fn new_nonce_can_replace_old_cookie_without_accepting_bad_or_mixed_credentials() {
        let previous = LocalCapabilities::new(config()).unwrap();
        let old_cookie = session(&previous);
        previous
            .sessions
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .expires_at_utc = Utc::now();
        assert!(previous.owner_session(&old_cookie).is_err());

        let new_nonce = "b".repeat(64);
        let mut replacement = config();
        let bootstrap = replacement.bootstrap.as_mut().unwrap();
        bootstrap.nonce_sha256 = digest(&new_nonce);
        bootstrap.session_token = "u".repeat(64);
        bootstrap.csrf_token = "v".repeat(64);
        let cap = LocalCapabilities::new(replacement).unwrap();
        assert!(cap.exchange_bootstrap(&old_cookie, &nonce()).is_err());
        let mut mixed = old_cookie.clone();
        mixed.insert(
            "authorization",
            format!("Bearer {}", owner_token()).parse().unwrap(),
        );
        assert!(cap.exchange_bootstrap(&mixed, &new_nonce).is_err());
        let mut duplicate = old_cookie.clone();
        duplicate.append(
            "cookie",
            format!("{COOKIE}={}", cookie_token()).parse().unwrap(),
        );
        assert!(cap.exchange_bootstrap(&duplicate, &new_nonce).is_err());
        let mut malformed = old_cookie.clone();
        malformed.insert("cookie", format!("{COOKIE}=short").parse().unwrap());
        assert!(cap.exchange_bootstrap(&malformed, &new_nonce).is_err());

        let response = cap.exchange_bootstrap(&old_cookie, &new_nonce).unwrap();
        assert!(
            response
                .set_cookie
                .starts_with(&format!("{COOKIE}={};", "u".repeat(64)))
        );
        assert_eq!(response.csrf_token, "v".repeat(64));
        assert!(cap.exchange_bootstrap(&old_cookie, &new_nonce).is_err());
    }

    #[test]
    fn expired_credentials_sessions_and_nonce_are_rejected() {
        let mut cap = LocalCapabilities::new(config()).unwrap();
        cap.owner_bearer.as_mut().unwrap().expires_at_utc = Utc::now();
        assert!(
            cap.authorize(
                &bearer(&owner_token()),
                "GET",
                "/api/v2/live/trading",
                None,
                "tenant-a"
            )
            .is_err()
        );
        assert!(
            cap.automation_bearer_digest(&bearer(&owner_token()))
                .is_err()
        );
        let session_headers = session(&cap);
        cap.sessions
            .lock()
            .unwrap()
            .session
            .as_mut()
            .unwrap()
            .expires_at_utc = Utc::now();
        assert!(
            cap.authorize(
                &session_headers,
                "GET",
                "/api/v2/live/trading",
                None,
                "tenant-a"
            )
            .is_err()
        );
        assert!(cap.owner_session(&session_headers).is_err());
        let cap = LocalCapabilities::new(config()).unwrap();
        cap.sessions
            .lock()
            .unwrap()
            .bootstrap
            .as_mut()
            .unwrap()
            .expires_at_utc = Utc::now();
        assert!(cap.exchange_bootstrap(&headers(), &nonce()).is_err());
    }

    #[test]
    fn configuration_rejects_unbounded_or_ambiguous_secrets_and_origins() {
        for origin in [
            "http://127.0.0.1:5180/",
            "http://user@127.0.0.1:5180",
            "https://example.org",
            "http://127.0.0.1:5180/path",
        ] {
            let mut candidate = config();
            candidate.allowed_origins = vec![origin.into()];
            assert!(LocalCapabilities::new(candidate).is_err());
        }
        let mut candidate = config();
        candidate.bootstrap.as_mut().unwrap().session_expires_at_utc =
            Utc::now() + Duration::hours(13);
        assert!(LocalCapabilities::new(candidate).is_err());
        let mut candidate = config();
        candidate.bootstrap.as_mut().unwrap().expires_at_utc = Utc::now() + Duration::minutes(11);
        assert!(LocalCapabilities::new(candidate).is_err());
        let mut candidate = config();
        candidate.bootstrap.as_mut().unwrap().session_token = owner_token();
        assert!(LocalCapabilities::new(candidate).is_err());
        let mut candidate = config();
        candidate
            .allowed_origins
            .push(candidate.allowed_origins[0].clone());
        assert!(LocalCapabilities::new(candidate).is_err());
    }

    fn config_file(expired_nonce: bool) -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!("naqex-auth-fixture-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("capabilities.json");
        let candidate = config();
        let owner = candidate.owner_bearer.unwrap();
        let mut bootstrap = candidate.bootstrap.unwrap();
        if expired_nonce {
            bootstrap.expires_at_utc = Utc::now() - Duration::minutes(1);
        }
        let data = serde_json::json!({"allowed_origins":candidate.allowed_origins,"owner_bearer":{"token_sha256":owner.token_sha256,"expires_at_utc":owner.expires_at_utc},"bootstrap":{"nonce_sha256":bootstrap.nonce_sha256,"expires_at_utc":bootstrap.expires_at_utc,"session_token":bootstrap.session_token,"csrf_token":bootstrap.csrf_token,"session_expires_at_utc":bootstrap.session_expires_at_utc}});
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        (directory, path)
    }

    fn clean_fixture(directory: &Path) {
        assert!(directory.is_absolute());
        assert_eq!(directory.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            directory
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("naqex-auth-fixture-")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn file_backed_bootstrap_restores_session_without_nonce_replay_or_expiry_extension() {
        let (directory, path) = config_file(false);
        let cap = LocalCapabilities::from_file(&path).unwrap();
        let session_headers = session(&cap);
        let expires = cap.owner_session(&session_headers).unwrap().expires_at_utc;
        let marker_path = &cap.consumption.as_ref().unwrap().path;
        let marker = fs::read_to_string(marker_path).unwrap();
        for secret in [cookie_token(), csrf(), nonce(), owner_token()] {
            assert!(!marker.contains(&secret));
        }
        drop(cap);
        let restarted = LocalCapabilities::from_file(&path).unwrap();
        assert_eq!(
            restarted
                .owner_session(&session_headers)
                .unwrap()
                .expires_at_utc,
            expires
        );
        assert!(restarted.exchange_bootstrap(&headers(), &nonce()).is_err());
        assert!(
            restarted
                .exchange_bootstrap(&session_headers, &nonce())
                .is_err()
        );
        let mut mutate = session_headers;
        mutate.insert(CSRF_HEADER, csrf().parse().unwrap());
        assert_eq!(
            restarted
                .authorize(
                    &mutate,
                    "POST",
                    "/api/v2/live/trading/commands",
                    None,
                    "tenant-a"
                )
                .unwrap(),
            Actor::Owner
        );
        clean_fixture(&directory);
    }

    #[test]
    fn expired_bootstrap_does_not_brick_bearer_and_consumed_session_can_outlive_nonce() {
        let (directory, path) = config_file(true);
        let cap = LocalCapabilities::from_file(&path).unwrap();
        assert!(cap.exchange_bootstrap(&headers(), &nonce()).is_err());
        assert_eq!(
            cap.authorize(
                &bearer(&owner_token()),
                "GET",
                "/api/v2/live/trading",
                None,
                "tenant-a"
            )
            .unwrap(),
            Actor::Owner
        );
        // Reconstruct a previously successful exchange from before this nonce expired.
        cap.consumption
            .as_ref()
            .unwrap()
            .claim(Utc::now() - Duration::minutes(2))
            .unwrap();
        let restarted = LocalCapabilities::from_file(&path).unwrap();
        let mut session_headers = headers();
        session_headers.insert(
            "cookie",
            format!("{COOKIE}={}", cookie_token()).parse().unwrap(),
        );
        assert_eq!(
            restarted
                .owner_session(&session_headers)
                .unwrap()
                .csrf_token,
            csrf()
        );
        assert!(restarted.exchange_bootstrap(&headers(), &nonce()).is_err());
        clean_fixture(&directory);

        let (directory, path) = config_file(true);
        let mut data: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        data["bootstrap"]["expires_at_utc"] = serde_json::json!(Utc::now() - Duration::hours(2));
        data["bootstrap"]["session_expires_at_utc"] =
            serde_json::json!(Utc::now() - Duration::hours(1));
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let expired = LocalCapabilities::from_file(&path).unwrap();
        assert_eq!(
            expired
                .authorize(
                    &bearer(&owner_token()),
                    "GET",
                    "/api/v2/live/trading",
                    None,
                    "tenant-a"
                )
                .unwrap(),
            Actor::Owner
        );
        assert!(expired.owner_session(&session_headers).is_err());
        clean_fixture(&directory);
    }

    #[test]
    fn cross_instance_bootstrap_claim_has_one_winner() {
        let (directory, path) = config_file(false);
        let first = LocalCapabilities::from_file(&path).unwrap();
        let second = LocalCapabilities::from_file(&path).unwrap();
        let handles: Vec<_> = [first, second]
            .into_iter()
            .map(|cap| {
                std::thread::spawn(move || cap.exchange_bootstrap(&headers(), &nonce()).is_ok())
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|handle| usize::from(handle.join().unwrap()))
                .sum::<usize>(),
            1
        );
        let restarted = LocalCapabilities::from_file(&path).unwrap();
        assert!(restarted.exchange_bootstrap(&headers(), &nonce()).is_err());
        clean_fixture(&directory);
    }

    #[test]
    fn corrupt_or_foreign_consumption_marker_fails_closed() {
        let (directory, path) = config_file(false);
        let cap = LocalCapabilities::from_file(&path).unwrap();
        let store = cap.consumption.as_ref().unwrap();
        fs::write(&store.path, b"truncated").unwrap();
        assert!(LocalCapabilities::from_file(&path).is_err());
        fs::write(
            &store.path,
            serde_json::to_vec(&ConsumptionMarker {
                schema_version: "naqex-local-bootstrap-consumption-v1".into(),
                binding_sha256: digest("foreign configuration"),
                consumed_at_utc: Utc::now(),
            })
            .unwrap(),
        )
        .unwrap();
        assert!(LocalCapabilities::from_file(&path).is_err());
        assert!(LocalCapabilities::from_file(Path::new("relative.json")).is_err());
        clean_fixture(&directory);
    }
}
