"""Collect installed Rust/JS dependency notices for a Windows release candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SUPPLEMENTAL = {
    ("jsonschema-regex", "0.58.6"): "jsonschema-MIT.txt",
    ("jsonschema-value", "0.58.6"): "jsonschema-MIT.txt",
    ("uuid-simd", "0.8.0"): "simd-MIT.txt",
    ("vsimd", "0.8.0"): "simd-MIT.txt",
    ("fancy-canvas", "2.1.0"): "fancy-canvas-MIT.txt",
}


def supplemental_notice(name, version):
    filename = SUPPLEMENTAL.get((name, version))
    if not filename:
        return None
    directory = ROOT / "config/dependency-notices"
    provenance = json.loads((directory / "provenance.json").read_text(encoding="utf8"))
    entry = next(item for item in provenance if item["path"] == filename)
    source = directory / filename
    if hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
        raise ValueError(f"Supplemental notice checksum mismatch: {name}")
    return source


def collect(output):
    output = output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents or output.exists():
        raise ValueError("Use a new notices directory outside the checkout")
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--format-version", "1",
        "--manifest-path", str(ROOT / "foundation_v2/api-rust/Cargo.toml"),
        "--filter-platform", "x86_64-pc-windows-msvc",
    ], cwd=ROOT, text=True))
    inputs = []
    for package in metadata["packages"]:
        if not package.get("source"):
            continue
        inputs.append(("rust", package["name"], package["version"], package.get("license"), Path(package["manifest_path"]).parent, package.get("license_file")))
    for relative in ("foundation_v2/web", "foundation_v2/data_worker"):
        directory = ROOT / relative
        lock = json.loads((directory / "package-lock.json").read_text(encoding="utf8"))
        for location, package in lock["packages"].items():
            if not location:
                continue
            installed = directory / location
            if not installed.is_dir():
                if package.get("optional"):
                    continue
                raise ValueError(f"Dependency not installed: {location}")
            info = json.loads((installed / "package.json").read_text(encoding="utf8"))
            inputs.append(("javascript", info["name"], info["version"], info.get("license", package.get("license")), installed, None))
    output.mkdir(parents=True)
    entries = []
    missing = []
    for ecosystem, name, version, license_name, directory, explicit in inputs:
        files = [p for p in directory.iterdir() if p.is_file() and p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE", "PATENTS", "UNLICENSE"))]
        if explicit:
            candidate = (directory / explicit).resolve()
            if candidate.is_file() and directory.resolve() in candidate.parents:
                files.append(candidate)
        # Some upstream packages omit the workspace-root license from npm/crates.
        # Use the exact version's pinned upstream text, never a generic MIT template.
        supplement = supplemental_notice(name, version)
        if supplement:
            files.append(supplement)
        if name.startswith(("@esbuild/", "@rollup/")) and not files:
            parent_name = "esbuild" if name.startswith("@esbuild/") else "rollup"
            parent = directory.parents[1] / parent_name
            parent_info = json.loads((parent / "package.json").read_text(encoding="utf8"))
            if parent_info["version"] != version or parent_info.get("license") != license_name:
                raise ValueError(f"Native package notice version mismatch: {name}")
            files.extend(p for p in parent.iterdir() if p.is_file() and p.name.upper().startswith("LICENSE"))
        files = sorted(set(files))
        entry = {"ecosystem": ecosystem, "name": name, "version": version, "license": license_name, "files": []}
        target = output / ecosystem / (name.replace("/", "_") + "-" + version)
        for source in files:
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target / source.name)
            entry["files"].append({"path": (target / source.name).relative_to(output).as_posix(), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
        if not license_name or not files:
            missing.append({"ecosystem": ecosystem, "name": name, "version": version, "reason": "missing license expression or notice text"})
        entries.append(entry)
    report = {"source_commit": subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip(), "components": entries, "unresolved": missing}
    (output / "inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    if missing:
        raise ValueError(f"{len(missing)} unresolved dependency notices; inspect inventory.json before packaging")
    return {"components": len(entries), "unresolved": 0, "directory": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(collect(args.output), indent=2))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Notice inventory failed: {error}\n")
