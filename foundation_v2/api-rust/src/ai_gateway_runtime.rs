use crate::{auth::ApiError, owned_process};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::{io::AsyncReadExt, sync::Mutex, task::JoinHandle};

const BINARY_HASH: &str = "0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443";
const PANEL_HASH: &str = "8c9c6b7d3fb311e6aad5d06e1993e53a2d28389e640448a1bc6304ed20b057b5";
const PANEL_VERSION: &str = "v1.26.7";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
#[cfg(test)]
pub(crate) static ACCEPTANCE_LOCK: Mutex<()> = Mutex::const_new(());

pub(crate) struct GatewayRuntime {
    binary: PathBuf,
    home: PathBuf,
    port: u16,
    state: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    server: Option<owned_process::Child>,
    login: Option<LoginJob>,
    error: Option<&'static str>,
}

struct LoginJob {
    task: JoinHandle<Result<(), &'static str>>,
    url: Arc<StdMutex<Option<String>>>,
}
impl Drop for LoginJob {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn failure(code: &'static str) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, code)
}

// Only the pinned CLI's Google authorization URL can leave the process-output reader.
pub(crate) fn google_auth_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
    let callback = reqwest::Url::parse(query.get("redirect_uri")?).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("accounts.google.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && ["/o/oauth2/auth", "/o/oauth2/v2/auth"].contains(&url.path())
        && url.fragment().is_none()
        && query.get("response_type").is_some_and(|v| v == "code")
        && query.get("state").is_some_and(|v| !v.is_empty())
        && callback.scheme() == "http"
        && callback.host_str() == Some("localhost")
        && callback.port() == Some(51121)
        && callback.path() == "/oauth-callback"
        && callback.username().is_empty()
        && callback.password().is_none()
        && callback.query().is_none()
        && callback.fragment().is_none())
    .then(|| url.into())
}

impl GatewayRuntime {
    pub(crate) async fn model_metadata(
        &self,
        client: &reqwest::Client,
        channels: Vec<String>,
    ) -> Vec<(String, Value)> {
        use futures_util::{StreamExt, stream};
        let Ok(Some(key)) = read_config(&self.home.join("management.key")).await else {
            return Vec::new();
        };
        // Only metadata from this managed loopback gateway; the key never leaves the backend.
        stream::iter(channels.into_iter().take(8).map(|channel| {
            let request = client
                .get(format!(
                    "http://127.0.0.1:{}/v8/management/routing/model-definitions/{channel}",
                    self.port
                ))
                .bearer_auth(key.trim())
                .timeout(Duration::from_secs(2));
            async move { (channel, crate::ai_gateway::read_json(request).await.ok()) }
        }))
        .buffer_unordered(4)
        .filter_map(|(channel, value)| async move { value.map(|v| (channel, v)) })
        .collect()
        .await
    }

    pub(crate) fn new(project: &Path) -> Self {
        Self {
            binary: project
                .join(".runtime/ai-gateway-evaluation/cliproxyapi-v8.0.40/cli-proxy-api.exe"),
            home: project.join(".runtime/mt5-ai-gateway"),
            port: 17852,
            state: Mutex::new(RuntimeState::default()),
        }
    }

    pub(crate) async fn busy(&self) -> bool {
        self.state
            .lock()
            .await
            .login
            .as_ref()
            .is_some_and(|job| !job.task.is_finished())
    }

    async fn reap(state: &mut RuntimeState) -> bool {
        let mut changed = false;
        if state
            .server
            .as_ref()
            .is_some_and(|child| child.try_wait().ok().flatten().is_some())
        {
            state.server = None;
            state.error = Some("ai_gateway_stopped");
            changed = true;
        }
        if state
            .login
            .as_ref()
            .is_some_and(|job| job.task.is_finished())
        {
            let mut job = state.login.take().unwrap();
            // Await by mutable reference because Drop still owns cancellation.
            state.error = match (&mut job.task).await {
                Ok(Ok(())) => None,
                Ok(Err(code)) => Some(code),
                Err(_) => Some("ai_gateway_login_failed"),
            };
            return true;
        }
        changed
    }

