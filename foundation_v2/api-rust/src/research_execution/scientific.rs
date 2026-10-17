//! The pinned scientific adapter supplies native fills. Rust owns orchestration,
//! lease cancellation, accounting, source validation and durable publication.
use super::{reference, scientific_normalize};
use crate::{owned_process, research_jobs};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::io::AsyncReadExt;

type R<T> = Result<T, String>;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> R<Self> {
        let parent = std::env::temp_dir()
            .canonicalize()
            .map_err(|_| "scientific scratch unavailable")?;
        let root = parent.join(format!("tw-native-scientific-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).map_err(|_| "scientific scratch unavailable")?;
        Ok(Self(root))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        // Only this freshly created UUID directory is owned by this execution.
        // It is never reconstructed from a protocol, job ID or adapter output.
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn capability(root: &Path, descriptor: &Path, protocol: &Value) -> R<Value> {
    let engine = &protocol["engine"];
    let hash = engine["code_sha256"]
        .as_str()
        .ok_or("invalid scientific engine identity")?;
    if research_jobs::adapter::engine_code_hash(root)? != hash {
        return Err("engine code hash no longer matches queued protocol".into());
    }
    let pinned = research_jobs::adapter::descriptor(root, descriptor, hash)?;
    if engine["backend"] != "nautilus"
        || engine["native_version"] != "1.231.0"
        || engine["adapter_version"] != "nautilus-breakout-v1"
        || engine["adapter_sha256"] != pinned["adapter_sha256"]
        || engine["runtime_identity"] != pinned["runtime_identity"]
    {
        return Err("scientific adapter capability differs from queued protocol".into());
    }
    Ok(pinned)
}

async fn run_adapter(
    child: &mut owned_process::Child,
    check: &impl Fn() -> R<()>,
    deadline: Instant,
) -> R<()> {
    let mut stdout = child.stdout.take().ok_or("scientific stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("scientific stderr unavailable")?;
    let mut output = [0u8; 8192];
    let mut errors = [0u8; 8192];
    let (mut output_bytes, mut error_bytes) = (0usize, 0usize);
    let (mut stdout_eof, mut stderr_eof) = (false, false);
    let mut status = None;
    let mut tick = tokio::time::interval(Duration::from_millis(20));
    let result = async {
        loop {
            check()?;
            if Instant::now() >= deadline { return Err("run exceeded budget.max_runtime_ms".into()); }
            if stdout_eof && stderr_eof && status.is_some() { break; }
            tokio::select! {
                exited = child.wait(), if status.is_none() => { status = Some(exited.map_err(|_| "scientific adapter wait failed")?); }
                read = stdout.read(&mut output), if !stdout_eof => {
                    let count = read.map_err(|_| "scientific adapter output failed")?;
                    stdout_eof = count == 0; output_bytes += count;
                    if output_bytes > 1024*1024 { return Err("scientific adapter output budget exceeded".into()); }
                }
                read = stderr.read(&mut errors), if !stderr_eof => {
                    let count = read.map_err(|_| "scientific adapter output failed")?;
                    stderr_eof = count == 0; error_bytes += count;
                    if error_bytes > 1024*1024 { return Err("scientific adapter output budget exceeded".into()); }
                }
                _ = tick.tick() => {}
            }
        }
        if !status.unwrap().success() { return Err("scientific adapter process failed".into()); }
        Ok(())
    }.await;
    if result.is_err() {
        let _ = child.kill().await;
    }
    result
}

pub(super) fn execute(
    rows: &[Value],
    protocol: &Value,
    root: &Path,
    descriptor: &Path,
    check: &impl Fn() -> R<()>,
    deadline: Instant,
) -> R<Value> {
    tokio::runtime::Handle::try_current()
        .map_err(|_| "scientific orchestration requires worker runtime")?
        .block_on(execute_async(
            rows, protocol, root, descriptor, check, deadline,
        ))
}

async fn execute_async(
    rows: &[Value],
    protocol: &Value,
    root: &Path,
    descriptor: &Path,
    check: &impl Fn() -> R<()>,
    deadline: Instant,
) -> R<Value> {
    check()?;
    if Instant::now() >= deadline {
        return Err("run exceeded budget.max_runtime_ms".into());
    }
    capability(root, descriptor, protocol)?;
    let memory = protocol["budget"]["max_memory_mb"]
        .as_u64()
        .filter(|v| (256..=4096).contains(v))
        .ok_or("scientific memory budget is invalid")?;
    let scratch = Scratch::new()?;
    let input = scratch.0.join("input.json");
    let output = scratch.0.join("result.json");
    #[derive(serde::Serialize)]
    struct Input<'a> {
        rows: &'a [Value],
        protocol: &'a Value,
    }
    let payload = Input { rows, protocol };
    let mut source = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&input)
        .map_err(|_| "scientific input unavailable")?;
    serde_json::to_writer(&mut source, &payload).map_err(|_| "scientific input invalid")?;
    source
        .flush()
        .and_then(|_| source.sync_all())
        .map_err(|_| "scientific input unavailable")?;
    drop(source);
    check()?;
    let runtime = root.join("engine_runtime");
    let args = [
        "-I".into(),
        runtime.join("run.py").to_string_lossy().into_owned(),
        "--input".into(),
        input.to_string_lossy().into_owned(),
        "--output".into(),
        output.to_string_lossy().into_owned(),
        "--source-hash".into(),
        protocol["engine"]["adapter_sha256"]
            .as_str()
            .ok_or("invalid scientific identity")?
            .into(),
        "--memory-mb".into(),
        memory.to_string(),
    ];
    // The venv launcher briefly needs a second process. The pinned adapter applies
    // its existing one-process ceiling before importing Nautilus. Both are owned
    // atomically from creation, including a crash during launcher startup.
    let mut child = owned_process::spawn(
        &runtime.join(".venv/Scripts/python.exe"),
        &args,
        Some(&runtime),
        &[
            ("OMP_NUM_THREADS", "1"),
            ("OPENBLAS_NUM_THREADS", "1"),
            ("MKL_NUM_THREADS", "1"),
        ],
        owned_process::Limits {
            active_processes: None,
            process_memory_bytes: Some(memory as usize * 1024 * 1024),
        },
        true,
    )
    .map_err(|_| "scientific adapter spawn failed")?;
    run_adapter(&mut child, check, deadline).await?;
    // Closing the job kills any unexpected surviving descendants before reading
    // and validating the result or cleaning up scratch files.
    child
        .kill()
        .await
        .map_err(|_| "scientific adapter cleanup failed")?;
    drop(child);
    check()?;
    capability(root, descriptor, protocol)?;
    super::regular_path(&output)?;
    let mut source =
        fs::File::open(&output).map_err(|_| "Nautilus output missing or adapter changed")?;
    let bound = (memory * 1024 * 1024 / 2).min(256 * 1024 * 1024);
    if source
        .metadata()
        .map_err(|_| "scientific output unavailable")?
        .len()
        > bound
    {
        return Err("scientific result exceeds memory budget".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut source)
        .take(bound + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "scientific output unavailable")?;
    if bytes.len() as u64 > bound {
        return Err("scientific result exceeds memory budget".into());
    }
    let mut native: Value =
        serde_json::from_slice(&bytes).map_err(|_| "scientific output invalid")?;
    drop(bytes);
    native["isolation"]
        .as_object_mut()
        .ok_or("scientific isolation evidence missing")?
        .insert("worker_owned_job_object".into(), json!(true));
    let mut result = scientific_normalize::normalize(&native, protocol, check)?;
    drop(native);
    // Each fill and metric must reconcile to the immutable source rows before
    // the caller can publish a candidate, including OOS/stress slices.
    result["artifact_schema_version"] = json!("research-engine-result-v1");
    result["protocol"] = protocol.clone();
    result["protocol_sha256"] = json!(format!(
        "{:x}",
        <sha2::Sha256 as sha2::Digest>::digest(research_jobs::canonical_py_json(protocol)?)
    ));
    for (key, value) in [
        ("playbook_id", &protocol["playbook"]["record_id"]),
        ("playbook_revision", &protocol["playbook"]["revision"]),
        ("dataset_sha256", &protocol["dataset"]["artifact_sha256"]),
        ("engine_code_sha256", &protocol["engine"]["code_sha256"]),
        ("split", &protocol["split"]),
    ] {
        result[key] = value.clone();
    }
    reference::independent::validate(&result, rows, check)?;
    for key in [
        "artifact_schema_version",
        "protocol",
        "protocol_sha256",
        "playbook_id",
        "playbook_revision",
        "dataset_sha256",
        "engine_code_sha256",
        "split",
    ] {
        result.as_object_mut().unwrap().remove(key);
    }
    check()?;
    if Instant::now() >= deadline {
        return Err("run exceeded budget.max_runtime_ms".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_deadline_and_output_budget_reap_the_adapter() {
        let python = research_jobs::adapter::foundation_root().join(".venv/Scripts/python.exe");
        for mode in ["cancel", "deadline", "output"] {
            let code = if mode == "output" {
                "import sys;sys.stdout.write('x'*2097152);sys.stdout.flush()"
            } else {
                "import time;time.sleep(60)"
            };
            let mut child = owned_process::spawn(
                &python,
                &["-I".into(), "-c".into(), code.into()],
                None,
                &[],
                owned_process::Limits::default(),
                true,
            )
            .unwrap();
            let started = Instant::now();
            let check = || {
                if mode == "cancel" && started.elapsed() > Duration::from_millis(100) {
                    Err("research_execution_interrupted".into())
                } else {
                    Ok(())
                }
            };
            let deadline = Instant::now()
                + if mode == "deadline" {
                    Duration::from_millis(100)
                } else {
                    Duration::from_secs(5)
                };
            let error = run_adapter(&mut child, &check, deadline).await.unwrap_err();
            assert_eq!(
                error,
                match mode {
                    "cancel" => "research_execution_interrupted",
                    "deadline" => "run exceeded budget.max_runtime_ms",
                    _ => "scientific adapter output budget exceeded",
                }
            );
            assert!(child.try_wait().unwrap().is_some());
            assert!(started.elapsed() < Duration::from_secs(3));
        }
    }
    #[tokio::test]
    #[ignore = "pinned installed offline scientific runtime and synthetic source only"]
    async fn actual_native_adapter_oracle() {
        let fixture: Value = serde_json::from_slice(
            &fs::read(std::env::var("TW_NATIVE_SCIENTIFIC_ORACLE").unwrap()).unwrap(),
        )
        .unwrap();
        let descriptor =
            PathBuf::from(std::env::var_os("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY").unwrap());
        let root = research_jobs::adapter::foundation_root();
        let mut count = 0;
        for case in fixture.as_array().unwrap() {
            let rows = case["rows"].as_array().unwrap();
            let protocol = &case["protocol"];
            let result = execute_async(
                rows,
                protocol,
                &root,
                &descriptor,
                &|| Ok(()),
                Instant::now() + Duration::from_secs(20),
            )
            .await;
            let mut result = result.unwrap_or_else(|error| panic!("{}: {error}", case["name"]));
            let mut expected = case["expected"]["value"].clone();
            // Engine elapsed time and generated native IDs are deliberately
            // independent between actual engine executions. Money/source fields
            // and assumptions must still exactly match the Python oracle.
            for item in [&mut result, &mut expected] {
                item["observed_range"]
                    .as_object_mut()
                    .unwrap()
                    .remove("elapsed_ms");
                item.as_object_mut().unwrap().remove("execution");
                for trade in item["ledger"].as_array_mut().unwrap() {
                    trade.as_object_mut().unwrap().remove("execution_link");
                }
            }
            assert_eq!(
                research_jobs::canonical_py_json(&result).unwrap(),
                research_jobs::canonical_py_json(&expected).unwrap(),
                "{}",
                case["name"]
            );
            count += 1;
        }
        assert!(count >= 2);
        let case = &fixture[0];
        let error = execute_async(
            case["rows"].as_array().unwrap(),
            &case["protocol"],
            &root,
            &descriptor,
            &|| Err("research_execution_interrupted".into()),
            Instant::now() + Duration::from_secs(20),
        )
        .await
        .unwrap_err();
        assert_eq!(error, "research_execution_interrupted");
        println!(
            "{}",
            json!({"actual_offline_cases":count,"pre_spawn_cancel":true})
        );
    }
}
