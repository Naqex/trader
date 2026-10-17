//! Immutable, bounded Parquet reads shared by replay and research consumers.
//!
//! Authorization and manifest lookup belong to the caller. This reader never
//! guesses an artifact identity and never executes a Python fallback.
use chrono::{Datelike, TimeZone, Utc};
use parquet::{
    basic::{Compression, Repetition, Type as PhysicalType},
    data_type::{DoubleType, Int64Type},
    file::{
        properties::WriterProperties,
        reader::{FileReader, SerializedFileReader},
        statistics::Statistics,
        writer::SerializedFileWriter,
    },
    record::{Field, Row},
    schema::types::Type,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

pub type DataResult<T> = Result<T, String>;

/// Publishes an already synced file without replacing an immutable winner.
pub(crate) fn publish_created_file(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn MoveFileExW(source: *const u16, target: *const u16, flags: u32) -> i32;
        }
        let wide = |path: &Path| -> std::io::Result<Vec<u16>> {
            let value: Vec<u16> = path.as_os_str().encode_wide().collect();
            if value.contains(&0) {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in publication path"));
            }
            Ok(value.into_iter().chain(Some(0)).collect())
        };
        let source = wide(source)?;
        let target = wide(target)?;
        // WRITE_THROUGH, with neither replacement nor cross-volume copy allowed.
        if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0x8) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    #[cfg(not(windows))]
    {
        fs::hard_link(source, target)?;
        #[cfg(unix)]
        File::open(target.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "publication parent missing"))?)?.sync_all()?;
        fs::remove_file(source)?;
        #[cfg(unix)]
        File::open(source.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "publication parent missing"))?)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod publication_tests {
    use super::*;

    #[test]
    fn immutable_publication_keeps_the_winner_and_losing_source() {
        let root = std::env::temp_dir().join(format!("tw-publication-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let first = root.join("first.tmp");
        let second = root.join("second.tmp");
        let target = root.join("artifact");
        fs::write(&first, b"winner").unwrap();
        fs::write(&second, b"loser").unwrap();
        publish_created_file(&first, &target).unwrap();
        assert!(!first.exists());
        assert!(publish_created_file(&second, &target).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"winner");
        assert_eq!(fs::read(&second).unwrap(), b"loser");
        fs::remove_dir_all(root).unwrap();
    }
}

pub(crate) fn same_file(left: &Path, right: &Path) -> bool {
    let checked = || -> DataResult<bool> {
        for path in [left, right] {
            let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Ok(false);
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Ok(false);
                }
            }
        }
        let a = identity(&File::open(left).map_err(|e| e.to_string())?)?;
        let b = identity(&File::open(right).map_err(|e| e.to_string())?)?;
        Ok(a.device == b.device && a.object == b.object)
    };
    checked().unwrap_or(false)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileIdentity {
    size: u64,
    modified: Option<SystemTime>,
    device: u64,
    object: [u8; 16],
    change: i64,
}

#[cfg(windows)]
fn identity(file: &File) -> DataResult<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    #[repr(C)]
    struct BasicInfo {
        created: i64,
        accessed: i64,
        written: i64,
        changed: i64,
        attributes: u32,
    }
    #[repr(C)]
    struct IdInfo {
        volume: u64,
        id: [u8; 16],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandleEx(
            handle: *mut std::ffi::c_void,
            class: i32,
            output: *mut std::ffi::c_void,
            size: u32,
        ) -> i32;
    }
    let mut basic = BasicInfo {
        created: 0,
        accessed: 0,
        written: 0,
        changed: 0,
        attributes: 0,
    };
    let mut id = IdInfo {
        volume: 0,
        id: [0; 16],
    };
    // FILE_BASIC_INFO.ChangeTime detects same-size edits even if LastWriteTime
    // is restored. FILE_ID_INFO detects replacement of a pathname.
    let queried = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            0,
            &mut basic as *mut _ as _,
            std::mem::size_of::<BasicInfo>() as u32,
        ) != 0
            && GetFileInformationByHandleEx(
                file.as_raw_handle(),
                18,
                &mut id as *mut _ as _,
                std::mem::size_of::<IdInfo>() as u32,
            ) != 0
    };
    if !queried || basic.changed <= 0 {
        return Err("cannot establish reliable artifact file identity".into());
    }
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("artifact must be a regular file".into());
    }
    Ok(FileIdentity {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        device: id.volume,
        object: id.id,
        change: basic.changed,
    })
}

