//! Native close-delta research worker. PostgreSQL leases own every publication.
pub mod oos_runner;
pub mod reference;
mod scientific;
mod scientific_normalize;
use crate::{
    artifact_data::{ArtifactData, TimingQuery},
    research_jobs::{
        self,
        lifecycle::{self, ClaimedJob},
    },
    state::AppState,
};
use bigdecimal::{BigDecimal, FromPrimitive, RoundingMode, ToPrimitive};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}
fn checked(flag: &AtomicBool) -> Result<(), String> {
    if flag.load(Ordering::Acquire) {
        Ok(())
    } else {
        Err("research_execution_interrupted".into())
    }
}

// Python round(float, 8) rounds the original binary value, not a scaled f64.
// A decimal conversion through shortest display text changes halfway results.
fn round_eight(value: f64) -> Result<f64, String> {
    if !value.is_finite() {
        return Err("research_close_delta_nonfinite".into());
    }
    let result = BigDecimal::from_f64(value)
        .ok_or("research_close_delta_nonfinite")?
        .with_scale_round(8, RoundingMode::HalfEven)
        .to_f64()
        .ok_or("research_close_delta_nonfinite")?;
    Ok(if result == 0.0 && value.is_sign_negative() {
        -0.0
    } else {
        result
    })
}

pub fn close_delta_result(
    job: &ClaimedJob,
    sha: &str,
    closes: &[f64],
    created: &str,
    continue_check: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    if job.strategy_version != "close-delta-v1" || job.protocol.is_some() {
        return Err("unsupported_native_research_job".into());
    }
    if closes.len() < 2 {
        return Err("research_dataset_requires_two_rows".into());
    }
    let mut ledger = Vec::with_capacity(closes.len() - 1);
    for (index, pair) in closes.windows(2).enumerate() {
        if index % 256 == 0 {
            continue_check()?;
        }
        let net = round_eight((pair[1] - pair[0]) * 100.0)?;
        ledger.push(json!({"trade_id":format!("{}-{}",job.job_id,index+1),"net_pnl":net,"gross_pnl":net,"fees":0.0,"planned_risk_budget":100.0}));
    }
    continue_check()?;
    let metrics = crate::analytics::compute_metrics_v2(&ledger, &json!(job.starting_balance))?;
    continue_check()?;
    Ok(
        json!({"contract_version":crate::CONTRACT_VERSION,"job_id":job.job_id,"workspace_id":job.workspace_id,"dataset_id":job.dataset_id,"dataset_sha256":sha,"strategy_version":job.strategy_version,"metrics_schema_version":metrics["metric_schema_version"],"metrics":metrics,"trade_count":ledger.len(),"created_at_utc":created}),
    )
}

fn component(value: &str) -> Result<(), String> {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.is_empty()
        || matches!(value, "." | "..")
        || value.ends_with(['.', ' '])
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
        || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("invalid_research_artifact_component".into());
    }
    Ok(())
}
fn regular_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "research_artifact_unavailable")?;
    if metadata.file_type().is_symlink() {
        return Err("research_artifact_reparse_point".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("research_artifact_reparse_point".into());
        }
    }
    Ok(())
}
fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::fs::File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|_| "research_artifact_sync_failed")?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn move_created(source: &Path, target: &Path) -> Result<(), String> {
    crate::artifact_data::publish_created_file(source, target)
        .map_err(|_| "research_artifact_publication_failed".into())
}

pub struct ResultCandidates {
    root: PathBuf,
}
impl ResultCandidates {
    pub fn new(root: &Path) -> Result<Self, String> {
        regular_path(root)?;
        let root = root
            .canonicalize()
            .map_err(|_| "research_artifact_root_unavailable")?;
        if !root.is_dir() {
            return Err("research_artifact_root_unavailable".into());
        }
        Ok(Self { root })
    }
    fn path(&self, parts: &[&str], create_parents: bool) -> Result<PathBuf, String> {
        let mut result = self.root.clone();
        for (index, part) in parts.iter().enumerate() {
            component(part)?;
            result.push(part);
            if create_parents && index + 1 < parts.len() {
                match fs::create_dir(&result) {
                    Ok(()) => sync_directory(result.parent().unwrap())?,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(_) => return Err("research_artifact_directory_failed".into()),
                }
            }
            if result
                .try_exists()
                .map_err(|_| "research_artifact_unavailable")?
            {
                regular_path(&result)?;
                if index + 1 < parts.len() && !result.is_dir() {
                    return Err("research_artifact_parent_invalid".into());
                }
            }
        }
        Ok(result)
    }
    pub fn publish(&self, job: &ClaimedJob, value: &Value) -> Result<(String, String), String> {
        if job.attempt_no <= 0 {
            return Err("invalid_research_attempt".into());
        }
        let legacy = format!("{}.json", job.job_id);
        if self
            .path(&[&job.workspace_id, "results", &legacy], false)?
            .exists()
        {
            return Err("legacy_research_result_exists".into());
        }
        let token = format!("{:x}", Sha256::digest(job.lease_token.as_bytes()));
        let name = format!("attempt-{:06}-{}.json", job.attempt_no, &token[..16]);
        let target = self.path(&[&job.workspace_id, "results", &job.job_id, &name], true)?;
        if target.exists() {
            return Err("research_candidate_exists".into());
        }
        let bytes = research_jobs::canonical_py_json(value)?;
        let sha = format!("{:x}", Sha256::digest(&bytes));
        let temporary =
            target.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()));
        let written = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(|_| "research_artifact_write_failed")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "research_artifact_sync_failed")?;
            drop(file);
            move_created(&temporary, &target)
        })();
        let _ = fs::remove_file(&temporary);
        written?;
        Ok((
            format!("{}/results/{}/{}", job.workspace_id, job.job_id, name),
            sha,
        ))
    }
    pub fn quarantine(&self, relative: &str) -> Result<Option<String>, String> {
        let parts: Vec<&str> = relative.split('/').collect();
        if parts.len() != 4 || parts[1] != "results" || !parts[3].starts_with("attempt-") {
            return Err("invalid_research_candidate_path".into());
        }
        let source = self.path(&parts, false)?;
        let target = self.path(
            &[parts[0], "quarantine", "results", parts[2], parts[3]],
            true,
        )?;
        if !source.exists() {
            return Ok(target
                .exists()
                .then(|| format!("{}/quarantine/results/{}/{}", parts[0], parts[2], parts[3])));
        }
        if target.exists() && crate::artifact_data::same_file(&source, &target) {
            fs::remove_file(&source).map_err(|_| "research_candidate_cleanup_failed")?;
            sync_directory(source.parent().ok_or("research_artifact_parent_missing")?)?;
            return Ok(Some(format!(
                "{}/quarantine/results/{}/{}",
                parts[0], parts[2], parts[3]
            )));
        }
        if let Err(error) = move_created(&source, &target) {
            if source.exists() || !target.exists() {
                return Err(error);
            }
        }
        Ok(Some(format!(
            "{}/quarantine/results/{}/{}",
            parts[0], parts[2], parts[3]
        )))
    }
    fn quarantine_through(&self, workspace: &str, job: &str, attempt: i32) -> Result<(), String> {
        let folder = self.path(&[workspace, "results", job], false)?;
        if !folder.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(folder).map_err(|_| "research_candidate_cleanup_failed")? {
            let entry = entry.map_err(|_| "research_candidate_cleanup_failed")?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "research_candidate_cleanup_failed")?;
            if let Some(value) = name
                .strip_prefix("attempt-")
                .and_then(|s| s.split('-').next())
                .and_then(|s| s.parse::<i32>().ok())
                && value <= attempt
                && name.ends_with(".json")
            {
                self.quarantine(&format!("{workspace}/results/{job}/{name}"))?;
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct WorkerOptions {
    pub worker_id: String,
    pub lease_seconds: i32,
    pub max_active_jobs: i64,
    pub shutdown_file: Option<PathBuf>,
}
impl WorkerOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.worker_id.trim().is_empty()
            || self.worker_id.len() > 200
            || self.worker_id.chars().any(char::is_control)
            || !(3..=3600).contains(&self.lease_seconds)
            || !(1..=128).contains(&self.max_active_jobs)
        {
            return Err("invalid_native_research_worker_options".into());
        }
        Ok(())
    }
}
#[derive(Debug, PartialEq)]
pub enum RunOutcome {
    Idle,
    Completed(String),
    Interrupted(String),
}

