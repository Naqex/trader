use super::python_json;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
mod dependencies;

fn file_hash(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| "research adapter source unavailable")?;
    let mut digest = Sha256::new();
    let mut bytes = [0; 65536];
    loop {
        let n = file
            .read(&mut bytes)
            .map_err(|_| "research adapter source unavailable")?;
        if n == 0 {
            break;
        }
        digest.update(&bytes[..n]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub fn foundation_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}
pub fn engine_code_hash(root: &Path) -> Result<String, String> {
    let package = root.join("trading_workspace_v2");
    let mut sources = BTreeMap::new();
    for entry in std::fs::read_dir(&package).map_err(|_| "research engine sources unavailable")? {
        let entry = entry.map_err(|_| "research engine sources unavailable")?;
        let path = entry.path();
        if path.extension().is_some_and(|s| s == "py") {
            sources.insert(
                format!("foundation/{}", entry.file_name().to_string_lossy()),
                file_hash(&path)?,
            );
        }
    }
    sources.insert(
        "foundation/uv.lock".into(),
        file_hash(&root.join("uv.lock"))?,
    );
    for name in [
        "adapter.py",
        "limits.py",
        "run.py",
        "pyproject.toml",
        "uv.lock",
    ] {
        let path = root.join("engine_runtime").join(name);
        if path.is_file() {
            sources.insert(format!("engine_runtime/{name}"), file_hash(&path)?);
        }
    }
    for module in ["data_contracts", "data_costs", "evidence_metrics"] {
        sources.insert(
            format!("retained/{module}.py"),
            file_hash(&root.join("..").join(format!("{module}.py")))?,
        );
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(python_json(&json!(sources), true)?.as_bytes())
    ))
}
pub fn adapter_hash(root: &Path) -> Result<String, String> {
    let mut sources = BTreeMap::new();
    for name in [
        "adapter.py",
        "limits.py",
        "run.py",
        "pyproject.toml",
        "uv.lock",
    ] {
        sources.insert(name, file_hash(&root.join("engine_runtime").join(name))?);
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(python_json(&json!(sources), true)?.as_bytes())
    ))
}

/// Cheap admission metadata check. Full installation verification belongs to
/// startup/execution boundaries, never the API request or worker polling loop.
pub fn descriptor(root: &Path, path: &Path, engine_hash: &str) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|_| "isolated Nautilus runtime is unavailable")?;
    if bytes.len() > 1024 * 1024 {
        return Err("scientific adapter capability is invalid".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "scientific adapter capability is invalid")?;
    if value["schema"] != "research-scientific-adapter-capability-v2"
        || value["engine_code_sha256"] != engine_hash
        || value["adapter_sha256"] != adapter_hash(root)?
    {
        return Err("scientific adapter capability is stale".into());
    }
    if value["bytecode_policy"] != "pinned-isolated-cache-v1"
        || value["dependency_sha256"] != dependencies::manifest_digest(&value["dependency_trees"])?
    {
        return Err("scientific dependency manifest is invalid".into());
    }
    let declared_root = value["foundation_root"]
        .as_str()
        .ok_or("scientific adapter capability is invalid")?;
    if Path::new(declared_root).canonicalize().ok() != root.canonicalize().ok() {
        return Err("scientific adapter capability belongs to another installation".into());
    }
    let files = value["files"]
        .as_object()
        .filter(|m| !m.is_empty() && m.len() <= 32)
        .ok_or("scientific adapter capability is invalid")?;
    for (path, hash) in files {
        if file_hash(Path::new(path))?
            != hash
                .as_str()
                .ok_or("scientific adapter capability is invalid")?
        {
            return Err("scientific adapter capability is stale".into());
        }
    }
    let identity = &value["runtime_identity"];
    if identity["nautilus_trader"] != "1.231.0"
        || identity["pyarrow"].as_str().is_none()
        || identity["python"].as_str().is_none()
    {
        return Err("scientific adapter capability is invalid".into());
    }
    let runtime = root.join("engine_runtime");
    let installed_runtime = runtime
        .canonicalize()
        .map_err(|_| "isolated Nautilus runtime is unavailable")?;
    let base = Path::new(
        value["dependency_trees"]["base_python"]["path"]
            .as_str()
            .ok_or("scientific dependency manifest is invalid")?,
    );
    let declared_runtime = Path::new(
        value["dependency_trees"]["engine_runtime"]["path"]
            .as_str()
            .ok_or("scientific dependency manifest is invalid")?,
    );
    dependencies::unlinked_directory(declared_runtime)?;
    dependencies::unlinked_directory(base)?;
    if declared_runtime.canonicalize().ok() != Some(installed_runtime)
        || base.starts_with(declared_runtime)
        || declared_runtime.starts_with(base)
    {
        return Err("scientific dependency roots are invalid".into());
    }
    let config = std::fs::read_to_string(runtime.join(".venv/pyvenv.cfg"))
        .map_err(|_| "scientific interpreter configuration is unavailable")?;
    let home = config
        .lines()
        .find_map(|line| {
            let (k, v) = line.split_once('=')?;
            (k.trim() == "home").then(|| v.trim())
        })
        .ok_or("scientific base interpreter is unavailable")?;
    if Path::new(home).canonicalize().ok() != base.canonicalize().ok()
        || !config.lines().any(|l| {
            l.trim()
                .eq_ignore_ascii_case("include-system-site-packages = false")
        })
    {
        return Err("scientific base interpreter differs from pinned installation".into());
    }
    let base_executable = base.join("python.exe");
    let required = [
        runtime.join(".venv/Scripts/python.exe"),
        runtime.join("uv.lock"),
        runtime.join(".venv/pyvenv.cfg"),
        base_executable,
        runtime.join(".venv/Lib/site-packages/nautilus_trader/__init__.py"),
        runtime.join(".venv/Lib/site-packages/pyarrow/__init__.py"),
        runtime.join(".venv/Lib/site-packages/nautilus_trader-1.231.0.dist-info/METADATA"),
        runtime.join(format!(
            ".venv/Lib/site-packages/pyarrow-{}.dist-info/METADATA",
            identity["pyarrow"].as_str().unwrap()
        )),
    ];
    let pinned = files
        .keys()
        .map(|path| {
            Path::new(path)
                .canonicalize()
                .map_err(|_| "scientific adapter capability is invalid")
        })
        .collect::<Result<Vec<_>, _>>()?;
    for path in required {
        let path = path
            .canonicalize()
            .map_err(|_| "isolated Nautilus runtime is unavailable")?;
        if !pinned.contains(&path) {
            return Err("scientific adapter capability is missing runtime files".into());
        }
    }
    Ok(value)
}

