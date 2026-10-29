use crate::{auth::LocalAuthorization, config::Config, telemetry::Telemetry};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod, Runtime, Timeouts};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, atomic::AtomicBool},
    time::Instant,
};
use tokio::sync::Semaphore;
use tokio_postgres::{NoTls, config::Host};

pub struct AppState {
    pub config: Config,
    pub pool: Pool,
    pub authorization: LocalAuthorization,
    pub telemetry: Telemetry,
    pub admission: Arc<Semaphore>,
    pub artifact_reads: Arc<Semaphore>,
    pub artifact_data: Arc<crate::artifact_data::ArtifactData>,
    pub analytics_cache: crate::analytics::ProjectionCache,
    pub replay_history: crate::replay_service::history::HistoryCache,
    pub notion_oauth: Arc<crate::notion_oauth::NotionOAuthService>,
    pub ai_assistant: Arc<crate::ai_assistant::AiAssistant>,
    pub ai_runs: Arc<crate::ai_runs::Engine>,
    pub mt5_tools: crate::ai_mt5_tools::Mt5Tools,
    pub providers: Arc<crate::provider_routes::ProviderRuntime>,
    pub event_hub: crate::events::EventHub,
    pub(crate) market_hub: crate::demo_trading::market_stream::MarketHub,
    pub draining: AtomicBool,
    pub rate_windows: Mutex<HashMap<String, (Instant, u32)>>,
    pub openapi_schema: Option<serde_json::Value>,
    pub native_runtime: bool,
}
impl AppState {
    pub async fn connect(config: Config) -> Result<Arc<Self>, String> {
        let native_runtime = match std::env::var("TW_V2_RUNTIME_PROFILE").as_deref() {
            Err(std::env::VarError::NotPresent) | Ok("compatibility") => false,
            Ok("native") => true,
            _ => return Err("unsupported TW_V2_RUNTIME_PROFILE".into()),
        };
        let mut database: tokio_postgres::Config = config
            .database_url
            .parse()
            .map_err(|_| "invalid database configuration")?;
        // NoTls is deliberately local-only; do not silently downgrade a hosted DB connection.
        if !local_database(&database) {
            return Err("Rust database connector currently requires loopback PostgreSQL; remote TLS connector not configured".into());
        }
        // Server-side deadlines continue to bound SQL even if an HTTP future is dropped.
        let options = database.get_options().unwrap_or_default();
        let statement_ms = config.request_timeout.as_millis().min(15000);
        database.options(format!("{options} -c statement_timeout={statement_ms} -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000"));
        let pool = Pool::builder(Manager::from_config(
            database,
            NoTls,
            ManagerConfig {
                recycling_method: RecyclingMethod::Verified,
            },
        ))
        .max_size(config.pool_size)
        .runtime(Runtime::Tokio1)
        .timeouts(Timeouts {
            wait: Some(config.pool_timeout),
            create: Some(config.pool_timeout),
            recycle: Some(config.pool_timeout),
        })
        .build()
        .map_err(|_| "cannot build PostgreSQL pool")?;
        if let Err(error) = tokio::time::timeout(config.pool_timeout, verify_migrations(&pool))
            .await
            .map_err(|_| "database schema verification timed out".to_owned())
            .and_then(|result| result)
        {
            pool.close();
            return Err(error);
        }
        let workspaces = if let Some(workspaces) = &config.local_workspaces {
            workspaces.clone()
        } else {
            let client = pool
                .get()
                .await
                .map_err(|_| "database unavailable during identity initialization")?;
            client.query("SELECT workspace_id FROM workspaces", &[]).await.map_err(|_| "cannot read server-owned workspace membership; initialize schema before startup")?
                .iter().map(|r| r.get::<_,String>(0)).collect()
        };
        let openapi_schema = std::fs::read(&config.openapi_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let ai_assistant = Arc::new(crate::ai_assistant::AiAssistant::from_environment()?);
        let ai_runs = crate::ai_runs::Engine::new(pool.clone(), ai_assistant.clone());
        Ok(Arc::new(Self {
            providers: crate::provider_routes::ProviderRuntime::from_environment(
                &config.artifact_root,
            )?,
            notion_oauth: Arc::new(crate::notion_oauth::NotionOAuthService::from_environment()?),
            ai_assistant,
            ai_runs,
            mt5_tools: crate::ai_mt5_tools::Mt5Tools::from_environment()?,
            artifact_data: Arc::new(crate::artifact_data::ArtifactData::new(
                &config.artifact_root,
            )?),
            analytics_cache: Default::default(),
            replay_history: Default::default(),
            authorization: LocalAuthorization::new(config.local_identity.clone(), workspaces),
            admission: Arc::new(Semaphore::new(config.max_concurrency)),
            artifact_reads: Arc::new(Semaphore::new(2)),
            event_hub: crate::events::EventHub::default(),
            market_hub: crate::demo_trading::market_stream::MarketHub::default(),
            telemetry: Telemetry::default(),
            draining: AtomicBool::new(false),
            rate_windows: Mutex::new(HashMap::new()),
            openapi_schema,
            native_runtime,
            pool,
            config,
        }))
    }
}

async fn verify_migrations(pool: &Pool) -> Result<(), String> {
    let client = pool
        .get()
        .await
        .map_err(|_| "database unavailable during schema verification")?;
    let rows = client
        .query(
            "SELECT version,sha256 FROM tw_schema_migrations ORDER BY version",
            &[],
        )
        .await
        .map_err(
            |_| "database schema migration ledger unavailable; initialize schema before startup",
        )?;
    let mut recorded = HashMap::new();
    for row in rows {
        let version: String = row
            .try_get("version")
            .map_err(|_| "database migration ledger invalid")?;
        let digest: String = row
            .try_get("sha256")
            .map_err(|_| "database migration ledger invalid")?;
        recorded.insert(version, digest);
    }
    crate::rust_runtime::validate_recorded(&recorded, true).map(|_| ())
}

fn local_database(database: &tokio_postgres::Config) -> bool {
    !database.get_hosts().is_empty()
        && database.get_hosts().iter().all(|host| matches!(host, Host::Tcp(value) if value == "localhost" || value.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())))
        && database.get_hostaddrs().iter().all(std::net::IpAddr::is_loopback)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_tls_cannot_connect_to_remote_hostaddr() {
        for dsn in [
            "host=127.0.0.1",
            "host=localhost hostaddr=127.0.0.1",
            "host=::1",
        ] {
            assert!(local_database(&dsn.parse().unwrap()));
        }
        for dsn in [
            "host=localhost hostaddr=192.0.2.1",
            "host=192.0.2.1",
            "host=localhost,192.0.2.1",
            "user=owner",
        ] {
            assert!(!local_database(&dsn.parse().unwrap()));
        }
    }
}
