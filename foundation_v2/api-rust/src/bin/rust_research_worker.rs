//! Offline worker only; no broker/provider/OAuth process can be launched here.
use std::{path::PathBuf, time::Duration,fs::{self,OpenOptions},io::Write};
use trading_workspace_api::{
    config::Config,
    research_execution::{self, RunOutcome, WorkerOptions},
    state::AppState,
};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!(
            "{}",
            serde_json::json!({"event":"native_research_worker_failed","error_code":error})
        );
        std::process::exit(1)
    }
}
async fn run() -> Result<(), String> {
    let mut once = false;
    let mut poll_ms = 1000u64;
    let mut options = WorkerOptions {
        worker_id: std::env::var("TW_V2_WORKER_ID").unwrap_or_else(|_| {
            format!(
                "rust-research-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4().simple()
            )
        }),
        lease_seconds: 30,
        max_active_jobs: 1,
        shutdown_file: std::env::var_os("TW_V2_SHUTDOWN_FILE").map(PathBuf::from),
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str(){
        "--once"=>once=true,
        "--poll-ms"=>poll_ms=args.next().ok_or("missing_poll_ms")?.parse().map_err(|_|"invalid_poll_ms")?,
        "--lease-seconds"=>options.lease_seconds=args.next().ok_or("missing_lease_seconds")?.parse().map_err(|_|"invalid_lease_seconds")?,
        "--max-active-jobs"=>options.max_active_jobs=args.next().ok_or("missing_max_active_jobs")?.parse().map_err(|_|"invalid_max_active_jobs")?,
        "--worker-id"=>options.worker_id=args.next().ok_or("missing_worker_id")?,
        "--shutdown-file"=>options.shutdown_file=Some(PathBuf::from(args.next().ok_or("missing_shutdown_file")?)),
        _=>return Err("usage_native_research_worker_once_poll_ms_lease_seconds_max_active_jobs_worker_id_shutdown_file".into())
    }
    }
    if !(10..=60000).contains(&poll_ms) {
        return Err("invalid_poll_ms".into());
    }
    options.validate()?;
    let state = AppState::connect(Config::from_environment()?).await?;
    research_execution::prepare_scientific(&state,&options).await?;
    publish_ready(&options.worker_id)?;
    loop {
        if options.shutdown_file.as_ref().is_some_and(|p| p.exists()) {
            break;
        }
        match research_execution::run_one(state.clone(), &options).await {
            Ok(outcome) => {
                let (event, id) = match outcome {
                    RunOutcome::Idle => ("idle", None),
                    RunOutcome::Completed(id) => ("completed", Some(id)),
                    RunOutcome::Interrupted(id) => ("interrupted", Some(id)),
                };
                if once || event != "idle" {
                    println!("{}", serde_json::json!({"event":event,"job_id":id}));
                }
            }
            // Driver/provider details and configuration values never enter logs.
            Err(_) => {
                if once {state.pool.close();return Err("native_research_attempt_failed".into());}
                eprintln!("{}",serde_json::json!({"event":"native_research_attempt_failed"}));
            }
        }
        if once {
            break;
        }
        let wait = tokio::time::sleep(Duration::from_millis(poll_ms));
        tokio::pin!(wait);
        tokio::select! {_=wait=>(),_=tokio::signal::ctrl_c()=>break}
    }
    state.pool.close();
    Ok(())
}

fn publish_ready(worker_id:&str)->Result<(),String>{
    match(std::env::var_os("TW_V2_WORKER_READY_FILE"),std::env::var("TW_V2_WORKER_STARTUP_TOKEN")){
        (None,Err(_))=>Ok(()),
        (Some(path),Ok(token))if token.len()>=32=>{
            let path=PathBuf::from(path);
            if path.exists(){return Err("research_worker_ready_file_exists".into());}
            let parent=path.parent().ok_or("research_worker_ready_parent_missing")?;
            if !parent.is_dir(){return Err("research_worker_ready_parent_missing".into());}
            let temporary=parent.join(format!(".research-ready-{}-{}",std::process::id(),uuid::Uuid::new_v4().simple()));
            let outcome=(||{
                let mut file=OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_|"research_worker_ready_create_failed")?;
                let bytes=serde_json::to_vec(&serde_json::json!({"schema":"research-worker-ready-v1","worker_id":worker_id,"pid":std::process::id(),"startup_token":token})).map_err(|_|"research_worker_ready_encode_failed")?;
                file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|_|"research_worker_ready_write_failed")?;drop(file);
                // A hard link publishes complete bytes without replacing a stale
                // ready file from another process, including on Windows.
                fs::hard_link(&temporary,&path).map_err(|_|"research_worker_ready_publish_failed")?;
                Ok(())
            })();
            let _=fs::remove_file(temporary);outcome
        }
        _=>Err("research_worker_ready_identity_invalid".into())
    }
}