#[cfg(unix)]
fn identity(file: &File) -> DataResult<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("artifact must be a regular file".into());
    }
    let mut object = [0; 16];
    object[..8].copy_from_slice(&metadata.ino().to_le_bytes());
    Ok(FileIdentity {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        device: metadata.dev(),
        object,
        change: metadata
            .ctime()
            .wrapping_mul(1_000_000_000)
            .wrapping_add(metadata.ctime_nsec()),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChartPeriod {
    Seconds(i64),
    Day,
    Week,
    Month,
}

impl ChartPeriod {
    pub fn parse(resolution: &str, timeframe_seconds: i64) -> DataResult<Self> {
        if matches!(resolution, "1D" | "1W" | "1M") {
            if timeframe_seconds <= 0 || timeframe_seconds > 86400 || 86400 % timeframe_seconds != 0
            {
                return Err("chart resolution is incompatible with dataset".into());
            }
            return Ok(match resolution {
                "1D" => Self::Day,
                "1W" => Self::Week,
                _ => Self::Month,
            });
        }
        let (value, multiplier, suffixed) = if let Some(value) = resolution.strip_suffix('D') {
            (value, 86400i64, true)
        } else if let Some(value) = resolution.strip_suffix('S') {
            (value, 1i64, true)
        } else {
            (resolution, 60i64, false)
        };
        let seconds = value
            .parse::<i64>()
            .ok()
            .and_then(|n| n.checked_mul(multiplier))
            .ok_or("invalid chart resolution")?;
        if timeframe_seconds <= 0 || seconds < timeframe_seconds || seconds % timeframe_seconds != 0
        {
            return Err("chart resolution is incompatible with dataset".into());
        }
        if seconds != timeframe_seconds
            && (suffixed || ![60, 180, 300, 900, 1800, 3600, 7200, 14400].contains(&seconds))
        {
            return Err("chart resolution is unsupported".into());
        }
        Ok(Self::Seconds(seconds))
    }

    pub fn bucket(self, timestamp: i64) -> DataResult<i64> {
        let seconds = match self {
            Self::Seconds(period) if period > 0 => timestamp.div_euclid(period).checked_mul(period),
            Self::Day => timestamp.div_euclid(86400).checked_mul(86400),
            Self::Week => {
                let date = Utc
                    .timestamp_opt(timestamp, 0)
                    .single()
                    .ok_or("invalid chart timestamp")?;
                timestamp
                    .div_euclid(86400)
                    .checked_sub(i64::from(date.weekday().num_days_from_monday()))
                    .and_then(|day| day.checked_mul(86400))
            }
            Self::Month => {
                let date = Utc
                    .timestamp_opt(timestamp, 0)
                    .single()
                    .ok_or("invalid chart timestamp")?;
                Some(
                    Utc.with_ymd_and_hms(date.year(), date.month(), 1, 0, 0, 0)
                        .single()
                        .ok_or("invalid chart month")?
                        .timestamp(),
                )
            }
            _ => None,
        }
        .ok_or("invalid chart timestamp")?;
        seconds
            .checked_mul(1000)
            .ok_or_else(|| "chart timestamp overflow".into())
    }
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
pub struct ReadStats {
    pub row_groups_decoded: usize,
    pub rows_decoded: usize,
    pub sha256_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimingQuery {
    #[serde(default)]
    pub index: usize,
    pub at_or_before: Option<i64>,
}

pub struct ArtifactData {
    root: PathBuf,
    verified: Mutex<VecDeque<(FileIdentity, String)>>,
}

struct OpenArtifact {
    file: File,
    path: PathBuf,
    identity: FileIdentity,
    reader: SerializedFileReader<File>,
    stats: ReadStats,
}

impl ArtifactData {
    pub fn new(root: impl AsRef<Path>) -> DataResult<Self> {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            verified: Mutex::new(VecDeque::new()),
        })
    }

    pub fn write_dataset(
        &self,
        workspace: &str,
        dataset: &str,
        rows: &[Value],
    ) -> DataResult<(String, String)> {
        self.write_dataset_iter(workspace, dataset, rows.iter().map(Ok))
    }

    pub(crate) fn write_dataset_iter<R: std::borrow::Borrow<Value>>(
        &self,
        workspace: &str,
        dataset: &str,
        mut rows: impl Iterator<Item = DataResult<R>>,
    ) -> DataResult<(String, String)> {
        safe_component(workspace)?;
        safe_component(dataset)?;
        let relative = format!("{workspace}/datasets/{dataset}.parquet");
        let target = self.output_target(&relative)?;
        let temporary = target.with_file_name(format!(
            ".{}.{}.tmp",
            target.file_name().unwrap().to_string_lossy(),
            uuid::Uuid::new_v4().simple()
        ));
        let mut publish = || -> DataResult<(String, String)> {
            let fields = ["timestamp", "open", "high", "low", "close", "volume"]
                .into_iter()
                .map(|name| {
                    Type::primitive_type_builder(
                        name,
                        if name == "timestamp" {
                            PhysicalType::INT64
                        } else {
                            PhysicalType::DOUBLE
                        },
                    )
                    .with_repetition(Repetition::REQUIRED)
                    .build()
                    .map(Arc::new)
                    .map_err(|e| e.to_string())
                })
                .collect::<DataResult<Vec<_>>>()?;
            let schema = Arc::new(
                Type::group_type_builder("schema")
                    .with_fields(fields)
                    .build()
                    .map_err(|e| e.to_string())?,
            );
            let properties = Arc::new(
                WriterProperties::builder()
                    .set_compression(Compression::ZSTD(Default::default()))
                    .build(),
            );
            let output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            // FlushFileBuffers requires a writable handle on Windows. Keep the
            // created file's handle so publication cannot sync a replaced path.
            let durable_output = output.try_clone().map_err(|e| e.to_string())?;
            let mut writer =
                SerializedFileWriter::new(output, schema, properties).map_err(|e| e.to_string())?;
            let mut count = 0;
            loop {
                let batch = rows.by_ref().take(50_000).collect::<DataResult<Vec<_>>>()?;
                if batch.is_empty() { break; }
                count += batch.len();
                let mut group = writer.next_row_group().map_err(|e| e.to_string())?;
                for name in ["timestamp", "open", "high", "low", "close", "volume"] {
                    let mut column = group
                        .next_column()
                        .map_err(|e| e.to_string())?
                        .ok_or("dataset column writer missing")?;
                    if name == "timestamp" {
                        let values = batch
                            .iter()
                            .map(|row|row_timestamp(row.borrow()))
                            .collect::<DataResult<Vec<_>>>()?;
                        column
                            .typed::<Int64Type>()
                            .write_batch(&values, None, None)
                            .map_err(|e| e.to_string())?;
                    } else {
                        let values = batch
                            .iter()
                            .map(|row| {
                                row.borrow()[name]
                                    .as_f64()
                                    .filter(|v| v.is_finite())
                                    .ok_or_else(|| format!("invalid canonical artifact {name}"))
                            })
                            .collect::<DataResult<Vec<_>>>()?;
                        column
                            .typed::<DoubleType>()
                            .write_batch(&values, None, None)
                            .map_err(|e| e.to_string())?;
                    }
                    column.close().map_err(|e| e.to_string())?;
                }
                group.close().map_err(|e| e.to_string())?;
            }
            if count == 0 { return Err("dataset requires at least one row".into()); }
            writer.close().map_err(|e| e.to_string())?;
            durable_output
                .sync_all()
                .map_err(|e| e.to_string())?;
            drop(durable_output);
            let digest = digest_file(&temporary)?;
            self.publish_created(&temporary, &relative)?;
            Ok((relative.clone(), digest))
        };
        let result = publish();
        let _ = fs::remove_file(temporary);
        result
    }

    pub fn write_raw_source_bytes(
        &self,
        workspace: &str,
        dataset: &str,
        bytes: &[u8],
    ) -> DataResult<(String, String)> {
        self.write_raw_source(workspace, dataset, bytes)
    }

    pub(crate) fn write_raw_source(
        &self,
        workspace: &str,
        dataset: &str,
        mut source: impl Read,
    ) -> DataResult<(String, String)> {
        safe_component(workspace)?;
        safe_component(dataset)?;
        let relative = format!("{workspace}/raw/{dataset}/source.csv");
        let target = self.output_target(&relative)?;
        let temporary =
            target.with_file_name(format!(".source.csv.{}.tmp", uuid::Uuid::new_v4().simple()));
        let mut publish = || -> DataResult<(String, String)> {
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut block = [0u8; 64 * 1024];
            loop {
                let n = source.read(&mut block).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                output.write_all(&block[..n]).map_err(|e| e.to_string())?;
                hash.update(&block[..n]);
            }
            output.sync_all().map_err(|e| e.to_string())?;
            drop(output);
            let digest = format!("{:x}", hash.finalize());
            self.publish_created(&temporary, &relative)?;
            Ok((relative.clone(), digest))
        };
        let result = publish();
        let _ = fs::remove_file(temporary);
        result
    }

    fn output_target(&self, relative: &str) -> DataResult<PathBuf> {
        let parts: Vec<_> = relative.split('/').collect();
        let mut path = self.root.clone();
        for (index, part) in parts.iter().enumerate() {
            safe_component(part)?;
            path.push(part);
            if index + 1 < parts.len() {
                match fs::create_dir(&path) {
                    Ok(()) => (),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(error) => return Err(error.to_string()),
                }
                self.path(
                    path.strip_prefix(&self.root)
                        .map_err(|e| e.to_string())?
                        .to_str()
                        .ok_or("invalid artifact path")?,
                )?;
            }
        }
        if path.try_exists().map_err(|e| e.to_string())? {
            return Err("artifact already exists".into());
        }
        Ok(path)
    }

    fn publish_created(&self, temporary: &Path, relative: &str) -> DataResult<()> {
        let target = self.output_target(relative)?;
        publish_created_file(temporary, &target)
            .map_err(|e| format!("immutable artifact publication failed: {e}"))?;
        if let Err(error) = self.path(relative) {
            return Err(error);
        }
        Ok(())
    }

    pub fn tick_manifest(&self, workspace: &str, snapshot: &str) -> DataResult<Value> {
        tick_token(workspace)?;
        let Some(digest) = snapshot.strip_prefix("ticks-") else {
            return Err("invalid snapshot identity".into());
        };
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid snapshot identity".into());
        }
        let relative = format!("{workspace}/ticks/manifests/{snapshot}.json");
        let (_, value) = self.read_json_object(&relative)?;
        if value["snapshot_id"] != snapshot || value["workspace_id"] != workspace {
            return Err("tick manifest checksum mismatch".into());
        }
        let mut unsigned = value.clone();
        unsigned.as_object_mut().unwrap().remove("snapshot_id");
        let mut canonical = crate::research_jobs::canonical_py_json(&unsigned)?;
        // Result artifacts terminate in a newline; the pinned tick manifest
        // contract uses the same Python canonical JSON without that newline.
        if canonical.last() == Some(&b'\n') {
            canonical.pop();
        }
        if format!("{:x}", Sha256::digest(canonical)) != digest {
            return Err("tick manifest checksum mismatch".into());
        }
        Ok(value)
    }

    pub fn latest_ticks(&self, workspace: &str, symbol: &str) -> DataResult<Option<Value>> {
        tick_token(workspace)?;
        tick_token(symbol)?;
        let relative = format!("{workspace}/ticks/latest/{symbol}.json");
        // Absence is expected, while malformed or redirected pointers fail.
        if !self
            .root
            .join(&relative)
            .try_exists()
            .map_err(|e| e.to_string())?
        {
            return Ok(None);
        }
        let (_, pointer) = self.read_json_object(&relative)?;
        let snapshot = pointer["snapshot_id"]
            .as_str()
            .ok_or("invalid snapshot identity")?;
        self.tick_manifest(workspace, snapshot).map(Some)
    }

    pub fn assert_tick_interval(
        &self,
        workspace: &str,
        snapshot: &str,
        from: i64,
        to: i64,
    ) -> DataResult<()> {
        let manifest = self.tick_manifest(workspace, snapshot)?;
        assert_tick_coverage(&manifest, from, to)
    }

    pub fn tick_interval(
        &self,
        workspace: &str,
        snapshot: &str,
        from: i64,
        to: i64,
    ) -> DataResult<Vec<Value>> {
        if to <= from {
            return Err("invalid tick read interval or batch size".into());
        }
        let manifest = self.tick_manifest(workspace, snapshot)?;
        assert_tick_coverage(&manifest, from, to)?;
        let partitions = manifest["partitions"]
            .as_array()
            .ok_or("invalid tick partitions")?;
        let mut rows = Vec::new();
        let mut previous = None;
        for part in partitions {
            let count = part["row_count"]
                .as_u64()
                .ok_or("invalid tick partition row count")?;
            let begin = part["requested_from_msc"]
                .as_i64()
                .ok_or("invalid tick partition bounds")?;
            let end = part["requested_to_msc"]
                .as_i64()
                .ok_or("invalid tick partition bounds")?;
            if count == 0 || end <= from || begin >= to {
                continue;
            }
            let sha = part["sha256"]
                .as_str()
                .ok_or("invalid tick object checksum")?;
            let relative = part["path"].as_str().ok_or("invalid tick object path")?;
            if relative != format!("objects/{sha}.parquet") {
                return Err("invalid tick object path".into());
            }
            let path = format!("{workspace}/ticks/{relative}");
            let mut artifact = self.open(&path, sha)?;
            if artifact.total()? as u64 != count {
                return Err("tick partition row count mismatch".into());
            }
            for group in 0..artifact.reader.num_row_groups() {
                if let Some((min, max)) = artifact.column_bounds(group, "time_msc")? {
                    if min >= to || max < from {
                        continue;
                    }
                }
                for row in artifact.group(group, None)? {
                    let stamp = row["time_msc"].as_i64().ok_or("invalid tick timestamp")?;
                    if from <= stamp && stamp < to {
                        if previous.is_some_and(|last| stamp < last) {
                            return Err("ticks must be ordered".into());
                        }
                        previous = Some(stamp);
                        rows.push(row);
                    }
                }
            }
            self.finish(&path, &artifact)?;
        }
        Ok(rows)
    }

    fn read_json_object(&self, relative: &str) -> DataResult<(Vec<u8>, Value)> {
        let path = self.path(relative)?;
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let before = identity(&file)?;
        if before.size > 16 * 1024 * 1024 {
            return Err("artifact JSON exceeds read budget".into());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if self.path(relative)? != path
            || identity(&file)? != before
            || identity(&File::open(path).map_err(|e| e.to_string())?)? != before
        {
            return Err("artifact changed during read".into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if !value.is_object() {
            return Err("artifact JSON must be an object".into());
        }
        Ok((bytes, value))
    }

    pub(crate) fn path(&self, relative: &str) -> DataResult<PathBuf> {
        if relative.is_empty() || relative.contains(':') || relative.chars().any(|c| c < ' ') {
            return Err("artifact path escapes root".into());
        }
        // Both slash forms are separators in artifact manifests on every host.
        let normalized = relative.replace('\\', "/");
        if normalized.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) || {
                let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
                    || (stem.len() == 4
                        && (stem.starts_with("COM") || stem.starts_with("LPT"))
                        && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            }
        }) {
            return Err("artifact path escapes root".into());
        }
        let mut result = self.root.clone();
        for component in Path::new(&normalized).components() {
            let Component::Normal(name) = component else {
                return Err("artifact path escapes root".into());
            };
            result.push(name);
            let metadata = fs::symlink_metadata(&result).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("artifact path escapes root".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err("artifact path escapes root".into());
                }
            }
        }
        let canonical = fs::canonicalize(&result).map_err(|e| e.to_string())?;
        if !canonical.starts_with(&self.root) || canonical == self.root {
            return Err("artifact path escapes root".into());
        }
        Ok(canonical)
    }

    fn open(&self, relative: &str, sha: &str) -> DataResult<OpenArtifact> {
        if sha.len() != 64
            || !sha
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid artifact SHA-256".into());
        }
        let path = self.path(relative)?;
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        let before = identity(&file)?;
        let mut stats = ReadStats::default();
        {
            let mut receipts = self
                .verified
                .lock()
                .map_err(|_| "artifact receipt lock poisoned")?;
            if !receipts
                .iter()
                .any(|(id, digest)| id == &before && digest == sha)
            {
                let mut digest = Sha256::new();
                let mut buffer = vec![0; 1024 * 1024];
                loop {
                    let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if read == 0 {
                        break;
                    }
                    stats.sha256_bytes += read as u64;
                    digest.update(&buffer[..read]);
                }
                if format!("{:x}", digest.finalize()) != sha || identity(&file)? != before {
                    return Err("dataset checksum mismatch".into());
                }
                receipts.push_back((before.clone(), sha.to_owned()));
                while receipts.len() > 32 {
                    receipts.pop_front();
                }
            }
        }
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let reader = SerializedFileReader::new(file.try_clone().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        Ok(OpenArtifact {
            file,
            path,
            identity: before,
            reader,
            stats,
        })
    }

    fn finish(&self, relative: &str, artifact: &OpenArtifact) -> DataResult<()> {
        let path = self.path(relative)?;
        if path != artifact.path
            || identity(&artifact.file)? != artifact.identity
            || identity(&File::open(path).map_err(|e| e.to_string())?)? != artifact.identity
        {
            return Err("dataset changed during read".into());
        }
        Ok(())
    }

    pub fn indices(
        &self,
        path: &str,
        sha: &str,
        start: usize,
        end: usize,
    ) -> DataResult<Vec<Value>> {
        self.indices_with_stats(path, sha, start, end)
            .map(|(rows, _)| rows)
    }

    pub fn indices_with_stats(
        &self,
        path: &str,
        sha: &str,
        start: usize,
        end: usize,
    ) -> DataResult<(Vec<Value>, ReadStats)> {
        if start > end {
            return Err("invalid dataset index range".into());
        }
        let mut artifact = self.open(path, sha)?;
        if end as u64 > artifact.total()? as u64 {
            return Err("dataset index exceeds immutable dataset".into());
        }
        let mut rows = Vec::with_capacity((end - start).min(8192));
        let mut offset = 0;
        for group in 0..artifact.reader.num_row_groups() {
            let count = artifact.group_size(group)?;
            if offset < end && offset + count > start {
                let values = artifact.group(group, None)?;
                rows.extend(
                    values
                        .into_iter()
                        .skip(start.saturating_sub(offset))
                        .take(end.min(offset + count) - start.max(offset)),
                );
            }
            offset += count;
            if offset >= end {
                break;
            }
        }
        self.finish(path, &artifact)?;
        Ok((rows, artifact.stats))
    }

    pub fn range(
        &self,
        path: &str,
        sha: &str,
        from: i64,
        to: i64,
        max_bars: usize,
    ) -> DataResult<Vec<Value>> {
        if to < from {
            return Err("invalid dataset range budget".into());
        }
        let mut artifact = self.open(path, sha)?;
        let mut rows = Vec::new();
        for group in 0..artifact.reader.num_row_groups() {
            if let Some((min, max)) = artifact.timestamp_bounds(group)? {
                if min >= to || max < from {
                    continue;
                }
            }
            for row in
                artifact.group(group, Some(&["timestamp", "open", "high", "low", "close"]))?
            {
                let timestamp = row_timestamp(&row)?;
                if from <= timestamp && timestamp < to {
                    if rows.len() >= max_bars {
                        return Err("run exceeded budget.max_bars".into());
                    }
                    rows.push(row);
                }
            }
        }
        self.finish(path, &artifact)?;
        Ok(rows)
    }

    pub fn timings(
        &self,
        path: &str,
        sha: &str,
        queries: &[TimingQuery],
    ) -> DataResult<Vec<Value>> {
        let mut artifact = self.open(path, sha)?;
        let total = artifact.total()?;
        if queries.iter().any(|query| query.index >= total) {
            return Err("start_index exceeds dataset".into());
        }
        if queries.is_empty() {
            self.finish(path, &artifact)?;
            return Ok(Vec::new());
        }
        let mut timestamps = TimestampCache::default();
        let first = timestamps.at(&mut artifact, 0)?;
        let last = timestamps.at(&mut artifact, total - 1)?;
        let mut result = Vec::with_capacity(queries.len());
        for query in queries {
            let timestamp = timestamps.at(&mut artifact, query.index)?;
            let cursor = if let Some(cutoff) = query.at_or_before {
                let mut found = -1i64;
                let offsets = artifact.offsets()?;
                for group in (0..offsets.len()).rev() {
                    if artifact
                        .timestamp_bounds(group)?
                        .is_some_and(|(min, _)| min > cutoff)
                    {
                        continue;
                    }
                    let values = timestamps.group(&mut artifact, group)?;
                    let position = values.partition_point(|value| *value <= cutoff);
                    if position > 0 {
                        found = (offsets[group] + position - 1) as i64;
                        break;
                    }
                }
                found
            } else {
                query.index as i64
            };
            result.push(json!({"row_count": total, "first_utc": first, "last_utc": last, "index_utc": timestamp, "cursor_index": cursor}));
        }
        self.finish(path, &artifact)?;
        Ok(result)
    }

    pub fn find_cursor(
        &self,
        path: &str,
        sha: &str,
        canonical: usize,
        timestamp: i64,
    ) -> DataResult<usize> {
        let mut artifact = self.open(path, sha)?;
        if canonical >= artifact.total()? {
            return Err("replay cursor exceeds immutable dataset".into());
        }
        let mut times = TimestampCache::default();
        if timestamp > times.at(&mut artifact, canonical)? {
            return Err("view cutoff cannot exceed current replay cutoff".into());
        }
        let offsets = artifact.offsets()?;
        let mut target = None;
        for (group, offset) in offsets
            .iter()
            .copied()
            .enumerate()
            .take_while(|(_, offset)| *offset <= canonical)
        {
            if artifact
                .timestamp_bounds(group)?
                .is_some_and(|(_, max)| max < timestamp)
            {
                continue;
            }
            let values = times.group(&mut artifact, group)?;
            let values = &values[..values.len().min(canonical + 1 - offset)];
            let position = values.partition_point(|value| *value < timestamp);
            if position < values.len() {
                target = Some(offset + position);
                break;
            }
        }
        self.finish(path, &artifact)?;
        target.ok_or_else(|| "view cutoff is outside replay dataset".into())
    }

    pub fn chart_window(
        &self,
        path: &str,
        sha: &str,
        cursor: usize,
        period: ChartPeriod,
        to: Option<i64>,
        count_back: usize,
    ) -> DataResult<Value> {
        self.chart_window_with_stats(path, sha, cursor, period, to, count_back)
            .map(|(value, _)| value)
    }

    pub fn chart_window_with_stats(
        &self,
        path: &str,
        sha: &str,
        cursor: usize,
        period: ChartPeriod,
        to: Option<i64>,
        count_back: usize,
    ) -> DataResult<(Value, ReadStats)> {
        if !(1..=2000).contains(&count_back) {
            return Err("invalid chart window budget".into());
        }
        let mut artifact = self.open(path, sha)?;
        let total = artifact.total()?;
        if cursor >= total {
            return Err("chart cursor exceeds immutable dataset".into());
        }
        let offsets = artifact.offsets()?;
        let current_group = offsets.partition_point(|offset| *offset <= cursor) - 1;
        let current = artifact.chart_group(current_group)?;
        let cutoff = current[cursor - offsets[current_group]].timestamp;
        let to = to
            .map(|value| value.checked_mul(1000).ok_or("chart timestamp overflow"))
            .transpose()?;
        let mut current = Some(current);
        let mut buckets = BTreeMap::<i64, Map<String, Value>>::new();
        let mut has_more = false;
        'groups: for group in (0..=current_group).rev() {
            if let (Some(to), Some((min, _))) = (to, artifact.timestamp_bounds(group)?) {
                if period.bucket(min)? >= to {
                    continue;
                }
            }
            let rows = if group == current_group {
                current.take().unwrap()
            } else {
                artifact.chart_group(group)?
            };
            let length = rows.len().min(cursor + 1 - offsets[group]);
            for row in rows[..length].iter().rev() {
                let time = period.bucket(row.timestamp)?;
                if to.is_some_and(|to| time >= to) {
                    continue;
                }
                if buckets.len() >= count_back && !buckets.contains_key(&time) {
                    has_more = true;
                    break 'groups;
                }
                prepend(&mut buckets, time, row)?;
            }
        }
        self.finish(path, &artifact)?;
        let bars: Vec<Value> = buckets.into_values().map(Value::Object).collect();
        Ok((
            json!({"bars": bars, "cutoff_timestamp": cutoff, "has_more": has_more, "total_row_count": total}),
            artifact.stats,
        ))
    }
}