struct LeaseGuard {
    owned: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}
impl LeaseGuard {
    fn new(state: Arc<AppState>, job: ClaimedJob, seconds: i32) -> Self {
        let owned = Arc::new(AtomicBool::new(true));
        let flag = owned.clone();
        let task = tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_millis(
                (i64::from(seconds) * 1000 / 3).clamp(100, 10000) as u64,
            ));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                timer.tick().await;
                let renewed = async {
                    let mut client = state.pool.get().await.map_err(|_| ())?;
                    let tx = client.transaction().await.map_err(|_| ())?;
                    let ok = lifecycle::renew(&tx, &job, seconds).await.map_err(|_| ())?;
                    tx.commit().await.map_err(|_| ())?;
                    Ok::<_, ()>(ok)
                }
                .await;
                if renewed != Ok(true) {
                    flag.store(false, Ordering::Release);
                    break;
                }
            }
        });
        Self { owned, task }
    }
}
impl Drop for LeaseGuard {
    fn drop(&mut self) {
        self.owned.store(false, Ordering::Release);
        self.task.abort();
    }
}

async fn save_checkpoint_progress(
    state: &AppState,
    job: &ClaimedJob,
    phase: &str,
    fields: Value,
    progress: Value,
) -> Result<bool, String> {
    let mut value =
        json!({"schema":"research-job-checkpoint-v1","phase":phase,"attempt_no":job.attempt_no});
    value.as_object_mut().unwrap().extend(
        fields
            .as_object()
            .ok_or("invalid_checkpoint_fields")?
            .clone(),
    );
    let mut client = state
        .pool
        .get()
        .await
        .map_err(|_| "research_database_unavailable")?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| "research_database_unavailable")?;
    let ok = lifecycle::checkpoint(&tx, job, value, Some(progress)).await?;
    tx.commit()
        .await
        .map_err(|_| "research_database_unavailable")?;
    Ok(ok)
}
async fn save_checkpoint(
    state: &AppState,
    job: &ClaimedJob,
    phase: &str,
    fields: Value,
    index: u32,
) -> Result<bool, String> {
    save_checkpoint_progress(
        state,
        job,
        phase,
        fields,
        json!({"phase_index":index,"phase_count":4}),
    )
    .await
}

fn dataset_snapshot(manifest: &Value) -> Value {
    let mut out = json!({});
    for key in [
        "dataset_id",
        "artifact_sha256",
        "normalized_sha256",
        "instrument_spec",
        "timeframe_seconds",
        "transform_version",
        "quality",
        "holdout_policy",
        "source",
    ] {
        out[key] = manifest[key].clone();
    }
    if out["holdout_policy"].is_null() {
        out["holdout_policy"] = json!({"mode":"none"})
    }
    if out["quality"].is_null() {
        out["quality"] = json!({})
    }
    out
}
fn validate_protocol(job: &ClaimedJob, manifest: &Value, engine_hash: &str) -> Result<(), String> {
    let protocol = job.protocol.as_ref().ok_or("research_protocol_missing")?;
    if job.protocol_sha256.as_deref()
        != Some(
            format!(
                "{:x}",
                Sha256::digest(research_jobs::canonical_py_json(protocol)?)
            )
            .as_str(),
        )
    {
        return Err("queued protocol hash mismatch".into());
    }
    if research_jobs::canonical_py_json(&protocol["dataset"])?
        != research_jobs::canonical_py_json(&dataset_snapshot(manifest))?
    {
        return Err("dataset snapshot changed after job creation".into());
    }
    if !matches!(
        protocol["engine"]["backend"].as_str(),
        Some("reference" | "nautilus")
    ) || protocol["engine"]["version"] != "bar-breakout-v1"
    {
        return Err("unsupported_native_research_job".into());
    }
    if protocol["engine"]["code_sha256"] != engine_hash {
        return Err("engine code hash no longer matches queued protocol".into());
    }
    let from = protocol["range"]["from_utc"]
        .as_i64()
        .ok_or("research_protocol_range_invalid")?;
    let to = protocol["range"]["to_utc"]
        .as_i64()
        .ok_or("research_protocol_range_invalid")?;
    if from >= to
        || from
            < manifest["first_timestamp"]
                .as_i64()
                .ok_or("research_dataset_time_invalid")?
        || manifest["last_timestamp"]
            .as_i64()
            .and_then(|last| {
                manifest["timeframe_seconds"]
                    .as_i64()
                    .and_then(|tf| last.checked_add(tf))
            })
            .is_none_or(|end| to > end)
    {
        return Err("research_protocol_range_invalid".into());
    }
    Ok(())
}

