//! Finite supervised shadow lifecycle. No HTTP surface or broker-send capability.
#[allow(dead_code, unused_imports)]
#[path = "../owned_process.rs"]
mod owned_process;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::io::AsyncReadExt;

type Result<T> = std::result::Result<T, String>;
const LIMIT: u64 = 1024 * 1024;
const SCRIPT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/mt5_shadow_step.py");

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn digest_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|_| "shadow_file_unavailable")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "shadow_read_failed")?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn local(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.to_string_lossy().starts_with(['\\', '/']) && cfg!(windows) {
        return Err("shadow_local_absolute_path_required".into());
    }
    for part in path.ancestors() {
        match fs::symlink_metadata(part) {
            Ok(meta) => {
                let mut linked = meta.file_type().is_symlink();
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    linked |= meta.file_attributes() & 0x400 != 0;
                }
                if linked {
                    return Err("shadow_links_forbidden".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("shadow_path_unavailable".into()),
        }
    }
    Ok(())
}
fn read(path: &Path) -> Result<Value> {
    local(path)?;
    let file = File::open(path).map_err(|_| "shadow_state_unavailable")?;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "shadow_read_failed")?;
    if bytes.len() as u64 > LIMIT {
        return Err("shadow_file_too_large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "shadow_json_invalid".into())
}
fn save(directory: &Path, state: &Value) -> Result<()> {
    let bytes = serde_json::to_vec(state).map_err(|_| "shadow_json_invalid")?;
    let envelope = json!({"state":state,"sha256":format!("{:x}", Sha256::digest(&bytes))});
    let path = directory.join("lifecycle.json");
    let temp = directory.join(format!(".lifecycle-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|_| "shadow_save_failed")?;
        file.write_all(envelope.to_string().as_bytes())
            .map_err(|_| "shadow_save_failed")?;
        file.sync_all().map_err(|_| "shadow_save_failed")?;
        fs::rename(&temp, &path).map_err(|_| "shadow_save_failed")?;
        Ok(())
    })();
    let _ = fs::remove_file(temp);
    result
}
fn load(directory: &Path) -> Result<Value> {
    let envelope = read(&directory.join("lifecycle.json"))?;
    let value = &envelope["state"];
    let bytes = serde_json::to_vec(value).map_err(|_| "shadow_json_invalid")?;
    if envelope["sha256"] != format!("{:x}", Sha256::digest(bytes))
        || value["schema_version"] != "mt5-shadow-lifecycle-v1"
    {
        return Err("shadow_lifecycle_corrupt".into());
    }
    Ok(value.clone())
}
fn heartbeat(directory: &Path, state: &mut Value, phase: &str) -> Result<()> {
    state["heartbeat_at_msc"] = json!(now());
    state["phase"] = json!(phase);
    save(directory, state)
}

fn health(state: &Value, locked: bool, clock: i64) -> &'static str {
    if state["status"] != "running" {
        return "terminal";
    }
    if !locked {
        return "interrupted";
    }
    if state["deadline_msc"]
        .as_i64()
        .is_some_and(|end| clock >= end)
    {
        return "overdue";
    }
    match state["heartbeat_at_msc"].as_i64() {
        Some(beat) if clock < beat || clock - beat > 15000 => "heartbeat_stale",
        Some(_) => "responsive",
        None => "heartbeat_unavailable",
    }
}
fn lock(directory: &Path) -> Result<File> {
    lock_file(directory, true)
}
fn lock_file(directory: &Path, create: bool) -> Result<File> {
    let path = directory.join("session.lock");
    local(&path)?;
    let file = OpenOptions::new()
        .create(create)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| "shadow_lock_failed")?;
    file.try_lock()
        .map_err(|_| "shadow_session_already_running")?;
    Ok(file)
}
fn deadline(plan: &Value, clock: i64, starting: bool) -> Result<i64> {
    let from = plan["capture"]["from_msc"]
        .as_i64()
        .ok_or("shadow_plan_invalid")?;
    let to = plan["capture"]["to_msc"]
        .as_i64()
        .ok_or("shadow_plan_invalid")?;
    let end = plan["deadline_msc"].as_i64().ok_or("shadow_plan_invalid")?;
    // A predecessor completes only after settlement. Python init verifies the
    // frozen completed predecessor before any successor capture is allowed.
    let start_lag = if plan["continuation"].is_object() {
        plan["settle_seconds"]
            .as_i64()
            .filter(|seconds| (30..=120).contains(seconds))
            .ok_or("shadow_plan_invalid")?
            * 1000
            + 60000
    } else {
        60000
    };
    if from < 0
        || to <= from
        || to - from > 86400000
        || end <= to
        || end - to > 180000
        || (starting
            && (from < clock - start_lag || from > clock + 60000 || to <= clock || end <= clock))
    {
        return Err("shadow_plan_time_invalid".into());
    }
    Ok(end)
}
fn interruption(
    directory: &Path,
    wall: i64,
    deadline: i64,
    monotonic_expired: bool,
) -> Option<&'static str> {
    if directory.join("STOP").exists() {
        Some("stopped")
    } else if wall >= deadline || monotonic_expired {
        Some("expired")
    } else {
        None
    }
}

