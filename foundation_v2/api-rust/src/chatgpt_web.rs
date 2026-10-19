use crate::{auth::{ApiError, Workspace}, owned_process, state::AppState};
use axum::{extract::{ConnectInfo, Path, Request, State}, http::StatusCode, middleware::Next, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, sync::Mutex};

/// Owns the dedicated browser bridge tree. Credentials remain in its private home.
pub struct ChatGptWeb {
    source: PathBuf,
    home: PathBuf,
    bun: PathBuf,
    port: u16,
    child: Mutex<Option<owned_process::Child>>,
    client: reqwest::Client,
    chat: Mutex<Option<ChatTurn>>,
}

struct ChatTurn {
    id: String,
    workspace: String,
    subject: String,
    created: std::time::Instant,
    selection: Value,
    task: Option<tokio::task::JoinHandle<Result<String, &'static str>>>,
    result: Value,
}

fn chat_messages(body: Value) -> Result<Value, ApiError> {
    let invalid = || ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chat_messages");
    if !body.is_object() || body.as_object().is_none_or(|v| v.len() != 1) { return Err(invalid()); }
    let messages = body["messages"].as_array().ok_or_else(invalid)?;
    if messages.is_empty() || messages.len() > 63 || serde_json::to_vec(&body).map_err(|_| invalid())?.len() > 49152 { return Err(invalid()); }
    for (index, message) in messages.iter().enumerate() {
        if message.as_object().is_none_or(|v| v.len() != 2)
            || message["role"] != if index % 2 == 0 { "user" } else { "assistant" }
            || message["content"].as_str().is_none_or(|v| v.trim().is_empty()) { return Err(invalid()); }
    }
    if messages.last().is_none_or(|v| v["role"] != "user") { return Err(invalid()); }
    Ok(body["messages"].clone())
}

fn chat_text(value: &Value) -> Result<String, &'static str> {
    if value["status"] != "completed" { return Err("chatgpt_incomplete_response"); }
    let text = value["output"].as_array().into_iter().flatten()
        .filter(|item| item["type"] == "message" && item["role"] == "assistant")
        .flat_map(|item| item["content"].as_array().into_iter().flatten())
        .filter(|part| part["type"] == "output_text")
        .filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n");
    if text.trim().is_empty() { return Err("chatgpt_empty_response"); }
    Ok(text)
}

fn unavailable(code: &str) -> ApiError { ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, code) }

