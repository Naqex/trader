//! Dataset catalog removal is committed before exact-path file cleanup.
//! The caller holds a session advisory lock across both phases and must evict
//! the connection on cancellation rather than return a still-locked session.
use crate::{artifact_data::ArtifactData, auth::ApiError, state::AppState};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tokio_postgres::Transaction;

pub(super) fn lock_key(workspace: &str, dataset: &str) -> i64 {
    let digest = Sha256::digest(format!("dataset-mutation:{workspace}:{dataset}"));
    i64::from_be_bytes(digest[..8].try_into().unwrap())
}

fn error(status: StatusCode, detail: &str) -> ApiError {
    ApiError::detail(status, detail)
}
fn path_error() -> ApiError {
    error(
        StatusCode::UNPROCESSABLE_ENTITY,
        "invalid_dataset_artifact_path",
    )
}
fn io_error() -> ApiError {
    error(StatusCode::SERVICE_UNAVAILABLE, "dataset_cleanup_failed")
}
fn recovery(detail: &str) -> ApiError {
    error(StatusCode::CONFLICT, detail)
}
fn recovery_io() -> ApiError {
    error(StatusCode::SERVICE_UNAVAILABLE, "dataset_recovery_failed")
}

fn component(value: &str) -> Result<(), ApiError> {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.ends_with(['.', ' '])
        || value.chars().any(|c| c < ' ' || "/\\:*?\"<>|".contains(c))
        || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err(path_error());
    }
    Ok(())
}

fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, ApiError> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        component(part)?;
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(path_error());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err(path_error());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(path_error()),
        }
    }
    Ok(path)
}

pub(super) fn import_staging(root: &Path) -> Result<PathBuf, ApiError> {
    let path = safe_path(
        root,
        &format!("dataset-import-staging/{}", uuid::Uuid::new_v4().simple()),
    )?;
    fs::create_dir_all(&path).map_err(|_| recovery_io())?;
    safe_path(
        root,
        &path
            .strip_prefix(root)
            .map_err(|_| path_error())?
            .to_string_lossy()
            .replace('\\', "/"),
    )
}

fn dataset_paths(
    root: &Path,
    workspace: &str,
    dataset: &str,
    manifest: &Value,
) -> Result<Vec<PathBuf>, ApiError> {
    component(workspace)?;
    component(dataset)?;
    let expected = format!("{workspace}/datasets/{dataset}.parquet");
    let raw = format!("{workspace}/raw/{dataset}/source.csv");
    let mut paths = vec![];
    for (field, expected) in [("artifact_path", expected), ("raw_artifact_path", raw)] {
        if field == "raw_artifact_path" && manifest[field].is_null() {
            continue;
        }
        let declared = manifest[field].as_str().ok_or_else(path_error)?;
        if declared.replace('\\', "/") != expected {
            return Err(path_error());
        }
        let path = safe_path(root, &expected)?;
        if path.exists() && !path.is_file() {
            return Err(path_error());
        }
        paths.push(path);
    }
    Ok(paths)
}

fn journal_path(root: &Path, workspace: &str, dataset: &str) -> Result<PathBuf, ApiError> {
    let digest = format!("{:x}", Sha256::digest(format!("{workspace}:{dataset}")));
    safe_path(root, &format!("dataset-removals/{digest}.json"))
}

pub(super) fn assert_not_removing(
    root: &Path,
    workspace: &str,
    dataset: &str,
) -> Result<(), ApiError> {
    if journal_path(root, workspace, dataset)?
        .try_exists()
        .map_err(|_| io_error())?
    {
        return Err(recovery("dataset_cleanup_pending"));
    }
    Ok(())
}

fn read_journal(root: &Path, workspace: &str, dataset: &str) -> Result<Value, ApiError> {
    let journal = journal_path(root, workspace, dataset)?;
    let mut bytes = Vec::new();
    File::open(journal)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                error(StatusCode::NOT_FOUND, "dataset_not_found")
            } else {
                io_error()
            }
        })?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| io_error())?;
    if bytes.len() > 16 * 1024 {
        return Err(path_error());
    }
    let saved: Value = serde_json::from_slice(&bytes).map_err(|_| path_error())?;
    if saved["workspace_id"] != workspace || saved["dataset_id"] != dataset {
        return Err(path_error());
    }
    dataset_paths(root, workspace, dataset, &saved)?;
    Ok(saved)
}