fn engine_result(
    job: &ClaimedJob,
    rows: &[Value],
    manifest: &Value,
    engine_hash: &str,
    owned: &AtomicBool,
    started: Instant,
    deadline: Instant,
    scientific_descriptor: &Path,
    checkpoint: impl FnMut(&[Value]) -> Result<(), String>,
) -> Result<Value, String> {
    validate_protocol(job, manifest, engine_hash)?;
    let protocol = job.protocol.as_ref().unwrap();
    let check = || {
        checked(owned)?;
        if Instant::now() >= deadline {
            Err("run exceeded budget.max_runtime_ms".into())
        } else {
            Ok(())
        }
    };
    let scientific_root = research_jobs::adapter::foundation_root();
    let scientific = protocol["engine"]["backend"] == "nautilus";
    if scientific {
        scientific::verify_installation(&scientific_root, scientific_descriptor, protocol, &check)?;
    }
    let mut result = json!({"artifact_schema_version":"research-engine-result-v1","contract_version":crate::CONTRACT_VERSION,"job_id":job.job_id,"workspace_id":job.workspace_id,"dataset_id":job.dataset_id,"dataset_sha256":manifest["artifact_sha256"],"protocol_sha256":job.protocol_sha256,"protocol":protocol,"playbook_id":protocol["playbook"]["record_id"],"playbook_revision":protocol["playbook"]["revision"],"engine_version":"bar-breakout-v1","engine_code_sha256":engine_hash,"split":protocol["split"],"created_at_utc":now(),"regime_partition":null});
    let partition = oos_runner::materialize_regime(protocol, rows, manifest)?;
    result["regime_partition"] = partition.clone().unwrap_or(Value::Null);
    if protocol.get("validation").is_some_and(|v| !v.is_null()) {
        let computed = oos_runner::execute_with_engine(
            rows,
            protocol,
            manifest,
            deadline,
            &check,
            checkpoint,
            |source, slice, deadline| {
                if protocol["engine"]["backend"] == "nautilus" {
                    scientific::execute(
                        source,
                        slice,
                        &research_jobs::adapter::foundation_root(),
                        scientific_descriptor,
                        &check,
                        deadline,
                    )
                } else {
                    reference::execute_breakout_until(source, slice, engine_hash, &check, deadline)
                }
            },
        )?;
        let validation = &computed["validation"];
        result["artifact_schema_version"] = json!("research-oos-result-v1");
        result["split"] = json!("validation");
        result["validation_schema"] = json!("research-oos-validation-v1");
        for key in ["selection", "walk_forward", "sweep"] {
            result[key] = validation[key].clone()
        }
        result["trials"] = computed["trials"].clone();
        result["outcome_summary"] = computed["outcome_summary"].clone();
        result["source_range"] = json!({"from_utc":protocol["range"]["from_utc"],"to_utc":protocol["range"]["to_utc"],"bar_count":rows.len(),"elapsed_ms":round_milliseconds(started.elapsed().as_secs_f64()*1000.0)?});
    } else {
        let computed = if protocol["engine"]["backend"] == "nautilus" {
            scientific::execute(
                rows,
                protocol,
                &research_jobs::adapter::foundation_root(),
                scientific_descriptor,
                &check,
                deadline,
            )?
        } else {
            reference::execute_breakout_until(rows, protocol, engine_hash, &check, deadline)?
        };
        for key in [
            "assumptions",
            "signals",
            "ledger",
            "metrics",
            "observed_range",
        ] {
            result[key] = computed[key].clone()
        }
        result["execution"] = computed.get("execution").cloned().unwrap_or(json!({}));
        if protocol["engine"]["backend"] == "reference" {
            reference::reconcile_reference(&result, rows, engine_hash, &check)?;
        }
        reference::independent::validate(&result, rows, &check)?;
        if let Some(mut partition) = partition {
            partition["engine_metrics"] = oos_runner::regime_metrics(
                &partition,
                result["ledger"]
                    .as_array()
                    .ok_or("research_ledger_invalid")?,
                &json!(job.starting_balance),
            )?;
            result["regime_partition"] = partition;
        }
        result["observed_range"]["elapsed_ms"] = json!(round_milliseconds(
            started.elapsed().as_secs_f64() * 1000.0
        )?);
    }
    if scientific {
        scientific::verify_installation(&scientific_root, scientific_descriptor, protocol, &check)?;
    }
    check()?;
    Ok(result)
}
fn round_milliseconds(value: f64) -> Result<f64, String> {
    BigDecimal::from_f64(value)
        .ok_or("invalid_elapsed")?
        .with_scale_round(3, RoundingMode::HalfEven)
        .to_f64()
        .ok_or("invalid_elapsed".into())
}

fn validate_manifest(job: &ClaimedJob, manifest: &Value, hash: &str) -> Result<(), String> {
    if manifest["workspace_id"] != job.workspace_id
        || manifest["dataset_id"] != job.dataset_id
        || manifest["artifact_sha256"] != hash
        || hash.len() != 64
        || !hash.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("research_dataset_identity_invalid".into());
    }
    if !manifest["artifact_path"].as_str().is_some_and(|p| {
        p.replace('\\', "/")
            .starts_with(&format!("{}/datasets/", job.workspace_id))
    }) {
        return Err("research_dataset_workspace_invalid".into());
    }
    let rows = manifest["row_count"]
        .as_u64()
        .ok_or("research_dataset_row_count_invalid")?;
    if rows < 2 {
        return Err("research_dataset_requires_two_rows".into());
    }
    match manifest
        .pointer("/quality/disposition")
        .and_then(Value::as_str)
    {
        None | Some("") | Some("pass") => (),
        _ => return Err("research_dataset_quality_not_approved".into()),
    }
    match manifest
        .pointer("/holdout_policy/mode")
        .and_then(Value::as_str)
        .unwrap_or("none")
    {
        "none" => (),
        "metadata_only" => {
            let boundary = manifest
                .pointer("/holdout_policy/from_utc")
                .and_then(Value::as_i64)
                .ok_or("research_holdout_policy_invalid")?;
            let last = manifest["last_timestamp"]
                .as_i64()
                .ok_or("research_dataset_time_invalid")?;
            let interval = manifest["timeframe_seconds"]
                .as_i64()
                .filter(|n| *n > 0)
                .ok_or("research_dataset_time_invalid")?;
            let end = job
                .protocol
                .as_ref()
                .and_then(|p| p["range"]["to_utc"].as_i64())
                .or_else(|| last.checked_add(interval));
            if end.is_none_or(|end| end > boundary) {
                return Err("research_locked_holdout".into());
            }
        }
        _ => return Err("research_holdout_policy_invalid".into()),
    }
    Ok(())
}
fn load_closes(
    reader: &ArtifactData,
    manifest: &Value,
    owned: &AtomicBool,
) -> Result<Vec<f64>, String> {
    checked(owned)?;
    let path = manifest["artifact_path"]
        .as_str()
        .ok_or("research_dataset_path_invalid")?;
    let sha = manifest["artifact_sha256"]
        .as_str()
        .ok_or("research_dataset_hash_invalid")?;
    let timing = reader.timings(
        path,
        sha,
        &[TimingQuery {
            index: 0,
            at_or_before: None,
        }],
    )?;
    let timing = &timing[0];
    if timing["row_count"] != manifest["row_count"]
        || timing["first_utc"] != manifest["first_timestamp"]
        || timing["last_utc"] != manifest["last_timestamp"]
    {
        return Err("research_dataset_metadata_mismatch".into());
    }
    let count = usize::try_from(
        manifest["row_count"]
            .as_u64()
            .ok_or("research_dataset_row_count_invalid")?,
    )
    .map_err(|_| "research_dataset_row_count_invalid")?;
    let mut closes = Vec::with_capacity(count.min(50000));
    for start in (0..count).step_by(50000) {
        checked(owned)?;
        for row in reader.indices(path, sha, start, (start + 50000).min(count))? {
            closes.push(
                row["close"]
                    .as_f64()
                    .filter(|v| v.is_finite())
                    .ok_or("research_close_invalid")?,
            );
        }
    }
    checked(owned)?;
    Ok(closes)
}

