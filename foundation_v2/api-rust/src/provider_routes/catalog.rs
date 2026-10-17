use super::DownloadEngine;
use chrono::{DateTime, NaiveDate, SecondsFormat, TimeZone, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub(super) const LIMIT: u64 = 2 * 1024 * 1024;
pub(super) const ENDPOINT: &str = "https://jetta.dukascopy.com/v1/instruments";

// The public cache predates the compact AI protocol encoder and freezes
// json.dumps(sort_keys=True)'s spaces as part of its identity.
pub(super) fn cache_json(value: &Value, out: &mut String) {
    match value {
        Value::Array(values) => {
            out.push('[');
            for (i, value) in values.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ")
                }
                cache_json(value, out)
            }
            out.push(']')
        }
        Value::Object(values) => {
            out.push('{');
            for (i, (key, value)) in values.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ")
                }
                crate::control_routes::canonical_json(&json!(key), out, true);
                out.push_str(": ");
                cache_json(value, out)
            }
            out.push('}')
        }
        _ => crate::control_routes::canonical_json(value, out, true),
    }
}

pub struct Catalog {
    items: Vec<Value>,
    metadata: BTreeMap<String, Value>,
    hash: Option<String>,
    retrieved: Option<String>,
    error: Option<String>,
    provider_id: Option<String>,
    next_refresh: Option<std::time::Instant>,
}

fn bounded(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|_| "catalog_missing")?;
    if file.metadata().map_err(|_| "catalog_missing")?.len() > LIMIT {
        return Err("invalid_catalog".into());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "catalog_missing")?;
    if bytes.len() as u64 > LIMIT {
        return Err("invalid_catalog".into());
    }
    Ok(bytes)
}

fn decode_qdm(bytes: &[u8]) -> Result<String, String> {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.strip_prefix('\u{feff}').unwrap_or(text).into());
    }
    if bytes
        .iter()
        .any(|b| [0x81, 0x8d, 0x8f, 0x90, 0x9d].contains(b))
    {
        return Err("invalid_catalog".into());
    }
    const CP: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    Ok(bytes
        .iter()
        .map(|b| {
            if (128..160).contains(b) {
                CP[(*b - 128) as usize]
            } else {
                char::from(*b)
            }
        })
        .collect())
}

pub fn parse_qdm(bytes: &[u8]) -> Result<Vec<(String, Value)>, String> {
    let text = decode_qdm(bytes)?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(b';')
        .from_reader(text.as_bytes());
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for row in reader.records() {
        let row = row.map_err(|_| "invalid_catalog")?;
        if row.iter().all(|v| v.trim().is_empty()) {
            continue;
        }
        if row.len() != 12 {
            return Err("invalid_catalog".into());
        }
        let fields = row.iter().take(6).map(str::trim).collect::<Vec<_>>();
        let (code, name, category, group) = (fields[0], fields[1], fields[2], fields[3]);
        if code.is_empty()
            || !code
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
            || name.is_empty()
        {
            return Err("invalid_catalog".into());
        }
        let date = |s: &str| {
            NaiveDate::parse_from_str(s, "%d.%m.%Y")
                .map(|v| v.to_string())
                .map_err(|_| "invalid_catalog".to_owned())
        };
        let ticks = date(fields[4])?;
        let minutes = date(fields[5])?;
        let class = match (category, group) {
            ("Forex", "Metals") => "metal",
            ("Forex", _) => "fx",
            ("Stocks", _) => "stock",
            ("Indices", _) => "index",
            ("Crypto", _) => "crypto",
            ("Bond", _) => "bond",
            ("Commodities", "Energy") => "energy",
            ("Commodities", "Metals") => "metal",
            ("Commodities", "Soft") => "agriculture",
            _ => return Err("invalid_catalog".into()),
        };
        let symbol = if category == "Forex" && code.len() == 6 {
            format!("{}/{}", &code[..3], &code[3..])
        } else {
            code.into()
        };
        if !seen.insert(symbol.clone()) {
            return Err("invalid_catalog".into());
        }
        items.push((symbol,json!({"code":code,"name":name,"asset_class":class,"source_category":category,"source_group":group,"startDayForMinuteCandles":minutes,"startDayForTicks":ticks})));
    }
    if items.is_empty() {
        return Err("invalid_catalog".into());
    }
    Ok(items)
}

