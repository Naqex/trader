//! Read services shared by HTTP and AI evidence. MCP never supplies authority.
use crate::{
    auth::{ApiError, Workspace},
    demo_trading::{self, ReadBinding},
    state::AppState,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{NaiveDateTime, Utc};
use rmcp::{
    ServiceExt,
    model::{
        CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation, ProtocolVersion,
    },
    transport::{
        StreamableHttpClientTransport, streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

const MAX_PAYLOAD: usize = 1_048_576;
const MCP_BUDGET: Duration = Duration::from_secs(12);
const TTL: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    bindings: Vec<Binding>,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    workspace_id: String,
    connection_id: Uuid,
    generation: i64,
    endpoint: String,
    key_env: String,
}
impl Binding {
    fn validate(&self) -> bool {
        let Ok(url) = reqwest::Url::parse(&self.endpoint) else {
            return false;
        };
        // Literal loopback only: no DNS rebinding, proxy, credentials or redirects.
        url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
            && url.port().is_some_and(|p| p > 1024)
            && url.path() == "/mcp"
            && url.query().is_none()
            && url.fragment().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && self.generation > 0
            && !self.workspace_id.is_empty()
            && self.workspace_id.len() <= 128
            && self.key_env.starts_with("TW_MT5_MCP_KEY_")
            && self.key_env.len() <= 128
            && self
                .key_env
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
    }
}
struct Cached {
    saved: Instant,
    data: Value,
    bytes: usize,
}
pub struct Mt5Tools {
    bindings: Vec<Binding>,
    cache: Mutex<HashMap<String, Cached>>,
    // Supplementary reads cannot occupy all API capacity or queue indefinitely.
    admission: Semaphore,
    client: reqwest_mcp::Client,
    terminal_root: PathBuf,
}
fn fail(code: &str) -> ApiError {
    ApiError::detail(StatusCode::SERVICE_UNAVAILABLE, code)
}
fn invalid() -> ApiError {
    ApiError::detail(StatusCode::UNPROCESSABLE_ENTITY, "invalid_mt5_tool_request")
}

impl Mt5Tools {
    pub fn from_environment() -> Result<Self, String> {
        let bindings = match std::env::var("TW_MT5_MCP_CONFIG") {
            Err(std::env::VarError::NotPresent) => Vec::new(),
            Ok(path) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() || std::fs::metadata(&path).map_or(true, |m| m.len() > 32768)
                {
                    return Err("invalid MT5 MCP configuration".into());
                }
                let config: Configuration = serde_json::from_slice(
                    &std::fs::read(path).map_err(|_| "cannot read MT5 MCP configuration")?,
                )
                .map_err(|_| "invalid MT5 MCP configuration")?;
                if config.bindings.len() > 10
                    || config.bindings.iter().any(|b| !b.validate())
                    || config.bindings.iter().enumerate().any(|(i, b)| {
                        config.bindings[..i].iter().any(|a| {
                            (a.workspace_id == b.workspace_id && a.connection_id == b.connection_id)
                                || a.endpoint == b.endpoint
                        })
                    })
                {
                    return Err("invalid MT5 MCP configuration".into());
                }
                config.bindings
            }
            Err(_) => return Err("invalid MT5 MCP configuration".into()),
        };
        let client = reqwest_mcp::Client::builder()
            .no_proxy()
            .redirect(reqwest_mcp::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(MCP_BUDGET)
            .build()
            .map_err(|_| "cannot create MT5 MCP client")?;
        Ok(Self {
            bindings,
            client,
            cache: Mutex::new(HashMap::new()),
            admission: Semaphore::new(2),
            terminal_root: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.runtime/mt5-broker"),
        })
    }
    pub(crate) fn configured(&self, workspace: &str, id: Uuid, generation: i64) -> bool {
        self.bindings.iter().any(|b| {
            b.workspace_id == workspace && b.connection_id == id && b.generation == generation
        })
    }
    async fn payload(
        &self,
        binding: &Binding,
        identity: &ReadBinding,
        tool: &str,
        args: Value,
        key: &str,
    ) -> Result<Value, ApiError> {
        if key.is_empty() || key.len() > 1024 || key.chars().any(char::is_control) {
            return Err(fail("mt5_mcp_key_missing"));
        }
        let mut transport_config =
            StreamableHttpClientTransportConfig::with_uri(binding.endpoint.clone())
                .auth_header(key);
        transport_config.max_concurrent_requests = 1;
        transport_config.max_sse_event_size = MAX_PAYLOAD;
        transport_config.reinit_on_expired_session = false;
        let transport =
            StreamableHttpClientTransport::with_client(self.client.clone(), transport_config);
        let info = ClientConfig::new(
            ClientCapabilities::default(),
            Implementation::new("wmreplay-readonly", "0.1"),
        )
        .with_protocol_version(ProtocolVersion::V_2025_06_18);
        let service = info
            .serve(transport)
            .await
            .map_err(|_| fail("mt5_mcp_unavailable"))?;
        let result = async {
            let call = |name: &'static str, args: Value| {
                service.call_tool(
                    CallToolRequestParams::new(name)
                        .with_arguments(args.as_object().unwrap().clone()),
                )
            };
            let account = decode(
                serde_json::to_value(
                    call("get_trading_account_info", json!({}))
                        .await
                        .map_err(|_| fail("mt5_mcp_unavailable"))?,
                )
                .map_err(|_| fail("mt5_mcp_invalid_response"))?,
            )?;
            verify_account(&account, identity)?;
            let workspace = decode(
                serde_json::to_value(
                    call("get_workspace_info", json!({}))
                        .await
                        .map_err(|_| fail("mt5_mcp_unavailable"))?,
                )
                .map_err(|_| fail("mt5_mcp_invalid_response"))?,
            )?;
            verify_terminal(
                &workspace,
                &self
                    .terminal_root
                    .join(binding.connection_id.to_string())
                    .join("MQL5"),
            )?;
            // Explicit allowlist; no arbitrary tool names, file access, tester or order calls.
            let name = match tool {
                "indicators" => "list_available_indicators",
                "calendar" => "economic_calendar_list_values",
                "event" => "economic_calendar_get_event_by_id",
                _ => return Err(invalid()),
            };
            let data = decode(
                serde_json::to_value(
                    call(name, args)
                        .await
                        .map_err(|_| fail("mt5_mcp_unavailable"))?,
                )
                .map_err(|_| fail("mt5_mcp_invalid_response"))?,
            )?;
            let after = decode(
                serde_json::to_value(
                    call("get_trading_account_info", json!({}))
                        .await
                        .map_err(|_| fail("mt5_mcp_unavailable"))?,
                )
                .map_err(|_| fail("mt5_mcp_invalid_response"))?,
            )?;
            verify_account(&after, identity)?;
            normalize(tool, data)
        }
        .await;
        // Also executed for semantic errors. Drop cancels if the outer deadline fires.
        let _ = tokio::time::timeout(Duration::from_millis(200), service.cancel()).await;
        result
    }
    pub(crate) async fn read(
        &self,
        state: &AppState,
        scope: &Workspace,
        id: Uuid,
        tool: &str,
        query: &ToolQuery,
    ) -> Result<Value, ApiError> {
        let args = query.arguments(tool)?;
        let identity = demo_trading::read_binding(state, scope, id).await?;
        let cache_key = format!(
            "{}:{id}:{}:{tool}:{args}",
            scope.workspace_id, identity.generation
        );
        let cached = self
            .cache
            .lock()
            .await
            .get(&cache_key)
            .filter(|v| v.saved.elapsed() < TTL)
            .map(|v| v.data.clone());
        let cache_miss = cached.is_none();
        let data = if let Some(data) = cached {
            data
        } else {
            let _permit = self
                .admission
                .try_acquire()
                .map_err(|_| fail("mt5_tool_busy"))?;
            let data = if tool == "symbols" {
                let data = demo_trading::symbol_catalog(state, scope, id).await?;
                if data["items"].as_array().is_none_or(|v| v.len() > 10000) {
                    return Err(fail("mt5_mcp_invalid_response"));
                }
                data
            } else {
                let binding = self
                    .bindings
                    .iter()
                    .find(|b| {
                        b.workspace_id == scope.workspace_id
                            && b.connection_id == id
                            && b.generation == identity.generation
                    })
                    .ok_or_else(|| fail("mt5_mcp_not_configured"))?;
                let key =
                    std::env::var(&binding.key_env).map_err(|_| fail("mt5_mcp_key_missing"))?;
                tokio::time::timeout(
                    MCP_BUDGET,
                    self.payload(binding, &identity, tool, args, &key),
                )
                .await
                .map_err(|_| fail("mt5_mcp_timeout"))??
            };
            if serde_json::to_vec(&data).map_or(true, |v| v.len() > 2 * MAX_PAYLOAD) {
                return Err(fail("mt5_tool_result_too_large"));
            }
            let mut data = data;
            data["captured_at_utc"] = json!(Utc::now());
            data
        };
        // Revoke/pause/reconnect must invalidate cache hits and in-flight results too.
        if demo_trading::read_binding(state, scope, id).await? != identity {
            return Err(fail("mt5_connection_changed"));
        }
        let mut cache = self.cache.lock().await;
        cache.retain(|_, v| v.saved.elapsed() < TTL);
        if cache_miss && !cache.contains_key(&cache_key) {
            let bytes = data.to_string().len();
            while cache.len() >= 32
                || cache.values().map(|v| v.bytes).sum::<usize>() + bytes > 8 * MAX_PAYLOAD
            {
                if let Some(key) = cache
                    .iter()
                    .min_by_key(|(_, v)| v.saved)
                    .map(|(k, _)| k.clone())
                {
                    cache.remove(&key);
                } else {
                    break;
                }
            }
            cache.insert(
                cache_key,
                Cached {
                    saved: Instant::now(),
                    data: data.clone(),
                    bytes,
                },
            );
        }
        let hash = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&data).map_err(|_| fail("mt5_mcp_invalid_response"))?
            )
        );
        Ok(
            json!({"provenance":{"source":if tool=="symbols" {"mt5_sdk"}else{"mt5_native_mcp"},"connection_id":id,"generation":identity.generation,"captured_at_utc":data["captured_at_utc"],"sha256":hash,"read_only":true},"data":data}),
        )
    }
}

