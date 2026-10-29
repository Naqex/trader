"""Version and package Naqex Trader without publishing or touching a runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = (
    "foundation_v2/pyproject.toml", "foundation_v2/engine_runtime/pyproject.toml",
    "foundation_v2/api-rust/Cargo.toml", "foundation_v2/web/package.json",
    "foundation_v2/data_worker/package.json",
)
SEMVER = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?")
COMPILE_FIXTURES = {
    "foundation_v2/evidence/rust-native-20261017/oauth/python-oracle.json",
    "foundation_v2/evidence/rust-native-20261017/prop/fixtures.json",
    "foundation_v2/evidence/rust-native-20261017/prop/decimal-scale-fixtures.json",
    "foundation_v2/evidence/rust-native-20261017/replay-core/oracle.json",
}


def version_value(value):
    if not SEMVER.fullmatch(value):
        raise ValueError("Use x.y.z or x.y.z-alpha.N / beta.N / rc.N (no leading zeros)")
    return value


def python_version(value):
    return re.sub(r"-(alpha|beta|rc)\.(\d+)$", lambda m: {"alpha": "a", "beta": "b", "rc": "rc"}[m[1]] + m[2], value)


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def manifest(path):
    return json.loads(path.read_text(encoding="utf8")) if path.suffix == ".json" else tomllib.loads(path.read_text(encoding="utf8"))


def section(path, value):
    return value if path.suffix == ".json" else value["package" if path.name == "Cargo.toml" else "project"]


def prepare(version):
    version_value(version)
    # Plan every output first: a missing later lock must not leave a partial bump.
    outputs = {}
    for relative in MANIFESTS:
        path = ROOT / relative
        value = manifest(path)
        target = python_version(version) if path.name == "pyproject.toml" else version
        own = section(path, value)
        if path.suffix == ".json":
            value["version"] = target
            outputs[path] = json.dumps(value, indent=2) + "\n"
            lock = path.with_name("package-lock.json")
            locked = manifest(lock)
            locked["name"] = value["name"]
            locked["version"] = target
            locked["packages"][""]["name"] = value["name"]
            locked["packages"][""]["version"] = target
            locked["packages"][""]["license"] = value["license"]
            outputs[lock] = json.dumps(locked, indent=2) + "\n"
        else:
            text = path.read_text(encoding="utf8")
            text, count = re.subn(r'^version = "[^"]+"', f'version = "{target}"', text, count=1, flags=re.M)
            if count != 1:
                raise ValueError(f"Missing own version: {path.relative_to(ROOT)}")
            outputs[path] = text
            lock = path.with_name("Cargo.lock" if path.name == "Cargo.toml" else "uv.lock")
            text = lock.read_text(encoding="utf8")
            pattern = r'(\[\[package\]\]\nname = "' + re.escape(own["name"]) + r'"\nversion = ")[^"]+(")'
            text, count = re.subn(pattern, lambda m: m[1] + target + m[2], text, count=1)
            if count != 1:
                raise ValueError(f"Missing internal package in {lock.relative_to(ROOT)}")
            outputs[lock] = text
    outputs[ROOT / "VERSION"] = version + "\n"
    originals = {path: path.read_bytes() for path in outputs}
    try:
        for path, text in outputs.items():
            path.write_text(text, encoding="utf8")
        return check()
    except (OSError, ValueError):
        for path, original in originals.items():
            path.write_bytes(original)
        raise


def check():
    version = version_value((ROOT / "VERSION").read_text(encoding="utf8").strip())
    failures = []
    for relative in MANIFESTS:
        path = ROOT / relative
        value = section(path, manifest(path))
        expected = python_version(version) if path.name == "pyproject.toml" else version
        if value["version"] != expected:
            failures.append(f"Version mismatch: {relative}")
        lock = path.with_name("package-lock.json" if path.suffix == ".json" else "Cargo.lock" if path.name == "Cargo.toml" else "uv.lock")
        if path.suffix == ".json":
            locked = manifest(lock)
            if locked["version"] != expected or locked["packages"][""]["version"] != expected or locked["name"] != value["name"]:
                failures.append(f"Lock mismatch: {lock.relative_to(ROOT)}")
            if locked["packages"][""].get("license") != value.get("license"):
                failures.append(f"License mismatch: {lock.relative_to(ROOT)}")
        elif lock.exists():
            matches = [p for p in manifest(lock)["package"] if p["name"] == value["name"]]
            if len(matches) != 1 or matches[0]["version"] != expected:
                failures.append(f"Lock mismatch: {lock.relative_to(ROOT)}")
        else:
            failures.append(f"Missing lock: {lock.relative_to(ROOT)}")
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", "docs/releases.md", "docs/advanced-charts.md"):
        if not (ROOT / name).is_file():
            failures.append(f"Missing release document: {name}")
    if failures:
        raise ValueError("; ".join(failures))
    return {"version": version, "manifest_count": len(MANIFESTS), "passed": True}


def included(relative):
    parts = Path(relative).parts
    if any(p in {".git", ".runtime", ".venv", "node_modules", "target", "dist", "charting_library", "__pycache__", ".artifacts"} for p in parts):
        return False
    if relative.startswith(("foundation_v2/evidence/", "foundation_v2/experiments/")) and relative not in COMPILE_FIXTURES:
        return False
    if Path(relative).suffix.lower() in {".ini", ".ex5", ".ex4", ".db", ".sqlite", ".sqlite3", ".log", ".bak"}:
        return False
    if Path(relative).name.startswith(".env") and Path(relative).name != ".env.example":
        return False
    return True


def package(output, binary_dir=None, web_dist=None, notices_dir=None):
    checked = check()
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Package requires committed tracked source; commit reviewed changes first")
    output = output.expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("Package output must be outside the checkout")
    if bool(binary_dir) != bool(web_dist):
        raise ValueError("Windows candidate requires both --binary-dir and --web-dist")
    sources = []
    for relative in git("ls-files").splitlines():
        if not included(relative):
            continue
        source = (ROOT / relative).resolve()
        if ROOT not in source.parents:
            raise ValueError("Tracked path escapes checkout")
        if source.is_file():
            sources.append((source, relative))
    kind = "windows-x64" if binary_dir else "source"
    if binary_dir:
        if not notices_dir:
            raise ValueError("Windows candidate requires --notices-dir from dependency_notices.py")
        notices_dir = notices_dir.resolve()
        notices = json.loads((notices_dir / "inventory.json").read_text(encoding="utf8"))
        if notices.get("unresolved") or not notices.get("components") or notices.get("source_commit") != git("rev-parse", "HEAD"):
            raise ValueError("Dependency notice inventory is incomplete or from another source commit")
        for component in notices["components"]:
            for entry in component.get("files", []):
                source = (notices_dir / entry["path"]).resolve()
                if notices_dir not in source.parents or hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
                    raise ValueError("Dependency notice file checksum mismatch")
        for source in sorted(notices_dir.rglob("*")):
            if source.is_symlink():
                raise ValueError("Notices must not contain symlinks")
            if source.is_file():
                sources.append((source, "third-party/" + source.relative_to(notices_dir).as_posix()))
        binary_dir = binary_dir.resolve()
        web_dist = web_dist.resolve()
        for name in ("trading-workspace-api.exe", "rust_runtime_admin.exe", "rust_research_worker.exe"):
            source = binary_dir / name
            if not source.is_file():
                raise ValueError(f"Missing release-built binary: {name}")
            sources.append((source, "bin/" + name))
        if not (web_dist / "index.html").is_file():
            raise ValueError("Missing built web index")
        for source in sorted(web_dist.rglob("*")):
            if source.is_symlink():
                raise ValueError("Candidate web assets must not contain symlinks")
            if source.is_file():
                relative = source.relative_to(web_dist).as_posix()
                if not included(relative) or source.suffix == ".map":
                    raise ValueError(f"Unexpected private/generated web asset: {relative}")
                sources.append((source, "web/" + relative))
    output.mkdir(parents=True, exist_ok=True)
    name = f"naqex-trader-{checked['version']}-{kind}.zip"
    destination = output / name
    if destination.exists():
        raise ValueError("Candidate already exists; use a new output directory")
    inventory = []
    with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED) as archive:
        for source, relative in sources:
            content = source.read_bytes()
            archive.writestr(relative, content)
            inventory.append({"path": relative, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        archive.writestr("PACKAGE.json", json.dumps({"product": "Naqex Trader", "version": checked["version"], "source_commit": git("rev-parse", "HEAD"), "kind": kind, "files": inventory}, indent=2))
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    (output / "SHA256SUMS").write_text(f"{digest}  {name}\n", encoding="utf8")
    return {"path": str(destination), "sha256": digest, "files": len(inventory), "kind": kind}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check")
    version_parser = commands.add_parser("prepare")
    version_parser.add_argument("version", type=version_value)
    pack = commands.add_parser("package")
    pack.add_argument("--output", required=True, type=Path)
    pack.add_argument("--binary-dir", type=Path)
    pack.add_argument("--web-dist", type=Path)
    pack.add_argument("--notices-dir", type=Path)
    args = parser.parse_args()
    try:
        result = check() if args.command == "check" else prepare(args.version) if args.command == "prepare" else package(args.output, args.binary_dir, args.web_dist, args.notices_dir)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Release check failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
