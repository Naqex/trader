//! Source-local provider projections. Configured adapters and executor ownership
//! are separate: cached metadata never grants permission to start a provider.
use crate::{
    auth::{ApiError, Workspace},
    state::AppState,
};
use axum::{
    Json, Router,
    extract::{Extension, MatchedPath, OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

pub mod catalog;
mod catalog_refresh;
pub mod execution;
pub mod dependencies;
pub mod lifecycle;

#[derive(Clone, Debug)]
pub enum DownloadEngine {
    None,
    Qdm {
        home: PathBuf,
    },
    Dukascopy {
        metadata: Value,
        adapter_present: bool,
    },
}

pub struct ProviderRuntime {
    pub(crate) root: PathBuf,
    pub(crate) engine: DownloadEngine,
    pub(crate) catalog: RwLock<catalog::Catalog>,
    pub(crate) worker: std::sync::atomic::AtomicBool,
    pub(crate) wake: tokio::sync::Notify,
    catalog_refresh: tokio::sync::Mutex<()>,
}

impl ProviderRuntime {
    pub fn worker_ready(&self) -> bool {
        matches!(self.engine, DownloadEngine::None) || self.worker.load(std::sync::atomic::Ordering::Acquire)
    }
    pub fn from_environment(root: &std::path::Path) -> Result<Arc<Self>, String> {
        let engine = match std::env::var("TW_V2_DOWNLOAD_ENGINE")
            .unwrap_or_else(|_| "none".into())
            .as_str()
        {
            "none" => DownloadEngine::None,
            "qdm" => DownloadEngine::Qdm {
                home: std::env::var_os("TW_V2_QDM_HOME")
                    .map(PathBuf::from)
                    .ok_or("TW_V2_QDM_HOME required for QDM")?,
            },
            "dukascopy" => {
                let path = std::env::var_os("TW_V2_DUKASCOPY_METADATA_PATH")
                    .map(PathBuf::from)
                    .ok_or("TW_V2_DUKASCOPY_METADATA_PATH required")?;
                use std::io::Read;
                let file=std::fs::File::open(path).map_err(|_|"cannot read pinned Dukascopy metadata")?;
                if file.metadata().map_err(|_|"cannot read pinned Dukascopy metadata")?.len()>4*1024*1024{
                    return Err("Dukascopy metadata exceeds bound".into());
                }
                let mut bytes=Vec::new();
                file.take(4*1024*1024+1).read_to_end(&mut bytes).map_err(|_|"cannot read pinned Dukascopy metadata")?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("Dukascopy metadata exceeds bound".into());
                }
                DownloadEngine::Dukascopy {
                    metadata: serde_json::from_slice(&bytes)
                        .map_err(|_| "invalid Dukascopy metadata")?,
                    adapter_present: true,
                }
            }
            _ => return Err("unsupported TW_V2_DOWNLOAD_ENGINE".into()),
        };
        Self::load(root.to_path_buf(), engine)
    }
    /// Reads bounded metadata only; never starts an executable or accesses network.
    pub fn load(root: PathBuf, engine: DownloadEngine) -> Result<Arc<Self>, String> {
        let catalog = catalog::Catalog::load(&root, &engine)?;
        Ok(Arc::new(Self {
            root,
            engine,
            catalog: RwLock::new(catalog),
            worker: std::sync::atomic::AtomicBool::new(false),
            wake: tokio::sync::Notify::new(),
            catalog_refresh: tokio::sync::Mutex::new(()),
        }))
    }
    pub fn capabilities(&self) -> Value {
        self.catalog
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .capabilities()
    }
    pub fn download_state(&self) -> Value {
        self.catalog
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .availability(&self.engine)
    }
    pub fn catalog_state(&self) -> Value {
        self.catalog
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .status(&self.engine)
    }
    pub fn instruments(&self) -> Vec<Value> {
        self.catalog
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .instruments()
    }
    pub fn refresh_local(&self) -> Result<(), String> {
        let mut state = self
            .catalog
            .write()
            .map_err(|_| "catalog_state_unavailable")?;
        state.refresh_local(&self.root, &self.engine)
    }
}

pub fn configured_download_routes(
    runtime: Arc<ProviderRuntime>,
) -> Result<Router<Arc<AppState>>, String> {
    if matches!(runtime.engine, DownloadEngine::None) {
        return Err("download_adapter_not_configured".into());
    }
    Ok(Router::new()
        .route("/api/v2/data/downloads", post(lifecycle::invoke))
        .route("/api/v2/data/downloads/full", post(lifecycle::invoke))
        .route(
            "/api/v2/data/downloads/{job_id}/resume",
            post(lifecycle::invoke),
        )
        .route(
            "/api/v2/data/downloads/{job_id}/pause",
            post(lifecycle::invoke),
        )
        .route(
            "/api/v2/data/downloads/{job_id}/cancel",
            post(lifecycle::invoke),
        )
        .layer(Extension(runtime)))
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/data/datasets", get(datasets))
        .route("/api/v2/data/providers", get(providers))
        .route("/api/v2/data/downloads", get(downloads))
}

pub fn native(method: &str, path: &str) -> bool {
    method == "GET"
        && matches!(
            path,
            "/api/v2/data/datasets" | "/api/v2/data/providers" | "/api/v2/data/downloads"
        )
}

/// These routes are owned only by the explicitly selected native runtime.
pub fn native_profile(method: &str, path: &str) -> bool {
    native(method, path) || match method {
        "GET" => matches!(path, "/api/v2/data/market-assets" | "/api/v2/live/status"),
        "POST" => matches!(path, "/api/v2/data/market-assets/update" | "/api/v2/data/catalog/refresh"
            | "/api/v2/data/downloads" | "/api/v2/data/downloads/full"
            | "/api/v2/data/downloads/{job_id}/resume" | "/api/v2/data/downloads/{job_id}/pause"
            | "/api/v2/data/downloads/{job_id}/cancel"),
        _ => false,
    }
}

pub fn runtime_routes(runtime: Arc<ProviderRuntime>) -> Result<Router<Arc<AppState>>, String> {
    let routes = absent_market_routes();
    if matches!(runtime.engine, DownloadEngine::None) {
        Ok(routes.merge(absent_download_routes(runtime)?))
    } else {
        Ok(routes.merge(configured_download_routes(runtime.clone())?).merge(catalog_refresh_routes(runtime)?))
    }
}

/// Explicit runtime config is required. The queued compatibility router retains
/// download writes until a native executor has a verified ownership protocol.
pub fn routes_with_runtime(runtime: Arc<ProviderRuntime>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/data/datasets", get(datasets))
        .route("/api/v2/data/providers", get(providers))
        .route("/api/v2/data/downloads", get(downloads))
        .layer(Extension(runtime))
}

/// Install only when the supervisor explicitly has no market SDK factory.
/// A configured market adapter must retain its actual owner and scoped reads.
pub fn absent_market_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v2/data/market-assets", get(absent_market))
        .route("/api/v2/live/status", get(absent_live))
        .route("/api/v2/data/market-assets/update", post(inactive_write))
}

