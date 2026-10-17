//! Frozen PyArrow byte serialization exception for pre-Rust immutable artifacts.
//! Called only by explicit admin repair after the native candidate hash differs.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn hash(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|_| "legacy_codec_unavailable")?;
    let mut sha = Sha256::new();
    let mut b = [0; 65536];
    loop {
        let n = f.read(&mut b).map_err(|_| "legacy_codec_unavailable")?;
        if n == 0 {
            break;
        }
        sha.update(&b[..n]);
    }
    Ok(format!("{:x}", sha.finalize()))
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}
fn executable(descriptor: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(descriptor).map_err(|_| "legacy_codec_unavailable")?;
    if metadata.len() > 1024 * 1024 {
        return Err("legacy_codec_identity_invalid".into());
    }
    let v: Value =
        serde_json::from_slice(&fs::read(descriptor).map_err(|_| "legacy_codec_unavailable")?)
            .map_err(|_| "legacy_codec_identity_invalid")?;
    if v["schema"] != "legacy-pyarrow-codec-capability-v1"
        || v["pyarrow_version"] != "21.0.0"
        || v["foundation_root"]
            .as_str()
            .and_then(|p| Path::new(p).canonicalize().ok())
            != root().canonicalize().ok()
    {
        return Err("legacy_codec_identity_invalid".into());
    }
    let files = v["files"]
        .as_object()
        .filter(|f| f.len() >= 8 && f.len() <= 1000)
        .ok_or("legacy_codec_identity_invalid")?;
    let exe = PathBuf::from(
        v["executable"]
            .as_str()
            .ok_or("legacy_codec_identity_invalid")?,
    );
    for path in [
        &exe,
        &root().join("scripts/rust_legacy_parquet_codec.py"),
        &root().join("engine_runtime/limits.py"),
    ] {
        let resolved = path
            .canonicalize()
            .map_err(|_| "legacy_codec_unavailable")?;
        let declared = files
            .iter()
            .find(|(p, _)| Path::new(p).canonicalize().ok() == Some(resolved.clone()))
            .ok_or("legacy_codec_identity_invalid")?;
        if hash(path)? != declared.1.as_str().ok_or("legacy_codec_identity_invalid")? {
            return Err("legacy_codec_identity_stale".into());
        }
    }
    if hash(&root().join("scripts/rust_legacy_parquet_codec.py"))?
        != format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../../scripts/rust_legacy_parquet_codec.py"
            ))
        )
        || hash(&root().join("engine_runtime/limits.py"))?
            != format!(
                "{:x}",
                Sha256::digest(include_bytes!("../../../engine_runtime/limits.py"))
            )
    {
        return Err("legacy_codec_binary_stale".into());
    }
    for (path, expected) in files {
        if hash(Path::new(path))? != expected.as_str().ok_or("legacy_codec_identity_invalid")? {
            return Err("legacy_codec_identity_stale".into());
        }
    }
    Ok(exe)
}
pub(super) fn restore(staging: &Path, candidate: &Path, raw: &Path) -> Result<(), String> {
    let descriptor = std::env::var_os("TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY")
        .map(PathBuf::from)
        .ok_or("legacy_codec_unavailable")?;
    let exe = executable(&descriptor)?;
    let input = staging.join("legacy-codec-rows.json");
    let written = (|| {
        super::ingest::stream_parquet_rows(raw, &input)?;
        if candidate.exists() {
            fs::remove_file(candidate).map_err(|_| "legacy_codec_output_invalid")?;
        }
        fs::create_dir_all(candidate.parent().ok_or("legacy_codec_output_invalid")?)
            .map_err(|_| "legacy_codec_output_invalid")?;
        let mut command = Command::new(exe);
        command
            .args(["-I"])
            .arg(root().join("scripts/rust_legacy_parquet_codec.py"))
            .arg("--input")
            .arg(&input)
            .arg("--output")
            .arg(candidate)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "legacy_codec_unavailable")?;
        wait(&mut child, Duration::from_secs(60))
    })();
    let _ = fs::remove_file(input);
    written
}
fn wait(child: &mut std::process::Child, timeout: Duration) -> Result<(), String> {
    let result = (|| {
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|_| "legacy_codec_failed")? {
                return if status.success() {
                    Ok(())
                } else {
                    Err("legacy_codec_failed".into())
                };
            }
            if start.elapsed() > timeout {
                return Err("legacy_codec_timeout".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptor_tamper_fails_closed() {
        let path = std::env::temp_dir().join(format!("legacy-codec-{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, b"{\"schema\":\"wrong\"}").unwrap();
        assert!(executable(&path).is_err());
        let _ = fs::remove_file(path);
    }
    #[test]
    #[ignore = "explicit installed codec capability only"]
    fn pinned_identity_and_timeout() {
        let descriptor =
            PathBuf::from(std::env::var_os("TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY").unwrap());
        let exe = executable(&descriptor).unwrap();
        let mut v: Value = serde_json::from_slice(&fs::read(&descriptor).unwrap()).unwrap();
        let key = v["files"]
            .as_object()
            .unwrap()
            .keys()
            .next()
            .unwrap()
            .clone();
        v["files"][key] = Value::String("0".repeat(64));
        let tampered =
            std::env::temp_dir().join(format!("legacy-codec-{}.json", uuid::Uuid::new_v4()));
        fs::write(&tampered, serde_json::to_vec(&v).unwrap()).unwrap();
        assert!(executable(&tampered).is_err());
        let _ = fs::remove_file(tampered);
        let mut command = Command::new(exe);
        command
            .args(["-I", "-c", "import time;time.sleep(20)"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let started = Instant::now();
        assert_eq!(
            wait(&mut child, Duration::from_millis(20)).unwrap_err(),
            "legacy_codec_timeout"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(child.try_wait().unwrap().is_some());
    }
}