// Only read-side readiness/lock failures may wait. Identity, permissions,
// data revisions and worker/protocol failures still require operator review.
fn transport_retry(state: &mut Value, reason: &str, clock: i64, end: i64) -> Option<i64> {
    if !matches!(
        reason,
        "shadow_native_http_423_mt5_connection_not_ready"
            | "shadow_native_http_503_demo_terminal_busy"
    ) || clock >= end
    {
        return None;
    }
    let prior = &state["transport_retry"];
    let started = if prior.is_null() {
        clock
    } else {
        prior["started_at_msc"].as_i64()?
    };
    let attempts = if prior.is_null() {
        0
    } else {
        prior["attempts"].as_u64()?
    };
    if clock < started || clock - started >= 60000 || attempts >= 6 {
        return None;
    }
    let next = (clock + 10000).min(started + 60000).min(end);
    state["transport_retry"] = json!({"started_at_msc":started,"attempts":attempts+1,
        "reason":reason,"next_poll_msc":next});
    state["transport_retries_total"] =
        json!(state["transport_retries_total"].as_u64().unwrap_or(0) + 1);
    state["updated_at_msc"] = json!(clock);
    Some(next)
}

struct Worker {
    python: PathBuf,
    manifest: PathBuf,
    secret: PathBuf,
    directory: PathBuf,
}
impl Worker {
    async fn call(
        &self,
        action: &str,
        recover: bool,
        end: i64,
        hard_end: tokio::time::Instant,
        mut state: Option<&mut Value>,
    ) -> Result<Value> {
        let mut args = vec![
            "-I".into(),
            "-u".into(),
            SCRIPT.into(),
            action.into(),
            "--manifest".into(),
            self.manifest.to_string_lossy().into_owned(),
            "--state-dir".into(),
            self.directory.to_string_lossy().into_owned(),
        ];
        if action == "step" {
            args.extend([
                "--owner-secret-file".into(),
                self.secret.to_string_lossy().into_owned(),
            ]);
        }
        if recover {
            args.push("--recover".into());
        }
        let environment: Vec<(String, String)> = ["SystemRoot", "WINDIR", "TEMP", "TMP"]
            .iter()
            .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
            .collect();
        let vars: Vec<(&str, &str)> = environment
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let mut child = owned_process::spawn_isolated_with_stdin(
            &self.python,
            &args,
            None,
            &vars,
            owned_process::Limits {
                active_processes: Some(2),
                process_memory_bytes: Some(384 * 1024 * 1024),
            },
            false,
        )
        .map_err(|_| "shadow_worker_start_failed")?;
        child.stdin.take();
        let stdout = child.stdout.take().ok_or("shadow_worker_protocol_failed")?;
        let mut output = Vec::new();
        let collect = async {
            stdout
                .take(LIMIT + 1)
                .read_to_end(&mut output)
                .await
                .map_err(|_| "shadow_worker_protocol_failed")?;
            let exit = child
                .wait()
                .await
                .map_err(|_| "shadow_worker_wait_failed")?;
            if output.len() as u64 > LIMIT {
                return Err("shadow_worker_output_limit".into());
            }
            let value: Value =
                serde_json::from_slice(&output).map_err(|_| "shadow_worker_protocol_failed")?;
            if !exit.success() || value["execution_capability"] != false {
                return Err(value["reason"]
                    .as_str()
                    .filter(|s| s.starts_with("shadow_") || s.starts_with("capture_"))
                    .unwrap_or("shadow_worker_failed")
                    .to_string());
            }
            Ok(value)
        };
        let watch = async {
            let mut beat = tokio::time::Instant::now();
            loop {
                if let Some(reason) = interruption(
                    &self.directory,
                    now(),
                    end,
                    tokio::time::Instant::now() >= hard_end,
                ) {
                    return reason.to_string();
                }
                if beat.elapsed() >= Duration::from_secs(5) {
                    if let Some(value) = state.as_deref_mut() {
                        if let Err(reason) = heartbeat(&self.directory, value, "worker") {
                            return reason;
                        }
                    }
                    beat = tokio::time::Instant::now();
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        };
        tokio::select! {
            value=collect=>value,
            reason=watch=>Err(reason.into()),
            _=tokio::signal::ctrl_c()=>Err("stopped".into()),
            _=tokio::time::sleep(Duration::from_secs(90))=>Err("shadow_worker_timeout".into()),
        }
        // Dropping the existing owned-process Job handle kills the entire
        // worker tree, including if this supervisor is abruptly terminated.
    }
}

async fn run(action: &str, options: HashMap<String, PathBuf>) -> Result<Value> {
    let directory = options
        .get("--state-dir")
        .ok_or("shadow_state_dir_required")?
        .clone();
    local(&directory)?;
    if action == "status" || action == "stop" {
        let mut state = load(&directory)?;
        if action == "stop" {
            local(&directory.join("STOP"))?;
            let mut file = OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(directory.join("STOP"))
                .map_err(|_| "shadow_stop_failed")?;
            file.write_all(b"operator stop\n")
                .map_err(|_| "shadow_stop_failed")?;
            file.sync_all().map_err(|_| "shadow_stop_failed")?;
        }
        let locked = match lock_file(&directory, false) {
            Ok(_guard) => {
                // Completion may commit between the first read and lock release.
                // Re-read under the lock before declaring an interruption.
                state = load(&directory)?;
                false
            }
            Err(reason) if reason == "shadow_session_already_running" => true,
            Err(reason) => return Err(reason),
        };
        if action == "stop" {
            state["stop_requested"] = json!(true);
        }
        state["health"] = json!(health(&state, locked, now()));
        if state["health"] == "interrupted" {
            state["status"] = json!("interrupted");
        }
        return Ok(state);
    }
    let manifest = options
        .get("--manifest")
        .ok_or("shadow_manifest_required")?
        .clone();
    let python = options
        .get("--python")
        .ok_or("shadow_python_required")?
        .clone();
    let secret = options
        .get("--owner-secret-file")
        .ok_or("shadow_secret_file_required")?
        .clone();
    for path in [&manifest, &python, &secret] {
        local(path)?;
        if path.starts_with(&directory) {
            return Err("shadow_inputs_must_be_outside_output".into());
        }
    }
    let plan = read(&manifest)?;
    let end = deadline(&plan, now(), action == "start")?;
    let digest = digest_file(&manifest)?;
    let binary =
        digest_file(&std::env::current_exe().map_err(|_| "shadow_executable_unavailable")?)?;
    let interpreter = digest_file(&python)?;
    let worker = Worker {
        python,
        manifest,
        secret,
        directory: directory.clone(),
    };
    let hard_end = tokio::time::Instant::now() + Duration::from_millis((end - now()).max(0) as u64);
    if action == "start" {
        worker.call("init", false, end, hard_end, None).await?;
    }
    let _guard = lock(&directory)?;
    let mut state = if action == "start" {
        json!({"schema_version":"mt5-shadow-lifecycle-v1","manifest_sha256":digest,"binary_sha256":binary,"python_sha256":interpreter,
            "started_at_msc":now(),"deadline_msc":end,"incarnation":0,"execution_capability":false})
    } else {
        load(&directory)?
    };
    if state["manifest_sha256"] != digest
        || state["binary_sha256"] != binary
        || state["python_sha256"] != interpreter
        || state["deadline_msc"] != end
    {
        return Err("shadow_registration_changed".into());
    }
    if state["status"] == "complete" {
        return Ok(state);
    }
    if now() >= end {
        state["status"] = json!("expired");
        save(&directory, &state)?;
        return Ok(state);
    }
    // An explicit resume elects to clear a previous operator STOP; deadlines
    // and source/registration pins cannot be edited or extended by resuming.
    if action == "resume" && directory.join("STOP").exists() {
        fs::remove_file(directory.join("STOP")).map_err(|_| "shadow_stop_clear_failed")?;
    }
    state["incarnation"] = json!(
        state["incarnation"]
            .as_u64()
            .ok_or("shadow_lifecycle_corrupt")?
            + 1
    );
    state["status"] = json!("running");
    state
        .as_object_mut()
        .ok_or("shadow_lifecycle_corrupt")?
        .remove("reason");
    state
        .as_object_mut()
        .ok_or("shadow_lifecycle_corrupt")?
        .remove("ended_at_msc");
    state["pid"] = json!(std::process::id());
    state["capture_from_msc"] = plan["capture"]["from_msc"].clone();
    state["capture_to_msc"] = plan["capture"]["to_msc"].clone();
    state["settle_seconds"] = plan["settle_seconds"].clone();
    heartbeat(&directory, &mut state, "worker")?;
    let mut recover = action == "resume";
    loop {
        if let Some(reason) = interruption(
            &directory,
            now(),
            end,
            tokio::time::Instant::now() >= hard_end,
        ) {
            state["status"] = json!(reason);
            break;
        }
        heartbeat(&directory, &mut state, "worker")?;
        let outcome = worker
            .call("step", recover, end, hard_end, Some(&mut state))
            .await
            .and_then(|value| {
                let status = value["status"].as_str().unwrap_or_default();
                if !["complete", "waiting", "capturing", "expired", "stopped"].contains(&status)
                    || (["waiting", "capturing"].contains(&status)
                        && value["next_poll_msc"].as_i64().is_none())
                {
                    Err("shadow_worker_protocol_failed".into())
                } else {
                    Ok(value)
                }
            });
        let next_poll = match outcome {
            Ok(value) => {
                recover = false;
                let status = value["status"]
                    .as_str()
                    .ok_or("shadow_worker_protocol_failed")?
                    .to_string();
                if !["complete", "waiting", "capturing", "expired", "stopped"]
                    .contains(&status.as_str())
                {
                    return Err("shadow_worker_protocol_failed".into());
                }
                state["observation"] = value;
                state["updated_at_msc"] = json!(now());
                if !["expired", "stopped"].contains(&status.as_str()) {
                    if let Some(mut retry) =
                        state.as_object_mut().unwrap().remove("transport_retry")
                    {
                        retry["recovered_at_msc"] = json!(now());
                        state["last_transport_retry"] = retry;
                    }
                }
                if ["complete", "expired", "stopped"].contains(&status.as_str()) {
                    state["status"] = json!(status);
                    break;
                }
                state["observation"]["next_poll_msc"]
                    .as_i64()
                    .ok_or("shadow_worker_protocol_failed")?
                    .min(end)
            }
            Err(reason) => {
                if let Some(next) = transport_retry(&mut state, &reason, now(), end) {
                    // A worker may have durably appended a page before its read
                    // failed. Re-audit the whole prefix on the next attempt.
                    recover = true;
                    next
                } else {
                    state["status"] = json!(if ["stopped", "expired"].contains(&reason.as_str()) {
                        reason.as_str()
                    } else {
                        "failed"
                    });
                    state["reason"] = json!(reason);
                    break;
                }
            }
        };
        let phase = if state["transport_retry"].is_object() {
            "retry_wait"
        } else if state["observation"]["status"] == "waiting" {
            "settling"
        } else {
            "poll_wait"
        };
        heartbeat(&directory, &mut state, phase)?;
        let mut beat = tokio::time::Instant::now();
        while now() < next_poll
            && interruption(
                &directory,
                now(),
                end,
                tokio::time::Instant::now() >= hard_end,
            )
            .is_none()
        {
            if beat.elapsed() >= Duration::from_secs(5) {
                heartbeat(&directory, &mut state, phase)?;
                beat = tokio::time::Instant::now();
            }
            tokio::select! {
                _=tokio::time::sleep(Duration::from_millis(200))=>(),
                _=tokio::signal::ctrl_c()=>{state["status"]=json!("stopped");state["ended_at_msc"]=json!(now());heartbeat(&directory,&mut state,"terminal")?;return Ok(state);}
            }
        }
    }
    state["ended_at_msc"] = json!(now());
    heartbeat(&directory, &mut state, "terminal")?;
    Ok(state)
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let action = args.next().unwrap_or_default();
    let mut options = HashMap::new();
    while let Some(key) = args.next() {
        let Some(value) = args.next() else {
            eprintln!("shadow_argument_invalid");
            std::process::exit(2)
        };
        if ![
            "--state-dir",
            "--manifest",
            "--python",
            "--owner-secret-file",
        ]
        .contains(&key.as_str())
            || options.insert(key, PathBuf::from(value)).is_some()
        {
            eprintln!("shadow_argument_invalid");
            std::process::exit(2);
        }
    }
    let result = if ["start", "resume", "status", "stop"].contains(&action.as_str()) {
        run(&action, options).await
    } else {
        Err("shadow_action_invalid".into())
    };
    match result {
        Ok(value) => {
            println!("{value}");
            if value["status"] == "failed" {
                std::process::exit(2);
            }
        }
        Err(reason) => {
            eprintln!(
                "{}",
                json!({"status":"error","reason":reason,"execution_capability":false})
            );
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn status_without_lock_file_fails_without_creating_one() {
        let dir = std::env::temp_dir().join(format!("shadow-status-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        save(
            &dir,
            &json!({"schema_version":"mt5-shadow-lifecycle-v1","status":"running"}),
        )
        .unwrap();
        let before = fs::read(dir.join("lifecycle.json")).unwrap();
        let result = run(
            "status",
            HashMap::from([("--state-dir".into(), dir.clone())]),
        )
        .await;
        assert_eq!(result.unwrap_err(), "shadow_lock_failed");
        assert!(!dir.join("session.lock").exists());
        assert_eq!(fs::read(dir.join("lifecycle.json")).unwrap(), before);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn health_separates_quiet_progress_from_dead_or_unresponsive_supervisor() {
        let mut state = json!({"status":"running", "heartbeat_at_msc":20000,
            "updated_at_msc":1,"deadline_msc":100000});
        assert_eq!(health(&state, true, 30000), "responsive");
        assert_eq!(health(&state, true, 35001), "heartbeat_stale");
        assert_eq!(health(&state, true, 100000), "overdue");
        assert_eq!(health(&state, false, 30000), "interrupted");
        state.as_object_mut().unwrap().remove("heartbeat_at_msc");
        assert_eq!(health(&state, true, 30000), "heartbeat_unavailable");
        state["status"] = json!("failed");
        assert_eq!(health(&state, false, 30000), "terminal");
    }
    #[test]
    fn transient_read_budget_survives_reload_and_never_extends_deadline() {
        let dir = std::env::temp_dir().join(format!("shadow-retry-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let mut state = json!({"schema_version":"mt5-shadow-lifecycle-v1"});
        let reason = "shadow_native_http_423_mt5_connection_not_ready";
        assert_eq!(
            transport_retry(&mut state, reason, 1000, 999999),
            Some(11000)
        );
        save(&dir, &state).unwrap();
        state = load(&dir).unwrap();
        for index in 1..6 {
            assert_eq!(
                transport_retry(&mut state, reason, 1000 + index * 10000, 999999),
                Some(11000 + index * 10000)
            );
        }
        assert_eq!(state["transport_retry"]["attempts"], 6);
        assert!(transport_retry(&mut state, reason, 61000, 999999).is_none());
        let mut fresh = json!({});
        assert_eq!(transport_retry(&mut fresh, reason, 1000, 5000), Some(5000));
        assert!(transport_retry(&mut fresh, reason, 5000, 5000).is_none());
        assert!(transport_retry(&mut fresh, reason, 999, 999999).is_none());
        let mut late = json!({});
        transport_retry(&mut late, reason, 1000, 999999).unwrap();
        assert!(transport_retry(&mut late, reason, 61000, 999999).is_none());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retry_allowlist_excludes_identity_data_auth_and_unknown_errors() {
        for reason in [
            "shadow_native_http_401_unavailable",
            "shadow_native_http_423_mt5_permissions_unverified",
            "shadow_native_http_503_demo_identity_changed",
            "capture_binding_changed",
            "shadow_observed_window_revised",
            "shadow_worker_timeout",
            "stopped",
            "expired",
        ] {
            let mut state = json!({});
            assert!(transport_retry(&mut state, reason, 1000, 100000).is_none());
            assert_eq!(state, json!({}));
        }
        let mut state = json!({});
        assert!(
            transport_retry(
                &mut state,
                "shadow_native_http_503_demo_terminal_busy",
                1000,
                100000
            )
            .is_some()
        );
    }

    #[test]
    fn bounded_forward_registration_and_deadline_cannot_be_extended_on_resume() {
        let plan = json!({"capture":{"from_msc":100000,"to_msc":130000},"deadline_msc":170000});
        assert_eq!(deadline(&plan, 101000, true).unwrap(), 170000);
        assert!(deadline(&plan, 200000, true).is_err());
        assert_eq!(deadline(&plan, 200000, false).unwrap(), 170000);
        assert!(
            deadline(
                &json!({"capture":{"from_msc":0,"to_msc":86400001},"deadline_msc":86440000}),
                0,
                false
            )
            .is_err()
        );
    }
    #[test]
    fn continuation_start_allows_settlement_but_not_unbounded_backdating() {
        let mut plan = json!({"capture":{"from_msc":100000,"to_msc":500000},
            "deadline_msc":590000,"settle_seconds":120,"continuation":{"state_dir":"fixture"}});
        assert_eq!(deadline(&plan, 280000, true).unwrap(), 590000);
        assert!(deadline(&plan, 280001, true).is_err());
        plan["settle_seconds"] = json!(30);
        assert_eq!(deadline(&plan, 190000, true).unwrap(), 590000);
        assert!(deadline(&plan, 190001, true).is_err());
        plan["settle_seconds"] = json!(121);
        assert!(deadline(&plan, 150000, true).is_err());
        plan["continuation"] = Value::Null;
        assert!(deadline(&plan, 160001, true).is_err());
        assert_eq!(deadline(&plan, 160000, true).unwrap(), 590000);
    }
    #[test]
    fn lifecycle_is_atomic_checksummed_and_single_writer() {
        let dir = std::env::temp_dir().join(format!("shadow-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let state = json!({"schema_version":"mt5-shadow-lifecycle-v1","status":"running"});
        let guard = lock(&dir).unwrap();
        assert!(lock(&dir).is_err());
        save(&dir, &state).unwrap();
        assert_eq!(load(&dir).unwrap(), state);
        save(
            &dir,
            &json!({"schema_version":"mt5-shadow-lifecycle-v1","status":"complete"}),
        )
        .unwrap();
        assert_eq!(load(&dir).unwrap()["status"], "complete");
        assert_eq!(interruption(&dir, 200, 200, false), Some("expired"));
        assert_eq!(interruption(&dir, 199, 200, true), Some("expired"));
        fs::write(dir.join("STOP"), b"stop").unwrap();
        assert_eq!(interruption(&dir, 199, 200, false), Some("stopped"));
        fs::write(dir.join("lifecycle.json"), b"{}").unwrap();
        assert!(load(&dir).is_err());
        drop(guard);
        fs::remove_dir_all(dir).unwrap();
    }
}