fn sync_parent(path: &Path) -> Result<(), ApiError> {
    #[cfg(unix)]
    File::open(path.parent().ok_or_else(io_error)?)
        .and_then(|f| f.sync_all())
        .map_err(|_| io_error())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn prepare_journal(
    root: &Path,
    workspace: &str,
    dataset: &str,
    manifest: &Value,
) -> Result<(), ApiError> {
    dataset_paths(root, workspace, dataset, manifest)?;
    let journal = journal_path(root, workspace, dataset)?;
    let saved = json!({"workspace_id":workspace,"dataset_id":dataset,"artifact_path":manifest["artifact_path"],"raw_artifact_path":manifest["raw_artifact_path"]});
    if journal.exists() {
        if read_journal(root, workspace, dataset)? != saved {
            return Err(path_error());
        }
        return Ok(());
    }
    fs::create_dir_all(journal.parent().ok_or_else(io_error)?).map_err(|_| io_error())?;
    let temporary = safe_path(
        root,
        &format!("dataset-removals/.{}.tmp", uuid::Uuid::new_v4().simple()),
    )?;
    let result = (|| {
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| io_error())?;
        out.write_all(&serde_json::to_vec(&saved).map_err(|_| io_error())?)
            .map_err(|_| io_error())?;
        out.sync_all().map_err(|_| io_error())?;
        drop(out);
        // Create-only publication avoids silently replacing a retry journal.
        crate::artifact_data::publish_created_file(&temporary, &journal).map_err(|_| io_error())
    })();
    let _ = fs::remove_file(temporary);
    result
}

pub(super) async fn delete(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    dataset: &str,
) -> Result<Value, ApiError> {
    component(workspace)?;
    component(dataset)?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&lock_key(workspace, dataset)],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let row = tx
        .query_opt(
            "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR UPDATE",
            &[&workspace, &dataset],
        )
        .await
        .map_err(|_| ApiError::database())?;
    let root = state.config.artifact_root.clone();
    let owned_workspace = workspace.to_owned();
    let owned_dataset = dataset.to_owned();
    if let Some(row) = row {
        let manifest: Value = row.get(0);
        let checksum = manifest["artifact_sha256"].as_str().unwrap_or("");
        let checksum_prefixed = format!("sha256:{checksum}");
        let variables = json!({"id":dataset});
        let pinned = tx.query_one("SELECT EXISTS(SELECT 1 FROM research_jobs WHERE workspace_id=$1 AND dataset_id=$2) OR EXISTS(SELECT 1 FROM workspace_record_revisions WHERE workspace_id=$1 AND kind='replay' AND (payload_json->>'dataset_id'=$2 OR payload_json->'dataset_ids' ? $2)) OR EXISTS(SELECT 1 FROM prop_attempt_revisions WHERE workspace_id=$1 AND (jsonb_path_exists(resume_json, '$.**.dataset_id ? (@ == $id)', $3::jsonb) OR jsonb_path_exists(resume_json, '$.**.dataset_ids[*] ? (@ == $id)', $3::jsonb) OR snapshot_json->>'data_version' IN ($2,$4,$5)))", &[&workspace,&dataset,&variables,&checksum,&checksum_prefixed]).await.map_err(|_| ApiError::database())?.get::<_,bool>(0);
        if pinned {
            return Err(recovery("dataset_in_use"));
        }
        tokio::task::spawn_blocking(move || {
            prepare_journal(&root, &owned_workspace, &owned_dataset, &manifest)
        })
        .await
        .map_err(|_| io_error())??;
        tx.execute(
            "DELETE FROM datasets WHERE workspace_id=$1 AND dataset_id=$2",
            &[&workspace, &dataset],
        )
        .await
        .map_err(|_| ApiError::database())?;
    } else {
        tokio::task::spawn_blocking(move || read_journal(&root, &owned_workspace, &owned_dataset))
            .await
            .map_err(|_| io_error())??;
    }
    Ok(json!({"dataset_id":dataset,"deleted":true}))
}

/// Call only after the catalog transaction commits, with the session lock held.
pub(super) async fn finish_delete(
    state: &AppState,
    workspace: &str,
    dataset: &str,
) -> Result<(), ApiError> {
    let root = state.config.artifact_root.clone();
    let workspace = workspace.to_owned();
    let dataset = dataset.to_owned();
    tokio::task::spawn_blocking(move || cleanup(&root, &workspace, &dataset))
        .await
        .map_err(|_| io_error())?
}

fn cleanup(root: &Path, workspace: &str, dataset: &str) -> Result<(), ApiError> {
    let saved = read_journal(root, workspace, dataset)?;
    for path in dataset_paths(root, workspace, dataset, &saved)? {
        match fs::remove_file(&path) {
            Ok(()) => sync_parent(&path)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(io_error()),
        }
    }
    Ok(())
}