    pub(crate) async fn status(&self) -> (Value, bool) {
        let mut state = self.state.lock().await;
        let completed = Self::reap(&mut state).await;
        let operation = state
            .login
            .as_ref()
            .map(|job| json!({"kind":"login", "auth_url":job.url.lock().unwrap().clone()}));
        // Count credentials without reading token contents or exposing filenames/email addresses.
        let mut accounts = 0;
        if let Ok(mut entries) = tokio::fs::read_dir(self.home.join("auth")).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.path().extension().is_some_and(|v| v == "json")
                    && entry.file_type().await.is_ok_and(|kind| kind.is_file())
                {
                    accounts += 1;
                }
                if accounts >= 64 {
                    break;
                }
            }
        }
        let panel_installed = self.home.join("static/management.html").is_file();
        (
            json!({"managed":true,"running":state.server.is_some(),"operation":operation,
            "accounts":accounts,"error":state.error,"management_available":panel_installed,
            "management_version":if panel_installed {Some(PANEL_VERSION)} else {None},
            "management_url":if panel_installed && state.server.is_some() {Some(format!("http://127.0.0.1:{}/management.html",self.port))} else {None}}),
            completed,
        )
    }

    async fn prepare_config(&self, key: &str) -> Result<PathBuf, ApiError> {
        let metadata = tokio::fs::metadata(&self.binary)
            .await
            .map_err(|_| failure("ai_gateway_not_installed"))?;
        if !metadata.is_file() || metadata.len() > 128 * 1024 * 1024 {
            return Err(failure("ai_gateway_binary_invalid"));
        }
        let bytes = tokio::fs::read(&self.binary)
            .await
            .map_err(|_| failure("ai_gateway_not_installed"))?;
        if format!("{:x}", Sha256::digest(&bytes)) != BINARY_HASH {
            return Err(failure("ai_gateway_binary_invalid"));
        }
        if !self.home.join("auth").is_dir() {
            return Err(failure("ai_gateway_not_configured"));
        }
        let auth = serde_json::to_string(&self.home.join("auth").to_string_lossy()).unwrap();
        // Bootstrap once. Provider/routing edits belong to the gateway's persisted document.
        let config = format!(
            r#"config-version: 8
server:
  host: "127.0.0.1"
  port: {port}
  max-request-body-bytes: 65536
  commercial-mode: true
  discovery:
    enabled: false
management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: true
  disable-auto-update-panel: true
access:
  api-keys: ["{key}"]
oauth:
  auth-dir: {auth}
routing:
  strategy: "round-robin"
  session-affinity: true
  retry:
    request-retry: 0
    max-retry-credentials: 1
    max-retry-interval: 0
observability:
  logs:
    debug: false
    logging-to-file: false
    request-log: false
  usage:
    usage-statistics-enabled: false
"#,
            port = self.port
        );
        let path = self.home.join("managed.yaml");
        let managed = read_config(&path).await?;
        let mut changed = managed.is_none();
        let existing = match managed {
            Some(document) => Some(document),
            None => read_config(&self.home.join("config.yaml")).await?,
        };
        let mut document: Value = serde_yaml_ng::from_str(existing.as_deref().unwrap_or(&config))
            .map_err(|_| failure("ai_gateway_config_invalid"))?;
        validate_config(&document, key, &self.home, self.port)?;
        let panel = self.home.join("static/management.html");
        if panel.exists() {
            let metadata = tokio::fs::metadata(&panel)
                .await
                .map_err(|_| failure("ai_gateway_panel_invalid"))?;
            if metadata.len() > 8 * 1024 * 1024 {
                return Err(failure("ai_gateway_panel_invalid"));
            }
            let bytes = tokio::fs::read(&panel)
                .await
                .map_err(|_| failure("ai_gateway_panel_invalid"))?;
            if format!("{:x}", Sha256::digest(&bytes)) != PANEL_HASH {
                return Err(failure("ai_gateway_panel_invalid"));
            }
            let management_key_path = self.home.join("management.key");
            if document["management"]["secret-key"]
                .as_str()
                .is_some_and(|s| s.is_empty())
            {
                let management_key = management_key(&management_key_path).await?;
                document["management"]["secret-key"] = json!(management_key);
                document["management"]["disable-control-panel"] = json!(false);
                changed = true;
            } else {
                // An administrator may rotate this key; never silently replace an unknown credential.
                if !management_key_path.is_file()
                    || document["management"]["disable-control-panel"] != false
                {
                    return Err(failure("ai_gateway_config_conflict"));
                }
            }
        } else if document["management"]["disable-control-panel"] == false {
            return Err(failure("ai_gateway_panel_invalid"));
        }
        if changed {
            let encoded = encode_config(&document)?;
            let temporary = self.home.join("managed.yaml.next");
            tokio::fs::write(&temporary, encoded)
                .await
                .map_err(|_| failure("ai_gateway_not_configured"))?;
            tokio::fs::rename(&temporary, &path)
                .await
                .map_err(|_| failure("ai_gateway_not_configured"))?;
        }
        Ok(path)
    }

    pub(crate) async fn start(&self, key: &str) -> Result<(), ApiError> {
        let mut state = self.state.lock().await;
        Self::reap(&mut state).await;
        if state.server.is_some() {
            return Ok(());
        }
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, self.port))
            .await
            .map_err(|_| failure("ai_gateway_port_in_use"))?;
        // Do not mutate a config that an externally owned listener may be using.
        let config = self.prepare_config(key).await?;
        drop(listener);
        let args = vec![
            "--local-model".into(),
            "--config".into(),
            config.to_string_lossy().into_owned(),
        ];
        let static_path = self.home.join("static").to_string_lossy().into_owned();
        // The panel stays at its own origin. Ignore inherited management passwords/static paths.
        let mut child = owned_process::spawn(
            &self.binary,
            &args,
            Some(&self.home),
            &[
                ("MANAGEMENT_STATIC_PATH", &static_path),
                ("MANAGEMENT_PASSWORD", ""),
            ],
            owned_process::Limits::default(),
            true,
        )
        .map_err(|_| failure("ai_gateway_start_failed"))?;
        if let Some(output) = child.stdout.take() {
            drain(output);
        }
        if let Some(output) = child.stderr.take() {
            drain(output);
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(300))
            .build()
            .map_err(|_| failure("ai_gateway_start_failed"))?;
        for _ in 0..50 {
            if child
                .try_wait()
                .map_err(|_| failure("ai_gateway_start_failed"))?
                .is_some()
            {
                return Err(failure("ai_gateway_start_failed"));
            }
            if client
                .get(format!("http://127.0.0.1:{}/v1/models", self.port))
                .bearer_auth(key)
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                if self.home.join("static/management.html").is_file() {
                    let admin = tokio::fs::read_to_string(self.home.join("management.key"))
                        .await
                        .map_err(|_| failure("ai_gateway_config_conflict"))?;
                    // Management authenticates with bcrypt; the model-list probe's 300ms
                    // budget can expire during a cold start or a concurrent local build.
                    let checked = client
                        .get(format!(
                            "http://127.0.0.1:{}/v8/management/config/server/host",
                            self.port
                        ))
                        .timeout(Duration::from_secs(3))
                        .bearer_auth(admin.trim())
                        .send()
                        .await;
                    if !checked.is_ok_and(|r| r.status().is_success()) {
                        let _ = child.kill().await;
                        return Err(failure("ai_gateway_config_conflict"));
                    }
                }
                state.server = Some(child);
                state.error = None;
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = child.kill().await;
        Err(failure("ai_gateway_start_failed"))
    }

    pub(crate) async fn login(&self, key: &str) -> Result<(), ApiError> {
        self.start(key).await?;
        let mut state = self.state.lock().await;
        Self::reap(&mut state).await;
        if state.login.is_some() {
            return Err(ApiError::detail(StatusCode::CONFLICT, "chatgpt_busy"));
        }
        // The web client opens the validated URL. The owned process must never spawn a personal browser.
        let args = vec![
            "--antigravity-login".into(),
            "--no-browser".into(),
            "--config".into(),
            self.home
                .join("managed.yaml")
                .to_string_lossy()
                .into_owned(),
        ];
        let mut child = owned_process::spawn(
            &self.binary,
            &args,
            Some(&self.home),
            &[],
            owned_process::Limits::default(),
            true,
        )
        .map_err(|_| failure("ai_gateway_login_failed"))?;
        if let Some(output) = child.stderr.take() {
            drain(output);
        }
        let url = Arc::new(StdMutex::new(None));
        let captured = url.clone();
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| failure("ai_gateway_login_failed"))?;
        let reader = tokio::spawn(async move {
            let mut buffer = [0; 4096];
            let mut pending = String::new();
            while let Ok(count) = stdout.read(&mut buffer).await {
                if count == 0 {
                    break;
                }
                pending.push_str(&String::from_utf8_lossy(&buffer[..count]));
                while let Some(end) = pending.find('\n') {
                    let line: String = pending.drain(..=end).collect();
                    if let Some(value) = line.split_whitespace().find_map(google_auth_url) {
                        *captured.lock().unwrap() = Some(value);
                    }
                }
                if pending.len() > 16384 {
                    pending.clear();
                }
            }
        });
        let task = tokio::spawn(async move {
            let result = tokio::time::timeout(LOGIN_TIMEOUT, async {
                loop {
                    if let Some(exit) = child.try_wait().map_err(|_| "ai_gateway_login_failed")? {
                        return if exit.success() {
                            Ok(())
                        } else {
                            Err("ai_gateway_login_failed")
                        };
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            })
            .await
            .unwrap_or(Err("ai_gateway_login_timeout"));
            let _ = child.kill().await;
            reader.abort();
            result
        });
        state.login = Some(LoginJob { task, url });
        state.error = None;
        Ok(())
    }

    pub(crate) async fn cancel(&self) {
        if let Some(mut job) = self.state.lock().await.login.take() {
            job.task.abort();
            let _ = (&mut job.task).await;
        }
    }

    pub(crate) async fn stop(&self) {
        self.cancel().await;
        let mut state = self.state.lock().await;
        if let Some(mut child) = state.server.take() {
            let _ = child.kill().await;
        }
        state.error = None;
    }
}