/// Verify all installed runtime bytes, including native extensions and their
/// bundled DLLs, only when starting or executing the optional scientific engine.
pub fn verify_installation(root: &Path, path: &Path, engine_hash: &str) -> Result<Value, String> {
    verify_installation_checked(root, path, engine_hash, &|| Ok(()))
}

pub fn verify_installation_checked(
    root: &Path,
    path: &Path,
    engine_hash: &str,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let value = descriptor(root, path, engine_hash)?;
    for name in ["engine_runtime", "base_python"] {
        let expected = &value["dependency_trees"][name];
        let root = Path::new(expected["path"].as_str().unwrap());
        let actual = dependencies::tree_checked(root, check)?;
        for field in ["sha256", "file_count", "total_bytes"] {
            if actual[field] != expected[field] {
                return Err("scientific adapter installation is stale".into());
            }
        }
    }
    check()?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires explicit installed descriptor; offline inspection only"]
    fn installed_descriptor_verification() {
        let path = PathBuf::from(
            std::env::var("TW_SCIENTIFIC_IDENTITY_TEST_DESCRIPTOR")
                .expect("explicit installed descriptor is required"),
        );
        let root = foundation_root();
        let hash = engine_code_hash(&root).unwrap();
        let measure = || {
            let started = std::time::Instant::now();
            let value = descriptor(&root, &path, &hash).unwrap();
            let mut observations = serde_json::Map::new();
            for name in ["engine_runtime", "base_python"] {
                let expected = &value["dependency_trees"][name];
                let (actual, stats) = dependencies::tree_measured(
                    Path::new(expected["path"].as_str().unwrap()),
                    &|| Ok(()),
                )
                .unwrap();
                for field in ["sha256", "file_count", "total_bytes"] {
                    assert_eq!(actual[field], expected[field]);
                }
                observations.insert(
                    name.into(),
                    json!({
                        "read_bytes":stats.read_bytes,"cache_hits":stats.cache_hits,
                        "cache_misses":stats.cache_misses,
                        "enumeration_ms":stats.enumeration_time.as_secs_f64()*1000.0,
                        "file_verification_ms":stats.file_verification_time.as_secs_f64()*1000.0
                    }),
                );
            }
            (
                value,
                started.elapsed().as_secs_f64() * 1000.0,
                observations,
            )
        };
        let (value, first_ms, first_stats) = measure();
        let (warm, warm_ms, warm_stats) = measure();
        assert_eq!(value["dependency_sha256"], warm["dependency_sha256"]);
        let start = std::time::Instant::now();
        assert_eq!(verify_installation(&root, &path, &hash).unwrap(), value);
        let production_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = std::time::Instant::now();
        for _ in 0..10 {
            descriptor(&root, &path, &hash).unwrap();
        }
        let metadata = start.elapsed().as_secs_f64() * 100.0;
        println!(
            "{}",
            json!({"dependency_sha256":value["dependency_sha256"],"dependency_trees":value["dependency_trees"],"first_verification_ms":first_ms,"first_stats":first_stats,"warm_verification_ms":warm_ms,"warm_stats":warm_stats,"production_warm_verification_ms":production_ms,"metadata_mean_ms":metadata})
        );
    }
    #[test]
    fn descriptor_rejects_changed_missing_or_foreign_runtime() {
        let root = std::env::temp_dir().join(format!("research-adapter-{}", uuid::Uuid::new_v4()));
        let runtime = root.join("engine_runtime");
        let names = [
            "adapter.py",
            "limits.py",
            "run.py",
            "pyproject.toml",
            "uv.lock",
            ".venv/Scripts/python.exe",
            ".venv/Lib/site-packages/nautilus_trader/__init__.py",
            ".venv/Lib/site-packages/pyarrow/__init__.py",
            ".venv/Lib/site-packages/nautilus_trader-1.231.0.dist-info/METADATA",
            ".venv/Lib/site-packages/pyarrow-25.0.1.dist-info/METADATA",
            ".venv/pyvenv.cfg",
        ];
        for name in names {
            let path = runtime.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, name).unwrap();
        }
        let base = root.join("base");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("python.exe"), b"base-python.exe").unwrap();
        std::fs::write(
            runtime.join(".venv/pyvenv.cfg"),
            format!(
                "home = {}\ninclude-system-site-packages = false\n",
                base.display()
            ),
        )
        .unwrap();
        let mut files = serde_json::Map::new();
        for name in &names[4..] {
            let path = runtime.join(name).canonicalize().unwrap();
            files.insert(
                path.to_string_lossy().into_owned(),
                json!(file_hash(&path).unwrap()),
            );
        }
        let base_python = base.join("python.exe").canonicalize().unwrap();
        files.insert(
            base_python.to_string_lossy().into_owned(),
            json!(file_hash(&base_python).unwrap()),
        );
        let mut trees = json!({});
        for (name, path) in [
            ("engine_runtime", runtime.clone()),
            ("base_python", base.clone()),
        ] {
            let mut tree = dependencies::tree(&path).unwrap();
            tree["path"] = json!(path.canonicalize().unwrap().to_string_lossy());
            trees[name] = tree;
        }
        let value = json!({"schema":"research-scientific-adapter-capability-v2","engine_code_sha256":"engine",
            "adapter_sha256":adapter_hash(&root).unwrap(),"foundation_root":root.to_string_lossy(),"files":files,
            "dependency_sha256":dependencies::manifest_digest(&trees).unwrap(),"dependency_trees":trees,"bytecode_policy":"pinned-isolated-cache-v1",
            "runtime_identity":{"nautilus_trader":"1.231.0","python":"3.12.10","pyarrow":"25.0.1"}});
        let path = root.join("capability.json");
        let save =
            |value: &Value| std::fs::write(&path, serde_json::to_vec(value).unwrap()).unwrap();
        save(&value);
        assert!(descriptor(&root, &path, "engine").is_ok());
        assert!(verify_installation(&root, &path, "engine").is_ok());
        let compiled = runtime.join(".venv/Lib/site-packages/core.pyd");
        std::fs::write(&compiled, b"new compiled bytes").unwrap();
        assert!(descriptor(&root, &path, "engine").is_ok());
        assert_eq!(
            verify_installation(&root, &path, "engine").unwrap_err(),
            "scientific adapter installation is stale"
        );
        std::fs::remove_file(compiled).unwrap();
        let shadow = runtime.join("decimal.py");
        std::fs::write(&shadow, b"import shadowed").unwrap();
        assert!(descriptor(&root, &path, "engine").is_ok());
        assert_eq!(
            verify_installation(&root, &path, "engine").unwrap_err(),
            "scientific adapter installation is stale"
        );
        std::fs::remove_file(shadow).unwrap();
        std::fs::write(base.join("python.exe"), b"changed").unwrap();
        assert_eq!(
            descriptor(&root, &path, "engine").unwrap_err(),
            "scientific adapter capability is stale"
        );
        std::fs::write(base.join("python.exe"), b"base-python.exe").unwrap();
        let mut missing = value.clone();
        let key = runtime
            .join(".venv/Scripts/python.exe")
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        missing["files"].as_object_mut().unwrap().remove(&key);
        save(&missing);
        assert_eq!(
            descriptor(&root, &path, "engine").unwrap_err(),
            "scientific adapter capability is missing runtime files"
        );
        let mut foreign = value.clone();
        foreign["foundation_root"] = json!(runtime.to_string_lossy());
        save(&foreign);
        assert_eq!(
            descriptor(&root, &path, "engine").unwrap_err(),
            "scientific adapter capability belongs to another installation"
        );
        save(&value);
        assert_eq!(
            descriptor(&root, &path, "other-engine").unwrap_err(),
            "scientific adapter capability is stale"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