pub(super) async fn clear_delete_journal(
    state: &AppState,
    workspace: &str,
    dataset: &str,
) -> Result<(), ApiError> {
    let root = state.config.artifact_root.clone();
    let workspace = workspace.to_owned();
    let dataset = dataset.to_owned();
    tokio::task::spawn_blocking(move || {
        let journal = journal_path(&root, &workspace, &dataset)?;
        match fs::remove_file(&journal) {
            Ok(()) => sync_parent(&journal),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(io_error()),
        }
    })
    .await
    .map_err(|_| io_error())?
}

fn digest(path: &Path) -> Result<String, ApiError> {
    let mut file = File::open(path).map_err(|_| recovery_io())?;
    let mut sha = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(|_| recovery_io())?;
        if size == 0 {
            break;
        }
        sha.update(&buffer[..size]);
    }
    Ok(format!("{:x}", sha.finalize()))
}

pub(super) fn publish_candidate(
    root: &Path,
    staging: &Path,
    relative: &str,
    expected: &str,
) -> Result<(), ApiError> {
    let target = safe_path(root, relative)?;
    let source = safe_path(staging, relative)?;
    if digest(&source)? != expected {
        return Err(recovery_io());
    }
    fs::create_dir_all(target.parent().ok_or_else(recovery_io)?).map_err(|_| recovery_io())?;
    // Recheck after mkdir: no parent may be a symlink/reparse point.
    safe_path(root, relative)?;
    match crate::artifact_data::publish_created_file(&source, &target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            if digest(&target)? == expected {
                Ok(())
            } else {
                Err(recovery("dataset_recovery_mismatch"))
            }
        }
        Err(_) => Err(recovery_io()),
    }
}

pub(super) async fn repair(
    tx: &Transaction<'_>,
    state: &AppState,
    workspace: &str,
    dataset: &str,
) -> Result<Value, ApiError> {
    component(workspace)?;
    component(dataset)?;
    tx.query_one(
        "SELECT pg_advisory_xact_lock($1)",
        &[&lock_key(workspace, dataset)],
    )
    .await
    .map_err(|_| ApiError::database())?;
    let row = tx
        .query_opt(
            "SELECT manifest_json FROM datasets WHERE workspace_id=$1 AND dataset_id=$2 FOR UPDATE",
            &[&workspace, &dataset],
        )
        .await
        .map_err(|_| ApiError::database())?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "dataset_not_found"))?;
    let manifest: Value = row.get(0);
    let root = state.config.artifact_root.clone();
    let workspace = workspace.to_owned();
    let dataset = dataset.to_owned();
    let mut work =
        tokio::task::spawn_blocking(move || repair_files(&root, &workspace, &dataset, &manifest));
    loop {
        tokio::select! {
            result=&mut work=>return result.map_err(|_|recovery_io())?,
            _=tokio::time::sleep(std::time::Duration::from_secs(5))=>{
                // Keep only this owned admin transaction alive during streaming I/O.
                if tx.simple_query("SELECT 1").await.is_err(){let _=work.await;return Err(ApiError::database());}
            }
        }
    }
}

