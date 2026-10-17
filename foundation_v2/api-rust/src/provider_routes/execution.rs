//! Provider adapter orchestration. The supervisor supplies an explicit, pinned
//! process capability; native PostgreSQL state owns every job transition.
use super::{DownloadEngine,ProviderRuntime,lifecycle};
use crate::{auth::ApiError,state::AppState};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::{Path,PathBuf},sync::{Arc,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use tokio::io::{AsyncBufReadExt,AsyncReadExt,BufReader};
use tokio_postgres::Client;

#[derive(Clone)]
pub enum Adapter {
    Qdm{executable:PathBuf,sha256:String},
    Dukascopy{node:PathBuf,node_sha256:String,worker:PathBuf,worker_sha256:String},
}

impl Adapter {
    pub fn from_environment(runtime:&ProviderRuntime)->Result<Option<Self>,String>{
        let required=|key:&str|std::env::var(key).map_err(|_|format!("{key} required for configured native provider"));
        let adapter=match &runtime.engine {
            DownloadEngine::None=>return Ok(None),
            DownloadEngine::Qdm{home}=>Self::Qdm{executable:home.join("qdmcli.exe"),sha256:required("TW_V2_QDM_SHA256")?},
            DownloadEngine::Dukascopy{..}=>Self::Dukascopy{node:PathBuf::from(required("TW_V2_DUKASCOPY_NODE")?),node_sha256:required("TW_V2_DUKASCOPY_NODE_SHA256")?,worker:PathBuf::from(required("TW_V2_DUKASCOPY_WORKER")?),worker_sha256:required("TW_V2_DUKASCOPY_WORKER_SHA256")?},
        };adapter.verify()?;Ok(Some(adapter))
    }
    fn verify(&self)->Result<(),String>{
        match self{Self::Qdm{executable,sha256}=>verify(executable,sha256),Self::Dukascopy{node,node_sha256,worker,worker_sha256}=>{verify(node,node_sha256)?;verify(worker,worker_sha256)}}
    }
}

fn verify(path:&Path,expected:&str)->Result<(),String>{
    use std::io::Read;
    if !path.is_absolute()||expected.len()!=64||!expected.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("invalid_provider_adapter_identity".into())}
    let meta=std::fs::symlink_metadata(path).map_err(|_|"provider_adapter_missing")?;
    if !meta.is_file()||meta.file_type().is_symlink(){return Err("provider_adapter_identity_changed".into())}
    #[cfg(windows)] {use std::os::windows::fs::MetadataExt;
        if meta.file_attributes()&0x400!=0{return Err("provider_adapter_identity_changed".into())}}
    let mut handle=std::fs::File::open(path).map_err(|_|"provider_adapter_missing")?;
    let mut hash=Sha256::new();let mut block=[0u8;1024*64];loop{let n=handle.read(&mut block).map_err(|_|"provider_adapter_missing")?;if n==0{break}hash.update(&block[..n]);}
    if format!("{:x}",hash.finalize())!=expected{return Err("provider_adapter_identity_changed".into())}Ok(())
}

pub struct WorkerHandle {
    stop:Arc<AtomicBool>,
    runtime:Arc<ProviderRuntime>,
    task:tokio::task::JoinHandle<()>,
}
struct WorkerRunning(Arc<ProviderRuntime>);
impl Drop for WorkerRunning {
    fn drop(&mut self){self.0.worker.store(false,Ordering::Release);}
}
impl WorkerHandle {
    pub fn request_stop(&self){self.stop.store(true,Ordering::Release);self.runtime.wake.notify_one();}
    /// QDM has no documented mid-write cancellation. Its current command drains.
    pub async fn finish(mut self){self.request_stop();let _=(&mut self.task).await;}
}
impl Drop for WorkerHandle {
    fn drop(&mut self){self.request_stop();self.task.abort();self.runtime.worker.store(false,Ordering::Release);}
}

pub fn start(state:Arc<AppState>,runtime:Arc<ProviderRuntime>,adapter:Adapter)->Result<WorkerHandle,String>{
    match (&runtime.engine,&adapter){(DownloadEngine::Qdm{home},Adapter::Qdm{executable,..})if *executable==home.join("qdmcli.exe")=>(),(DownloadEngine::Dukascopy{..},Adapter::Dukascopy{..})=>(),_=>return Err("provider_adapter_scope_mismatch".into())}
    adapter.verify()?;
    if runtime.worker.swap(true,Ordering::AcqRel){return Err("provider_worker_already_started".into())}
    let stop=Arc::new(AtomicBool::new(false));let task_stop=stop.clone();let task_runtime=runtime.clone();
    let task=tokio::spawn(async move{
        let _running=WorkerRunning(task_runtime.clone());
        while !task_stop.load(Ordering::Acquire){
            match run_one(&state,&task_runtime,&adapter,&task_stop).await {
                Ok(true)=>continue,
                Err(error)=>tracing::warn!(detail=%error,"native provider job failed"),
                Ok(false)=>(),
            }
            tokio::select!{_=task_runtime.wake.notified()=>(),_=tokio::time::sleep(Duration::from_millis(250))=>()}
        }
        task_runtime.worker.store(false,Ordering::Release);
    });Ok(WorkerHandle{stop,runtime,task})
}