impl OpenArtifact {
    fn projection(&self, columns: &[&str]) -> DataResult<Type> {
        let schema = self.reader.metadata().file_metadata().schema();
        Type::group_type_builder(schema.name())
            .with_fields(
                schema
                    .get_fields()
                    .iter()
                    .filter(|field| columns.contains(&field.name()))
                    .cloned()
                    .collect(),
            )
            .build()
            .map_err(|e| e.to_string())
    }

    fn chart_group(&mut self, group: usize) -> DataResult<Vec<ChartRow>> {
        let projection = self.projection(&[
            "timestamp",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "tick_volume",
        ])?;
        let reader = self
            .reader
            .get_row_group(group)
            .map_err(|e| e.to_string())?;
        let rows = reader
            .get_row_iter(Some(projection))
            .map_err(|e| e.to_string())?
            .map(|row| {
                row.map_err(|e| e.to_string())
                    .and_then(ChartRow::from_record)
            })
            .collect::<DataResult<Vec<_>>>()?;
        self.stats.row_groups_decoded += 1;
        self.stats.rows_decoded += rows.len();
        Ok(rows)
    }

    fn timestamp_group(&mut self, group: usize) -> DataResult<Vec<i64>> {
        let projection = self.projection(&["timestamp"])?;
        let reader = self
            .reader
            .get_row_group(group)
            .map_err(|e| e.to_string())?;
        let values = reader
            .get_row_iter(Some(projection))
            .map_err(|e| e.to_string())?
            .map(|row| {
                let row = row.map_err(|e| e.to_string())?;
                match row.into_columns().into_iter().next() {
                    Some((_, Field::Long(value))) => Ok(value),
                    Some((_, Field::Int(value))) => Ok(i64::from(value)),
                    _ => Err("dataset timestamp must be an integer UTC value".into()),
                }
            })
            .collect::<DataResult<Vec<_>>>()?;
        self.stats.row_groups_decoded += 1;
        self.stats.rows_decoded += values.len();
        Ok(values)
    }