pub fn absent_download_routes(
    runtime: Arc<ProviderRuntime>,
) -> Result<Router<Arc<AppState>>, String> {
    if !matches!(runtime.engine, DownloadEngine::None) {
        return Err("configured_download_adapter_requires_executor_routes".into());
    }
    Ok(Router::new()
        .route("/api/v2/data/catalog/refresh", post(inactive_write))
        .route("/api/v2/data/downloads", post(inactive_write))
        .route("/api/v2/data/downloads/full", post(inactive_write))
        .route(
            "/api/v2/data/downloads/{job_id}/resume",
            post(inactive_write),
        )
        .route(
            "/api/v2/data/downloads/{job_id}/pause",
            post(inactive_write),
        )
        .route(
            "/api/v2/data/downloads/{job_id}/cancel",
            post(inactive_write),
        ))
}

pub fn qdm_refresh_routes(runtime: Arc<ProviderRuntime>) -> Result<Router<Arc<AppState>>, String> {
    if !matches!(runtime.engine, DownloadEngine::Qdm { .. }) {
        return Err("qdm_catalog_refresh_requires_qdm_configuration".into());
    }
    catalog_refresh_routes(runtime)
}

pub fn catalog_refresh_routes(runtime: Arc<ProviderRuntime>) -> Result<Router<Arc<AppState>>, String> {
    if matches!(runtime.engine, DownloadEngine::None) {
        return Err("instrument_catalog_not_configured".into());
    }
    Ok(Router::new()
        .route("/api/v2/data/catalog/refresh", post(qdm_refresh))
        .layer(Extension(runtime)))
}