fn load_engine_rows(
    reader: &ArtifactData,
    manifest: &Value,
    protocol: &Value,
    owned: &AtomicBool,
    deadline: Instant,
) -> Result<Vec<Value>, String> {
    let check = || {
        checked(owned)?;
        if Instant::now() >= deadline {
            Err("run exceeded budget.max_runtime_ms".to_owned())
        } else {
            Ok(())
        }
    };
    check()?;
    let path = manifest["artifact_path"]
        .as_str()
        .ok_or("research_dataset_path_invalid")?;
    let sha = manifest["artifact_sha256"]
        .as_str()
        .ok_or("research_dataset_hash_invalid")?;
    let from = protocol["range"]["from_utc"]
        .as_i64()
        .ok_or("research_protocol_range_invalid")?;
    let to = protocol["range"]["to_utc"]
        .as_i64()
        .ok_or("research_protocol_range_invalid")?;
    let queries = [
        TimingQuery {
            index: 0,
            at_or_before: Some(
                from.checked_sub(1)
                    .ok_or("research_protocol_range_invalid")?,
            ),
        },
        TimingQuery {
            index: 0,
            at_or_before: Some(to.checked_sub(1).ok_or("research_protocol_range_invalid")?),
        },
    ];
    let timing = reader.timings(path, sha, &queries)?;
    if timing[0]["row_count"] != manifest["row_count"]
        || timing[0]["first_utc"] != manifest["first_timestamp"]
        || timing[0]["last_utc"] != manifest["last_timestamp"]
    {
        return Err("research_dataset_metadata_mismatch".into());
    }
    let start = usize::try_from(
        timing[0]["cursor_index"]
            .as_i64()
            .ok_or("research_dataset_time_invalid")?
            + 1,
    )
    .map_err(|_| "research_dataset_time_invalid")?;
    let end = usize::try_from(
        timing[1]["cursor_index"]
            .as_i64()
            .ok_or("research_dataset_time_invalid")?
            + 1,
    )
    .map_err(|_| "research_dataset_time_invalid")?;
    let budget = protocol["budget"]["max_bars"]
        .as_u64()
        .ok_or("research_bar_budget_invalid")?;
    if end < start || (end - start) as u64 > budget {
        return Err("run exceeded budget.max_bars".into());
    }
    let mut rows = Vec::with_capacity((end - start).min(50000));
    for at in (start..end).step_by(50000) {
        check()?;
        rows.extend(reader.indices(path, sha, at, (at + 50000).min(end))?);
    }
    check()?;
    Ok(rows)
}

async fn complete_candidate(
    state: &AppState,
    job: &ClaimedJob,
    candidates: &ResultCandidates,
    path: &str,
    sha: &str,
) -> Result<bool, String> {
    let mut client = state
        .pool
        .get()
        .await
        .map_err(|_| "research_database_unavailable")?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| "research_database_unavailable")?;
    let completed = match lifecycle::complete(&tx, job, path, sha).await {
        Ok(value) => value,
        Err(error) => {
            let _ = tx.rollback().await;
            candidates.quarantine(path)?;
            return Err(error);
        }
    };
    // Commit may have succeeded even when its acknowledgement is lost. Keep the
    // candidate until a later durable read/recovery establishes its ownership.
    tx.commit()
        .await
        .map_err(|_| "research_completion_outcome_unknown")?;
    if !completed {
        candidates.quarantine(path)?;
    }
    Ok(completed)
}

async fn execute(
    state: Arc<AppState>,
    job: &ClaimedJob,
    guard: &LeaseGuard,
    candidates: &ResultCandidates,
) -> Result<bool, String> {
    checked(&guard.owned)?;
    if !save_checkpoint(
        &state,
        job,
        "claimed",
        json!({"dataset_id":job.dataset_id}),
        0,
    )
    .await?
    {
        return Ok(false);
    }
    let manifest = {
        let client = state
            .pool
            .get()
            .await
            .map_err(|_| "research_database_unavailable")?;
        let row=client.query_opt("SELECT manifest_json,artifact_sha256 FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",&[&job.workspace_id,&job.dataset_id]).await.map_err(|_|"research_database_unavailable")?.ok_or("research_dataset_missing")?;
        let manifest: Value = row.get(0);
        validate_manifest(job, &manifest, &row.get::<_, String>(1))?;
        manifest
    };
    let engine = if let Some(protocol) = &job.protocol {
        let hash =
            research_jobs::adapter::engine_code_hash(&research_jobs::adapter::foundation_root())?;
        validate_protocol(job, &manifest, &hash)?;
        if !save_checkpoint(
            &state,
            job,
            "protocol-validated",
            json!({"protocol_sha256":job.protocol_sha256}),
            1,
        )
        .await?
        {
            return Ok(false);
        }
        let started = Instant::now();
        let budget = Duration::from_millis(
            protocol["budget"]["max_runtime_ms"]
                .as_u64()
                .filter(|v| *v > 0)
                .ok_or("research_runtime_budget_invalid")?,
        );
        Some((
            hash,
            started,
            started
                .checked_add(budget)
                .ok_or("research_runtime_budget_invalid")?,
        ))
    } else {
        None
    };
    let permit = state
        .artifact_reads
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "research_reader_unavailable")?;
    let reader = state.artifact_data.clone();
    let owned = guard.owned.clone();
    let manifest_copy = manifest.clone();
    let protocol = job.protocol.clone();
    let engine_deadline = engine.as_ref().map(|v| v.2);
    let rows = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if let Some(protocol) = protocol {
            load_engine_rows(
                &reader,
                &manifest_copy,
                &protocol,
                &owned,
                engine_deadline.unwrap(),
            )
            .map(|rows| (rows, Vec::new()))
        } else {
            load_closes(&reader, &manifest_copy, &owned).map(|closes| (Vec::new(), closes))
        }
    })
    .await
    .map_err(|_| "research_compute_task_failed")??;
    if !save_checkpoint(
        &state,
        job,
        "dataset-loaded",
        json!({"row_count":if engine.is_some(){rows.0.len()}else{rows.1.len()}}),
        2,
    )
    .await?
    {
        return Ok(false);
    }
    let owned = guard.owned.clone();
    let job_copy = job.clone();
    let sha = manifest["artifact_sha256"]
        .as_str()
        .ok_or("research_dataset_hash_invalid")?
        .to_owned();
    let checkpoint_state = state.clone();
    let checkpoint_job = job.clone();
    let handle = tokio::runtime::Handle::current();
    let manifest_copy = manifest.clone();
    let result = tokio::task::spawn_blocking(move || {
        if let Some((hash, started, deadline)) = engine {
            let descriptor = scientific_descriptor(&checkpoint_state);
            engine_result(
                &job_copy,
                &rows.0,
                &manifest_copy,
                &hash,
                &owned,
                started,
                deadline,
                &descriptor,
                |outcomes| {
                    checked(&owned)?;
                    let ok = handle.block_on(save_checkpoint_progress(
                        &checkpoint_state,
                        &checkpoint_job,
                        "oos-sweep-running",
                        json!({"trial_outcomes":outcomes}),
                        json!({"phase_index":3,"phase_count":5,"trial_index":outcomes.len()}),
                    ))?;
                    if ok {
                        Ok(())
                    } else {
                        Err("research_execution_interrupted".into())
                    }
                },
            )
        } else {
            close_delta_result(&job_copy, &sha, &rows.1, &now(), || checked(&owned))
        }
    })
    .await
    .map_err(|_| "research_compute_task_failed")??;
    if job.protocol.is_some()&&!save_checkpoint(&state,job,"result-validated",json!({"trade_count":result["ledger"].as_array().map(Vec::len),"outcome_summary":result["outcome_summary"]}),3).await?{return Ok(false);}
    checked(&guard.owned)?;
    let (path, sha) = candidates.publish(job, &result)?;
    match save_checkpoint(
        &state,
        job,
        "candidate-ready",
        json!({"result_sha256":sha}),
        4,
    )
    .await
    {
        Ok(true) => (),
        Ok(false) => {
            candidates.quarantine(&path)?;
            return Ok(false);
        }
        Err(error) => {
            candidates.quarantine(&path)?;
            return Err(error);
        }
    }
    complete_candidate(&state, job, candidates, &path, &sha).await
}

