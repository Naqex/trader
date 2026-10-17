use super::*;
use crate::data_routes::{self, ingest};
use chrono::{Days, NaiveDate, TimeZone, Utc};
use std::io::{Read,Write,BufRead};

pub(crate) fn source(job: &Value, qdm: bool, code: &str, start: &str, parent_hash: Value) -> Value {
    let mut settings = json!({"library":if qdm {"qdm-cli-v1"}else{"dukascopy-node@1.50.0"},
        "timeframe":"m1","price":if qdm {"provider_default"}else{"bid"},"timezone":"UTC",
        "synthetic_bars":false,"volume_units":if qdm {"provider_defined"}else{"units"},
        "requested_from":start,"requested_to":job["to_date"],"price_only":true,
        "parent_dataset_id":job["parent_dataset_id"],"parent_raw_sha256":parent_hash});
    if qdm {
        for (key, value) in [("qdm_version",job["qdm_version"].clone()),("upstream_provider",json!("Dukascopy")),
            ("download_engine",json!("QuantDataManager")),("catalog_sha256",job["catalog_sha256"].clone()),
            ("qdm_export_sha256",job["qdm_export_sha256"].clone())] { settings[key]=value; }
    } else { settings["raw_buckets_sha256"]=job["buckets_sha256"].clone(); }
    let mut encoded = String::new();
    super::super::catalog::cache_json(&settings,&mut encoded);
    let mut mapping=serde_json::Map::new();mapping.insert(code.into(),job["instrument_id"].clone());
    json!({"source_id":if qdm {"quantdatamanager-dukascopy-m1"}else{"dukascopy-public-m1-bid"},
        "provider":if qdm {"QuantDataManager"}else{"Dukascopy"},"instrument_mapping":mapping,
        "license_use":if qdm {"owner licensed local QDM research; redistribution not granted"}else{"owner-requested local research; redistribution not granted"},
        "retrieved_at_utc":job[if qdm {"qdm_retrieved_at_utc"}else{"created_at_utc"}],"export_settings":encoded})
}

pub(super) fn open_regular(path: &Path) -> Result<std::fs::File,String> {
    let metadata=std::fs::symlink_metadata(path).map_err(|_|"invalid_source_data")?;
    if !metadata.is_file()||metadata.file_type().is_symlink(){return Err("invalid_source_data".into());}
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()&0x400!=0{return Err("invalid_source_data".into());}
    }
    std::fs::File::open(path).map_err(|_|"invalid_source_data".into())
}

pub(super) struct Prepared {
    pub(super) raw: std::path::PathBuf,
    pub(super) rows: std::path::PathBuf,
    pub(super) preview: Value,
}
impl Drop for Prepared {
    fn drop(&mut self) {
        let _=std::fs::remove_file(&self.raw);
        let _=std::fs::remove_file(&self.rows);
    }
}