async fn read_config(path: &Path) -> Result<Option<String>, ApiError> {
    match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() && metadata.len() <= 1024 * 1024 => {
            tokio::fs::read_to_string(path)
                .await
                .map(Some)
                .map_err(|_| failure("ai_gateway_config_invalid"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err(failure("ai_gateway_config_invalid")),
    }
}

fn encode_config(document: &Value) -> Result<String, ApiError> {
    // serde_json's arbitrary_precision numbers use a private serializer map.
    // Convert through JSON text so Go/YAML receives numeric scalars, not that internal map.
    let yaml: serde_yaml_ng::Value = serde_yaml_ng::from_str(&document.to_string())
        .map_err(|_| failure("ai_gateway_config_invalid"))?;
    serde_yaml_ng::to_string(&yaml).map_err(|_| failure("ai_gateway_config_invalid"))
}

fn validate_config(document: &Value, key: &str, home: &Path, port: u16) -> Result<(), ApiError> {
    let management = &document["management"];
    let auth_matches = document["oauth"]["auth-dir"]
        .as_str()
        .is_some_and(|path| Path::new(path) == home.join("auth"));
    if document["config-version"] != 8
        || document["server"]["host"] != "127.0.0.1"
        || document["server"]["port"] != port
        || document["server"]["tls"]["enable"] == true
        || document["server"]["discovery"]["enabled"] != false
        || !auth_matches
        || !document["access"]["api-keys"]
            .as_array()
            .is_some_and(|keys| keys.iter().any(|v| v == key))
        || management["allow-remote"] != false
        || management["disable-auto-update-panel"] != true
        || !management["secret-key"].is_string()
        || !management["disable-control-panel"].is_boolean()
        || document["observability"]["pprof"]["enable"] == true
        || document["home"]["enabled"] == true
    {
        return Err(failure("ai_gateway_config_conflict"));
    }
    Ok(())
}

async fn management_key(path: &Path) -> Result<String, ApiError> {
    if let Some(key) = read_config(path).await? {
        let key = key.trim();
        if key.len() == 43
            && key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Ok(key.to_owned());
        }
        return Err(failure("ai_gateway_config_conflict"));
    }
    use base64::Engine;
    use tokio::io::AsyncWriteExt;
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| failure("ai_gateway_not_configured"))?;
    let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    // Inherits the private runtime directory ACL; create_new never overwrites a concurrent key.
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .map_err(|_| failure("ai_gateway_not_configured"))?;
    file.write_all(key.as_bytes())
        .await
        .map_err(|_| failure("ai_gateway_not_configured"))?;
    Ok(key)
}