async fn run_one(state:&Arc<AppState>,runtime:&Arc<ProviderRuntime>,adapter:&Adapter,stop:&AtomicBool)->Result<bool,String>{
    let conn=state.pool.get().await.map_err(|_|"provider_database_unavailable")?;
    // The socket is never returned to a pool while it owns session locks.
    let mut conn=deadpool_postgres::Client::take(conn);
    let source=lifecycle::source_key(runtime).map_err(detail)?;
    let available:bool=conn.query_one("SELECT pg_try_advisory_lock($1)",&[&source]).await.map_err(|_|"provider_database_unavailable")?.get(0);
    if !available{return Ok(false)}
    let tx=conn.transaction().await.map_err(|_|"provider_database_unavailable")?;
    let workspaces=state.authorization.authorized_workspace_ids();
    let row=tx.query_opt("SELECT workspace_id,job_id FROM download_jobs WHERE provider=$1 AND workspace_id=ANY($2) AND payload->>'status' IN ('queued','running','pausing') ORDER BY created_at_utc,job_id FOR UPDATE SKIP LOCKED LIMIT 1",&[&lifecycle::provider(runtime),&workspaces]).await.map_err(|_|"provider_database_unavailable")?;
    let Some(row)=row else{return Ok(false)};
    let workspace:String=row.get(0);let id:String=row.get(1);
    let mut headers=axum::http::HeaderMap::new();headers.insert("x-workspace-id",workspace.parse().map_err(|_|"workspace_access_denied")?);
    state.authorization.authorize(&headers).map_err(detail)?;
    let key=lifecycle::job_key(runtime,&workspace,&id).map_err(detail)?;
    let owned:bool=tx.query_one("SELECT pg_try_advisory_lock($1)",&[&key]).await.map_err(|_|"provider_database_unavailable")?.get(0);if !owned{return Ok(false)}
    let mut job=lifecycle::read(&tx,runtime,&workspace,&id,true).await.map_err(detail)?;
    if job["status"]!="queued" {
        // Source and job locks are both unowned after a crash. Persist the
        // interrupted state; resumption requires the normal admission contract.
        job["status"]=json!("paused");job["error"]=json!("download_interrupted");
        lifecycle::save(&tx,runtime,&mut job).await.map_err(detail)?;
        tx.commit().await.map_err(|_|"provider_database_unavailable")?;
        return Ok(true);
    }
    job["status"]=json!("running");lifecycle::save(&tx,runtime,&mut job).await.map_err(detail)?;
    tx.commit().await.map_err(|_|"provider_database_unavailable")?;
    let result=execute(state,runtime,adapter,&mut conn,&mut job,stop).await;
    if let Err(error)=&result {
        let tx=conn.transaction().await.map_err(|_|"provider_database_unavailable")?;
        let mut latest=lifecycle::read(&tx,runtime,&workspace,&id,true).await.map_err(detail)?;
        if !matches!(latest["status"].as_str(),Some("completed"|"cancelled")){
            let pausing=latest["status"]==json!("pausing");
            let paused=pausing||matches!(error.as_str(),"qdm_busy"|"download_busy"|"download_interrupted"|"download_paused"|"source_access_challenge"|"source_rate_limited"|"source_unavailable");
            latest["status"]=json!(if paused{"paused"}else{"failed"});latest["error"]=if pausing{Value::Null}else{json!(error)};
            if error=="source_access_challenge"{latest["retry_at"]=json!(0)}else if paused&&!pausing{latest["retry_at"]=json!(chrono::Utc::now().timestamp()+60)}
            lifecycle::save(&tx,runtime,&mut latest).await.map_err(detail)?;
        }
        tx.commit().await.map_err(|_|"provider_database_unavailable")?;
    }
    result.map(|_|true)
}
fn detail(error:ApiError)->String{error.1["detail"].as_str().unwrap_or("provider_database_unavailable").to_owned()}

async fn checkpoint(conn:&mut Client,runtime:&ProviderRuntime,job:&mut Value)->Result<(),String>{
    let tx=conn.transaction().await.map_err(|_|"provider_database_unavailable")?;
    let current=lifecycle::read(&tx,runtime,job["workspace_id"].as_str().unwrap(),job["job_id"].as_str().unwrap(),true).await.map_err(detail)?;
    match current["status"].as_str(){Some("cancelled")=>return Err("download_cancelled".into()),Some("pausing"|"paused")=>return Err("download_paused".into()),Some("running")=>(),_=>return Err("download_ownership_lost".into())}
    job["revision"]=current["revision"].clone();lifecycle::save(&tx,runtime,job).await.map_err(detail)?;tx.commit().await.map_err(|_|"provider_database_unavailable")?;Ok(())
}

