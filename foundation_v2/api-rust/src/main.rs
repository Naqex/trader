use std::{future::IntoFuture, sync::atomic::Ordering};
use trading_workspace_api::{config::Config, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    trading_workspace_api::telemetry::initialize();
    let config = Config::from_environment().map_err(std::io::Error::other)?;
    let state = AppState::connect(config)
        .await
        .map_err(std::io::Error::other)?;
    if !state.native_runtime {
        let client = state.pool.get().await?;
        let compact: bool = client.query_one("SELECT EXISTS(SELECT 1 FROM workspace_record_revisions WHERE storage_format <> 'full_snapshot')", &[]).await?.get(0);
        if compact {
            return Err("compatibility startup requires materializing every compact replay revision on an isolated restored target, including historical and deleted revisions".into());
        }
    }
    let domain = trading_workspace_api::runtime_domain_routes(&state).map_err(std::io::Error::other)?;
    let listener = tokio::net::TcpListener::bind(state.config.bind).await?;
    let provider = if state.native_runtime {
        let adapter = trading_workspace_api::provider_routes::execution::Adapter::from_environment(&state.providers)
            .map_err(std::io::Error::other)?;
        adapter.map(|adapter| trading_workspace_api::provider_routes::execution::start(state.clone(),state.providers.clone(),adapter))
            .transpose().map_err(std::io::Error::other)?
    } else { None };
    let app = trading_workspace_api::router(state.clone(), domain);
    let mt5 = if state.native_runtime { Some(trading_workspace_api::mt5_connector::start(state.clone())) } else { None };
    tracing::info!(bind=%state.config.bind,contract_version=trading_workspace_api::CONTRACT_VERSION,"API listening");
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(async move {
            let _ = stop_rx.await;
        })
        .into_future();
    tokio::pin!(server);
    tokio::select! {
        result=&mut server => { result?; },
        result=shutdown_signal() => {
            result?;
            state.draining.store(true,Ordering::Release);
            if let Some(provider)=&provider { provider.request_stop(); }
            let _=stop_tx.send(());
            tracing::info!("API draining");
            match tokio::time::timeout(state.config.drain_timeout,&mut server).await {
                Ok(result)=>result?,
                Err(_)=>tracing::warn!("drain deadline reached; unfinished requests will be disconnected"),
            }
        }
    }
    if let Some(provider)=provider {
        if tokio::time::timeout(state.config.drain_timeout,provider.finish()).await.is_err() {
            tracing::warn!("provider drain deadline reached; owned process tree stopped, interrupted job recovers paused");
        }
    }
    state.chatgpt_web.shutdown().await;
    if let Some(mut mt5) = mt5 {
        if tokio::time::timeout(std::time::Duration::from_secs(20), &mut mt5).await.is_err() {
            mt5.abort(); let _ = mt5.await;
        }
    }
    state.pool.close();
    Ok(())
}

async fn shutdown_signal() -> std::io::Result<()> {
    let stop_file = async {
        let Some(path) = std::env::var_os("TW_V2_SHUTDOWN_FILE") else {
            std::future::pending::<()>().await;
            return;
        };
        loop {
            if std::path::Path::new(&path).is_file() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    };
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! { result=tokio::signal::ctrl_c()=>result, _=terminate.recv()=>Ok(()), _=stop_file=>Ok(()) }
    }
    #[cfg(not(unix))]
    {
        tokio::select! { result=tokio::signal::ctrl_c()=>result, _=stop_file=>Ok(()) }
    }
}
