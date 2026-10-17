//! Full installed-file identity, including compiled and transitive dependencies.
use crate::artifact_data::{FileIdentity, reliable_file_identity};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_CACHED_FILES: usize = 32_768;
#[derive(Clone)]
struct VerifiedHash {
    identity: FileIdentity,
    digest: [u8; 32],
}
type HashCache = Mutex<HashMap<PathBuf, VerifiedHash>>;
static VERIFIED_HASHES: OnceLock<HashCache> = OnceLock::new();

#[derive(Debug, Default)]
pub(super) struct VerificationStats {
    pub(super) read_bytes: u64,
    pub(super) cache_hits: u64,
    pub(super) cache_misses: u64,
    pub(super) enumeration_time: Duration,
    pub(super) file_verification_time: Duration,
}

fn open_unlinked_file(path: &Path) -> Result<File, String> {
    let mut options = File::options();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        // Inspect the named object itself, rather than following a substituted
        // final-component link between enumeration and opening the file.
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(windows))]
    regular(path, false)?;
    options
        .open(path)
        .map_err(|_| "scientific dependency is missing".into())
}

fn file_metadata(file: &File) -> Result<Metadata, String> {
    let metadata = file
        .metadata()
        .map_err(|_| "scientific dependency is missing")?;
    regular_metadata(&metadata, false)?;
    Ok(metadata)
}

fn read_hash(
    file: &mut File,
    maximum: u64,
    check: &impl Fn() -> Result<(), String>,
    read_bytes: &mut u64,
) -> Result<([u8; 32], u64), String> {
    let mut content = Sha256::new();
    let mut block = [0u8; 65536];
    let mut length = 0u64;
    loop {
        check()?;
        let n = file
            .read(&mut block)
            .map_err(|_| "scientific dependency read failed")?;
        if n == 0 {
            break;
        }
        length += n as u64;
        *read_bytes += n as u64;
        if length > maximum {
            return Err("scientific dependency changed during verification".into());
        }
        content.update(&block[..n]);
    }
    Ok((content.finalize().into(), length))
}

fn checked_file_hash(
    path: &Path,
    cache: &HashCache,
    stamp: fn(&File) -> Option<FileIdentity>,
    check: &impl Fn() -> Result<(), String>,
    stats: &mut VerificationStats,
    remaining: u64,
) -> Result<([u8; 32], u64), String> {
    check()?;
    let mut file = open_unlinked_file(path)?;
    let identity = stamp(&file);
    // The reliable identity already checked handle type and contains length.
    // Unsupported filesystems must validate metadata directly and rehash.
    let before = if identity.is_none() {
        Some(file_metadata(&file)?)
    } else {
        None
    };
    let length = identity
        .as_ref()
        .map(FileIdentity::len)
        .unwrap_or_else(|| before.as_ref().unwrap().len());
    if length > remaining {
        return Err("scientific dependency byte budget exceeded".into());
    }
    let cached = identity.as_ref().and_then(|identity| {
        cache
            .lock()
            .ok()?
            .get(path)
            .filter(|entry| &entry.identity == identity)
            .map(|entry| entry.digest)
    });
    let digest = if let Some(digest) = cached {
        stats.cache_hits += 1;
        digest
    } else {
        stats.cache_misses += 1;
        let (digest, read_length) = read_hash(&mut file, length, check, &mut stats.read_bytes)?;
        if read_length != length {
            return Err("scientific dependency changed during verification".into());
        }
        digest
    };
    check()?;
    let mut named = open_unlinked_file(path)?;
    if let Some(identity) = &identity {
        // A cache hit reads no bytes from the first handle. The reopened name
        // must still refer to the exact object/change stamp used by the cache.
        if (cached.is_none() && stamp(&file).as_ref() != Some(identity))
            || stamp(&named).as_ref() != Some(identity)
        {
            return Err("scientific dependency changed during verification".into());
        }
    } else {
        // An unsupported filesystem still gets exact bytes and pathname checks,
        // but never a size/mtime-only cache hit.
        let before = before.as_ref().unwrap();
        file_metadata(&named)?;
        let (named_digest, named_length) =
            read_hash(&mut named, length, check, &mut stats.read_bytes)?;
        let after = file_metadata(&file)?;
        let named_after = file_metadata(&named)?;
        if named_digest != digest
            || named_length != length
            || after.len() != length
            || named_after.len() != length
            || before.modified().ok() != after.modified().ok()
            || before.modified().ok() != named_after.modified().ok()
        {
            return Err("scientific dependency changed during verification".into());
        }
    }
    check()?;
    #[cfg(not(windows))]
    regular(path, false)?;
    if let Some(identity) = identity {
        if cached.is_none() {
            if let Ok(mut values) = cache.lock() {
                if !values.contains_key(path) && values.len() >= MAX_CACHED_FILES {
                    if let Some(key) = values.keys().next().cloned() {
                        values.remove(&key);
                    }
                }
                values.insert(path.to_owned(), VerifiedHash { identity, digest });
            }
        }
    }
    Ok((digest, length))
}