fn scientific_descriptor(state: &AppState) -> PathBuf {
    std::env::var_os("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            state
                .config
                .artifact_root
                .join(".runtime/scientific-adapter-capability.json")
        })
}
/// Verify optional installed code before advertising worker readiness or taking
/// a lease. Subsequent job checks reuse only reliable per-file hash receipts.
pub async fn prepare_scientific(state: &AppState, options: &WorkerOptions) -> Result<(), String> {
    let descriptor = scientific_descriptor(state);
    if !descriptor.is_file() {
        return if std::env::var_os("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY").is_some() {
            Err("scientific_adapter_capability_missing".into())
        } else {
            Ok(())
        };
    }
    let shutdown = options.shutdown_file.clone();
    tokio::task::spawn_blocking(move || {
        let check = || {
            if shutdown.as_ref().is_some_and(|p| p.exists()) {
                Err("research_execution_interrupted".into())
            } else {
                Ok(())
            }
        };
        let root = research_jobs::adapter::foundation_root();
        let hash = research_jobs::adapter::engine_code_hash(&root)?;
        research_jobs::adapter::verify_installation_checked(&root, &descriptor, &hash, &check)?;
        check()
    })
    .await
    .map_err(|_| "research_compute_task_failed")?
}
pub async fn run_one(state: Arc<AppState>, options: &WorkerOptions) -> Result<RunOutcome, String> {
    options.validate()?;
    if options.shutdown_file.as_ref().is_some_and(|p| p.exists()) {
        return Ok(RunOutcome::Idle);
    }
    let candidates = ResultCandidates::new(&state.config.artifact_root)?;
    let workspaces = state.authorization.authorized_workspace_ids();
    if workspaces.is_empty() {
        return Ok(RunOutcome::Idle);
    }
    let descriptor = scientific_descriptor(&state);
    let scientific_available = descriptor.is_file();
    if scientific_available {
        let root = research_jobs::adapter::foundation_root();
        let hash = research_jobs::adapter::engine_code_hash(&root)?;
        research_jobs::adapter::descriptor(&root, &descriptor, &hash)?;
    }
    {
        let mut client = state
            .pool
            .get()
            .await
            .map_err(|_| "research_database_unavailable")?;
        let tx = client
            .transaction()
            .await
            .map_err(|_| "research_database_unavailable")?;
        lifecycle::recover_native_scoped(&tx, &workspaces, scientific_available).await?;
        tx.commit()
            .await
            .map_err(|_| "research_database_unavailable")?;
    }
    // Keyset batches prevent a large terminal history from starving later
    // orphan cleanup. No lease is held while filesystem cleanup runs.
    let mut cursor = (String::new(), String::new());
    loop {
        let cleanup = {
            let client = state
                .pool
                .get()
                .await
                .map_err(|_| "research_database_unavailable")?;
            client.query("SELECT workspace_id,job_id,attempt_no FROM research_jobs WHERE workspace_id=ANY($3) AND ((protocol_json IS NULL AND strategy_version='close-delta-v1') OR (strategy_version='bar-breakout-v1' AND protocol_json->'engine'->>'version'='bar-breakout-v1' AND (protocol_json->'engine'->>'backend'='reference' OR ($4 AND protocol_json->'engine'->>'backend'='nautilus')))) AND status IN ('queued','failed','canceled') AND attempt_no>0 AND (workspace_id,job_id)>($1,$2) ORDER BY workspace_id,job_id LIMIT 100",&[&cursor.0,&cursor.1,&workspaces,&scientific_available]).await.map_err(|_|"research_database_unavailable")?.iter().map(|r|(r.get::<_,String>(0),r.get::<_,String>(1),r.get::<_,i32>(2))).collect::<Vec<_>>()
        };
        if cleanup.is_empty() {
            break;
        }
        for (workspace, id, attempt) in cleanup {
            candidates.quarantine_through(&workspace, &id, attempt)?;
            cursor = (workspace, id);
        }
    }
    if options.shutdown_file.as_ref().is_some_and(|p| p.exists()) {
        return Ok(RunOutcome::Idle);
    }
    let job = {
        let mut client = state
            .pool
            .get()
            .await
            .map_err(|_| "research_database_unavailable")?;
        let tx = client
            .transaction()
            .await
            .map_err(|_| "research_database_unavailable")?;
        let job = lifecycle::claim_native_scoped(
            &tx,
            &options.worker_id,
            options.lease_seconds,
            options.max_active_jobs,
            &workspaces,
            scientific_available,
        )
        .await?;
        tx.commit()
            .await
            .map_err(|_| "research_database_unavailable")?;
        job
    };
    let Some(job) = job else {
        return Ok(RunOutcome::Idle);
    };
    let guard = LeaseGuard::new(state.clone(), job.clone(), options.lease_seconds);
    let outcome = execute(state.clone(), &job, &guard, &candidates).await;
    match outcome {
        Ok(true) => Ok(RunOutcome::Completed(job.job_id)),
        Ok(false) => Ok(RunOutcome::Interrupted(job.job_id)),
        Err(error) if error == "research_execution_interrupted" => {
            Ok(RunOutcome::Interrupted(job.job_id))
        }
        Err(error) => {
            if error == "research_completion_outcome_unknown" {
                return Err(error);
            }
            let retry = error == "research_database_unavailable";
            let code = if retry {
                "WORKER_DATABASE_UNAVAILABLE"
            } else {
                "WORKER_EXECUTION_FAILED"
            };
            if let Ok(mut client) = state.pool.get().await {
                if let Ok(tx) = client.transaction().await {
                    let _ = lifecycle::fail(&tx, &job, code, retry).await;
                    let _ = tx.commit().await;
                }
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(id: &str) -> ClaimedJob {
        ClaimedJob {
            workspace_id: "tenant-a".into(),
            job_id: id.into(),
            dataset_id: "dataset-fixture".into(),
            strategy_version: "close-delta-v1".into(),
            starting_balance: 100000.0,
            protocol: None,
            protocol_sha256: None,
            attempt_no: 1,
            lease_owner: "fixture".into(),
            lease_token: "fixture-token".into(),
        }
    }
    #[test]
    fn cancellation_and_paths_fail_closed() {
        let job = job("fixture");
        assert_eq!(
            close_delta_result(&job, "hash", &[1.0, 2.0], "now", || Err("stopped".into()))
                .unwrap_err(),
            "stopped"
        );
        for invalid in [
            "..",
            "x/y",
            "x\\y",
            "x:",
            "CON",
            "AUX.txt",
            "trailing ",
            "trailing.",
            "\0",
        ] {
            assert!(component(invalid).is_err(), "{invalid:?}")
        }
        assert!(component("tenant-á").is_ok());
        let mut unsupported = job.clone();
        unsupported.protocol = Some(json!({}));
        assert!(close_delta_result(&unsupported, "hash", &[1.0, 2.0], "now", || Ok(())).is_err());
    }
    #[test]
    #[ignore = "requires Python oracle generated by rust_research_execution_parity.py"]
    fn python_baseline_oracle() {
        let fixture: Value = serde_json::from_slice(
            &fs::read(std::env::var("TW_RUST_RESEARCH_EXECUTION_ORACLE").unwrap()).unwrap(),
        )
        .unwrap();
        fn differences(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
            match (a, b) {
                (Value::Object(a), Value::Object(b)) => {
                    for (k, a) in a {
                        differences(
                            a,
                            b.get(k).unwrap_or(&Value::Null),
                            &format!("{path}/{k}"),
                            out,
                        )
                    }
                }
                (Value::Array(a), Value::Array(b)) => {
                    if a.len() != b.len() {
                        out.push(format!("{path}: array length mismatch"));
                        return;
                    }
                    for (i, (a, b)) in a.iter().zip(b).enumerate() {
                        differences(a, b, &format!("{path}/{i}"), out)
                    }
                }
                _ => {
                    if research_jobs::canonical_py_json(a).unwrap()
                        != research_jobs::canonical_py_json(b).unwrap()
                    {
                        out.push(format!("{path}: {a} != {b}"))
                    }
                }
            }
        }
        let mut mismatches = Vec::new();
        for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
            let mut job = job("fixture");
            job.starting_balance = case["starting_balance"].as_f64().unwrap();
            let closes = case["closes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_f64().unwrap())
                .collect::<Vec<_>>();
            let result =
                close_delta_result(&job, "hash", &closes, "2026-10-17T00:00:00.000001Z", || {
                    Ok(())
                })
                .unwrap();
            let bytes = research_jobs::canonical_py_json(&result).unwrap();
            let expected = research_jobs::canonical_py_json(&case["expected"]).unwrap();
            if bytes != expected {
                differences(
                    &result,
                    &case["expected"],
                    &format!("case-{index}-{}", case["name"]),
                    &mut mismatches,
                );
                continue;
            }
            assert_eq!(
                format!("{:x}", Sha256::digest(bytes)),
                case["sha256"].as_str().unwrap(),
                "case {index} canonical hash"
            );
        }
        assert!(
            mismatches.is_empty(),
            "{} exact mismatches; first 40:\n{}",
            mismatches.len(),
            mismatches
                .iter()
                .take(40)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
        println!(
            "{}",
            json!({"pure_oracle_cases":fixture["cases"].as_array().unwrap().len(),"exact_json_bytes":true})
        );
    }
    #[tokio::test]
    #[ignore = "requires explicitly owned disposable PostgreSQL via rust_research_execution_parity.py"]
    async fn postgres_execution_fences() {
        assert_eq!(
            std::env::var("TW_RUST_EXECUTION_DISPOSABLE").as_deref(),
            Ok("1")
        );
        let state = AppState::connect(crate::config::Config::from_environment().unwrap())
            .await
            .unwrap();
        let client = state.pool.get().await.unwrap();
        let identity = client
            .query_one("SELECT current_database(),current_user", &[])
            .await
            .unwrap();
        assert_eq!(identity.get::<_, String>(0), "rust_execution_fixture");
        assert_eq!(identity.get::<_, String>(1), "rust_execution_fixture");
        drop(client);
        let fixture: Value = serde_json::from_slice(
            &fs::read(std::env::var("TW_RUST_EXECUTION_PG_ORACLE").unwrap()).unwrap(),
        )
        .unwrap();
        let options = WorkerOptions {
            worker_id: "rust-fixture".into(),
            lease_seconds: 3,
            max_active_jobs: 1,
            shutdown_file: None,
        };
        prepare_scientific(&state, &options).await.unwrap();
        let candidates = ResultCandidates::new(&state.config.artifact_root).unwrap();
        async fn insert(state: &AppState, id: &str, protocol: Option<Value>) {
            let client = state.pool.get().await.unwrap();
            client.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc,protocol_json) VALUES('tenant-a',$1,'dataset-fixture','close-delta-v1',100000,'queued',$2,$2,$3)",&[&id,&now(),&protocol]).await.unwrap();
        }
        async fn claim(state: &AppState, options: &WorkerOptions) -> ClaimedJob {
            let mut client = state.pool.get().await.unwrap();
            let tx = client.transaction().await.unwrap();
            let job =
                lifecycle::claim_close_delta(&tx, &options.worker_id, options.lease_seconds, 1)
                    .await
                    .unwrap()
                    .unwrap();
            tx.commit().await.unwrap();
            job
        }
        async fn cancel(state: &AppState, id: &str) {
            state.pool.get().await.unwrap().execute("UPDATE research_jobs SET status='canceled',cancel_requested=true,lease_owner=NULL,lease_token=NULL,lease_expires_at_utc=NULL WHERE workspace_id='tenant-a' AND job_id=$1",&[&id]).await.unwrap();
        }
        let client = state.pool.get().await.unwrap();
        client.execute("INSERT INTO workspaces(workspace_id,created_at_utc) VALUES('outside-worker-scope',$1)",&[&now()]).await.unwrap();
        client.execute("INSERT INTO datasets(workspace_id,dataset_id,manifest_json,artifact_sha256,created_at_utc) SELECT 'outside-worker-scope',dataset_id,manifest_json,artifact_sha256,created_at_utc FROM datasets WHERE workspace_id='tenant-a' AND dataset_id='dataset-fixture'",&[]).await.unwrap();
        client.execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc) VALUES('outside-worker-scope','foreign-earliest','dataset-fixture','close-delta-v1',100000,'queued','2000','2000')",&[]).await.unwrap();
        drop(client);
        insert(&state, "fixture", None).await;
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap(),
            RunOutcome::Completed("fixture".into())
        );
        let row=state.pool.get().await.unwrap().query_one("SELECT result_path,result_sha256,attempt_no,status FROM research_jobs WHERE workspace_id='tenant-a' AND job_id='fixture'",&[]).await.unwrap();
        assert_eq!(row.get::<_, i32>(2), 1);
        assert_eq!(row.get::<_, String>(3), "completed");
        let path: String = row.get(0);
        let sha: String = row.get(1);
        let bytes = fs::read(state.config.artifact_root.join(&path)).unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), sha);
        let mut actual: Value = serde_json::from_slice(&bytes).unwrap();
        actual["created_at_utc"] = fixture["expected"]["created_at_utc"].clone();
        assert_eq!(
            research_jobs::canonical_py_json(&actual).unwrap(),
            research_jobs::canonical_py_json(&fixture["expected"]).unwrap()
        );
        let client = state.pool.get().await.unwrap();
        let foreign = client
            .query_one(
                "SELECT status,attempt_no FROM research_jobs WHERE job_id='foreign-earliest'",
                &[],
            )
            .await
            .unwrap();
        assert_eq!(foreign.get::<_, String>(0), "queued");
        assert_eq!(foreign.get::<_, i32>(1), 0);
        client.execute("UPDATE research_jobs SET status='canceled',cancel_requested=true WHERE job_id='foreign-earliest'",&[]).await.unwrap();
        drop(client);
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap(),
            RunOutcome::Idle
        );
        insert(
            &state,
            "engine-unclaimed",
            Some(json!({"engine":"reference"})),
        )
        .await;
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap(),
            RunOutcome::Idle
        );
        assert_eq!(
            state
                .pool
                .get()
                .await
                .unwrap()
                .query_one(
                    "SELECT attempt_no FROM research_jobs WHERE job_id='engine-unclaimed'",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, i32>(0),
            0
        );

        insert(&state, "cancel-before", None).await;
        cancel(&state, "cancel-before").await;
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap(),
            RunOutcome::Idle
        );
        insert(&state, "cancel-candidate", None).await;
        let job = claim(&state, &options).await;
        let (path, sha) = candidates
            .publish(&job, &json!({"candidate":"cancel"}))
            .unwrap();
        cancel(&state, &job.job_id).await;
        assert!(
            !complete_candidate(&state, &job, &candidates, &path, &sha)
                .await
                .unwrap()
        );
        assert!(!state.config.artifact_root.join(path).exists());

        insert(&state, "crashed-candidate", None).await;
        let old = claim(&state, &options).await;
        let (path, _) = candidates
            .publish(&old, &json!({"candidate":"crash"}))
            .unwrap();
        state.pool.get().await.unwrap().execute("UPDATE research_jobs SET lease_expires_at_utc=CURRENT_TIMESTAMP-interval '1 second',retry_base_seconds=0 WHERE job_id='crashed-candidate'",&[]).await.unwrap();
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap(),
            RunOutcome::Completed("crashed-candidate".into())
        );
        assert!(!state.config.artifact_root.join(&path).exists());
        assert!(
            state
                .config
                .artifact_root
                .join(path.replace("/results/", "/quarantine/results/"))
                .exists()
        );
        assert!(
            complete_candidate(
                &state,
                &old,
                &candidates,
                &format!("tenant-a/results/crashed-candidate/attempt-000001-orphan.json"),
                "sha"
            )
            .await
            .is_err()
        );

        insert(&state, "heartbeat", None).await;
        let job = claim(&state, &options).await;
        let guard = LeaseGuard::new(state.clone(), job.clone(), 3);
        tokio::time::sleep(Duration::from_millis(4200)).await;
        assert!(guard.owned.load(Ordering::Acquire));
        assert!(
            save_checkpoint(&state, &job, "claimed", json!({}), 0)
                .await
                .unwrap()
        );
        cancel(&state, &job.job_id).await;
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(!guard.owned.load(Ordering::Acquire));
        drop(guard);

        insert(&state, "duplicate-workers", None).await;
        let other_options = WorkerOptions {
            worker_id: "other".into(),
            ..options.clone()
        };
        let (a, b) = tokio::join!(
            run_one(state.clone(), &options),
            run_one(state.clone(), &other_options)
        );
        let results = [a.unwrap(), b.unwrap()];
        assert_eq!(
            results
                .iter()
                .filter(|r| matches!(r, RunOutcome::Completed(_)))
                .count(),
            1
        );
        assert_eq!(
            state
                .pool
                .get()
                .await
                .unwrap()
                .query_one(
                    "SELECT attempt_no FROM research_jobs WHERE job_id='duplicate-workers'",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, i32>(0),
            1
        );

        let first = &fixture["engine_cases"][0];
        let mut oversized = first["protocol"].clone();
        oversized["budget"]["max_bars"] = json!(1);
        let digest = format!(
            "{:x}",
            Sha256::digest(research_jobs::canonical_py_json(&oversized).unwrap())
        );
        state.pool.get().await.unwrap().execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc,protocol_json,protocol_sha256) VALUES('tenant-a','source-budget-rejected',$1,'bar-breakout-v1',$2,'queued',$3,$3,$4,$5)",&[&first["manifest"]["dataset_id"].as_str().unwrap(),&oversized["starting_balance"].as_f64().unwrap(),&now(),&oversized,&digest]).await.unwrap();
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap_err(),
            "run exceeded budget.max_bars"
        );
        let rejected=state.pool.get().await.unwrap().query_one("SELECT status,result_path FROM research_jobs WHERE job_id='source-budget-rejected'",&[]).await.unwrap();
        assert_eq!(rejected.get::<_, String>(0), "failed");
        assert!(rejected.get::<_, Option<String>>(1).is_none());

        for case in fixture["engine_cases"].as_array().unwrap() {
            let id = case["job_id"].as_str().unwrap();
            let dataset = case["manifest"]["dataset_id"].as_str().unwrap();
            let protocol = &case["protocol"];
            let digest = case["protocol_sha256"].as_str().unwrap();
            let starting = protocol["starting_balance"].as_f64().unwrap();
            state.pool.get().await.unwrap().execute("INSERT INTO research_jobs(workspace_id,job_id,dataset_id,strategy_version,starting_balance,status,created_at_utc,updated_at_utc,protocol_json,protocol_sha256) VALUES('tenant-a',$1,$2,'bar-breakout-v1',$3,'queued',$4,$4,$5,$6)",&[&id,&dataset,&starting,&now(),&protocol,&digest]).await.unwrap();
            assert_eq!(
                run_one(state.clone(), &options)
                    .await
                    .unwrap_or_else(|error| panic!("{id}: {error}")),
                RunOutcome::Completed(id.into()),
                "{id}"
            );
            let row=state.pool.get().await.unwrap().query_one("SELECT result_path,result_sha256,attempt_no,status FROM research_jobs WHERE job_id=$1",&[&id]).await.unwrap();
            assert_eq!(row.get::<_, String>(3), "completed");
            assert_eq!(row.get::<_, i32>(2), 1);
            let bytes = fs::read(state.config.artifact_root.join(row.get::<_, String>(0))).unwrap();
            assert_eq!(
                format!("{:x}", Sha256::digest(&bytes)),
                row.get::<_, String>(1)
            );
            let mut actual: Value = serde_json::from_slice(&bytes).unwrap();
            actual["created_at_utc"] = case["expected"]["created_at_utc"].clone();
            let range = if actual["artifact_schema_version"] == "research-oos-result-v1" {
                "source_range"
            } else {
                "observed_range"
            };
            assert!(actual[range]["elapsed_ms"].as_f64().unwrap() >= 0.);
            actual[range]["elapsed_ms"] = json!(0.0);
            let mut expected = case["expected"].clone();
            if protocol["engine"]["backend"] == "nautilus" {
                fn zero_elapsed(value: &mut Value) {
                    match value {
                        Value::Object(fields) => {
                            for (key, value) in fields {
                                if key == "elapsed_ms" {
                                    *value = json!(0.0);
                                } else {
                                    zero_elapsed(value);
                                }
                            }
                        }
                        Value::Array(items) => {
                            for item in items {
                                zero_elapsed(item);
                            }
                        }
                        _ => (),
                    }
                }
                // Generated native IDs differ between engine runs; source/fill
                // links were independently validated before candidate publication.
                for result in [&mut actual, &mut expected] {
                    zero_elapsed(result);
                    result.as_object_mut().unwrap().remove("execution");
                    if let Some(ledger) = result["ledger"].as_array_mut() {
                        for trade in ledger {
                            trade.as_object_mut().unwrap().remove("execution_link");
                        }
                    }
                }
            }
            if research_jobs::canonical_py_json(&actual).unwrap()
                != research_jobs::canonical_py_json(&expected).unwrap()
            {
                let evidence = PathBuf::from(std::env::var("TW_RUST_EXECUTION_PG_ORACLE").unwrap())
                    .parent()
                    .unwrap()
                    .to_path_buf();
                fs::write(
                    evidence.join(format!("{id}-actual.json")),
                    serde_json::to_vec_pretty(&actual).unwrap(),
                )
                .unwrap();
                fs::write(
                    evidence.join(format!("{id}-expected.json")),
                    serde_json::to_vec_pretty(&expected).unwrap(),
                )
                .unwrap();
                panic!(
                    "{id} durable artifact parity; inspect actual/expected JSON beside PostgreSQL oracle"
                );
            }
        }

        insert(&state, "holdout-blocked", None).await;
        let mut manifest = fixture["manifest"].clone();
        manifest["holdout_policy"] = json!({"mode":"metadata_only","from_utc":100});
        state
            .pool
            .get()
            .await
            .unwrap()
            .execute(
                "UPDATE datasets SET manifest_json=$1 WHERE dataset_id='dataset-fixture'",
                &[&manifest],
            )
            .await
            .unwrap();
        assert_eq!(
            run_one(state.clone(), &options).await.unwrap_err(),
            "research_locked_holdout"
        );
        assert_eq!(
            state
                .pool
                .get()
                .await
                .unwrap()
                .query_one(
                    "SELECT status FROM research_jobs WHERE job_id='holdout-blocked'",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, String>(0),
            "failed"
        );
        state
            .pool
            .get()
            .await
            .unwrap()
            .execute(
                "UPDATE datasets SET manifest_json=$1 WHERE dataset_id='dataset-fixture'",
                &[&fixture["manifest"]],
            )
            .await
            .unwrap();

        let stop = state.config.artifact_root.join("owned-fixture.stop");
        fs::write(&stop, "stop").unwrap();
        insert(&state, "stop-before-claim", None).await;
        assert_eq!(
            run_one(
                state.clone(),
                &WorkerOptions {
                    shutdown_file: Some(stop),
                    ..options.clone()
                }
            )
            .await
            .unwrap(),
            RunOutcome::Idle
        );
        assert_eq!(
            state
                .pool
                .get()
                .await
                .unwrap()
                .query_one(
                    "SELECT attempt_no FROM research_jobs WHERE job_id='stop-before-claim'",
                    &[]
                )
                .await
                .unwrap()
                .get::<_, i32>(0),
            0
        );
        let all = state
            .pool
            .get()
            .await
            .unwrap()
            .query(
                "SELECT workspace_id,status,result_path FROM research_jobs",
                &[],
            )
            .await
            .unwrap();
        assert!(all.iter().all(|r| r.get::<_, String>(0) == "tenant-a"
            || (r.get::<_, String>(0) == "outside-worker-scope"
                && r.get::<_, String>(1) == "canceled"
                && r.get::<_, Option<String>>(2).is_none())));
        state.pool.close();
        assert_eq!(
            run_one(state, &options).await.unwrap_err(),
            "research_database_unavailable"
        );
        println!(
            "{}",
            json!({"postgres_cases":["result_exact_python_parity","hash_matches_bytes","unsupported_job_not_claimed","idle","cancel_before_claim","cancel_candidate_quarantine","crash_candidate_recovery","stale_completion_rejected","heartbeat_renews","cancel_stops_heartbeat","duplicate_workers_one_completion","locked_holdout_blocked_before_read","shutdown_stops_claim","database_unavailable_fails_closed"]})
        );
    }
}
