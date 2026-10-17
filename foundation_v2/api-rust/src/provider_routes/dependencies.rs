//! Pins the installed dependency bytes as well as the Node entry point/lockfile.
use sha2::{Digest, Sha256};
use std::{io::Read, path::{Path, PathBuf}};

fn regular(path: &Path, directory: bool) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_|"provider_dependencies_missing")?;
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err("provider_dependency_links_unsupported".into()); }
    }
    if meta.file_type().is_symlink() || if directory { !meta.is_dir() } else { !meta.is_file() } {
        return Err("provider_dependency_type_invalid".into());
    }
    Ok(())
}

pub fn digest(root: &Path) -> Result<String, String> {
    regular(root, true)?;
    let mut files = vec![root.join("package.json"), root.join("package-lock.json")];
    let mut folders = vec![root.join("node_modules")];
    let mut directories = 0;
    while let Some(folder) = folders.pop() {
        regular(&folder, true)?;
        directories += 1;
        if directories > 8192 { return Err("provider_dependency_file_budget_exceeded".into()); }
        for entry in std::fs::read_dir(folder).map_err(|_|"provider_dependencies_missing")? {
            let path = entry.map_err(|_|"provider_dependencies_missing")?.path();
            let meta = std::fs::symlink_metadata(&path).map_err(|_|"provider_dependencies_missing")?;
            regular(&path, meta.is_dir())?;
            if meta.is_dir() { folders.push(path); } else { files.push(path); }
            if files.len() + folders.len() > 8192 { return Err("provider_dependency_file_budget_exceeded".into()); }
        }
    }
    let relative = |p: &PathBuf| p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
    files.sort_by_key(&relative);
    let mut total = 0u64;
    let mut digest = Sha256::new();
    for file in files {
        regular(&file, false)?;
        let mut handle = std::fs::File::open(&file).map_err(|_|"provider_dependencies_missing")?;
        let mut hash = Sha256::new();
        let mut block = [0u8; 65536];
        loop {
            let n = handle.read(&mut block).map_err(|_|"provider_dependencies_missing")?;
            if n == 0 { break; }
            total += n as u64;
            if total > 64 * 1024 * 1024 { return Err("provider_dependency_byte_budget_exceeded".into()); }
            hash.update(&block[..n]);
        }
        let name = relative(&file);
        digest.update((name.len() as u64).to_le_bytes());
        digest.update(name.as_bytes());
        digest.update(hash.finalize());
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_tree_identity_covers_changed_added_and_missing_files() {
        let root = std::env::temp_dir().join(format!("provider-pins-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("node_modules/dependency")).unwrap();
        for (name, bytes) in [("package.json", "{}"), ("package-lock.json", "{}"), ("node_modules/dependency/index.js", "export default 1")] {
            std::fs::write(root.join(name),bytes).unwrap();
        }
        let initial = digest(&root).unwrap();
        assert_eq!(initial, "bc70f98a3f7023e27f8fce088355acfc848c365fe5b7cbab1f0778011b187445");
        std::fs::write(root.join("node_modules/dependency/index.js"),"export default 2").unwrap();
        assert_ne!(initial,digest(&root).unwrap());
        std::fs::write(root.join("node_modules/dependency/index.js"),"export default 1").unwrap();
        std::fs::write(root.join("node_modules/extra.js"),"extra").unwrap();
        assert_ne!(initial,digest(&root).unwrap());
        std::fs::remove_file(root.join("package-lock.json")).unwrap();
        assert!(digest(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