fn safe_folder(runtime:&ProviderRuntime,workspace:&str,id:&str)->Result<PathBuf,String>{
    let folder=lifecycle::folder(runtime,workspace,id).map_err(detail)?;
    let relative=folder.strip_prefix(&runtime.root).map_err(|_|"invalid_source_data")?;
    let mut current=runtime.root.clone();for component in relative.components(){current.push(component);match std::fs::symlink_metadata(&current){Ok(meta)=>{if meta.file_type().is_symlink()||!meta.is_dir(){return Err("invalid_source_data".into())}#[cfg(windows)]{use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("invalid_source_data".into())}}},Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{std::fs::create_dir(&current).map_err(|_|"invalid_source_data")?},Err(_)=>return Err("invalid_source_data".into())}}
    Ok(folder)
}

pub(crate) fn atomic_json(path:&Path,value:&Value)->Result<(),String>{
    use std::io::Write;
    let temp=path.with_extension(format!("{}.tmp",uuid::Uuid::new_v4().simple()));
    let result=(||{let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|"provider_checkpoint_failed")?;file.write_all(value.to_string().as_bytes()).map_err(|_|"provider_checkpoint_failed")?;file.sync_all().map_err(|_|"provider_checkpoint_failed")?;std::fs::rename(&temp,path).map_err(|_|"provider_checkpoint_failed")?;Ok(())})();let _=std::fs::remove_file(temp);result
}

async fn bounded_line<R:tokio::io::AsyncBufRead+Unpin>(reader:&mut R,line:&mut Vec<u8>)->Result<Option<String>,String>{
    loop{let available=reader.fill_buf().await.map_err(|_|"provider_adapter_failed")?;
        if available.is_empty(){return if line.is_empty(){Ok(None)}else{
            String::from_utf8(std::mem::take(line)).map(Some).map_err(|_|"invalid_source_data".into())}}
        let n=available.iter().position(|b|*b==b'\n').map(|i|i+1).unwrap_or(available.len());
        if line.len()+n>64*1024{return Err("provider_adapter_output_exceeded".into())}
        line.extend_from_slice(&available[..n]);let done=available[n-1]==b'\n';reader.consume(n);
        if done{return String::from_utf8(std::mem::take(line))
            .map(|s|Some(s.trim_end_matches(['\r','\n']).to_owned())).map_err(|_|"invalid_source_data".into())}
    }
}

async fn execute(state:&Arc<AppState>,runtime:&Arc<ProviderRuntime>,adapter:&Adapter,conn:&mut Client,job:&mut Value,stop:&AtomicBool)->Result<(),String>{
    adapter.verify()?;
    let folder=safe_folder(runtime,job["workspace_id"].as_str().unwrap(),job["job_id"].as_str().unwrap())?;
    match adapter {
        Adapter::Dukascopy{node,worker,..}=>{
            let policy=lifecycle::policy(runtime).map_err(detail)?;
            if policy["until"].as_f64().unwrap_or(0.)>chrono::Utc::now().timestamp()as f64{return Err("source_rate_limited".into())}
            let pacing=[(3,1000),(2,2000),(1,4000),(1,8000),(1,16000),(1,30000)][policy["rate_limit_level"].as_u64().unwrap()as usize];
            atomic_json(&folder.join("request.json"),&json!({"instrument_id":job["instrument_id"],"from_date":job["from_date"],"to_date":job["to_date"],"parent_dataset_id":job["parent_dataset_id"],"transferred_bytes":job.get("transferred_bytes").cloned().unwrap_or(json!(0)),"completed_days":job["completed_days"],"pacing":{"concurrency":pacing.0,"pause_ms":pacing.1}}))?;
            command(node,&[worker.to_string_lossy().into(),folder.join("request.json").to_string_lossy().into()],None,conn,runtime,job,stop,false).await?;
            source_success(runtime)?;
        },
        Adapter::Qdm{executable,..}=>{
            let home=executable.parent().ok_or("qdm_not_configured")?;
            let probe=command(executable,&["-h".into()],Some(home),conn,runtime,job,stop,true).await?;
            let version=probe.lines().find_map(|line|line.split_once("App version:").map(|v|v.1.trim().split_whitespace().next().unwrap_or("").to_owned())).filter(|v|!v.is_empty()&&v.bytes().all(|b|b.is_ascii_digit()||b==b'.')).ok_or("qdm_version_unsupported")?;
            if !probe.contains("cIncludeHeader")||!probe.contains("cFormat"){return Err("qdm_version_unsupported".into())}
            job["qdm_version"]=json!(version);job["provider"]=json!("QuantDataManager");job["transferred_bytes"]=Value::Null;job["progress_scope"]=json!("phase");job["progress_percent"]=Value::Null;checkpoint(conn,runtime,job).await?;
            let name=ensure_qdm_symbol(executable,home,conn,runtime,job,stop).await?;
            command(executable,&["-data".into(),"action=update".into(),format!("symbols={name}")],Some(home),conn,runtime,job,stop,true).await?;
            ensure_qdm_symbol(executable,home,conn,runtime,job,stop).await?;
            if stop.load(Ordering::Acquire){return Err("download_interrupted".into())}
            let export=folder.join("export");std::fs::create_dir_all(&export).map_err(|_|"invalid_source_data")?;
            job["stage"]=json!("processing");job["progress_percent"]=Value::Null;checkpoint(conn,runtime,job).await?;
            command(executable,&["-data".into(),"action=export".into(),format!("symbols={name}"),"timeframe=M1".into(),"timezone=UTC".into(),format!("datefrom={}",job["from_date"].as_str().unwrap().replace('-',".")),format!("dateto={}",job["to_date"].as_str().unwrap().replace('-',".")),format!("outputdir={}",export.to_string_lossy()),"format=Custom".into(),"cIncludeHeader=true".into(),"cHeader=Date,Time,Open,High,Low,Close,Volume".into(),"cFormat=[Date:yyyy.MM.dd],[Time:HH:mm:ss],[Open],[High],[Low],[Close],[Volume]".into()],Some(home),conn,runtime,job,stop,true).await?;
            let exports=std::fs::read_dir(&export).map_err(|_|"invalid_source_data")?.filter_map(Result::ok).map(|e|e.path()).filter(|p|p.extension().is_some_and(|e|e.eq_ignore_ascii_case("csv"))).collect::<Vec<_>>();if exports.len()!=1{return Err("invalid_source_data".into())}
            let source=exports[0].clone();let target=folder.join("candles.csv");let start=job["from_date"].as_str().unwrap().to_owned();let end=job["to_date"].as_str().unwrap().to_owned();
            let sha=tokio::task::spawn_blocking(move||normalize_export(&source,&target,&start,&end)).await.map_err(|_|"invalid_source_data")??;
            if job["qdm_retrieved_at_utc"].is_null(){job["qdm_retrieved_at_utc"]=json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros,false));}
            job["qdm_export_sha256"]=json!(sha);job["completed_days"]=job["total_days"].clone();checkpoint(conn,runtime,job).await?;
        },
    }
    publish(state,runtime,conn,job,&folder,stop).await
}