    fn total(&self) -> DataResult<usize> {
        usize::try_from(self.reader.metadata().file_metadata().num_rows())
            .map_err(|_| "invalid dataset row count".into())
    }
    fn group_size(&self, group: usize) -> DataResult<usize> {
        usize::try_from(self.reader.metadata().row_group(group).num_rows())
            .map_err(|_| "invalid row group size".into())
    }
    fn offsets(&self) -> DataResult<Vec<usize>> {
        let mut result = Vec::with_capacity(self.reader.num_row_groups());
        let mut offset = 0usize;
        for group in 0..self.reader.num_row_groups() {
            result.push(offset);
            offset = offset
                .checked_add(self.group_size(group)?)
                .ok_or("dataset row count overflow")?;
        }
        Ok(result)
    }
    fn timestamp_bounds(&self, group: usize) -> DataResult<Option<(i64, i64)>> {
        self.column_bounds(group, "timestamp")
    }
    fn column_bounds(&self, group: usize, name: &str) -> DataResult<Option<(i64, i64)>> {
        let schema = self.reader.metadata().file_metadata().schema_descr();
        let column = schema
            .columns()
            .iter()
            .position(|column| column.path().string() == name)
            .ok_or("dataset has no timestamp column")?;
        Ok(
            match self
                .reader
                .metadata()
                .row_group(group)
                .column(column)
                .statistics()
            {
                Some(Statistics::Int64(stat)) => {
                    stat.min_opt().zip(stat.max_opt()).map(|(a, b)| (*a, *b))
                }
                Some(Statistics::Int32(stat)) => stat
                    .min_opt()
                    .zip(stat.max_opt())
                    .map(|(a, b)| (i64::from(*a), i64::from(*b))),
                None => None,
                _ => return Err("dataset timestamp must be an integer UTC value".into()),
            },
        )
    }
    fn group(&mut self, group: usize, columns: Option<&[&str]>) -> DataResult<Vec<Value>> {
        let schema = self.reader.metadata().file_metadata().schema();
        let projection = columns
            .map(|columns| {
                Type::group_type_builder(schema.name())
                    .with_fields(
                        schema
                            .get_fields()
                            .iter()
                            .filter(|field| columns.contains(&field.name()))
                            .cloned()
                            .collect(),
                    )
                    .build()
            })
            .transpose()
            .map_err(|e| e.to_string())?;
        let reader = self
            .reader
            .get_row_group(group)
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = reader
            .get_row_iter(projection)
            .map_err(|e| e.to_string())?
            .map(|row| row.map_err(|e| e.to_string()).and_then(row_json))
            .collect::<DataResult<_>>()?;
        self.stats.row_groups_decoded += 1;
        self.stats.rows_decoded += rows.len();
        Ok(rows)
    }
}