pub(super) fn prepare(reader:&crate::artifact_data::ArtifactData,csv:&Path,parent:Option<Value>,source:&Value,
    symbol:&str,start:&str,end:&str)->Result<Prepared,String>{
    let token=uuid::Uuid::new_v4().simple().to_string();
    let mut prepared=Prepared{raw:csv.with_file_name(format!(".{token}.csv")),
        rows:csv.with_file_name(format!(".{token}.ndjson")),preview:Value::Null};
    let mut raw=std::fs::OpenOptions::new().write(true).create_new(true).open(&prepared.raw).map_err(|_|"invalid_source_data")?;
    let mut downloaded=std::io::BufReader::new(open_regular(csv)?);
    if let Some(parent)=parent{
        let path=reader.path(parent["raw_artifact_path"].as_str().ok_or("invalid_source_data")?)?;
        let mut input=open_regular(&path)?;let mut hash=Sha256::new();let mut block=[0u8;64*1024];
        loop{let n=input.read(&mut block).map_err(|_|"invalid_source_data")?;if n==0{break}
            hash.update(&block[..n]);raw.write_all(&block[..n]).map_err(|_|"invalid_source_data")?;}
        if json!(format!("{:x}",hash.finalize()))!=parent["raw_sha256"]{return Err("invalid_source_data".into());}
        // Preserve the legacy append identity, including the separating newline.
        raw.write_all(b"\n").map_err(|_|"invalid_source_data")?;
        let mut header=Vec::new();
        let n=downloaded.by_ref().take(4097).read_until(b'\n',&mut header).map_err(|_|"invalid_source_data")?;
        if n>4096||!header.ends_with(b"\n"){return Err("invalid_source_data".into());}
    }
    std::io::copy(&mut downloaded,&mut raw).map_err(|_|"invalid_source_data")?;
    raw.sync_all().map_err(|_|"invalid_source_data")?;drop(raw);
    let day=|date:&str|NaiveDate::parse_from_str(date,"%Y-%m-%d").map_err(|_|"invalid_date_range");
    let from=Utc.from_utc_datetime(&day(start)?.and_hms_opt(0,0,0).unwrap()).timestamp();
    let to=Utc.from_utc_datetime(&day(end)?.checked_add_days(Days::new(1)).ok_or("invalid_date_range")?.and_hms_opt(0,0,0).unwrap()).timestamp();
    prepared.preview=ingest::stream_ordered_price_only(&prepared.raw,&prepared.rows,source,symbol,60,(from,to))
        .map_err(|_|"quality_rejected")?;
    Ok(prepared)
}