pub fn qdm_error(output:&str)->Option<&'static str>{
    let lower=output.to_lowercase();
    if lower.contains("another instance of quantdatamanager is running"){return Some("qdm_busy")}
    if ["missing license","invalid license","license expired"].iter().any(|s|lower.contains(s)){return Some("qdm_license_required")}
    if ["exception","update failed","export failed","unknown symbol"].iter().any(|s|lower.contains(s))||lower.split(|c:char|!c.is_alphanumeric()&&c!='_').any(|s|s=="error"){return Some("qdm_command_failed")}None
}

async fn command(executable:&Path,args:&[String],cwd:Option<&Path>,conn:&mut Client,runtime:&ProviderRuntime,job:&mut Value,stop:&AtomicBool,qdm:bool)->Result<String,String>{
    let mut child=crate::owned_process::spawn(executable,args,cwd,&[],crate::owned_process::Limits::default(),false)
        .map_err(|_|if qdm{"qdm_not_configured"}else{"worker_unavailable"})?;
    let mut reader=BufReader::new(child.stdout.take().ok_or("provider_adapter_failed")?);
    // Keep partial bytes outside the select future so timer cancellation cannot
    // discard a fragmented JSON event.
    let mut line_buffer=Vec::new();
    let mut tick=tokio::time::interval(Duration::from_millis(100));let started=Instant::now();let mut output=String::new();let mut complete=false;let mut error=None;let mut last_checkpoint=Instant::now();
    let deadline=tokio::time::Instant::now()+Duration::from_secs(if qdm{6*3600}else{24*3600});
    let streamed=async {
        loop {
            tokio::select!{
                line=bounded_line(&mut reader,&mut line_buffer)=>{
                    let Some(line)=line? else {break};
                    if qdm {
                        if let Some(reason)=qdm_error(&line){error=Some(reason.to_owned());}
                        if output.len()+line.len()+1>128*1024 {let boundary=output.char_indices().find(|(i,_)|*i>=64*1024).map(|(i,_)|i).unwrap_or(output.len());output.drain(..boundary);}
                        output.push_str(&line);output.push('\n');
                        let name=format!("{}_TW,",job["provider_code"].as_str().unwrap_or(""));
                        if line.starts_with(&name)&&line.trim_end().ends_with('%'){
                            if let Some(percent)=line.split_whitespace().last().and_then(|s|s.strip_suffix('%')).and_then(|s|s.parse::<u64>().ok()){
                                job["progress_percent"]=json!(percent.min(100));job["stage"]=json!(if line.contains("Writing"){ "processing" }else{"downloading"});
                                if last_checkpoint.elapsed()>Duration::from_millis(200){checkpoint(conn,runtime,job).await?;last_checkpoint=Instant::now();}
                            }
                        }
                    }else{
                        let event:Value=serde_json::from_str(&line).map_err(|_|"invalid_source_data")?;
                        match event["event"].as_str(){
                            Some("progress")=>{
                                for field in ["completed_days","transferred_bytes","cached_bytes","network_days"]{if let Some(value)=event.get(field){if value.as_u64().is_none(){return Err("invalid_source_data".to_owned())}job[field]=value.clone();}}
                                if job["completed_days"].as_u64().unwrap_or(u64::MAX)>job["total_days"].as_u64().unwrap_or(0){return Err("invalid_source_data".into())}
                                job["stage"]=json!("downloading");checkpoint(conn,runtime,job).await?;
                            },
                            Some("error")=>{let reason=event["error"].as_str().ok_or("invalid_source_data")?;
                                if !["source_access_challenge","source_rate_limited","source_unavailable","invalid_source_data","empty_range","invalid_date_range","instrument_not_supported"].contains(&reason){return Err("invalid_source_data".into())}
                                if reason=="source_rate_limited"{record_rate_limit(runtime,event["retry_after_seconds"].as_u64().unwrap_or(300).clamp(60,86400))?;}
                                error=Some(reason.to_owned());
                            },
                            Some("complete")=>{let hash=event["buckets_sha256"].as_str().filter(|s|s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))).ok_or("invalid_source_data")?;
                                job["buckets_sha256"]=json!(hash);job["stage"]=json!("processing");for field in ["transferred_bytes","cached_bytes"]{if let Some(value)=event.get(field){if value.as_u64().is_none(){return Err("invalid_source_data".into())}job[field]=value.clone();}}checkpoint(conn,runtime,job).await?;complete=true;
                            },_=>return Err("invalid_source_data".into()),
                        }
                    }
                },
                _=tick.tick()=>{
                    if !qdm {
                        if stop.load(Ordering::Acquire){return Err("download_interrupted".into())}
                        let row=conn.query_opt("SELECT payload->>'status' FROM download_jobs WHERE workspace_id=$1 AND provider=$2 AND job_id=$3",&[&job["workspace_id"].as_str().unwrap(),&lifecycle::provider(runtime),&job["job_id"].as_str().unwrap()]).await.map_err(|_|"provider_database_unavailable")?.ok_or("download_ownership_lost")?;
                        let status:String=row.get(0);if status=="cancelled"{return Err("download_cancelled".into())}if status=="pausing"{return Err("download_paused".into())}
                    }
                    if started.elapsed()>Duration::from_secs(if qdm{6*3600}else{24*3600}){return Err("provider_adapter_timeout".into())}
                },
            }
        }Ok::<_,String>(())
    };
    let streamed=tokio::time::timeout_at(deadline,streamed).await.unwrap_or_else(|_|Err("provider_adapter_timeout".into()));
    if let Err(error)=streamed{
        if !qdm{let _=child.kill().await;}
        else{drain_process(&mut child,&mut reader,deadline).await?;}
        return Err(error)
    }
    let status=drain_process(&mut child,&mut reader,deadline).await?;
    if let Some(error)=error{return Err(error)}
    if !status.success(){return Err(if qdm{"qdm_command_failed"}else{"download_interrupted"}.into())}
    if qdm&&!output.contains("Exit app - ok"){return Err("qdm_command_failed".into())}
    if !qdm&&!complete{return Err("download_interrupted".into())}Ok(output)
}