#[derive(Default)]
struct TimestampCache {
    groups: VecDeque<(usize, Vec<i64>)>,
}
impl TimestampCache {
    fn group(&mut self, artifact: &mut OpenArtifact, group: usize) -> DataResult<&[i64]> {
        if let Some(index) = self.groups.iter().position(|(key, _)| *key == group) {
            return Ok(&self.groups[index].1);
        }
        let values = artifact.timestamp_group(group)?;
        if values.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err("dataset timestamps must be ordered".into());
        }
        while self.groups.len() >= 4 {
            self.groups.pop_front();
        }
        self.groups.push_back((group, values));
        Ok(&self.groups.back().unwrap().1)
    }
    fn at(&mut self, artifact: &mut OpenArtifact, index: usize) -> DataResult<i64> {
        let offsets = artifact.offsets()?;
        let group = offsets.partition_point(|offset| *offset <= index) - 1;
        self.group(artifact, group)?
            .get(index - offsets[group])
            .copied()
            .ok_or_else(|| "dataset index exceeds immutable dataset".into())
    }
}

fn row_timestamp(row: &Value) -> DataResult<i64> {
    row.get("timestamp")
        .and_then(Value::as_i64)
        .ok_or_else(|| "dataset timestamp must be an integer UTC value".into())
}