pub(super) async fn publish(state:&Arc<AppState>,runtime:&Arc<ProviderRuntime>,conn:&mut Client,
    job:&mut Value,folder:&Path,stop:&AtomicBool)->Result<(),String>{
    if stop.load(Ordering::Acquire){return Err("download_interrupted".into());}
    let workspace=job["workspace_id"].as_str().ok_or("invalid_source_data")?.to_owned();
    let id=job["job_id"].as_str().ok_or("invalid_source_data")?.to_owned();
    let symbol=job["instrument_id"].as_str().ok_or("instrument_not_supported")?.to_owned();
    let start=job["full_from_date"].as_str().or_else(||job["from_date"].as_str()).ok_or("invalid_date_range")?.to_owned();
    let end=job["to_date"].as_str().ok_or("invalid_date_range")?.to_owned();
    let parent = if let Some(parent)=job["parent_dataset_id"].as_str(){
        let row=conn.query_opt("SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",&[&workspace,&parent]).await.map_err(|_|"provider_database_unavailable")?.ok_or("dataset_not_supported")?;
        let manifest:Value=row.get(0);let (from,to)=lifecycle::dataset_scope(runtime,&workspace,&manifest,&symbol).map_err(detail)?;
        if from.to_string()!=start||to.checked_add_days(Days::new(1)).map(|v|v.to_string()).as_deref()!=job["from_date"].as_str(){return Err("dataset_not_supported".into());}
        Some(manifest)
    }else{None};
    let code=if matches!(runtime.engine,DownloadEngine::Qdm{..}){
        job["provider_code"].as_str().ok_or("instrument_not_supported")?.to_owned()
    }else{runtime.catalog.read().map_err(|_|"catalog_state_unavailable")?.metadata_for(&symbol)
        .and_then(|v|v["code"].as_str().map(str::to_owned)).ok_or("instrument_not_supported")?};
    let source=source(job,matches!(runtime.engine,DownloadEngine::Qdm{..}),&code,&start,
        parent.as_ref().map(|p|p["raw_sha256"].clone()).unwrap_or(Value::Null));
    let reader=state.artifact_data.clone();let csv=folder.join("candles.csv");
    let permit=state.artifact_reads.clone().acquire_owned().await.map_err(|_|"provider_reader_unavailable")?;
    let prepared=tokio::task::spawn_blocking(move||{
        let _permit=permit;
        prepare(&reader,&csv,parent,&source,&symbol,&start,&end)
    }).await.map_err(|_|"provider_preparation_failed")??;
    if stop.load(Ordering::Acquire){return Err("download_interrupted".into());}
    let mut headers=axum::http::HeaderMap::new();headers.insert("x-workspace-id",workspace.parse().map_err(|_|"workspace_access_denied")?);
    state.authorization.authorize(&headers).map_err(detail)?;
    let preview=prepared.preview.clone();let dataset=preview["dataset_id"].as_str().ok_or("invalid_source_data")?.to_owned();
    let tx=conn.transaction().await.map_err(|_|"provider_database_unavailable")?;
    tx.query_one("SELECT pg_advisory_xact_lock($1)",&[&data_routes::dataset_lock_key(&workspace,&dataset)]).await.map_err(|_|"provider_database_unavailable")?;
    data_routes::assert_not_removing(&state.config.artifact_root,&workspace,&dataset).map_err(detail)?;
    let mut latest=lifecycle::read(&tx,runtime,&workspace,&id,true).await.map_err(detail)?;
    match latest["status"].as_str(){Some("running")=>(),Some("cancelled")=>return Err("download_cancelled".into()),Some("paused"|"pausing")=>return Err("download_paused".into()),_=>return Err("download_ownership_lost".into())}
    let existing=tx.query_opt("SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",&[&workspace,&dataset]).await.map_err(|_|"provider_database_unavailable")?;
    if let Some(row)=existing{
        let saved:Value=row.get(0);
        if saved["workspace_id"]!=workspace||saved["dataset_id"]!=dataset||saved["raw_sha256"]!=preview["raw_sha256"]||saved["normalized_sha256"]!=preview["normalized_sha256"]||saved["source"]!=preview["source"]{return Err("invalid_source_data".into());}
    }else{
        let root=state.config.artifact_root.clone();let write_workspace=workspace.clone();let data=dataset.clone();
        let mut task=tokio::task::spawn_blocking(move||{
            let result=data_routes::publish_import_files(&root,&write_workspace,&data,&prepared.raw,&prepared.rows);
            drop(prepared);result
        });
        let mut keepalive=tokio::time::interval(Duration::from_secs(5));
        let mut connection_error=false;
        let (raw_path,raw_sha,artifact_path,artifact_sha)=loop{tokio::select!{
            result=&mut task=>break result.map_err(|_|"dataset_publication_failed")?.map_err(detail)?,
            _=keepalive.tick(),if !connection_error=>{connection_error=tx.simple_query("SELECT 1").await.is_err();}
        }};
        // spawn_blocking cannot be canceled. Drain it before releasing job/source
        // ownership even when PostgreSQL has disconnected during publication.
        if connection_error{return Err("provider_database_unavailable".into());}
        if json!(raw_sha)!=preview["raw_sha256"]{return Err("invalid_source_data".into());}
        let manifest=json!({"contract_version":crate::CONTRACT_VERSION,"dataset_id":dataset,"workspace_id":workspace,"source":preview["source"],"instrument_id":preview["instrument"]["instrument_id"],"timeframe":"60s","row_count":preview["row_count"],"first_timestamp":preview["available_range"]["from_utc"],"last_timestamp":preview["available_range"]["to_utc"],"artifact_path":artifact_path,"artifact_sha256":artifact_sha,"raw_artifact_path":raw_path,"raw_sha256":raw_sha,"normalized_sha256":preview["normalized_sha256"],"instrument_spec":preview["instrument"],"timeframe_seconds":60,"available_range":preview["available_range"],"quality":preview["quality"],"holdout_policy":preview["holdout_policy"],"transform_version":ingest::TRANSFORM,"created_at_utc":Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,true)});
        tx.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) VALUES($1,$2,$3,$4,$5)",&[&workspace,&dataset,&manifest,&artifact_sha,&manifest["created_at_utc"].as_str().unwrap()]).await.map_err(|_|"provider_database_unavailable")?;
    }
    for key in ["status","dataset_id","error","quality"]{latest[key]=match key{"status"=>json!("completed"),"dataset_id"=>json!(dataset),"quality"=>preview["quality"]["disposition"].clone(),_=>Value::Null};}
    lifecycle::save(&tx,runtime,&mut latest).await.map_err(detail)?;
    tx.commit().await.map_err(|_|"provider_completion_outcome_unknown")?;*job=latest;Ok(())
}
