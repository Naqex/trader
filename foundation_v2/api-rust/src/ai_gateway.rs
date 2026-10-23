use crate::auth::ApiError;
use axum::http::StatusCode;
use serde_json::{Value, json};
use std::{collections::BTreeSet, path::PathBuf, time::{Duration, Instant}};
use tokio::sync::Mutex;

/// OAuth tokens stay in the pinned gateway; the product only counts credential files.
pub(crate) struct LocalGateway {
    base: String,
    key_file: PathBuf,
    client: reqwest::Client,
    state: Mutex<GatewayState>,
    runtime: Option<crate::ai_gateway_runtime::GatewayRuntime>,
}

struct GatewayState {
    selected: Option<String>,
    catalog: Option<(Instant, Vec<Value>)>,
}

fn unavailable(code: &str) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, code)
}

fn base_url(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "invalid AI gateway URL")?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path().trim_end_matches('/') != "/v1"
        || url.port().is_none_or(|port| port < 1024)
        || !url.host_str().is_some_and(|host| host.trim_matches(['[', ']']).parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())) {
        return Err("AI gateway requires an explicit loopback HTTP /v1 endpoint and nonprivileged port".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

impl LocalGateway {
    pub(crate) fn from_environment() -> Result<Self, String> {
        let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().and_then(|p| p.parent()).ok_or("project path unavailable")?;
        let base = std::env::var("TW_AI_GATEWAY_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:17852/v1".into());
        let key_file = std::env::var_os("TW_AI_GATEWAY_KEY_FILE").map(PathBuf::from)
            .unwrap_or_else(|| project.join(".runtime/mt5-ai-gateway/inference.key"));
        let managed = base_url(&base)? == "http://127.0.0.1:17852/v1"
            && key_file == project.join(".runtime/mt5-ai-gateway/inference.key");
        let mut gateway = Self::new(&base, key_file, std::env::var("TW_AI_GATEWAY_MODEL").ok())?;
        if managed && cfg!(windows) { gateway.runtime = Some(crate::ai_gateway_runtime::GatewayRuntime::new(project)); }
        Ok(gateway)
    }

    pub(crate) fn new(base: &str, key_file: PathBuf, selected: Option<String>) -> Result<Self, String> {
        if !key_file.is_absolute() { return Err("AI gateway key file must be absolute".into()); }
        Ok(Self { base: base_url(base)?, key_file,
            client: reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3)).build().map_err(|_| "AI gateway client unavailable")?,
            state: Mutex::new(GatewayState { selected, catalog: None }), runtime: None })
    }

    async fn key(&self) -> Result<String, ApiError> {
        let metadata = tokio::fs::metadata(&self.key_file).await.map_err(|_| unavailable("ai_gateway_not_configured"))?;
        if !metadata.is_file() || metadata.len() > 4096 { return Err(unavailable("ai_gateway_key_invalid")); }
        let bytes = tokio::fs::read(&self.key_file).await.map_err(|_| unavailable("ai_gateway_not_configured"))?;
        let key = std::str::from_utf8(&bytes).map_err(|_| unavailable("ai_gateway_key_invalid"))?.trim();
        if !(32..=256).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_+/=".contains(&b)) {
            return Err(unavailable("ai_gateway_key_invalid"));
        }
        Ok(key.to_owned())
    }

    async fn catalog(&self, state: &mut GatewayState, refresh: bool) -> Result<Vec<Value>, ApiError> {
        if !refresh && let Some((at, models)) = &state.catalog && at.elapsed() < Duration::from_secs(30) {
            return Ok(models.clone());
        }
        // A failed refresh invalidates readiness; never serve a stale catalog as a healthy connection.
        state.catalog = None;
        let request = self.client.get(format!("{}/models", self.base)).bearer_auth(self.key().await?);
        let value = read_json(request).await.map_err(unavailable)?;
        let rows = value["data"].as_array().filter(|rows| rows.len() <= 256).ok_or_else(|| unavailable("ai_gateway_invalid_response"))?;
        let mut ids = BTreeSet::new();
        for row in rows {
            let id = row["id"].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
                .ok_or_else(|| unavailable("ai_gateway_invalid_response"))?;
            ids.insert(id.to_owned());
        }
        let models: Vec<_> = ids.into_iter().map(|id| json!({"id":id,"name":id,"efforts":[]})).collect();
        state.catalog = Some((Instant::now(), models.clone()));
        Ok(models)
    }

    pub(crate) async fn status(&self, refresh: bool) -> Value {
        let (runtime, completed) = match &self.runtime {
            Some(runtime) => runtime.status().await,
            None => (json!({"managed":false}), false),
        };
        if runtime["operation"].is_object() {
            return json!({"status":"waiting_for_browser","models":[],"ready":false,"selection":null,
                "operation":runtime["operation"],"runtime":runtime,"endpoint":self.base});
        }
        let mut state = self.state.lock().await;
        let mut value = match self.catalog(&mut state, refresh || completed).await {
            Ok(models) => {
                let selection = state.selected.as_ref().filter(|id| models.iter().any(|m| m["id"] == id.as_str()))
                    .map(|id| json!({"model":id,"effort":null}));
                json!({"status":if models.is_empty() {"empty"} else {"catalog_ready"},"models":models,
                    "ready":selection.is_some(),"selection":selection,"operation":null,"endpoint":self.base})
            }
            Err(error) => json!({"status":"unavailable","error":error.1["detail"],"models":[],"selection":null,
                "ready":false,"operation":null,"endpoint":self.base}),
        };
        if runtime["error"].is_string() { value["error"] = runtime["error"].clone(); }
        value["runtime"] = runtime;
        value["runtime"]["external"] = json!(value["runtime"]["managed"] == true && value["runtime"]["running"] == false && value["status"] != "unavailable");
        value
    }

    pub(crate) async fn busy(&self) -> bool {
        match &self.runtime { Some(runtime) => runtime.busy().await, None => false }
    }

    pub(crate) async fn action(&self, action: &str, body: &Value) -> Result<(), ApiError> {
        if body.as_object().is_none_or(|v| !v.is_empty()) || !["start","login","cancel","stop"].contains(&action) {
            return Err(ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY,"invalid_ai_action"));
        }
        let runtime = self.runtime.as_ref().ok_or_else(|| unavailable("ai_gateway_unmanaged"))?;
        match action {
            "start" => runtime.start(&self.key().await?).await?,
            "login" => runtime.login(&self.key().await?).await?,
            "cancel" => runtime.cancel().await,
            "stop" => runtime.stop().await,
            _ => unreachable!(),
        }
        self.state.lock().await.catalog = None;
        Ok(())
    }

    pub(crate) async fn shutdown(&self) {
        if let Some(runtime) = &self.runtime { runtime.stop().await; }
    }

    pub(crate) async fn select(&self, body: &Value) -> Result<(), ApiError> {
        if body.as_object().is_none_or(|o| o.len() != 2 || !o.contains_key("effort")) || !body["effort"].is_null() {
            return Err(ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_ai_selection"));
        }
        let mut state = self.state.lock().await;
        let models = self.catalog(&mut state, false).await?;
        let model = body["model"].as_str().filter(|id| models.iter().any(|m| m["id"] == *id))
            .ok_or_else(|| ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_ai_selection"))?;
        state.selected = Some(model.to_owned());
        Ok(())
    }

    pub(crate) async fn prepare(&self, messages: Value, instructions: &str) -> Result<(Value, reqwest::RequestBuilder), ApiError> {
        let mut state = self.state.lock().await;
        let models = self.catalog(&mut state, false).await?;
        let model = state.selected.as_ref().filter(|id| models.iter().any(|m| m["id"] == id.as_str()))
            .ok_or_else(|| unavailable("ai_gateway_selection_required"))?;
        let selection = json!({"model":model,"effort":null});
        let payload = json!({"model":model,"input":messages,"instructions":instructions,"stream":false,"store":false});
        let request = self.client.post(format!("{}/responses", self.base)).bearer_auth(self.key().await?)
            .timeout(Duration::from_secs(190)).json(&payload);
        Ok((selection, request))
    }
}

pub(crate) async fn read_json(request: reqwest::RequestBuilder) -> Result<Value, &'static str> {
    let mut response = request.send().await.map_err(|e| if e.is_timeout() {"ai_gateway_timeout"} else {"ai_gateway_unavailable"})?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "ai_gateway_auth_failed", 429 => "ai_gateway_rate_limited",
            408 | 504 => "ai_gateway_timeout", _ => "ai_gateway_response_failed",
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "ai_gateway_response_failed")? {
        if bytes.len() + chunk.len() > 262144 { return Err("ai_gateway_response_too_large"); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "ai_gateway_invalid_response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_cannot_send_credentials_off_machine_or_to_management() {
        assert!(base_url("http://127.0.0.1:17852/v1/").is_ok());
        assert!(base_url("http://[::1]:17852/v1").is_ok());
        for value in ["https://example.com/v1", "http://localhost:17852/v1", "http://127.0.0.1:80/v1",
            "http://token@127.0.0.1:17852/v1", "http://127.0.0.1:17852/v0/management", "http://127.0.0.1:17852/v1?key=x"] {
            assert!(base_url(value).is_err(), "{value}");
        }
    }
}
