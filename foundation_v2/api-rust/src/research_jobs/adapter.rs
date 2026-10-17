use super::python_json;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

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

/// The scientific adapter is probed by its installed interpreter at bootstrap.
/// Admission validates its pinned files and sources; it never launches Python.
pub fn descriptor(root: &Path, path: &Path, engine_hash: &str) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|_| "isolated Nautilus runtime is unavailable")?;
    if bytes.len() > 1024 * 1024 {
        return Err("scientific adapter capability is invalid".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "scientific adapter capability is invalid")?;
    if value["schema"] != "research-scientific-adapter-capability-v1"
        || value["engine_code_sha256"] != engine_hash
        || value["adapter_sha256"] != adapter_hash(root)?
    {
        return Err("scientific adapter capability is stale".into());
    }
    let declared_root = value["foundation_root"]
        .as_str()
        .ok_or("scientific adapter capability is invalid")?;
    if Path::new(declared_root).canonicalize().ok() != root.canonicalize().ok() {
        return Err("scientific adapter capability belongs to another installation".into());
    }
    let files = value["files"]
        .as_object()
        .filter(|m| m.len() >= 6 && m.len() <= 32)
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
    let required = [
        runtime.join(".venv/Scripts/python.exe"),
        runtime.join("uv.lock"),
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

#[cfg(test)]
mod tests {
    use super::*;
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
            "base-python.exe",
        ];
        for name in names {
            let path = runtime.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, name).unwrap();
        }
        let mut files = serde_json::Map::new();
        for name in &names[4..] {
            let path = runtime.join(name).canonicalize().unwrap();
            files.insert(
                path.to_string_lossy().into_owned(),
                json!(file_hash(&path).unwrap()),
            );
        }
        let value = json!({"schema":"research-scientific-adapter-capability-v1","engine_code_sha256":"engine",
            "adapter_sha256":adapter_hash(&root).unwrap(),"foundation_root":root.to_string_lossy(),"files":files,
            "runtime_identity":{"nautilus_trader":"1.231.0","python":"3.12.10","pyarrow":"25.0.1"}});
        let path = root.join("capability.json");
        let save =
            |value: &Value| std::fs::write(&path, serde_json::to_vec(value).unwrap()).unwrap();
        save(&value);
        assert!(descriptor(&root, &path, "engine").is_ok());
        std::fs::write(runtime.join("base-python.exe"), b"changed").unwrap();
        assert_eq!(
            descriptor(&root, &path, "engine").unwrap_err(),
            "scientific adapter capability is stale"
        );
        std::fs::write(runtime.join("base-python.exe"), b"base-python.exe").unwrap();
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