pub fn normalize_dukascopy(payload: &Value) -> Result<Vec<Value>, String> {
    let invalid = || "invalid_catalog".to_owned();
    let instruments = payload["instruments"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 10000)
        .ok_or_else(invalid)?;
    let groups = payload["groups"]
        .as_array()
        .filter(|a| a.len() <= 1000)
        .ok_or_else(invalid)?;
    let mut index = BTreeMap::new();
    for group in groups {
        let id = group["id"].as_i64().ok_or_else(invalid)?;
        if !group["code"].is_string()
            || (!group["parentId"].is_null() && group["parentId"].as_i64().is_none())
            || index.insert(id, group).is_some()
        {
            return Err(invalid());
        }
    }
    let (mut seen, mut codes, mut result) = (HashSet::new(), HashSet::new(), Vec::new());
    for item in instruments {
        let name = item["name"]
            .as_str()
            .ok_or_else(invalid)?
            .trim()
            .to_uppercase();
        let code = item["code"].as_str().ok_or_else(invalid)?.trim();
        let valid = |s: &str, slash: bool| {
            !s.is_empty()
                && s.len() <= 80
                && s.as_bytes()[0].is_ascii_alphanumeric()
                && s.bytes().all(|b| {
                    b.is_ascii_alphanumeric() || b"._+-".contains(&b) || (slash && b == b'/')
                })
        };
        if !valid(&name, true)
            || !valid(code, false)
            || !seen.insert(name.clone())
            || !codes.insert(code.to_owned())
        {
            return Err(invalid());
        }
        let pip = item["pipValue"]
            .as_f64()
            .filter(|n| n.is_finite() && *n > 0.)
            .ok_or_else(invalid)?;
        if !item["priceScale"].is_null()
            && !item["priceScale"]
                .as_i64()
                .is_some_and(|n| (0..=12).contains(&n))
        {
            return Err(invalid());
        }
        let group_id = item.get("groupId").cloned().unwrap_or(Value::Null);
        if !group_id.is_null() && group_id.as_i64().is_none() {
            return Err(invalid());
        }
        let group = group_id.as_i64().and_then(|id| index.get(&id).copied());
        let (mut cursor, mut visited, mut class) = (group, HashSet::new(), "");
        while let Some(current) = cursor {
            if !visited.insert(current["id"].as_i64().ok_or_else(invalid)?) {
                return Err(invalid());
            }
            if class.is_empty() {
                class = match current["code"].as_str().unwrap_or("") {
                    "FX" => "fx",
                    "FX_METALS" | "CMD_METALS" => "metal",
                    "CMD_ENERGY" => "energy",
                    "CMD_AGRICULTURAL" => "agriculture",
                    "IDX" => "index",
                    "STCK_CFD" => "stock",
                    "ETF_CFD" => "etf",
                    "BND_CFD" => "bond",
                    "VCCY" => "crypto",
                    "CMD" => "commodity",
                    _ => "",
                }
            }
            cursor = current["parentId"]
                .as_i64()
                .and_then(|id| index.get(&id).copied());
        }
        let description = item["description"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(&name)
            .chars()
            .take(240)
            .collect::<String>();
        let _ = pip;
        result.push(json!({"instrument_id":name,"provider_code":code,"pip_value":item["pipValue"],"price_scale":item.get("priceScale").unwrap_or(&Value::Null),"name":description,"provider":"Dukascopy","provider_id":"dukascopy-catalog","asset_class":class,"provider_group_id":group_id,"provider_group":group.map(|g|g["code"].clone()).unwrap_or(json!(""))}));
    }
    result.sort_by(|a, b| {
        a["instrument_id"]
            .as_str()
            .cmp(&b["instrument_id"].as_str())
    });
    Ok(result)
}

impl Catalog {
    pub fn metadata_for(&self, symbol: &str) -> Option<Value> {
        self.metadata.get(symbol).cloned()
    }
    pub fn load(root: &Path, engine: &DownloadEngine) -> Result<Self, String> {
        let mut catalog = Self {
            items: vec![],
            metadata: BTreeMap::new(),
            hash: None,
            retrieved: None,
            error: None,
            next_refresh: None,
            provider_id: match engine {
                DownloadEngine::None => None,
                DownloadEngine::Qdm { .. } => Some("qdm-catalog".into()),
                DownloadEngine::Dukascopy { .. } => Some("dukascopy-catalog".into()),
            },
        };
        match engine {
            DownloadEngine::None => (),
            DownloadEngine::Qdm { .. } => {
                catalog.refresh_local(root, engine)?;
            }
            DownloadEngine::Dukascopy { metadata, .. } => {
                if metadata["version"] != json!("1.50.0") {
                    return Err("unsupported_dukascopy_adapter_metadata".into());
                }
                for item in metadata["items"]
                    .as_array()
                    .ok_or("invalid_dukascopy_adapter_metadata")?
                {
                    if item["startDayForMinuteCandles"]
                        .as_str()
                        .is_some_and(|s| !s.is_empty())
                    {
                        let symbol = item["name"]
                            .as_str()
                            .ok_or("invalid_dukascopy_adapter_metadata")?
                            .to_uppercase();
                        if catalog.metadata.insert(symbol, item.clone()).is_some() {
                            return Err("invalid_dukascopy_adapter_metadata".into());
                        }
                    }
                }
                let path = root.join("catalog/dukascopy-instruments.json");
                if path.exists() {
                    match catalog.load_dukascopy(&path) {
                        Ok(()) => (),
                        Err(_) => catalog.error = Some("invalid_cache".into()),
                    }
                }
            }
        }
        Ok(catalog)
    }
    fn load_dukascopy(&mut self, path: &Path) -> Result<(), String> {
        let snapshot: Value =
            serde_json::from_slice(&bounded(path)?).map_err(|_| "invalid_cache")?;
        if snapshot["version"] != json!(2) || snapshot["source"] != json!(ENDPOINT) {
            return Err("invalid_cache".into());
        }
        let items = normalize_dukascopy(&snapshot["raw_catalog"])?;
        let retrieved = snapshot["retrieved_at_utc"]
            .as_str()
            .ok_or("invalid_cache")?;
        let date = DateTime::parse_from_rfc3339(retrieved).map_err(|_| "invalid_cache")?;
        if date.timestamp() > Utc::now().timestamp() + 300 {
            return Err("invalid_cache".into());
        }
        let mut encoded = String::new();
        cache_json(&json!(items), &mut encoded);
        let hash = format!("{:x}", Sha256::digest(encoded.as_bytes()));
        if snapshot["sha256"] != json!(hash) {
            return Err("invalid_cache".into());
        }
        self.items = items;
        self.hash = Some(hash);
        self.retrieved = Some(retrieved.into());
        Ok(())
    }
    pub fn refresh_local(&mut self, _root: &Path, engine: &DownloadEngine) -> Result<(), String> {
        let DownloadEngine::Qdm { home } = engine else {
            return Err("catalog_refresh_requires_authorized_network_adapter".into());
        };
        let raw = match bounded(&home.join("internal/plugins/DataSourceDukascopy/dukascopy.csv")) {
            Ok(v) => v,
            Err(e) => {
                self.error = Some(
                    if e == "catalog_missing" {
                        "qdm_catalog_missing"
                    } else {
                        "qdm_catalog_invalid"
                    }
                    .into(),
                );
                return Ok(());
            }
        };
        match parse_qdm(&raw) {
            Ok(meta) => {
                self.metadata = meta.iter().cloned().collect();
                self.hash = Some(format!("{:x}", Sha256::digest(&raw)));
                self.retrieved = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Micros, false));
                self.error = None;
                self.items=meta.iter().map(|(symbol,item)|json!({"instrument_id":symbol,"provider_code":item["code"],"provider":"QuantDataManager","data_source":"Dukascopy","download_engine":"QuantDataManager","provider_id":"qdm-catalog","asset_class":item["asset_class"],"name":item["name"],"source_category":item["source_category"],"source_group":item["source_group"],"available_from_date":item["startDayForMinuteCandles"],"tick_available_from_date":item["startDayForTicks"]})).collect();
            }
            Err(_) => self.error = Some("qdm_catalog_invalid".into()),
        }
        Ok(())
    }
    pub fn instruments(&self) -> Vec<Value> {
        self.items.clone()
    }
    pub(super) fn begin_refresh(&mut self) -> bool {
        if self.next_refresh.is_some_and(|next| next > std::time::Instant::now()) {
            return false;
        }
        self.next_refresh = Some(std::time::Instant::now() + std::time::Duration::from_secs(60));
        // A canceled request must not leave a successful-looking refresh state.
        self.error = Some("source_unavailable".into());
        true
    }
    #[cfg(test)]
    pub(super) fn next_refresh_for_test(&mut self) {
        self.next_refresh = None;
    }
    pub(super) fn refresh_error(&mut self, error: &str) {
        self.error = Some(error.into());
        if error == "rate_limited" {
            self.next_refresh = Some(std::time::Instant::now() + std::time::Duration::from_secs(300));
        }
    }
    pub(super) fn refreshed(&mut self, snapshot: &Value, items: Vec<Value>) {
        self.items = items;
        self.hash = snapshot["sha256"].as_str().map(str::to_owned);
        self.retrieved = snapshot["retrieved_at_utc"].as_str().map(str::to_owned);
        self.error = None;
    }
    pub fn capabilities(&self) -> Value {
        let capabilities = json!({"read_metadata":true,"read_history":false,"import":false,"news":false,"fresh_quote":false,"holdout_content":false});
        let local = json!({"provider_id":"local-catalog","capabilities":capabilities,"readiness":{"source_kind":"local_catalog","connection_mode":"offline_local","network_access":false,"oauth_required":false,"entitlement_status":"dataset_metadata_only","production_ready":false}});
        let provider = self.provider_id.as_deref();
        // Empty configured catalogs still advertise their metadata provider.
        match provider {
            Some(id) => {
                let qdm = id == "qdm-catalog";
                let extra = json!({"provider_id":id,"capabilities":capabilities,"readiness":{"source_kind":"provider_metadata","connection_mode":if qdm{"local_cli"}else{"cached_metadata"},"network_access":true,"oauth_required":false,"entitlement_status":if qdm{"local_license_required"}else{"metadata_only"},"production_ready":false}});
                if qdm {
                    json!([local, extra])
                } else {
                    json!([extra, local])
                }
            }
            None => json!([local]),
        }
    }
    pub fn status(&self, engine: &DownloadEngine) -> Value {
        match engine {
            DownloadEngine::None => Value::Null,
            DownloadEngine::Qdm { home } => {
                let configured = home.join("qdmcli.exe").is_file();
                json!({"provider":"QuantDataManager","data_source":"Dukascopy","download_engine":"QuantDataManager","integration":"cli","status":if self.items.is_empty(){"unavailable"}else{"cached"},"configured":configured,"refresh_available":configured,"stale":self.error.is_some()&&!self.items.is_empty(),"error":self.error,"version":null,"pilot":false,"asset_count":self.items.len(),"upstream_provider":"Dukascopy","refresh_scope":"installed_definitions","source_sha256":self.hash,"retrieved_at_utc":self.retrieved})
            }
            DownloadEngine::Dukascopy { .. } => {
                let wait = self.next_refresh.map(|next| next.saturating_duration_since(std::time::Instant::now()));
                let available = wait.is_none_or(|wait| wait.is_zero());
                let retry = wait.map(|wait| if wait.is_zero() { 0 } else { wait.as_secs() + 1 }).unwrap_or(1);
                json!({"provider_id":"dukascopy-catalog","configured":true,"status":if self.items.is_empty(){"empty"}else{"cached"},"retrieved_at_utc":self.retrieved,"item_count":self.items.len(),"stale":self.retrieved.as_ref().and_then(|s|DateTime::parse_from_rfc3339(s).ok()).is_some_and(|d|Utc::now().signed_duration_since(d).num_seconds()>7*86400),"error":self.error,"refresh_available":available,"retry_after_seconds":retry})
            }
        }
    }
    pub fn availability(&self, engine: &DownloadEngine) -> Value {
        if matches!(engine, DownloadEngine::None) {
            return json!({"available":false,"supported_instruments":[]});
        }
        let earliest = self
            .metadata
            .iter()
            .map(|(key, item)| {
                (
                    key.clone(),
                    json!(
                        item["startDayForMinuteCandles"]
                            .as_str()
                            .unwrap_or("")
                            .chars()
                            .take(10)
                            .collect::<String>()
                    ),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        let mut value = json!({"available":!self.metadata.is_empty(),"provider":"Dukascopy","supported_instruments":self.metadata.keys().collect::<Vec<_>>(),"earliest_dates":earliest,"timeframe":"m1","price_type":"bid","supports_full":true});
        if let DownloadEngine::Qdm { home } = engine {
            value["available"] = json!(
                !self.metadata.is_empty()
                    && home.join("qdmcli.exe").is_file()
                    && self.error.is_none()
            );
            for (k, v) in [
                ("provider", json!("QuantDataManager")),
                ("data_source", json!("Dukascopy")),
                ("download_engine", json!("QuantDataManager")),
                ("integration", json!("cli")),
                ("price_type", json!("provider_default")),
                ("supports_pause", json!(false)),
                ("supports_cancel", json!(false)),
                ("pilot", json!(false)),
                ("version", Value::Null),
                ("error", json!(self.error)),
            ] {
                value[k] = v;
            }
        }
        value
    }
    pub fn dataset(
        &self,
        root: &Path,
        engine: &DownloadEngine,
        workspace: &str,
        manifest: &Value,
    ) -> Result<Value, String> {
        if manifest["workspace_id"] != json!(workspace)
            || !manifest["dataset_id"].is_string()
            || !manifest["instrument_id"].is_string()
        {
            return Err("dataset_manifest_invalid".into());
        }
        let mut item = manifest.clone();
        let size = dataset_size(root, workspace, manifest);
        item["size_bytes"] = json!(size);
        item["artifact_available"] = json!(size.is_some_and(|v| v > 0));
        item["quality_status"] = json!(if manifest["source"]["license_use"] == json!("qa-only") {
            "fixture-only"
        } else {
            "unverified"
        });
        item["holdout_access"] = json!(false);
        item["provider_id"] = json!("local-catalog");
        if let Some(class) = self
            .items
            .iter()
            .find(|i| {
                i["provider"] == manifest["source"]["provider"]
                    && i["instrument_id"] == manifest["instrument_id"]
            })
            .map(|i| i["asset_class"].clone())
        {
            item["asset_class"] = class;
        }
        if manifest["instrument_spec"].is_null() {
            if let Some(spec) = replay_instrument(manifest) {
                item["replay_instrument_spec"] = spec;
            }
        }
        item["update_available"] = json!(false);
        let provider = match engine {
            DownloadEngine::None => return Ok(item),
            DownloadEngine::Qdm { .. } => "QuantDataManager",
            DownloadEngine::Dukascopy { .. } => "Dukascopy",
        };
        let symbol = manifest["instrument_id"].as_str().unwrap();
        if !self.metadata.contains_key(symbol)
            || !manifest["source"]["provider"]
                .as_str()
                .is_some_and(|s| s.eq_ignore_ascii_case(provider))
            || manifest["timeframe_seconds"] != json!(60)
            || manifest["holdout_policy"]
                .get("mode")
                .unwrap_or(&json!("none"))
                != &json!("none")
        {
            return Ok(item);
        }
        let settings: Value = match manifest["source"]["export_settings"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
        {
            Some(s) => s,
            None => return Ok(item),
        };
        let (library, price) = if provider == "QuantDataManager" {
            ("qdm-cli-v1", "provider_default")
        } else {
            ("dukascopy-node@1.50.0", "bid")
        };
        if settings["library"] != json!(library)
            || settings["price"] != json!(price)
            || settings["timeframe"] != json!("m1")
        {
            return Ok(item);
        }
        let date = |v: &Value| {
            v.as_str()
                .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        };
        let (Some(start), Some(end), Some(earliest)) = (
            date(&settings["requested_from"]),
            date(&settings["requested_to"]),
            date(&json!(
                self.metadata[symbol]["startDayForMinuteCandles"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(10)
                    .collect::<String>()
            )),
        ) else {
            return Ok(item);
        };
        if start > end {
            return Ok(item);
        }
        let yesterday = Utc::now()
            .date_naive()
            .pred_opt()
            .ok_or("date_out_of_range")?;
        item["update_available"] = json!(start > earliest || end < yesterday);
        item["update_from_date"] = json!(
            if start > earliest {
                earliest
            } else {
                end.succ_opt().ok_or("date_out_of_range")?
            }
            .to_string()
        );
        item["to_date"] = json!(yesterday.to_string());
        item["full_history"] = json!(start == earliest);
        item["coverage_from_date"] = json!(start.to_string());
        item["coverage_to_date"] = json!(end.to_string());
        Ok(item)
    }
}

fn safe_component(s: &str) -> bool {
    let stem = s.split('.').next().unwrap_or("").to_uppercase();
    !s.is_empty()
        && !matches!(s, "." | "..")
        && !s.ends_with(['.', ' '])
        && !s.chars().any(|c| c < ' ' || "/\\:*?\"<>|".contains(c))
        && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !(stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}
fn dataset_size(root: &Path, workspace: &str, manifest: &Value) -> Option<u64> {
    let id = manifest["dataset_id"].as_str()?;
    if !safe_component(id) || !safe_component(workspace) {
        return None;
    }
    let expected = PathBuf::from(workspace)
        .join("datasets")
        .join(format!("{id}.parquet"));
    if Path::new(manifest["artifact_path"].as_str()?) != expected {
        return None;
    }
    if let Some(raw) = manifest["raw_artifact_path"].as_str() {
        if Path::new(raw)
            != PathBuf::from(workspace)
                .join("raw")
                .join(id)
                .join("source.csv")
        {
            return None;
        }
    }
    for relative in [
        Some(expected),
        manifest["raw_artifact_path"].as_str().map(PathBuf::from),
    ]
    .into_iter()
    .flatten()
    {
        let mut current = root.to_path_buf();
        for part in relative.components() {
            current.push(part);
            match fs::symlink_metadata(&current) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        return None;
                    }
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::MetadataExt;
                        if meta.file_attributes() & 0x400 != 0 {
                            return None;
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return None,
            }
        }
    }
    let meta = fs::metadata(
        root.join(workspace)
            .join("datasets")
            .join(format!("{id}.parquet")),
    )
    .ok()?;
    meta.is_file().then_some(meta.len())
}
pub fn replay_instrument(manifest: &Value) -> Option<Value> {
    if manifest["instrument_spec"].is_object() {
        return Some(manifest["instrument_spec"].clone());
    }
    let symbol = manifest["instrument_id"].as_str()?.trim().to_uppercase();
    let compact = symbol.replace('/', "");
    if !symbol.contains('/')
        || compact.len() != 6
        || !compact.bytes().all(|b| b.is_ascii_uppercase())
    {
        return None;
    }
    let (base, quote) = (&compact[..3], &compact[3..]);
    if [base, quote]
        .iter()
        .any(|s| ["XAU", "XAG", "XPT", "XPD"].contains(s))
    {
        return None;
    }
    let effective = manifest["first_timestamp"]
        .as_i64()
        .filter(|n| *n >= 0)
        .and_then(|n| Utc.timestamp_opt(n, 0).single())
        .map(|v| v.to_rfc3339_opts(SecondsFormat::Secs, true))
        .unwrap_or_default();
    Some(
        json!({"instrument_id":symbol,"asset_class":"fx","base_ccy":base,"quote_ccy":quote,"account_ccy":quote,"tick_size":if quote=="JPY"{"0.001"}else{"0.00001"},"pip_size":if quote=="JPY"{"0.01"}else{"0.0001"},"contract_size":"100000","quantity_min":"0.01","quantity_step":"0.01","effective_from_utc":effective,"effective_to_utc":""}),
    )
}