fn tick_token(value: &str) -> DataResult<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err("invalid storage identity".into());
    }
    Ok(())
}

fn safe_component(value: &str) -> DataResult<()> {
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.is_empty()
        || matches!(value, "." | "..")
        || value.contains(['/', '\\', ':'])
        || value.chars().any(|c| c < ' ')
        || value.ends_with(['.', ' '])
        || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("artifact path must be a safe single component".into());
    }
    Ok(())
}

fn digest_file(path: &Path) -> DataResult<String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0; 1024 * 1024];
    let mut digest = Sha256::new();
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn assert_tick_coverage(manifest: &Value, from: i64, to: i64) -> DataResult<()> {
    if to <= from {
        return Err("tick interval must be nonempty".into());
    }
    let mut cursor = from;
    for interval in manifest["available_intervals"]
        .as_array()
        .ok_or("invalid tick coverage")?
    {
        let start = interval[0].as_i64().ok_or("invalid tick coverage")?;
        let end = interval[1].as_i64().ok_or("invalid tick coverage")?;
        if start > cursor {
            break;
        }
        cursor = cursor.max(end);
        if cursor >= to {
            return Ok(());
        }
    }
    Err("tick interval not downloaded in pinned snapshot".into())
}

fn row_json(row: Row) -> DataResult<Value> {
    let mut result = Map::new();
    for (name, field) in row.into_columns() {
        let value = match field {
            Field::Null => Value::Null,
            Field::Bool(value) => json!(value),
            Field::Byte(value) => json!(value),
            Field::Short(value) => json!(value),
            Field::Int(value) => json!(value),
            Field::Long(value) => json!(value),
            Field::UByte(value) => json!(value),
            Field::UShort(value) => json!(value),
            Field::UInt(value) => json!(value),
            Field::ULong(value) => json!(value),
            Field::Float(value) => json!(value),
            Field::Double(value) => json!(value),
            Field::Str(value) => json!(value),
            // Canonical bar artifacts use primitive UTC seconds and numeric OHLCV.
            // Date/decimal/nested values need an explicit domain contract first.
            _ => {
                return Err(format!(
                    "unsupported canonical artifact column type: {name}"
                ));
            }
        };
        result.insert(name, value);
    }
    Ok(Value::Object(result))
}