async fn drain_process(child:&mut crate::owned_process::Child,
    reader:&mut BufReader<tokio::process::ChildStdout>,deadline:tokio::time::Instant,
)->Result<std::process::ExitStatus,String>{
    let wait=async{
        let mut block=[0u8;8192];let mut eof=false;
        loop{tokio::select!{
            status=child.wait()=>return status.map_err(|_|"provider_adapter_failed".to_owned()),
            read=reader.read(&mut block),if !eof=>{eof=match read{Ok(0)|Err(_)=>true,Ok(_)=>false};}
        }}
    };
    match tokio::time::timeout_at(deadline,wait).await{
        Ok(status)=>status,
        Err(_)=>{let _=child.kill().await;let _=child.wait().await;Err("provider_adapter_timeout".into())}
    }
}

async fn ensure_qdm_symbol(executable:&Path,home:&Path,conn:&mut Client,runtime:&ProviderRuntime,job:&mut Value,stop:&AtomicBool)->Result<String,String>{
    let code=job["provider_code"].as_str().ok_or("qdm_symbol_mismatch")?.to_owned();let name=format!("{code}_TW");
    for attempt in 0..2 {
        let output=command(executable,&["-symbol".into(),"action=list".into()],Some(home),conn,runtime,job,stop,true).await?;
        let header="Symbol,Instrument,Timeframe,Timezone,Date from,Date to,Total days,Total records,Source,Data type";
        let table=output.split_once(header).ok_or("qdm_command_failed")?.1.split("Data listed.").next().unwrap_or("");
        let text=format!("{header}{table}");let mut reader=csv::Reader::from_reader(text.as_bytes());let headers=reader.headers().map_err(|_|"qdm_command_failed")?.clone();
        let mut existing=None;for row in reader.records(){let row=row.map_err(|_|"qdm_command_failed")?;if row.get(0)==Some(&name){existing=Some(headers.iter().zip(row.iter()).map(|(k,v)|(k.to_owned(),v.to_owned())).collect::<std::collections::HashMap<_,_>>());break}}
        if let Some(row)=existing{
            if row.get("Timeframe").is_none_or(|s|s.to_uppercase()!="M1")||row.get("Source").is_none_or(|s|s.to_lowercase()!="dukascopy")||row.get("Instrument")!=Some(&code)||!(row.get("Timezone").is_some_and(|s|s=="(UTC) Coordinated Universal Time, DST: No")||(row.get("Timezone").is_some_and(|s|s.is_empty())&&row.get("Total records").is_some_and(|s|s=="0"))){return Err("qdm_symbol_mismatch".into())}return Ok(name)
        }
        if attempt==0{command(executable,&["-symbol".into(),"action=add".into(),format!("symbols={code}"),"datasource=dukascopy".into(),"datatype=M1".into(),"bartype=startofbar".into(),"postfix=_TW".into()],Some(home),conn,runtime,job,stop,true).await?;}
    }Err("qdm_symbol_mismatch".into())
}