fn regular(path: &Path, directory: bool) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "scientific dependency is missing")?;
    regular_metadata(&meta, directory)
}

fn regular_metadata(meta: &Metadata, directory: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("scientific dependency links are unsupported".into());
        }
    }
    if meta.file_type().is_symlink()
        || if directory {
            !meta.is_dir()
        } else {
            !meta.is_file()
        }
    {
        return Err("scientific dependency type is invalid".into());
    }
    Ok(())
}

pub(super) fn unlinked_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("scientific dependency path must be absolute".into());
    }
    for ancestor in path.ancestors() {
        regular(ancestor, true)?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn tree(root: &Path) -> Result<Value, String> {
    tree_checked(root, &|| Ok(()))
}

pub(super) fn tree_checked(
    root: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    tree_with_cache(
        root,
        check,
        VERIFIED_HASHES.get_or_init(|| Mutex::new(HashMap::new())),
        reliable_file_identity,
    )
    .map(|(value, _)| value)
}

#[cfg(test)]
pub(super) fn tree_measured(
    root: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(Value, VerificationStats), String> {
    tree_with_cache(
        root,
        check,
        VERIFIED_HASHES.get_or_init(|| Mutex::new(HashMap::new())),
        reliable_file_identity,
    )
}

fn tree_with_cache(
    root: &Path,
    check: &impl Fn() -> Result<(), String>,
    cache: &HashCache,
    stamp: fn(&File) -> Option<FileIdentity>,
) -> Result<(Value, VerificationStats), String> {
    let enumeration_started = Instant::now();
    let mut stats = VerificationStats::default();
    check()?;
    unlinked_directory(root)?;
    let mut folders = vec![root.to_owned()];
    let mut files = Vec::new();
    let mut directories = 0usize;
    while let Some(folder) = folders.pop() {
        check()?;
        regular(&folder, true)?;
        directories += 1;
        for entry in std::fs::read_dir(folder).map_err(|_| "scientific dependency is missing")? {
            check()?;
            let entry = entry.map_err(|_| "scientific dependency is missing")?;
            let path = entry.path();
            // On Windows this reuses FindFirstFile/FindNextFile metadata.
            // DirEntry::metadata does not follow links on supported platforms.
            let meta = entry
                .metadata()
                .map_err(|_| "scientific dependency is missing")?;
            regular_metadata(&meta, meta.is_dir())?;
            if meta.is_dir() {
                folders.push(path);
            } else {
                files.push(path);
            }
            if directories + folders.len() + files.len() > MAX_FILES {
                return Err("scientific dependency file budget exceeded".into());
            }
        }
    }
    let name = |path: &std::path::PathBuf| -> Result<String, String> {
        let text = path
            .strip_prefix(root)
            .map_err(|_| "scientific dependency escaped root")?
            .to_str()
            .ok_or("scientific dependency path must be UTF-8")?
            .replace('\\', "/");
        if text.len() > 4096 {
            return Err("scientific dependency path budget exceeded".into());
        }
        Ok(text)
    };
    let mut entries = files
        .into_iter()
        .map(|p| name(&p).map(|n| (n, p)))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    stats.enumeration_time = enumeration_started.elapsed();
    let files_started = Instant::now();
    let mut digest = Sha256::new();
    let mut total = 0u64;
    for (relative, path) in &entries {
        check()?;
        let (content, length) =
            checked_file_hash(path, cache, stamp, check, &mut stats, MAX_BYTES - total)?;
        total += length;
        digest.update((relative.len() as u64).to_le_bytes());
        digest.update(relative.as_bytes());
        digest.update(content);
    }
    check()?;
    stats.file_verification_time = files_started.elapsed();
    Ok((
        json!({"sha256":format!("{:x}",digest.finalize()),"file_count":entries.len(),"total_bytes":total}),
        stats,
    ))
}

pub(super) fn manifest_digest(trees: &Value) -> Result<String, String> {
    let object = trees
        .as_object()
        .filter(|o| {
            o.len() == 2 && o.contains_key("engine_runtime") && o.contains_key("base_python")
        })
        .ok_or("scientific dependency manifest is invalid")?;
    for tree in object.values() {
        let item = tree
            .as_object()
            .filter(|o| o.len() == 4)
            .ok_or("scientific dependency manifest is invalid")?;
        if !item.contains_key("path")
            || !tree["path"]
                .as_str()
                .is_some_and(|p| Path::new(p).is_absolute())
            || !tree["sha256"].as_str().is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
            || !tree["file_count"]
                .as_u64()
                .is_some_and(|n| n > 0 && n <= MAX_FILES as u64)
            || !tree["total_bytes"].as_u64().is_some_and(|n| n <= MAX_BYTES)
        {
            return Err("scientific dependency manifest is invalid".into());
        }
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(crate::research_jobs::canonical_py_json(trees)?)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_does_not_grow_past_its_file_budget() {
        let root =
            std::env::temp_dir().join(format!("scientific-cache-budget-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("file");
        std::fs::write(&path, b"x").unwrap();
        let identity = reliable_file_identity(&File::open(&path).unwrap()).unwrap();
        let cache = Mutex::new(
            (0..MAX_CACHED_FILES)
                .map(|index| {
                    (
                        root.join(format!("cached-{index}")),
                        VerifiedHash {
                            identity: identity.clone(),
                            digest: [0; 32],
                        },
                    )
                })
                .collect::<HashMap<_, _>>(),
        );
        let mut stats = VerificationStats::default();
        checked_file_hash(
            &path,
            &cache,
            reliable_file_identity,
            &|| Ok(()),
            &mut stats,
            1,
        )
        .unwrap();
        let entries = cache.lock().unwrap();
        assert_eq!(entries.len(), MAX_CACHED_FILES);
        assert!(entries.contains_key(&path));
        drop(entries);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cache_revalidates_change_stamp_replacement_names_and_cancellation() {
        let root = std::env::temp_dir().join(format!("scientific-cache-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("compiled.pyd");
        std::fs::write(&path, b"original").unwrap();
        let cache = Mutex::new(HashMap::new());
        let (initial, cold) =
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity).unwrap();
        let (warm, warm_bytes) =
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity).unwrap();
        assert_eq!(initial, warm);
        assert_eq!(cold.read_bytes, 8);
        assert_eq!(cold.cache_misses, 1);
        assert_eq!(warm_bytes.read_bytes, 0);
        assert_eq!(warm_bytes.cache_hits, 1);
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, b"modified").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let (changed, read) =
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity).unwrap();
        assert_ne!(initial, changed);
        assert_eq!(
            read.read_bytes, 8,
            "restoring mtime must not authorize a cache hit"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, b"replaced").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        let (replaced, read) =
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity).unwrap();
        assert_ne!(changed, replaced);
        assert_eq!(read.read_bytes, 8);
        std::fs::write(root.join("extra.dll"), b"x").unwrap();
        let (added, _) =
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity).unwrap();
        assert_ne!(added, replaced);
        std::fs::remove_file(root.join("extra.dll")).unwrap();
        assert_eq!(
            tree_with_cache(&root, &|| Ok(()), &cache, reliable_file_identity)
                .unwrap()
                .0,
            replaced
        );
        let calls = std::cell::Cell::new(0);
        let error = tree_with_cache(
            &root,
            &|| {
                calls.set(calls.get() + 1);
                if calls.get() == 6 {
                    Err("research_execution_interrupted".into())
                } else {
                    Ok(())
                }
            },
            &cache,
            reliable_file_identity,
        )
        .unwrap_err();
        assert_eq!(error, "research_execution_interrupted");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cache_hit_rechecks_the_pathname_after_use() {
        let root =
            std::env::temp_dir().join(format!("scientific-path-replace-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("compiled.pyd");
        std::fs::write(&path, b"original").unwrap();
        let cache = Mutex::new(HashMap::new());
        let mut stats = VerificationStats::default();
        checked_file_hash(
            &path,
            &cache,
            reliable_file_identity,
            &|| Ok(()),
            &mut stats,
            1024,
        )
        .unwrap();
        let calls = std::cell::Cell::new(0);
        let error = checked_file_hash(
            &path,
            &cache,
            reliable_file_identity,
            &|| {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    std::fs::remove_file(&path).unwrap();
                    std::fs::write(&path, b"replaced").unwrap();
                }
                Ok(())
            },
            &mut stats,
            1024,
        )
        .unwrap_err();
        assert_eq!(error, "scientific dependency changed during verification");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unsupported_change_stamp_never_uses_cache() {
        let root =
            std::env::temp_dir().join(format!("scientific-no-stamp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("compiled.pyd"), b"original").unwrap();
        let cache = Mutex::new(HashMap::new());
        let (cold, cold_bytes) = tree_with_cache(&root, &|| Ok(()), &cache, |_| None).unwrap();
        let (warm, warm_bytes) = tree_with_cache(&root, &|| Ok(()), &cache, |_| None).unwrap();
        assert_eq!(cold, warm);
        assert_eq!(cold_bytes.read_bytes, 16);
        assert_eq!(warm_bytes.read_bytes, 16);
        assert!(cache.lock().unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn pathname_substituted_with_reparse_point_is_never_followed() {
        let root =
            std::env::temp_dir().join(format!("scientific-reparse-race-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("compiled.pyd");
        let target = root.join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(&path, b"original").unwrap();
        let cache = Mutex::new(HashMap::new());
        let mut stats = VerificationStats::default();
        checked_file_hash(
            &path,
            &cache,
            reliable_file_identity,
            &|| Ok(()),
            &mut stats,
            1024,
        )
        .unwrap();
        let calls = std::cell::Cell::new(0);
        assert!(
            checked_file_hash(
                &path,
                &cache,
                reliable_file_identity,
                &|| {
                    calls.set(calls.get() + 1);
                    if calls.get() == 2 {
                        std::fs::remove_file(&path).unwrap();
                        let status = std::process::Command::new("cmd")
                            .args(["/C", "mklink", "/J"])
                            .arg(&path)
                            .arg(&target)
                            .output()
                            .unwrap();
                        assert!(
                            status.status.success(),
                            "{}",
                            String::from_utf8_lossy(&status.stderr)
                        );
                    }
                    Ok(())
                },
                &mut stats,
                1024
            )
            .is_err()
        );
        // The fallback must reject the opened object even without a reliable stamp.
        assert!(checked_file_hash(&path, &cache, |_| None, &|| Ok(()), &mut stats, 1024).is_err());
        std::fs::remove_dir(&path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn verification_stops_during_a_file_read() {
        let root = std::env::temp_dir().join(format!("scientific-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("large.dll"), vec![0; 1024 * 1024]).unwrap();
        let calls = std::cell::Cell::new(0);
        let error = tree_checked(&root, &|| {
            calls.set(calls.get() + 1);
            if calls.get() >= 9 {
                Err("research_execution_interrupted".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert_eq!(error, "research_execution_interrupted");
        assert_eq!(calls.get(), 9);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn complete_tree_pins_compiled_transitive_bytecode_and_added_files() {
        let root = std::env::temp_dir().join(format!("scientific-tree-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("Lib/site-packages/transitive/.libs")).unwrap();
        for (name, data) in [
            ("python312.dll", "runtime"),
            ("Lib/site-packages/transitive/core.pyd", "compiled"),
            (
                "Lib/site-packages/transitive/.libs/dependency.dll",
                "linked",
            ),
            ("Lib/site-packages/transitive/cache.pyc", "bytecode"),
        ] {
            std::fs::write(root.join(name), data).unwrap();
        }
        let initial = tree(&root).unwrap();
        assert_eq!(initial["file_count"], 4);
        assert_eq!(
            initial["sha256"],
            "d3bf01aac1a0b6d95a5b88a0f5fdf89a090e0b52afff56fe8c7d3bf70f8b4d65"
        );
        for name in [
            "python312.dll",
            "Lib/site-packages/transitive/core.pyd",
            "Lib/site-packages/transitive/.libs/dependency.dll",
            "Lib/site-packages/transitive/cache.pyc",
        ] {
            let path = root.join(name);
            let original = std::fs::read(&path).unwrap();
            std::fs::write(&path, b"modified").unwrap();
            assert_ne!(tree(&root).unwrap(), initial);
            std::fs::write(&path, original).unwrap();
        }
        std::fs::write(root.join("injected.pth"), b"import unsafe").unwrap();
        assert_ne!(tree(&root).unwrap(), initial);
        std::fs::remove_file(root.join("injected.pth")).unwrap();
        std::fs::remove_file(root.join("python312.dll")).unwrap();
        assert_ne!(tree(&root).unwrap(), initial);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_links_and_file_roots() {
        let root = std::env::temp_dir().join(format!("scientific-link-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("file"), "x").unwrap();
        assert!(tree(&root.join("file")).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("file"), root.join("linked")).unwrap();
            assert!(tree(&root).is_err());
        }
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(root.join("linked"))
                .arg(&root)
                .output()
                .unwrap();
            assert!(
                status.status.success(),
                "{}",
                String::from_utf8_lossy(&status.stderr)
            );
            assert!(tree(&root).is_err());
            std::fs::remove_dir(root.join("linked")).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