struct ChartRow {
    timestamp: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: Option<f64>,
}

impl ChartRow {
    fn from_record(row: Row) -> DataResult<Self> {
        let mut result = Self {
            timestamp: 0,
            open: f64::NAN,
            high: f64::NAN,
            low: f64::NAN,
            close: f64::NAN,
            volume: None,
        };
        let mut timestamp = false;
        let mut tick_volume = None;
        for (name, field) in row.into_columns() {
            if name == "timestamp" {
                result.timestamp = match field {
                    Field::Long(value) => value,
                    Field::Int(value) => i64::from(value),
                    _ => return Err("dataset timestamp must be an integer UTC value".into()),
                };
                timestamp = true;
                continue;
            }
            let number = match field {
                Field::Null => None,
                Field::Byte(value) => Some(value as f64),
                Field::Short(value) => Some(value as f64),
                Field::Int(value) => Some(value as f64),
                Field::Long(value) => Some(value as f64),
                Field::UByte(value) => Some(value as f64),
                Field::UShort(value) => Some(value as f64),
                Field::UInt(value) => Some(value as f64),
                Field::ULong(value) => Some(value as f64),
                Field::Float(value) => Some(value as f64),
                Field::Double(value) => Some(value),
                _ => {
                    return Err(format!(
                        "unsupported canonical artifact column type: {name}"
                    ));
                }
            };
            match name.as_str() {
                "open" => result.open = number.unwrap_or(f64::NAN),
                "high" => result.high = number.unwrap_or(f64::NAN),
                "low" => result.low = number.unwrap_or(f64::NAN),
                "close" => result.close = number.unwrap_or(f64::NAN),
                "volume" => result.volume = number,
                "tick_volume" => tick_volume = number,
                _ => (),
            }
        }
        if !timestamp {
            return Err("dataset has no timestamp column".into());
        }
        result.volume = result
            .volume
            .or(tick_volume)
            .filter(|value| value.is_finite());
        Ok(result)
    }
}

fn prepend(
    buckets: &mut BTreeMap<i64, Map<String, Value>>,
    time: i64,
    row: &ChartRow,
) -> DataResult<()> {
    let (open, high, low, close, volume) = (row.open, row.high, row.low, row.close, row.volume);
    if ![open, high, low, close]
        .iter()
        .all(|value| value.is_finite())
    {
        return Ok(());
    }
    if let Some(newer) = buckets.get_mut(&time) {
        newer.insert("open".into(), json!(open));
        newer.insert(
            "high".into(),
            json!(newer["high"].as_f64().unwrap().max(high)),
        );
        newer.insert("low".into(), json!(newer["low"].as_f64().unwrap().min(low)));
        if let (Some(volume), Some(previous)) =
            (volume, newer.get("volume").and_then(Value::as_f64))
        {
            newer.insert("volume".into(), json!(previous + volume));
        } else {
            newer.remove("volume");
        }
    } else {
        let mut bar = json!({"time": time, "open": open, "high": high, "low": low, "close": close})
            .as_object()
            .unwrap()
            .clone();
        if let Some(volume) = volume {
            bar.insert("volume".into(), json!(volume));
        }
        buckets.insert(time, bar);
    }
    Ok(())
}