pub fn normalize_export(source:&Path,target:&Path,start:&str,end:&str)->Result<String,String>{
    use chrono::TimeZone;use std::io::{Read,Seek};
    let temporary=target.with_file_name(format!(".export-{}.tmp",uuid::Uuid::new_v4().simple()));
    let result=(||{
        let mut file=publication::open_regular(source)?;let mut hash=Sha256::new();let mut block=[0u8;64*1024];
        loop{let n=file.read(&mut block).map_err(|_|"invalid_source_data")?;if n==0{break}hash.update(&block[..n]);}
        file.rewind().map_err(|_|"invalid_source_data")?;
        let mut reader=csv::Reader::from_reader(crate::data_routes::ingest::ProviderCsvInput::new(file));
        if reader.headers().map_err(|_|"invalid_source_data")?.iter().collect::<Vec<_>>()!=["Date","Time","Open","High","Low","Close","Volume"]{return Err("invalid_source_data".into())}
        let output=std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_|"invalid_source_data")?;
        let mut writer=csv::WriterBuilder::new().terminator(csv::Terminator::CRLF).from_writer(output);
        writer.write_record(["time","open","high","low","close","volume"]).map_err(|_|"invalid_source_data")?;let mut count=0;
        for row in reader.records(){let row=row.map_err(|_|"invalid_source_data")?;
            let stamp=chrono::NaiveDateTime::parse_from_str(&format!("{} {}",&row[0],&row[1]),"%Y.%m.%d %H:%M:%S").map_err(|_|"invalid_source_data")?;
            let date=stamp.date().to_string();if date.as_str()<start||date.as_str()>end{return Err("invalid_source_data".into())}
            let time=chrono::Utc.from_utc_datetime(&stamp).timestamp().to_string();
            writer.write_record(std::iter::once(time.as_str()).chain(row.iter().skip(2))).map_err(|_|"invalid_source_data")?;count+=1;
        }
        if count==0{return Err("empty_range".into())}
        writer.flush().map_err(|_|"invalid_source_data")?;
        writer.into_inner().map_err(|_|"invalid_source_data")?.sync_all().map_err(|_|"invalid_source_data")?;
        std::fs::rename(&temporary,target).map_err(|_|"invalid_source_data")?;
        Ok(format!("{:x}",hash.finalize()))
    })();let _=std::fs::remove_file(temporary);result
}

fn record_rate_limit(runtime:&ProviderRuntime,retry:u64)->Result<(),String>{
    let policy=lifecycle::policy(runtime).map_err(detail)?;let level=(policy["rate_limit_level"].as_u64().unwrap()+1).min(5);let until=(chrono::Utc::now().timestamp()as f64+retry.max(300*(1<<(level-1)))as f64).max(policy["until"].as_f64().unwrap_or(0.));atomic_json(&lifecycle::base(runtime).join("cooldown.json"),&json!({"until":until,"rate_limit_level":level}))
}
fn source_success(runtime:&ProviderRuntime)->Result<(),String>{let policy=lifecycle::policy(runtime).map_err(detail)?;let level=policy["rate_limit_level"].as_u64().unwrap();if level>0{atomic_json(&lifecycle::base(runtime).join("cooldown.json"),&json!({"until":0,"rate_limit_level":level-1}))?}Ok(())}

