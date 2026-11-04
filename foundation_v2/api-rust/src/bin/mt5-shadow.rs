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
fn lock(directory: &Path) -> Result<File> {
    let path = directory.join("session.lock");
    local(&path)?;
    let file = OpenOptions::new()
        .create(true)
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
            loop {
                if let Some(reason) = interruption(
                    &self.directory,
                    now(),
                    end,
                    tokio::time::Instant::now() >= hard_end,
                ) {
                    return reason;
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
            state["stop_requested"] = json!(true);
        }
        if state["status"] == "running" && lock(&directory).is_ok() {
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
        worker.call("init", false, end, hard_end).await?;
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
    save(&directory, &state)?;
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
        let outcome = worker.call("step", recover, end, hard_end).await;
        recover = false;
        match outcome {
            Ok(value) => {
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
                if ["complete", "expired", "stopped"].contains(&status.as_str()) {
                    state["status"] = json!(status);
                    break;
                }
                save(&directory, &state)?;
                let next_poll = state["observation"]["next_poll_msc"]
                    .as_i64()
                    .ok_or("shadow_worker_protocol_failed")?
                    .min(end);
                loop {
                    if now() >= next_poll
                        || interruption(
                            &directory,
                            now(),
                            end,
                            tokio::time::Instant::now() >= hard_end,
                        )
                        .is_some()
                    {
                        break;
                    }
                    tokio::select! {
                        _=tokio::time::sleep(Duration::from_millis(200))=>(),
                        _=tokio::signal::ctrl_c()=>{state["status"]=json!("stopped");save(&directory,&state)?;return Ok(state);}
                    }
                }
            }
            Err(reason) => {
                state["status"] = json!(if ["stopped", "expired"].contains(&reason.as_str()) {
                    reason.as_str()
                } else {
                    "failed"
                });
                state["reason"] = json!(reason);
                break;
            }
        }
    }
    state["ended_at_msc"] = json!(now());
    save(&directory, &state)?;
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