async fn qdm_refresh(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    runtime: Option<Extension<Arc<ProviderRuntime>>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let runtime = runtime
        .map(|v| v.0)
        .unwrap_or_else(|| state.providers.clone());
    // Wait for bounded refresh capacity before reserving a database connection.
    let permit = state.artifact_reads.clone().acquire_owned().await.map_err(|_| ApiError::database())?;
    let mut connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = connection
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    // The bounded network call can outlast the default 15s idle transaction budget.
    tx.query_one("SELECT set_config('idle_in_transaction_session_timeout',$1,true)",
        &[&state.config.request_timeout.as_millis().to_string()]).await.map_err(|_|ApiError::database())?;
    let receipt = match crate::native_mutation::begin(
        &tx,
        &scope,
        "POST",
        uri.path(),
        uri.query(),
        &headers,
        &Value::Null,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(response) => return Ok(response),
        crate::native_mutation::MutationStart::New(receipt) => receipt,
    };
    let _permit = permit;
    let refreshed = if matches!(runtime.engine, DownloadEngine::Dukascopy { .. }) {
        catalog_refresh::refresh(runtime.clone()).await
    } else {
        let runtime = runtime.clone();
        tokio::task::spawn_blocking(move || runtime.refresh_local())
            .await.map_err(|_|ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"catalog_read_failed"))?
    };
    let result = refreshed.and_then(|()| {
        let catalog = runtime.catalog.read().map_err(|_|"catalog_state_unavailable".to_owned())?;
        Ok(json!({"catalog_items":catalog.instruments(),"catalog_state":catalog.status(&runtime.engine),"download_state":catalog.availability(&runtime.engine)}))
    });
    let (status, value) = match result {
        Ok(value) => (StatusCode::OK, value),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"detail":"catalog_read_failed"}),
        ),
    };
    let response = crate::native_mutation::finish(&tx, receipt, status, value).await?;
    crate::native_mutation::commit(tx, response).await
}

async fn absent_market(_scope: Workspace) -> Json<Value> {
    Json(json!({"status":"unavailable","items":[],"execution_capability":false}))
}
async fn absent_live(_scope: Workspace) -> Json<Value> {
    Json(json!({"status":"unavailable","execution_capability":false}))
}