fn repair_files(
    root: &Path,
    workspace: &str,
    dataset: &str,
    manifest: &Value,
) -> Result<Value, ApiError> {
    let paths = dataset_paths(root, workspace, dataset, manifest).map_err(|_| recovery_io())?;
    let target = &paths[0];
    let expected = manifest["artifact_sha256"]
        .as_str()
        .ok_or_else(recovery_io)?;
    let before = if target.exists() {
        Some(digest(target)?)
    } else {
        None
    };
    if before.as_deref() == Some(expected) {
        return Ok(json!({"dataset_id":dataset,"status":"verified"}));
    }
    let raw = paths
        .get(1)
        .filter(|p| p.is_file())
        .ok_or_else(|| recovery("dataset_source_unavailable"))?;
    let source_hash = manifest["raw_sha256"]
        .as_str()
        .ok_or_else(|| recovery("dataset_source_corrupt"))?;
    if digest(raw)? != source_hash {
        return Err(recovery("dataset_source_corrupt"));
    }
    if manifest["transform_version"] != "u2-normalize-v3" {
        return Err(recovery("dataset_transform_unavailable"));
    }
    let staging_relative = format!("dataset-recovery/{}", uuid::Uuid::new_v4().simple());
    let staging = safe_path(root, &staging_relative).map_err(|_| recovery_io())?;
    fs::create_dir_all(&staging).map_err(|_| recovery_io())?;
    let candidate = staging
        .join(workspace)
        .join("datasets")
        .join(format!("{dataset}.parquet"));
    let row_stream = staging.join("normalized-rows.ndjson");
    let outcome = (|| {
        super::ingest::stream_parquet_rows(raw, &row_stream).map_err(|_| recovery_io())?;
        let rows = std::io::BufReader::new(fs::File::open(&row_stream).map_err(|_| recovery_io())?);
        let rows = serde_json::Deserializer::from_reader(rows)
            .into_iter::<Value>()
            .map(|row| row.map_err(|e| e.to_string()));
        let native_hash = ArtifactData::new(&staging)
            .map_err(|_| recovery_io())?
            .write_dataset_iter(workspace, dataset, rows)
            .map_err(|_| recovery_io())?
            .1;
        if native_hash != expected {
            super::legacy_codec::restore(&staging, &candidate, raw)
                .map_err(|detail| error(StatusCode::SERVICE_UNAVAILABLE, &detail))?;
        }
        if digest(&candidate)? != expected || digest(raw)? != source_hash {
            return Err(recovery("dataset_recovery_mismatch"));
        }
        let current = if target.exists() {
            Some(digest(target)?)
        } else {
            None
        };
        if current != before {
            return Err(recovery_io());
        }
        dataset_paths(root, workspace, dataset, manifest).map_err(|_| recovery_io())?;
        fs::create_dir_all(target.parent().ok_or_else(recovery_io)?).map_err(|_| recovery_io())?;
        let quarantine = if before.is_some() {
            let relative = format!(
                "{workspace}/quarantine/{dataset}-{}.parquet",
                uuid::Uuid::new_v4().simple()
            );
            let path = safe_path(root, &relative).map_err(|_| recovery_io())?;
            fs::create_dir_all(path.parent().ok_or_else(recovery_io)?)
                .map_err(|_| recovery_io())?;
            crate::artifact_data::publish_created_file(target, &path).map_err(|_| recovery_io())?;
            Some(path)
        } else {
            None
        };
        if crate::artifact_data::publish_created_file(&candidate, target).is_err() {
            if let Some(path) = quarantine {
                let _ = crate::artifact_data::publish_created_file(&path, target);
            }
            return Err(recovery_io());
        }
        sync_parent(target).map_err(|_| recovery_io())?;
        Ok(json!({"dataset_id":dataset,"status":"restored"}))
    })();
    // Only paths created by this recovery are cleaned; quarantined evidence stays.
    let _ = fs::remove_file(&candidate);
    let _ = fs::remove_file(&row_stream);
    let _ = fs::remove_dir(staging.join(workspace).join("datasets"));
    let _ = fs::remove_dir(staging.join(workspace));
    let _ = fs::remove_dir(staging);
    outcome
}

#[cfg(test)]
mod streaming_recovery_tests {
    use super::*;
    #[test]
    fn native_large_recovery_needs_no_legacy_codec_and_preserves_pinned_hash() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("tw-native-repair-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let input = root.join("input.csv");
        let count = 420003usize;
        let mut output = std::io::BufWriter::new(File::create(&input).unwrap());
        output
            .write_all(b"time,open,high,low,close,volume\n")
            .unwrap();
        for i in 0..count {
            writeln!(output, "{},1,2,0,1.23456,{}", i * 60, i % 17).unwrap();
        }
        output.flush().unwrap();
        drop(output);
        assert!(fs::metadata(&input).unwrap().len() > 10 * 1024 * 1024);
        let writer = ArtifactData::new(&root).unwrap();
        let (raw_path, raw_sha) = writer
            .write_raw_source("tenant-a", "native-large", File::open(&input).unwrap())
            .unwrap();
        let rows=(0..count).map(|i|Ok(json!({"timestamp":i*60,"open":1.,"high":2.,"low":0.,"close":1.23456,"volume":(i%17)as f64})));
        let (artifact_path, artifact_sha) = writer
            .write_dataset_iter("tenant-a", "native-large", rows)
            .unwrap();
        let manifest = json!({"artifact_path":artifact_path,"artifact_sha256":artifact_sha,"raw_artifact_path":raw_path,"raw_sha256":raw_sha,"transform_version":"u2-normalize-v3"});
        fs::write(root.join(&artifact_path), b"corrupt").unwrap();
        assert_eq!(
            repair_files(&root, "tenant-a", "native-large", &manifest).unwrap()["status"],
            "restored"
        );
        assert_eq!(digest(&root.join(&artifact_path)).unwrap(), artifact_sha);
        assert_eq!(
            repair_files(&root, "tenant-a", "native-large", &manifest).unwrap()["status"],
            "verified"
        );
        assert_eq!(
            fs::read_dir(root.join("dataset-recovery")).unwrap().count(),
            0
        );
        fs::remove_dir_all(root).unwrap();
    }
}
