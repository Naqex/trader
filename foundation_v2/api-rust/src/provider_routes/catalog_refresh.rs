//! Explicit refresh only. Cached reads never trigger provider network access.
use super::{DownloadEngine, ProviderRuntime, catalog};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc, time::Duration};

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .no_gzip().no_brotli().no_deflate().no_zstd()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "source_unavailable".into())
}

async fn fetch(client: &reqwest::Client, endpoint: &str) -> Result<Value, String> {
    let mut response = client.get(endpoint).send().await.map_err(|_| "source_unavailable")?;
    match response.status().as_u16() {
        200 => (),
        429 => return Err("rate_limited".into()),
        _ => return Err("source_unavailable".into()),
    }
    if response.content_length().is_some_and(|size| size > catalog::LIMIT) {
        return Err("invalid_response".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "source_unavailable")? {
        if chunk.len() > catalog::LIMIT as usize - bytes.len() {
            return Err("invalid_response".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "invalid_response".into())
}

fn snapshot(payload: Value) -> Result<(Value, Vec<Value>), String> {
    let items = catalog::normalize_dukascopy(&payload).map_err(|_| "invalid_response")?;
    let public = json!({
        "instruments": items.iter().map(|item| json!({
            "name":item["instrument_id"], "code":item["provider_code"],
            "description":item["name"], "groupId":item["provider_group_id"],
            "pipValue":item["pip_value"], "priceScale":item["price_scale"]
        })).collect::<Vec<_>>(),
        "groups":payload["groups"].as_array().ok_or("invalid_response")?.iter()
            .map(|group|json!({"id":group["id"],"code":group["code"],"parentId":group["parentId"]}))
            .collect::<Vec<_>>()
    });
    let mut encoded = String::new();
    catalog::cache_json(&json!(items), &mut encoded);
    let value = json!({"version":2,"source":catalog::ENDPOINT,
        "retrieved_at_utc":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,false),
        "sha256":format!("{:x}",Sha256::digest(encoded.as_bytes())),"raw_catalog":public});
    if serde_json::to_vec(&value).map_err(|_| "invalid_response")?.len() as u64 > catalog::LIMIT {
        return Err("invalid_response".into());
    }
    Ok((value, items))
}

fn plain(path: &Path, directory: bool) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "cache_write_failed")?;
    if meta.file_type().is_symlink() || meta.is_dir() != directory {
        return Err("cache_write_failed".into());
    }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err("cache_write_failed".into()); }
    }
    Ok(())
}

fn publish(runtime: &ProviderRuntime, value: Value, items: Vec<Value>) -> Result<(), String> {
    let folder = runtime.root.join("catalog");
    plain(&runtime.root, true)?;
    match std::fs::create_dir(&folder) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err("cache_write_failed".into()),
    }
    plain(&folder, true)?;
    let path = folder.join("dukascopy-instruments.json");
    match std::fs::symlink_metadata(&path) {
        Ok(_) => plain(&path, false)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("cache_write_failed".into()),
    }
    let mut catalog = runtime.catalog.write().map_err(|_| "catalog_state_unavailable")?;
    super::execution::atomic_json(&path, &value).map_err(|_| "cache_write_failed")?;
    catalog.refreshed(&value, items);
    Ok(())
}

pub(super) async fn refresh(runtime: Arc<ProviderRuntime>) -> Result<(), String> {
    refresh_from(runtime, catalog::ENDPOINT, Duration::from_secs(20)).await
}

async fn refresh_from(runtime: Arc<ProviderRuntime>, endpoint: &str, deadline: Duration) -> Result<(), String> {
    if !matches!(runtime.engine, DownloadEngine::Dukascopy { .. }) {
        return Err("instrument_catalog_not_configured".into());
    }
    let Ok(_guard) = runtime.catalog_refresh.try_lock() else { return Ok(()); };
    if !runtime.catalog.write().map_err(|_| "catalog_state_unavailable")?.begin_refresh() {
        return Ok(());
    }
    let result = async {
        let payload = tokio::time::timeout(deadline, fetch(&client()?, endpoint))
            .await.map_err(|_| "source_unavailable")??;
        let (value, items) = snapshot(payload)?;
        let runtime = runtime.clone();
        tokio::task::spawn_blocking(move || publish(&runtime, value, items))
            .await.map_err(|_| "cache_write_failed")?
    }.await;
    if let Err(error) = &result {
        runtime.catalog.write().map_err(|_| "catalog_state_unavailable")?.refresh_error(error);
    }
    // Provider errors are projected into catalog_state, as in the existing API.
    Ok(())
}

#[cfg(test)]
mod tests;