fn decode(result: Value) -> Result<Value, ApiError> {
    if result["isError"] == true || result.to_string().len() > MAX_PAYLOAD {
        return Err(fail("mt5_mcp_invalid_response"));
    }
    let data = if result["structuredContent"].is_object() {
        result["structuredContent"].clone()
    } else {
        let parts = result["content"]
            .as_array()
            .ok_or_else(|| fail("mt5_mcp_invalid_response"))?;
        if parts.len() != 1 || parts[0]["type"] != "text" {
            return Err(fail("mt5_mcp_invalid_response"));
        }
        serde_json::from_str(
            parts[0]["text"]
                .as_str()
                .ok_or_else(|| fail("mt5_mcp_invalid_response"))?,
        )
        .map_err(|_| fail("mt5_mcp_invalid_response"))?
    };
    if !data.is_object() || data.get("ok").is_some_and(|v| v != true) {
        return Err(fail("mt5_mcp_invalid_response"));
    }
    Ok(data)
}
fn verify_account(data: &Value, identity: &ReadBinding) -> Result<(), ApiError> {
    if data["account"]["login"].as_str() != Some(&identity.login)
        || data["account"]["server"].as_str() != Some(&identity.server)
        || data["terminal"]["server_connected"] != true
    {
        return Err(fail("mt5_mcp_identity_mismatch"));
    }
    Ok(())
}
fn verify_terminal(data: &Value, expected: &std::path::Path) -> Result<(), ApiError> {
    let actual = data["workspace"]["mql5_folder"]
        .as_str()
        .ok_or_else(|| fail("mt5_mcp_identity_mismatch"))?;
    let actual = std::fs::canonicalize(actual).map_err(|_| fail("mt5_mcp_identity_mismatch"))?;
    if std::fs::canonicalize(expected).ok().as_ref() != Some(&actual) {
        return Err(fail("mt5_mcp_identity_mismatch"));
    }
    Ok(())
}
fn normalize(tool: &str, data: Value) -> Result<Value, ApiError> {
    let (array, fields, max) = match tool {
        "indicators" => (
            "indicators",
            &["name", "path", "type", "group", "subwindow_used"][..],
            512,
        ),
        "calendar" => (
            "values",
            &[
                "id",
                "event_id",
                "change_id",
                "time",
                "time_unknown",
                "reference_period_start",
                "revision",
                "actual_value",
                "prev_value",
                "revised_prev_value",
                "forecast_value",
                "impact_type",
            ][..],
            32,
        ),
        "event" => {
            return if data["event"].is_object() {
                Ok(json!({"event":data["event"]}))
            } else {
                Err(fail("mt5_mcp_invalid_response"))
            };
        }
        _ => return Err(invalid()),
    };
    let items = data[array]
        .as_array()
        .ok_or_else(|| fail("mt5_mcp_invalid_response"))?;
    if items.len() > max {
        return Err(fail("mt5_tool_result_too_large"));
    }
    if items.iter().any(|v| {
        !v.is_object()
            || (tool == "indicators"
                && v["name"]
                    .as_str()
                    .is_none_or(|s| s.is_empty() || s.len() > 256))
            || (tool == "calendar"
                && (v["event_id"]
                    .as_str()
                    .is_none_or(|s| s.parse::<u64>().is_err())
                    || !v["time_unknown"].is_boolean()))
    }) {
        return Err(fail("mt5_mcp_invalid_response"));
    }
    let items: Vec<Value> = items
        .iter()
        .map(|item| {
            let mut out = json!({});
            for key in fields {
                if let Some(value) = item.get(*key) {
                    out[*key] = value.clone();
                }
            }
            out
        })
        .collect();
    Ok(
        json!({"items":items,"truncated":data["truncated"].as_bool().unwrap_or(false),
        "time_basis":if tool=="calendar" {json!("trade_server_local_offset_unknown")}else{Value::Null}}),
    )
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ToolQuery {
    from: Option<String>,
    to: Option<String>,
    event_id: Option<String>,
}
impl ToolQuery {
    fn arguments(&self, tool: &str) -> Result<Value, ApiError> {
        match tool {
            "symbols" | "indicators"
                if self.from.is_none() && self.to.is_none() && self.event_id.is_none() =>
            {
                Ok(if tool == "indicators" {
                    json!({"indicator_type":"standard"})
                } else {
                    json!({})
                })
            }
            "event"
                if self.from.is_none()
                    && self.to.is_none()
                    && self.event_id.as_ref().is_some_and(|v| {
                        !v.is_empty()
                            && v.len() <= 20
                            && v.bytes().all(|b| b.is_ascii_digit())
                            && v.parse::<u64>().is_ok_and(|v| v > 0)
                    }) =>
            {
                Ok(json!({"event_id":self.event_id}))
            }
            "calendar" if self.event_id.is_none() => {
                let from = self.from.as_deref().ok_or_else(invalid)?;
                let to = self.to.as_deref().ok_or_else(invalid)?;
                let start = NaiveDateTime::parse_from_str(from, "%Y-%m-%dT%H:%M:%S")
                    .map_err(|_| invalid())?;
                let end = NaiveDateTime::parse_from_str(to, "%Y-%m-%dT%H:%M:%S")
                    .map_err(|_| invalid())?;
                if end <= start || (end - start).num_seconds() > 7 * 86400 {
                    return Err(invalid());
                }
                Ok(json!({"datetime_from":from,"datetime_to":to,"limit":32}))
            }
            _ => Err(invalid()),
        }
    }
}
pub(crate) async fn read(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    Path((id, tool)): Path<(Uuid, String)>,
    Query(query): Query<ToolQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        state
            .mt5_tools
            .read(&state, &scope, id, &tool, &query)
            .await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, response::IntoResponse, routing::post};
    use std::sync::Mutex as StdMutex;

    #[test]
    fn configuration_pins_local_endpoints_and_generation() {
        let mut b = Binding {
            workspace_id: "fixture".into(),
            connection_id: Uuid::new_v4(),
            generation: 1,
            endpoint: "http://127.0.0.1:22346/mcp".into(),
            key_env: "TW_MT5_MCP_KEY_FIXTURE".into(),
        };
        assert!(b.validate());
        for url in [
            "http://localhost:22346/mcp",
            "http://example.com:22346/mcp",
            "https://127.0.0.1:22346/mcp",
            "http://u:p@127.0.0.1:22346/mcp",
            "http://127.0.0.1:22346/mcp?q=x",
            "http://127.0.0.1:22346/other",
        ] {
            b.endpoint = url.into();
            assert!(!b.validate(), "{url}");
        }
        b.endpoint = "http://127.0.0.1:22346/mcp".into();
        b.generation = 0;
        assert!(!b.validate());
        b.generation = 1;
        b.key_env = "PATH".into();
        assert!(!b.validate());
    }
    #[test]
    fn queries_never_admit_arbitrary_tools_or_guess_calendar_timezone() {
        assert!(ToolQuery::default().arguments("order_send").is_err());
        assert!(ToolQuery::default().arguments("calendar").is_err());
        let mut q = ToolQuery {
            from: Some("2026-10-24T00:00:00".into()),
            to: Some("2026-10-25T00:00:00".into()),
            event_id: None,
        };
        assert_eq!(q.arguments("calendar").unwrap()["limit"], 32);
        q.to = Some("2026-11-05T00:00:00".into());
        assert!(q.arguments("calendar").is_err());
        q.to = Some("2026-10-23T00:00:00".into());
        assert!(q.arguments("calendar").is_err());
        q.to = Some("2026-10-25T00:00:00Z".into());
        assert!(q.arguments("calendar").is_err());
        assert!(serde_json::from_value::<ToolQuery>(json!({"url":"http://evil"})).is_err());
    }
    #[test]
    fn semantic_failure_and_wrong_identity_are_not_success() {
        for result in [
            json!({"isError":true,"content":[]}),
            json!({"structuredContent":{"ok":false}}),
            json!({"content":[{"type":"text","text":"not json"}]}),
        ] {
            assert!(decode(result).is_err());
        }
        let id = ReadBinding {
            generation: 1,
            login: "123".into(),
            server: "Fixture".into(),
        };
        let valid = json!({"account":{"login":"123","server":"Fixture"},"terminal":{"server_connected":true}});
        assert!(verify_account(&valid, &id).is_ok());
        for path in ["login", "server"] {
            let mut data = valid.clone();
            data["account"][path] = json!("wrong");
            assert!(verify_account(&data, &id).is_err());
        }
        assert!(normalize("indicators", json!({"indicators":[{"not_name":"x"}]})).is_err());
        let data=normalize("calendar",json!({"values":[{"event_id":"1","time_unknown":false,"time":"2026-10-24T10:00:00","forecast_value":null}],"truncated":true})).unwrap();
        assert_eq!(data["time_basis"], "trade_server_local_offset_unknown");
        assert_eq!(data["items"][0]["time"], "2026-10-24T10:00:00");
        assert!(data["items"][0]["forecast_value"].is_null());
    }

    #[derive(Clone)]
    struct Fixture {
        calls: Arc<StdMutex<Vec<String>>>,
        root: PathBuf,
        id: Uuid,
        fail: bool,
    }
    async fn rpc(State(f): State<Fixture>, Json(body): Json<Value>) -> axum::response::Response {
        let Some(id) = body.get("id") else {
            return StatusCode::ACCEPTED.into_response();
        };
        let result = match body["method"].as_str().unwrap_or("") {
            "initialize" => {
                json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}})
            }
            "tools/call" => {
                let name = body["params"]["name"].as_str().unwrap().to_string();
                f.calls.lock().unwrap().push(name.clone());
                let payload = match name.as_str() {
                    "get_trading_account_info" => {
                        json!({"account":{"login":"123","server":"Fixture"},"terminal":{"server_connected":true}})
                    }
                    "get_workspace_info" => {
                        json!({"workspace":{"mql5_folder":f.root.join(f.id.to_string()).join("MQL5")}})
                    }
                    "list_available_indicators" => {
                        json!({"indicators":[{"name":"Moving Average","group":"Trend","subwindow_used":false}]})
                    }
                    "economic_calendar_list_values" if f.fail => json!({"ok":false}),
                    "economic_calendar_list_values" => {
                        json!({"ok":true,"values":[],"truncated":false})
                    }
                    _ => panic!("unexpected tool {name}"),
                };
                json!({"content":[{"type":"text","text":payload.to_string()}]})
            }
            _ => panic!("unexpected rpc {body}"),
        };
        Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
    }
    #[tokio::test]
    async fn official_sdk_reads_native_shape_and_rejects_tool_failure() {
        // This directory is test-owned and always under the configured temporary root.
        let root = std::env::temp_dir().join(format!("wm-mcp-{}", Uuid::new_v4()));
        let id = Uuid::new_v4();
        std::fs::create_dir_all(root.join(id.to_string()).join("MQL5")).unwrap();
        let f = Fixture {
            calls: Default::default(),
            root: root.clone(),
            id,
            fail: true,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = Router::new().route("/mcp", post(rpc)).with_state(f.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut tools = Mt5Tools::from_environment().unwrap();
        tools.terminal_root = root.clone();
        let binding = Binding {
            workspace_id: "fixture".into(),
            connection_id: id,
            generation: 1,
            endpoint: format!("http://127.0.0.1:{port}/mcp"),
            key_env: "TW_MT5_MCP_KEY_FIXTURE".into(),
        };
        let identity = ReadBinding {
            generation: 1,
            login: "123".into(),
            server: "Fixture".into(),
        };
        let output = tools
            .payload(
                &binding,
                &identity,
                "indicators",
                json!({"indicator_type":"standard"}),
                "fixture-key",
            )
            .await
            .unwrap();
        assert_eq!(output["items"][0]["name"], "Moving Average");
        assert_eq!(output["items"][0]["subwindow_used"], false);
        assert!(tools.payload(&binding,&identity,"calendar",json!({"datetime_from":"2026-10-24T00:00:00","datetime_to":"2026-10-25T00:00:00","limit":32}),"fixture-key").await.is_err());
        assert!(f.calls.lock().unwrap().iter().all(|n| {
            [
                "get_trading_account_info",
                "get_workspace_info",
                "list_available_indicators",
                "economic_calendar_list_values",
            ]
            .contains(&n.as_str())
        }));
        server.abort();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "requires the owned disposable PostgreSQL runner"]
    async fn postgres_mt5_read_scope_and_cache_revocation() {
        assert_eq!(
            std::env::var("TW_RUST_RUNTIME_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let dsn = std::env::var("TW_RUST_RUNTIME_TEST_DSN").unwrap();
        let (mut db, connection) = tokio_postgres::connect(&dsn, tokio_postgres::NoTls)
            .await
            .unwrap();
        let task = tokio::spawn(connection);
        let who = db
            .query_one("SELECT current_user,current_database()", &[])
            .await
            .unwrap();
        assert_eq!(who.get::<_, String>(0), "rust_runtime_fixture");
        assert_eq!(who.get::<_, String>(1), "rust_runtime_fixture");
        crate::rust_runtime::apply_migrations(&mut db, false)
            .await
            .unwrap();
        db.execute("INSERT INTO workspaces VALUES('a','now'),('b','now')", &[])
            .await
            .unwrap();
        let id = Uuid::new_v4();
        let snapshot = json!({"account_binding":{"login":"123","server":"Fixture","generation":1,"account_environment":"demo"},"verified_permissions":{"read":true,"trade":false}});
        db.execute("INSERT INTO mt5_connections(workspace_id,connection_id,request_id,account_key,name,server,login_hint,start_date,credential,generation,status,snapshot,requested_mode) VALUES('a',$1,$1,'fixture','Fixture','Fixture','123','2026-10-24','fixture',1,'connected',$2,'read_only')",&[&id,&snapshot]).await.unwrap();
        let pool = deadpool_postgres::Pool::builder(deadpool_postgres::Manager::new(
            dsn.parse().unwrap(),
            tokio_postgres::NoTls,
        ))
        .max_size(2)
        .runtime(deadpool_postgres::Runtime::Tokio1)
        .build()
        .unwrap();
        let mut state = crate::tests::fixture(100);
        Arc::get_mut(&mut state).unwrap().pool = pool.clone();
        Arc::get_mut(&mut state).unwrap().native_runtime = true;
        let a = Workspace {
            workspace_id: "a".into(),
            subject: "owner".into(),
        };
        let b = Workspace {
            workspace_id: "b".into(),
            subject: "owner".into(),
        };
        let data = json!({"items":[{"symbol":"TEST","source":"mt5_sdk"}],"captured_at_utc":"2026-10-24T00:00:00Z"});
        state.mt5_tools.cache.lock().await.insert(
            format!("a:{id}:1:symbols:{{}}"),
            Cached {
                saved: Instant::now(),
                bytes: data.to_string().len(),
                data,
            },
        );
        let result = state
            .mt5_tools
            .read(&state, &a, id, "symbols", &Default::default())
            .await
            .unwrap();
        assert_eq!(result["data"]["items"][0]["symbol"], "TEST");
        assert_eq!(result["provenance"]["generation"], 1);
        assert_eq!(result["provenance"]["sha256"].as_str().unwrap().len(), 64);
        assert!(
            state
                .mt5_tools
                .read(&state, &b, id, "symbols", &Default::default())
                .await
                .is_err()
        );
        let source = json!({"kind":"mt5_symbols","id":id});
        let attached = crate::ai_context::snapshot(&state, &a, &source)
            .await
            .unwrap();
        assert_eq!(attached["data"]["total_count"], 1);
        assert_eq!(attached["provenance"]["read_only"], true);
        db.execute(
            "UPDATE mt5_connections SET status='paused' WHERE connection_id=$1",
            &[&id],
        )
        .await
        .unwrap();
        assert!(
            state
                .mt5_tools
                .read(&state, &a, id, "symbols", &Default::default())
                .await
                .is_err()
        );
        db.execute(
            "UPDATE mt5_connections SET status='connected',generation=2 WHERE connection_id=$1",
            &[&id],
        )
        .await
        .unwrap();
        assert!(
            state
                .mt5_tools
                .read(&state, &a, id, "symbols", &Default::default())
                .await
                .is_err()
        );
        pool.close();
        drop(db);
        task.abort();
    }

    #[tokio::test]
    #[ignore = "requires explicit read-only native MT5 configuration and account identity"]
    async fn native_mt5_read_smoke() {
        assert_eq!(
            std::env::var("TW_MT5_MCP_NATIVE_READ_SMOKE").as_deref(),
            Ok("1")
        );
        let tools = Mt5Tools::from_environment().unwrap();
        assert_eq!(tools.bindings.len(), 1);
        let b = &tools.bindings[0];
        let identity = ReadBinding {
            generation: b.generation,
            login: std::env::var("TW_MT5_MCP_TEST_LOGIN").unwrap(),
            server: std::env::var("TW_MT5_MCP_TEST_SERVER").unwrap(),
        };
        let key = std::env::var(&b.key_env).unwrap();
        let result = tokio::time::timeout(
            MCP_BUDGET,
            tools.payload(
                b,
                &identity,
                "indicators",
                json!({"indicator_type":"standard"}),
                &key,
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(result["items"].as_array().is_some_and(|v| !v.is_empty()));
        println!(
            "native MT5 official SDK read succeeded; standard indicators={}",
            result["items"].as_array().unwrap().len()
        );
    }
}