impl ChatGptWeb {
    pub fn from_environment() -> Result<Self, String> {
        let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(4).ok_or("workspace path unavailable")?;
        let source = std::env::var_os("TW_CHATGPT_WEB_CORE").map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("tooling/chatgpt-web-core"));
        let home = std::env::var_os("TW_CHATGPT_WEB_HOME").map(PathBuf::from)
            .unwrap_or_else(|| workspace.join(".runtime/mt5-chatgpt-web"));
        let bun = std::env::var_os("TW_CHATGPT_WEB_BUN").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join(".bun/bin/bun.exe"));
        let port = std::env::var("TW_CHATGPT_WEB_PORT").unwrap_or_else(|_| "17851".into()).parse::<u16>().map_err(|_| "invalid ChatGPT Web port")?;
        if !source.is_absolute() || !home.is_absolute() || !bun.is_absolute() || port < 1024 {
            return Err("ChatGPT Web requires explicit absolute local paths and a nonprivileged port".into());
        }
        Ok(Self { source, home, bun, port, child: Mutex::new(None), chat: Mutex::new(None),
            client: reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15)).build().map_err(|_| "ChatGPT Web HTTP client unavailable")? })
    }
    fn token(&self) -> Result<String, ApiError> {
        let bytes = std::fs::read(self.home.join("config.json")).map_err(|_| unavailable("chatgpt_profile_unavailable"))?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| unavailable("chatgpt_profile_invalid"))?;
        if value["port"].as_u64() != Some(self.port as u64) || value["host"] != "127.0.0.1" {
            return Err(unavailable("chatgpt_profile_invalid"));
        }
        value["controlToken"].as_str().filter(|s| s.len() >= 32).map(String::from).ok_or_else(|| unavailable("chatgpt_profile_invalid"))
    }
    async fn ensure_started(&self, child: &mut Option<owned_process::Child>) -> Result<(), ApiError> {
        if let Some(process) = child {
            if process.try_wait().map_err(|_| unavailable("chatgpt_runtime_unavailable"))?.is_none() { return Ok(()); }
        }
        *child = None;
        if !self.source.join("src/core-cli.ts").is_file() || !self.source.join("node_modules").is_dir() || !self.bun.is_file() {
            return Err(unavailable("chatgpt_core_not_installed"));
        }
        // Never adopt a listener merely because it occupies our configured port.
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, self.port)).await
            .map_err(|_| unavailable("chatgpt_port_in_use"))?;
        drop(listener);
        let args = vec!["run".into(), self.source.join("src/core-cli.ts").to_string_lossy().into(), "serve".into(),
            "--home".into(), self.home.to_string_lossy().into(), "--port".into(), self.port.to_string()];
        let mut process = owned_process::spawn(&self.bun, &args, Some(&self.source), &[], owned_process::Limits::default(), false)
            .map_err(|_| unavailable("chatgpt_start_failed"))?;
        // Drain diagnostics without copying prompts, tokens or browser content into API logs.
        if let Some(mut stdout) = process.stdout.take() {
            tokio::spawn(async move { let mut buffer = [0_u8; 4096]; while let Ok(count) = stdout.read(&mut buffer).await { if count == 0 { break; } } });
        }
        for _ in 0..50 {
            if process.try_wait().map_err(|_| unavailable("chatgpt_start_failed"))?.is_some() { return Err(unavailable("chatgpt_start_failed")); }
            if self.token().is_ok() && self.call("GET", "", None).await.is_ok() {
                *child = Some(process);
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let _ = process.kill().await;
        Err(unavailable("chatgpt_start_timeout"))
    }
    async fn call(&self, method: &str, suffix: &str, body: Option<Value>) -> Result<Value, ApiError> {
        let url = format!("http://127.0.0.1:{}/core/account{}", self.port, suffix);
        let mut request = self.client.request(if method == "GET" { reqwest::Method::GET } else { reqwest::Method::POST }, url)
            .bearer_auth(self.token()?).timeout(if method == "GET" { Duration::from_secs(1) } else { Duration::from_secs(15) });
        if let Some(body) = body { request = request.json(&body); }
        let response = request.send().await.map_err(|_| unavailable("chatgpt_runtime_unavailable"))?;
        let status = response.status();
        if !status.is_success() {
            let code = if status.as_u16() == 409 || status.as_u16() == 429 { "chatgpt_busy" } else { "chatgpt_action_failed" };
            return Err(ApiError::detail(if code == "chatgpt_busy" { StatusCode::CONFLICT } else { StatusCode::BAD_REQUEST }, code));
        }
        response.json().await.map_err(|_| unavailable("chatgpt_invalid_response"))
    }
    pub async fn status(&self) -> Result<Value, ApiError> {
        let mut child = self.child.lock().await;
        if child.as_ref().is_none_or(|process| process.try_wait().ok().flatten().is_some()) {
            *child = None;
            return Ok(json!({"status":"stopped", "login_state_present":null,"models":[],"selection":null,"operation":null,
                "account_scope":"local-machine","capabilities":{"text":true,"tools":false,"agents":false}}));
        }
        self.call("GET", "", None).await
    }
    async fn action(&self, action: &str, body: Value) -> Result<Value, ApiError> {
        if !["login", "probe", "selection", "cancel", "disconnect", "start"].contains(&action) {
            return Err(ApiError::detail(StatusCode::NOT_FOUND, "Not Found"));
        }
        if !body.is_object() || (action != "selection" && body.as_object().is_some_and(|v| !v.is_empty()))
            || (action == "selection" && (body.as_object().is_some_and(|v| v.len() != 2) || !body["model"].is_string() || !body["effort"].is_string())) {
            return Err(ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_chatgpt_action"));
        }
        let chat = self.chat.lock().await;
        if chat.as_ref().is_some_and(|turn| turn.task.as_ref().is_some_and(|task| !task.is_finished())) {
            return Err(ApiError::detail(StatusCode::CONFLICT, "chatgpt_busy"));
        }
        let mut child = self.child.lock().await;
        self.ensure_started(&mut child).await?;
        if action == "start" { return self.call("GET", "", None).await; }
        self.call("POST", &format!("/{action}"), Some(body)).await
    }
    async fn start_chat(&self, scope: &Workspace, body: Value) -> Result<Value, ApiError> {
        let messages = chat_messages(body)?;
        let mut chat = self.chat.lock().await;
        if chat.as_ref().is_some_and(|turn| turn.task.as_ref().is_some_and(|task| !task.is_finished())) {
            return Err(ApiError::detail(StatusCode::CONFLICT, "chatgpt_busy"));
        }
        let mut child = self.child.lock().await;
        self.ensure_started(&mut child).await?;
        let account = self.call("GET", "", None).await?;
        if !account["operation"].is_null() { return Err(ApiError::detail(StatusCode::CONFLICT, "chatgpt_busy")); }
        if account["login_state_present"] != true { return Err(unavailable("chatgpt_login_required")); }
        let selection = account["selection"].clone();
        let model = selection["model"].as_str().ok_or_else(|| unavailable("chatgpt_selection_required"))?;
        let effort = selection["effort"].as_str().ok_or_else(|| unavailable("chatgpt_selection_required"))?;
        // Validate against this core's upstream catalog immediately before sending.
        if !account["models"].as_array().is_some_and(|models| models.iter().any(|item|
            item["id"] == model && item["efforts"].as_array().is_some_and(|efforts| efforts.iter().any(|v| v == effort)))) {
            return Err(unavailable("chatgpt_selection_required"));
        }
        let payload = json!({"model":model,"reasoning":{"effort":effort},"input":messages,"stream":false,"store":false,
            "instructions":"Bạn là trợ lý AI của WMREPLAY. Trả lời bằng ngôn ngữ người dùng. Chỉ trao đổi văn bản; không có quyền đọc dữ liệu ứng dụng, tạo chiến lược, dùng công cụ hoặc thực hiện giao dịch. Không tuyên bố đã thực hiện các hành động đó."});
        let request = self.client.post(format!("http://127.0.0.1:{}/v1/responses", self.port))
            .bearer_auth(self.token()?).timeout(Duration::from_secs(190)).json(&payload);
        let task = tokio::spawn(async move {
            let mut response = request.send().await.map_err(|error| if error.is_timeout() { "chatgpt_timeout" } else { "chatgpt_response_failed" })?;
            if !response.status().is_success() {
                return Err(if [409, 429].contains(&response.status().as_u16()) { "chatgpt_busy" } else { "chatgpt_response_failed" });
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "chatgpt_response_failed")? {
                if bytes.len() + chunk.len() > 262144 { return Err("chatgpt_response_too_large"); }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "chatgpt_invalid_response")?;
            chat_text(&value)
        });
        let id = uuid::Uuid::new_v4().to_string();
        *chat = Some(ChatTurn { id: id.clone(), workspace: scope.workspace_id.clone(), subject: scope.subject.clone(),
            created: std::time::Instant::now(), selection: selection.clone(), task: Some(task), result: json!({"status":"running"}) });
        Ok(json!({"id":id,"status":"running","selection":selection}))
    }
    async fn read_chat(&self, scope: &Workspace, id: &str, cancel: bool) -> Result<Value, ApiError> {
        let mut chat = self.chat.lock().await;
        if chat.as_ref().is_some_and(|turn| turn.created.elapsed() > Duration::from_secs(600)) { *chat = None; }
        let turn = chat.as_mut().filter(|turn| turn.id == id && turn.workspace == scope.workspace_id && turn.subject == scope.subject)
            .ok_or_else(|| ApiError::detail(StatusCode::NOT_FOUND, "chatgpt_turn_not_found"))?;
        if cancel || turn.task.as_ref().is_some_and(|task| task.is_finished()) {
            if let Some(task) = turn.task.take() {
                if cancel && !task.is_finished() { task.abort(); }
                turn.result = match task.await {
                    Ok(Ok(text)) => json!({"status":"completed","text":text}),
                    Ok(Err(code)) => json!({"status":"failed","error":code}),
                    Err(_) => json!({"status":"cancelled"}),
                };
            }
        }
        let mut result = turn.result.clone();
        result["id"] = json!(turn.id);
        result["selection"] = turn.selection.clone();
        Ok(result)
    }
    pub async fn shutdown(&self) {
        if let Some(mut turn) = self.chat.lock().await.take() {
            if let Some(task) = turn.task.take() { task.abort(); let _ = task.await; }
        }
        if let Some(mut child) = self.child.lock().await.take() { let _ = child.kill().await; }
    }
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/v2/ai/chatgpt/account", get(status))
        .route("/api/v2/ai/chatgpt/account/{action}", post(action))
        .route("/api/v2/ai/chatgpt/chat", post(start_chat))
        .route("/api/v2/ai/chatgpt/chat/{id}", get(read_chat).delete(cancel_chat))
        .route_layer(axum::middleware::from_fn(local_boundary))
}
pub fn native(method: &str, path: &str) -> bool {
    matches!((method, path), ("GET", "/api/v2/ai/chatgpt/account") | ("POST", "/api/v2/ai/chatgpt/account/{action}")
        | ("POST", "/api/v2/ai/chatgpt/chat") | ("GET" | "DELETE", "/api/v2/ai/chatgpt/chat/{id}"))
}
fn local_request(request: &Request) -> bool {
    if !request.extensions().get::<ConnectInfo<std::net::SocketAddr>>().is_some_and(|peer| peer.0.ip().is_loopback()) { return false; }
    let Some(host) = request.headers().get("host").and_then(|v| v.to_str().ok()) else { return false; };
    let Ok(url) = reqwest::Url::parse(&format!("http://{host}")) else { return false; };
    if !url.username().is_empty() || url.password().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some()
        || !url.host_str().is_some_and(|host| host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())) { return false; }
    if request.method() != axum::http::Method::GET {
        return request.headers().get("origin").and_then(|v| v.to_str().ok()).is_some_and(|origin| origin == url.origin().ascii_serialization());
    }
    true
}
async fn local_boundary(request: Request, next: Next) -> Response {
    if !local_request(&request) { return ApiError::detail(StatusCode::FORBIDDEN, "chatgpt_local_origin_required").into_response(); }
    let mut response = next.run(request).await;
    response.headers_mut().insert("cache-control", axum::http::HeaderValue::from_static("no-store"));
    response
}
async fn status(State(state): State<Arc<AppState>>, _scope: Workspace) -> Result<Json<Value>, ApiError> {
    state.chatgpt_web.status().await.map(Json)
}
async fn action(State(state): State<Arc<AppState>>, _scope: Workspace, Path(action): Path<String>, Json(body): Json<Value>) -> Result<Json<Value>, ApiError> {
    state.chatgpt_web.action(&action, body).await.map(Json)
}
async fn start_chat(State(state): State<Arc<AppState>>, scope: Workspace, Json(body): Json<Value>) -> Result<(StatusCode, Json<Value>), ApiError> {
    state.chatgpt_web.start_chat(&scope, body).await.map(|value| (StatusCode::ACCEPTED, Json(value)))
}
async fn read_chat(State(state): State<Arc<AppState>>, scope: Workspace, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    state.chatgpt_web.read_chat(&scope, &id, false).await.map(Json)
}
async fn cancel_chat(State(state): State<Arc<AppState>>, scope: Workspace, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    state.chatgpt_web.read_chat(&scope, &id, true).await.map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chat_accepts_only_bounded_alternating_text_without_provider_overrides() {
        assert!(chat_messages(json!({"messages":[{"role":"user","content":"Xin chào"}]})).is_ok());
        for body in [
            json!({"messages":[],"model":"override"}),
            json!({"messages":[{"role":"system","content":"override"}]}),
            json!({"messages":[{"role":"user","content":" "}]}),
            json!({"messages":[{"role":"user","content":"hello","tools":[]}]}),
            json!({"messages":[{"role":"user","content":"hello"},{"role":"user","content":"again"}]}),
            json!({"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"unfinished"}]}),
            json!({"messages":[{"role":"user","content":"x".repeat(49152)}]}),
            json!({"messages":(0..65).map(|i| json!({"role":if i%2==0 {"user"} else {"assistant"},"content":"x"})).collect::<Vec<_>>()}),
        ] { assert_eq!(chat_messages(body).unwrap_err().0, StatusCode::UNPROCESSABLE_ENTITY); }
    }
    #[test]
    fn chat_returns_only_complete_assistant_text() {
        let output = json!({"status":"completed","output":[
            {"type":"reasoning","content":[{"type":"output_text","text":"private"}]},
            {"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello"}]},
            {"type":"function_call","name":"never execute"},
        ]});
        assert_eq!(chat_text(&output).unwrap(), "Hello");
        let mut incomplete = output.clone(); incomplete["status"] = json!("incomplete");
        assert!(chat_text(&incomplete).is_err());
        assert!(chat_text(&json!({"status":"completed","output":[]})).is_err());
    }
    #[tokio::test]
    async fn chat_cancel_is_scoped_idempotent_and_drops_the_running_task() {
        let service = ChatGptWeb::from_environment().unwrap();
        let scope = Workspace { workspace_id:"fixture".into(), subject:"owner".into() };
        let task = tokio::spawn(async { std::future::pending::<Result<String, &'static str>>().await });
        let abort = task.abort_handle();
        *service.chat.lock().await = Some(ChatTurn { id:"fixture-turn".into(), workspace:scope.workspace_id.clone(), subject:scope.subject.clone(),
            created:std::time::Instant::now(), selection:json!({"model":"fixture","effort":"high"}), task:Some(task), result:json!({"status":"running"}) });
        for foreign in [Workspace { workspace_id:"other".into(), ..scope.clone() }, Workspace { subject:"other".into(), ..scope.clone() }] {
            assert_eq!(service.read_chat(&foreign, "fixture-turn", true).await.unwrap_err().0, StatusCode::NOT_FOUND);
        }
        assert!(!abort.is_finished());
        assert_eq!(service.read_chat(&scope, "fixture-turn", false).await.unwrap()["status"], "running");
        assert_eq!(service.action("disconnect", json!({})).await.unwrap_err().0, StatusCode::CONFLICT);
        assert_eq!(service.read_chat(&scope, "fixture-turn", true).await.unwrap()["status"], "cancelled");
        assert!(abort.is_finished());
        assert_eq!(service.read_chat(&scope, "fixture-turn", true).await.unwrap()["status"], "cancelled");
        service.chat.lock().await.as_mut().unwrap().created -= Duration::from_secs(601);
        assert_eq!(service.read_chat(&scope, "fixture-turn", false).await.unwrap_err().0, StatusCode::NOT_FOUND);
    }
    #[tokio::test]
    async fn completed_chat_survives_late_cancel_and_shutdown_aborts_pending_work() {
        let service = ChatGptWeb::from_environment().unwrap();
        let scope = Workspace { workspace_id:"fixture".into(), subject:"owner".into() };
        let task = tokio::spawn(async { Ok("fixture reply".into()) });
        while !task.is_finished() { tokio::task::yield_now().await; }
        *service.chat.lock().await = Some(ChatTurn { id:"done".into(), workspace:scope.workspace_id.clone(), subject:scope.subject.clone(),
            created:std::time::Instant::now(), selection:json!({}), task:Some(task), result:json!({"status":"running"}) });
        assert_eq!(service.read_chat(&scope, "done", true).await.unwrap()["text"], "fixture reply");
        let task = tokio::spawn(async { std::future::pending::<Result<String, &'static str>>().await });
        let abort = task.abort_handle();
        service.chat.lock().await.as_mut().unwrap().task = Some(task);
        service.shutdown().await;
        assert!(abort.is_finished());
        assert!(service.chat.lock().await.is_none());
    }
    #[tokio::test]
    async fn status_does_not_start_a_browser_or_adopt_a_service() {
        let service = ChatGptWeb::from_environment().unwrap();
        assert_eq!(service.status().await.unwrap()["status"], "stopped");
        assert_eq!(service.action("arbitrary", json!({})).await.unwrap_err().0, StatusCode::NOT_FOUND);
        assert_eq!(service.action("login", json!({"home":"untrusted"})).await.unwrap_err().0, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(service.child.lock().await.is_none());
    }
    #[test]
    fn account_mutations_require_loopback_peer_and_same_origin() {
        for (peer, host, origin, allowed) in [
            ("127.0.0.1:1000", "127.0.0.1:5180", Some("http://127.0.0.1:5180"), true),
            ("127.0.0.1:1000", "127.0.0.1:5180", Some("https://foreign.example"), false),
            ("127.0.0.1:1000", "evil.example", Some("http://evil.example"), false),
            ("10.0.0.2:1000", "localhost:5180", Some("http://localhost:5180"), false),
            ("127.0.0.1:1000", "localhost:5180", None, false),
        ] {
            let mut request = Request::builder().method("POST").header("host", host);
            if let Some(origin) = origin { request = request.header("origin", origin); }
            let mut request = request.body(axum::body::Body::empty()).unwrap();
            request.extensions_mut().insert(ConnectInfo(peer.parse::<std::net::SocketAddr>().unwrap()));
            assert_eq!(local_request(&request), allowed);
        }
    }
}