fn drain(mut output: impl tokio::io::AsyncRead + Unpin + Send + 'static) {
    tokio::spawn(async move {
        let mut buffer = [0; 4096];
        while let Ok(count) = output.read(&mut buffer).await {
            if count == 0 {
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistent_config_keeps_provider_edits_but_rejects_connection_changes() {
        let home = Path::new("C:/fixture");
        let config = json!({"config-version":8,"server":{"host":"127.0.0.1","port":17852,"discovery":{"enabled":false}},
            "access":{"api-keys":["app-key","another-key"]},"oauth":{"auth-dir":"C:/fixture/auth"},
            "management":{"allow-remote":false,"disable-auto-update-panel":true,"disable-control-panel":false,"secret-key":"hashed-admin-key"},
            "routing":{"strategy":"fill-first"},"api-keys":{"openai-compatibility":[{"name":"fixture"}]}});
        let yaml = encode_config(&config).unwrap();
        let yaml_nodes: serde_yaml_ng::Value = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(yaml_nodes["config-version"].as_u64(), Some(8));
        assert_eq!(yaml_nodes["server"]["port"].as_u64(), Some(17852));
        let decoded: Value = serde_yaml_ng::from_str(&yaml).unwrap();
        validate_config(&decoded, "app-key", home, 17852).unwrap();
        assert_eq!(decoded["routing"]["strategy"], "fill-first");
        assert_eq!(
            decoded["api-keys"]["openai-compatibility"][0]["name"],
            "fixture"
        );
        for (pointer, value) in [
            ("/server/host", json!("0.0.0.0")),
            ("/server/port", json!(80)),
            ("/management/allow-remote", json!(true)),
            ("/management/disable-auto-update-panel", json!(false)),
            ("/access/api-keys", json!([])),
            ("/oauth/auth-dir", json!("C:/personal-auth")),
            ("/server/discovery/enabled", json!(true)),
        ] {
            let mut changed = config.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert_eq!(
                validate_config(&changed, "app-key", home, 17852)
                    .unwrap_err()
                    .1["detail"],
                "ai_gateway_config_conflict"
            );
        }
        assert!(serde_yaml_ng::from_str::<Value>("server: [broken").is_err());
    }

    #[tokio::test]
    #[ignore = "Explicit isolated acceptance: pinned gateway on17853, new empty auth, no login/inference"]
    async fn pinned_management_panel_preserves_config_after_restart() {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let fixture = PathBuf::from(
            std::env::var("TW_AI_ADMIN_EVIDENCE").expect("Set an external evidence folder"),
        );
        let home = fixture.join(format!("gateway-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(home.join("auth")).await.unwrap();
        let mut runtime = GatewayRuntime::new(project);
        runtime.home = home.clone();
        runtime.port = 17853;
        let key = "synthetic-app-key-for-isolated-gateway-only";
        runtime.prepare_config(key).await.unwrap();
        let initial = tokio::fs::read(home.join("managed.yaml")).await.unwrap();
        tokio::fs::create_dir(home.join("static")).await.unwrap();
        tokio::fs::copy(
            fixture.join("management.html"),
            home.join("static/management.html"),
        )
        .await
        .unwrap();
        let occupied = tokio::net::TcpListener::bind("127.0.0.1:17853")
            .await
            .unwrap();
        assert_eq!(
            runtime.start(key).await.unwrap_err().1["detail"],
            "ai_gateway_port_in_use"
        );
        assert_eq!(
            tokio::fs::read(home.join("managed.yaml")).await.unwrap(),
            initial
        );
        assert!(
            !home.join("management.key").exists(),
            "occupied listener must not trigger management setup"
        );
        drop(occupied);
        runtime.start(key).await.unwrap();
        let admin = tokio::fs::read_to_string(home.join("management.key"))
            .await
            .unwrap();
        assert_ne!(admin, key);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let base = "http://127.0.0.1:17853";
        let mut checks = vec!["occupied port rejected before config or key mutation"];
        for suffix in ["/v8/management/config", "/v0/management/config"] {
            assert_eq!(
                client
                    .get(format!("{base}{suffix}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::UNAUTHORIZED
            );
        }
        checks.push("unauthenticated management denied");
        assert_eq!(
            client
                .get(format!("{base}/v8/management/config"))
                .bearer_auth(key)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let html = client
            .get(format!("{base}/management.html"))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(&html)), PANEL_HASH);
        checks.push("pinned official panel served unchanged");
        let response = client
            .patch(format!("{base}/v8/management/config/routing"))
            .bearer_auth(&admin)
            .json(&json!({"strategy":"fill-first"}))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let config: Value = client
            .get(format!("{base}/v8/management/config"))
            .bearer_auth(&admin)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(config["routing"]["strategy"], "fill-first");
        let saved = tokio::fs::read(home.join("managed.yaml")).await.unwrap();
        assert_ne!(saved, initial);
        runtime.stop().await;
        runtime.start(key).await.unwrap();
        assert_eq!(
            tokio::fs::read(home.join("managed.yaml")).await.unwrap(),
            saved,
            "restart must not rewrite panel edits"
        );
        assert_eq!(
            tokio::fs::read_to_string(home.join("management.key"))
                .await
                .unwrap(),
            admin,
            "key survives restart"
        );
        checks.push("authenticated v8 write persists across managed restart");
        let status = runtime.status().await.0;
        assert_eq!(status["accounts"], 0);
        assert!(!status.to_string().contains(&admin));
        assert!(!status.to_string().contains(key));
        let models: Value = client
            .get(format!("{base}/v1/models"))
            .bearer_auth(key)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(models["data"].as_array().unwrap().len(), 0);
        runtime.stop().await;
        let mut changed: Value = serde_yaml_ng::from_slice(&saved).unwrap();
        changed["server"]["host"] = json!("0.0.0.0");
        let invalid = encode_config(&changed).unwrap();
        tokio::fs::write(home.join("managed.yaml"), &invalid)
            .await
            .unwrap();
        assert_eq!(
            runtime.start(key).await.unwrap_err().1["detail"],
            "ai_gateway_config_conflict"
        );
        assert_eq!(
            tokio::fs::read_to_string(home.join("managed.yaml"))
                .await
                .unwrap(),
            invalid,
            "invalid config is preserved for repair"
        );
        tokio::fs::write(home.join("managed.yaml"), saved)
            .await
            .unwrap();
        let _listener = tokio::net::TcpListener::bind("127.0.0.1:17853")
            .await
            .unwrap();
        checks.push("unsafe restart denied without overwriting config; owned listener stopped");
        tokio::fs::write(
            fixture.join("gateway-report.json"),
            serde_json::to_vec_pretty(&json!({"passed":true,"checks":checks,
            "fixture_home":home,"accounts":0,"inference_requests":0,"oauth_requests":0}))
            .unwrap(),
        )
        .await
        .unwrap();
    }
    #[test]
    fn only_google_oauth_with_exact_local_callback_is_opened() {
        let valid = "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=synthetic&redirect_uri=http%3A%2F%2Flocalhost%3A51121%2Foauth-callback";
        assert!(google_auth_url(valid).is_some());
        for bad in [
            valid.replace("https:", "http:"),
            valid.replace("accounts.google.com", "evil.example"),
            valid.replace("accounts.google.com", "accounts.google.com.evil.example"),
            valid.replace("localhost", "evil.example"),
            valid.replace("51121", "80"),
            valid.replace("response_type=code", "response_type=token"),
            format!("{valid}#fragment"),
        ] {
            assert!(google_auth_url(&bad).is_none(), "{bad}");
        }
    }

    #[tokio::test]
    async fn idle_is_lazy_cancel_stops_job_and_errors_are_sanitized() {
        let runtime = GatewayRuntime::new(Path::new("C:/nonexistent-wm-fixture"));
        let (value, changed) = runtime.status().await;
        assert!(!changed);
        assert_eq!(value["running"], false);
        assert_eq!(value["accounts"], 0);
        assert!(value["operation"].is_null());
        assert!(runtime.start("synthetic-key").await.is_err());
        runtime.state.lock().await.login = Some(LoginJob {
            task: tokio::spawn(async { std::future::pending().await }),
            url: Arc::new(StdMutex::new(None)),
        });
        assert!(runtime.busy().await);
        runtime.cancel().await;
        assert!(!runtime.busy().await);
        runtime.state.lock().await.login = Some(LoginJob {
            task: tokio::spawn(async { Err("ai_gateway_login_failed") }),
            url: Arc::new(StdMutex::new(None)),
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        let (value, changed) = runtime.status().await;
        assert!(changed);
        assert_eq!(value["error"], "ai_gateway_login_failed");
        assert!(!value.to_string().contains("synthetic-key"));
    }

    #[tokio::test]
    #[ignore = "Explicit local acceptance: starts the pinned gateway with the existing empty auth store, never OAuth"]
    async fn pinned_empty_gateway_starts_once_and_stops_owned_process() {
        let _guard = ACCEPTANCE_LOCK.lock().await;
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let runtime = GatewayRuntime::new(project);
        let key = tokio::fs::read_to_string(runtime.home.join("inference.key"))
            .await
            .unwrap();
        assert_eq!(
            runtime.status().await.0["accounts"],
            0,
            "Only run against empty auth"
        );
        let guard = tokio::net::TcpListener::bind("127.0.0.1:17852")
            .await
            .unwrap();
        assert_eq!(
            runtime.start(key.trim()).await.unwrap_err().1["detail"],
            "ai_gateway_port_in_use"
        );
        drop(guard);
        runtime.start(key.trim()).await.unwrap();
        let pid = runtime.state.lock().await.server.as_ref().unwrap().id();
        runtime.start(key.trim()).await.unwrap();
        assert_eq!(
            runtime.state.lock().await.server.as_ref().unwrap().id(),
            pid
        );
        let value = runtime.status().await.0;
        assert_eq!(value["running"], true);
        assert!(value["operation"].is_null());
        assert!(!value.to_string().contains(key.trim()));
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert_eq!(
            client
                .get("http://127.0.0.1:17852/v1/models")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let management_status = if runtime.home.join("static/management.html").is_file() {
            StatusCode::UNAUTHORIZED
        } else {
            StatusCode::NOT_FOUND
        };
        assert_eq!(
            client
                .get("http://127.0.0.1:17852/v0/management/auth-files")
                .send()
                .await
                .unwrap()
                .status(),
            management_status
        );
        runtime
            .state
            .lock()
            .await
            .server
            .as_mut()
            .unwrap()
            .kill()
            .await
            .unwrap();
        let (value, changed) = runtime.status().await;
        assert!(changed);
        assert_eq!(value["running"], false);
        assert_eq!(value["error"], "ai_gateway_stopped");
        runtime.start(key.trim()).await.unwrap();
        runtime.stop().await;
        assert_eq!(runtime.status().await.0["running"], false);
        // No listener or child survives an explicit stop.
        let _listener = tokio::net::TcpListener::bind("127.0.0.1:17852")
            .await
            .unwrap();
    }
}