async fn inactive_write(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    matched: MatchedPath,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Result<Response, ApiError> {
    let raw = body.map(|v| v.0).unwrap_or(Value::Null);
    let handler = match matched.as_str() {
        "/api/v2/data/downloads" => Some("request_offline_download"),
        "/api/v2/data/downloads/full" => Some("request_full_offline_download"),
        "/api/v2/data/market-assets/update" => Some("update_market_assets"),
        _ => None,
    };
    if let Some(handler) = handler {
        crate::native_contracts::validate_body(handler, raw.clone())?;
    }
    let detail = match matched.as_str() {
        "/api/v2/data/catalog/refresh" => "instrument_catalog_not_configured",
        "/api/v2/data/market-assets/update" => "market_sync_not_configured",
        _ => "worker_unavailable",
    };
    let mut connection = state.pool.get().await.map_err(|_| ApiError::database())?;
    let tx = connection
        .transaction()
        .await
        .map_err(|_| ApiError::database())?;
    let receipt = match crate::native_mutation::begin(
        &tx,
        &scope,
        "POST",
        uri.path(),
        uri.query(),
        &headers,
        &raw,
    )
    .await?
    {
        crate::native_mutation::MutationStart::Replay(response) => return Ok(response),
        crate::native_mutation::MutationStart::New(receipt) => receipt,
    };
    let response = crate::native_mutation::finish(
        &tx,
        receipt,
        StatusCode::SERVICE_UNAVAILABLE,
        json!({"detail":detail}),
    )
    .await?;
    crate::native_mutation::commit(tx, response).await
}

async fn providers(
    State(state): State<Arc<AppState>>,
    _scope: Workspace,
    runtime: Option<Extension<Arc<ProviderRuntime>>>,
) -> Json<Value> {
    let runtime = runtime
        .map(|v| v.0)
        .unwrap_or_else(|| state.providers.clone());
    Json(json!({"items":runtime.capabilities()}))
}

async fn downloads(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    runtime: Option<Extension<Arc<ProviderRuntime>>>,
) -> Result<Json<Value>, ApiError> {
    let runtime = runtime
        .map(|v| v.0)
        .unwrap_or_else(|| state.providers.clone());
    let provider = match runtime.engine {
        DownloadEngine::None => return Ok(Json(json!({"available":false,"items":[]}))),
        DownloadEngine::Qdm { .. } => "QuantDataManager",
        DownloadEngine::Dukascopy { .. } => "Dukascopy",
    };
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let rows=client.query("SELECT snapshot FROM download_job_snapshots WHERE workspace_id=$1 AND provider=$2 ORDER BY created_at_utc DESC,job_id DESC LIMIT 20", &[&scope.workspace_id,&provider]).await.map_err(|_|ApiError::database())?;
    let items = rows
        .iter()
        .map(|r| r.get::<_, Value>(0))
        .collect::<Vec<_>>();
    let qdm = provider == "QuantDataManager";
    let mut out = json!({"available":runtime.download_state()["available"],"supports_pause":!qdm,"items":items});
    if qdm {
        out["supports_cancel"] = json!(false);
    }
    Ok(Json(out))
}

async fn datasets(
    State(state): State<Arc<AppState>>,
    scope: Workspace,
    runtime: Option<Extension<Arc<ProviderRuntime>>>,
) -> Result<Json<Value>, ApiError> {
    let runtime = runtime
        .map(|v| v.0)
        .unwrap_or_else(|| state.providers.clone());
    let client = state.pool.get().await.map_err(|_| ApiError::database())?;
    let manifests=client.query("SELECT manifest_json FROM datasets WHERE workspace_id=$1 ORDER BY created_at_utc DESC,dataset_id", &[&scope.workspace_id]).await.map_err(|_|ApiError::database())?.iter().map(|r|r.get::<_,Value>(0)).collect::<Vec<_>>();
    drop(client);
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ApiError::database())?;
    let projected=tokio::task::spawn_blocking(move || {
        let _permit=permit;
        let source=runtime.catalog.read().map_err(|_|"catalog_state_unavailable".to_owned())?;
        let instruments=source.instruments();
        let items=manifests.iter().map(|manifest|source.dataset(&runtime.root,&runtime.engine,&scope.workspace_id,manifest)).collect::<Result<Vec<_>,String>>()?;
        Ok::<_,String>(json!({"items":items,"catalog_items":instruments,"holdout_access":false,"catalog_state":source.status(&runtime.engine),"download_state":source.availability(&runtime.engine)}))
    }).await.map_err(|_|ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,"catalog_read_failed"))?.map_err(|e|ApiError::detail(StatusCode::SERVICE_UNAVAILABLE,&e))?;
    Ok(Json(projected))
}