#[path = "publication.rs"]
mod publication;
use publication::publish;

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    #[ignore="resource benchmark: explicit synthetic input and owned temporary root required"]
    fn publication_resource_probe(){
        let root=PathBuf::from(std::env::var_os("TW_PROVIDER_BENCH_ROOT").unwrap());
        assert!(root.file_name().unwrap().to_string_lossy().starts_with("tw-provider-bench-"));
        let input=root.join("candles.csv");let artifact_root=root.join(uuid::Uuid::new_v4().simple().to_string());
        std::fs::create_dir(&artifact_root).unwrap();
        let source=json!({"source_id":"synthetic-resource-probe","provider":"fixture","license_use":"synthetic offline benchmark"});
        let mode=std::env::var("TW_PROVIDER_BENCH_MODE").unwrap();let started=Instant::now();
        let (preview,paths,preparation_ms)=match mode.as_str(){
            "buffered"=>{
                let raw=std::fs::read(&input).unwrap();
                let (preview,rows)=crate::data_routes::ingest::preview_price_only(std::str::from_utf8(&raw).unwrap(),&source,"EUR/USD",60,Some((0,31536000))).unwrap();
                let preparation_ms=started.elapsed().as_secs_f64()*1000.;
                let paths=crate::data_routes::publish_import(&artifact_root,"tenant-a",preview["dataset_id"].as_str().unwrap(),&raw,&rows).unwrap();
                (preview,paths,preparation_ms)
            },
            "streamed"=>{
                let reader=crate::artifact_data::ArtifactData::new(&artifact_root).unwrap();
                let prepared=publication::prepare(&reader,&input,None,&source,"EUR/USD","1970-01-01","1970-12-31").unwrap();
                let preparation_ms=started.elapsed().as_secs_f64()*1000.;
                let paths=crate::data_routes::publish_import_files(&artifact_root,"tenant-a",prepared.preview["dataset_id"].as_str().unwrap(),&prepared.raw,&prepared.rows).unwrap();
                (prepared.preview.clone(),paths,preparation_ms)
            },_=>panic!("unknown probe mode")
        };
        let total_ms=started.elapsed().as_secs_f64()*1000.;
        let result=json!({"mode":mode,"preparation_ms":preparation_ms,"publication_ms":total_ms-preparation_ms,"total_ms":total_ms,
            "row_count":preview["row_count"],"dataset_id":preview["dataset_id"],"preview":preview,"raw_sha256":paths.1,"artifact_sha256":paths.3});
        let output=PathBuf::from(std::env::var_os("TW_PROVIDER_BENCH_OUTPUT").unwrap());
        std::fs::write(output,serde_json::to_vec(&result).unwrap()).unwrap();
    }

    #[tokio::test]
    async fn fragmented_adapter_event_survives_timer_cancellation_and_has_a_bound() {
        let (mut sender,receiver)=tokio::io::duplex(128);
        let mut reader=BufReader::new(receiver);let mut partial=Vec::new();
        sender.write_all(b"{\"event\":\"prog").await.unwrap();
        assert!(tokio::time::timeout(Duration::from_millis(5),bounded_line(&mut reader,&mut partial)).await.is_err());
        assert_eq!(partial,b"{\"event\":\"prog");
        sender.write_all(b"ress\",\"completed_days\":1}\r\n").await.unwrap();
        assert_eq!(bounded_line(&mut reader,&mut partial).await.unwrap().unwrap(),"{\"event\":\"progress\",\"completed_days\":1}");
        assert!(partial.is_empty());
        let (mut sender,receiver)=tokio::io::duplex(128);
        let task=tokio::spawn(async move{let _=sender.write_all(&vec![b'x';65537]).await;});
        let mut reader=BufReader::new(receiver);
        assert_eq!(bounded_line(&mut reader,&mut partial).await.unwrap_err(),"provider_adapter_output_exceeded");
        drop(reader);task.await.unwrap();
    }

    #[test]
    fn qdm_streaming_export_preserves_bytes_and_does_not_replace_a_valid_file_on_failure() {
        let root=std::env::temp_dir().join(format!("tw-qdm-normalize-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();let source=root.join("export.csv");let target=root.join("candles.csv");
        let bytes=b"\xef\xbb\xbfDate,Time,Open,High,Low,Close,Volume\r\n2026.01.01,00:00:00,1,2,0,1.5,3\r\n2026.01.01,00:01:00,1.5,2,1,1.7,4\r\n";
        std::fs::write(&source,bytes).unwrap();
        assert_eq!(normalize_export(&source,&target,"2026-01-01","2026-01-01").unwrap(),format!("{:x}",Sha256::digest(bytes)));
        let expected=b"time,open,high,low,close,volume\r\n1767225600,1,2,0,1.5,3\r\n1767225660,1.5,2,1,1.7,4\r\n";
        assert_eq!(std::fs::read(&target).unwrap(),expected);
        assert!(normalize_export(&source,&target,"2026-01-02","2026-01-02").is_err());
        assert_eq!(std::fs::read(&target).unwrap(),expected);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(),2);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn subprocess_drain_reads_full_pipes_and_reaps_deadline_failure() {
        let python=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv/Scripts/python.exe");
        let spawn=|code:&str|{
            let mut child=crate::owned_process::spawn(&python,&["-I".into(),"-c".into(),code.into()],None,&[],crate::owned_process::Limits::default(),false).unwrap();
            let reader=BufReader::new(child.stdout.take().unwrap());(child,reader)
        };
        let (mut child,mut reader)=spawn("import sys;sys.stdout.write('x'*262144);sys.stdout.flush()");
        assert!(drain_process(&mut child,&mut reader,tokio::time::Instant::now()+Duration::from_secs(5)).await.unwrap().success());
        let (mut child,mut reader)=spawn("import time;time.sleep(20)");
        let started=Instant::now();
        assert_eq!(drain_process(&mut child,&mut reader,tokio::time::Instant::now()+Duration::from_millis(30)).await.unwrap_err(),"provider_adapter_timeout");
        assert!(started.elapsed()<Duration::from_secs(2));assert!(child.try_wait().unwrap().is_some());
    }

    #[tokio::test]
    #[ignore = "owned disposable PostgreSQL only; no vendor or network process"]
    async fn native_provider_claim_recovery_and_atomic_publication() {
        let state=AppState::connect(crate::config::Config::from_environment().unwrap()).await.unwrap();
        let mut conn=state.pool.get().await.unwrap();
        let db:String=conn.query_one("SELECT current_database()",&[]).await.unwrap().get(0);
        assert!(db.starts_with("rust_metadata_"),"refuse owner database");
        let root=state.config.artifact_root.join(format!("provider-native-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let runtime=ProviderRuntime::load(root.clone(),DownloadEngine::Dukascopy{
            metadata:json!({"version":"1.50.0","items":[{"name":"EUR/USD","code":"eurusd","startDayForMinuteCandles":"2000-01-01"}]}),adapter_present:true}).unwrap();
        conn.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('tenant-a','2026-01-01'),('outsider','2026-01-01') ON CONFLICT DO NOTHING",&[]).await.unwrap();
        let new_job=|workspace:&str,status:&str,from:&str,to:&str|json!({"job_id":uuid::Uuid::new_v4().simple().to_string(),"workspace_id":workspace,"instrument_id":"EUR/USD","from_date":from,"to_date":to,"status":status,"error":null,"completed_days":1,"total_days":1,"dataset_id":null,"transferred_bytes":100,"cached_bytes":0,"stage":"processing","full_from_date":null,"parent_dataset_id":null,"created_at_utc":"2026-01-01T00:00:00+00:00","buckets_sha256":"1".repeat(64)});
        let mut foreign=new_job("outsider","queued","2026-01-01","2026-01-01");
        let mut stale=new_job("tenant-a","running","2026-01-01","2026-01-01");
        let tx=conn.transaction().await.unwrap();
        for job in [&mut foreign,&mut stale]{lifecycle::save(&tx,&runtime,job).await.unwrap();}tx.commit().await.unwrap();
        let adapter=Adapter::Dukascopy{node:root.join("absent.exe"),node_sha256:"1".repeat(64),worker:root.join("absent.js"),worker_sha256:"1".repeat(64)};
        let stop=AtomicBool::new(false);
        assert!(run_one(&state,&runtime,&adapter,&stop).await.unwrap());
        assert!(!run_one(&state,&runtime,&adapter,&stop).await.unwrap(),"foreign queued job must not starve or execute");
        let tx=conn.transaction().await.unwrap();
        assert_eq!(lifecycle::read(&tx,&runtime,"outsider",foreign["job_id"].as_str().unwrap(),false).await.unwrap()["status"],"queued");
        assert_eq!(lifecycle::read(&tx,&runtime,"tenant-a",stale["job_id"].as_str().unwrap(),false).await.unwrap()["status"],"paused");tx.commit().await.unwrap();
        let mut job=new_job("tenant-a","running","2026-01-01","2026-01-01");
        let tx=conn.transaction().await.unwrap();lifecycle::save(&tx,&runtime,&mut job).await.unwrap();tx.commit().await.unwrap();
        let folder=safe_folder(&runtime,"tenant-a",job["job_id"].as_str().unwrap()).unwrap();
        let raw=b"time,open,high,low,close,volume\n1767225600,1,2,0,1.5,3\n1767225660,1.5,2,1,1.7,4\n";
        std::fs::write(folder.join("candles.csv"),raw).unwrap();
        // Simulate a crash after immutable file publication but before DB commit.
        let source=publication::source(&job,false,"eurusd","2026-01-01",Value::Null);
        let prepared=publication::prepare(&state.artifact_data,&folder.join("candles.csv"),None,&source,"EUR/USD","2026-01-01","2026-01-01").unwrap();
        crate::data_routes::publish_import_files(&state.config.artifact_root,"tenant-a",prepared.preview["dataset_id"].as_str().unwrap(),&prepared.raw,&prepared.rows).unwrap();drop(prepared);
        let mut owned=deadpool_postgres::Client::take(conn);
        publish(&state,&runtime,&mut owned,&mut job,&folder,&stop).await.unwrap();
        assert_eq!(job["status"],"completed");
        let saved:Value=owned.query_one("SELECT manifest_json FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",&[&job["dataset_id"].as_str().unwrap()]).await.unwrap().get(0);
        assert_eq!(saved["row_count"],2);assert_eq!(saved["raw_sha256"],format!("{:x}",Sha256::digest(raw)));
        // Appending retains parent identity and requested coverage.
        let mut next=new_job("tenant-a","running","2026-01-02","2026-01-02");next["parent_dataset_id"]=job["dataset_id"].clone();next["full_from_date"]=json!("2026-01-01");
        let tx=owned.transaction().await.unwrap();lifecycle::save(&tx,&runtime,&mut next).await.unwrap();tx.commit().await.unwrap();
        let next_folder=safe_folder(&runtime,"tenant-a",next["job_id"].as_str().unwrap()).unwrap();
        std::fs::write(next_folder.join("candles.csv"),b"time,open,high,low,close,volume\n1767312000,1,2,0,1.5,3\n1767312060,1.5,2,1,1.7,4\n").unwrap();
        publish(&state,&runtime,&mut owned,&mut next,&next_folder,&stop).await.unwrap();
        let appended:Value=owned.query_one("SELECT manifest_json FROM datasets WHERE workspace_id='tenant-a' AND dataset_id=$1",&[&next["dataset_id"].as_str().unwrap()]).await.unwrap().get(0);
        assert_eq!(appended["row_count"],4);let settings:Value=serde_json::from_str(appended["source"]["export_settings"].as_str().unwrap()).unwrap();
        assert_eq!(settings["parent_raw_sha256"],saved["raw_sha256"]);assert_eq!(settings["requested_from"],"2026-01-01");
        for status in ["cancelled","paused"] {
            let mut denied=new_job("tenant-a",status,"2026-01-01","2026-01-01");
            let tx=owned.transaction().await.unwrap();lifecycle::save(&tx,&runtime,&mut denied).await.unwrap();tx.commit().await.unwrap();
            let folder=safe_folder(&runtime,"tenant-a",denied["job_id"].as_str().unwrap()).unwrap();std::fs::write(folder.join("candles.csv"),raw).unwrap();
            let error=publish(&state,&runtime,&mut owned,&mut denied,&folder,&stop).await.unwrap_err();
            assert_eq!(error,if status=="cancelled"{"download_cancelled"}else{"download_paused"});
            assert_eq!(std::fs::read_dir(folder).unwrap().count(),1,"prepared temporaries must be cleaned");
        }
        let before:i64=owned.query_one("SELECT count(*) FROM datasets",&[]).await.unwrap().get(0);
        let mut invalid=new_job("tenant-a","running","2026-01-01","2026-01-01");
        let tx=owned.transaction().await.unwrap();lifecycle::save(&tx,&runtime,&mut invalid).await.unwrap();tx.commit().await.unwrap();
        let folder=safe_folder(&runtime,"tenant-a",invalid["job_id"].as_str().unwrap()).unwrap();
        std::fs::write(folder.join("candles.csv"),b"time,open,high,low,close\n1767225600,1,2,0,1\n1767225600,1,2,0,1\n").unwrap();
        assert_eq!(publish(&state,&runtime,&mut owned,&mut invalid,&folder,&stop).await.unwrap_err(),"quality_rejected");
        assert_eq!(owned.query_one("SELECT count(*) FROM datasets",&[]).await.unwrap().get::<_,i64>(0),before);
        assert_eq!(std::fs::read_dir(folder).unwrap().count(),1);
    }
}
