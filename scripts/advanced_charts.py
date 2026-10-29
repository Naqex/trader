"""Verify, install or fetch the supported separately licensed chart dependency."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "23.040"
LOADER = "charting_library.standalone.js"
LOADER_SHA256 = "7d817040632e32ef0f4000af8698051367cc5e7f0e29fa26bbc24f33b7eb36a9"
UPSTREAM = "tradingview/charting_library"
INVENTORY = ROOT / "config" / "advanced-charts-23.040.json"


def verify(directory):
    directory = directory.resolve()
    if not (directory / LOADER).is_file() or not (directory / "bundles").is_dir():
        raise ValueError("Expected intact charting_library directory with loader and bundles")
    if hashlib.sha256((directory / LOADER).read_bytes()).hexdigest() != LOADER_SHA256:
        raise ValueError("Unsupported loader hash; the tested 23.040 distribution is required")
    if any(path.is_symlink() for path in directory.rglob("*")):
        raise ValueError("Vendor installation must not contain symlinks")
    inventory = json.loads(INVENTORY.read_text(encoding="utf8"))
    for entry in inventory["files"]:
        source = (directory / entry["path"]).resolve()
        if directory not in source.parents or not source.is_file():
            raise ValueError(f"Missing or unsafe vendor asset: {entry['path']}")
        if hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Vendor asset checksum mismatch: {entry['path']}")
    return {"version": VERSION, "loader_sha256": LOADER_SHA256, "verified_files": len(inventory["files"]), "passed": True}


def extract(archive, directory):
    with zipfile.ZipFile(archive) as source:
        for info in source.infolist():
            parts = PurePosixPath(info.filename.replace("\\", "/"))
            target = (directory / info.filename).resolve()
            mode = info.external_attr >> 16
            if parts.is_absolute() or ".." in parts.parts or directory not in target.parents or (mode & 0o170000) == 0o120000:
                raise ValueError("Unsafe archive path or symlink")
        source.extractall(directory)
    choices = [p.parent for p in directory.rglob(LOADER)]
    if len(choices) != 1:
        raise ValueError("Archive must contain exactly one charting_library distribution")
    return choices[0]


def install(directory, upstream_commit=None):
    result = verify(directory)
    target = ROOT / ".runtime" / "vendors" / "advanced-charts" / VERSION
    if target.exists():
        raise ValueError("Installation already exists; verify it or choose a separately configured location")
    target.parent.mkdir(parents=True, exist_ok=True)
    # Copy to a temporary sibling, then rename only a verified complete copy.
    with tempfile.TemporaryDirectory(prefix=".install-", dir=target.parent) as temporary:
        copied = Path(temporary) / "distribution"
        shutil.copytree(directory, copied)
        verify(copied)
        copied.rename(target)
    record = target.parent / f"{VERSION}.json"
    record.write_text(json.dumps({**result, "upstream": UPSTREAM, "upstream_commit": upstream_commit}, indent=2) + "\n", encoding="utf8")
    return {**result, "directory": str(target)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("verify", "install"):
        commands.add_parser(name).add_argument("--source", required=True, type=Path)
    commands.add_parser("fetch").add_argument("--commit", required=True)
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix="naqex-charts-") as temporary:
            temporary = Path(temporary).resolve()
            if args.command == "fetch":
                if not re.fullmatch(r"[0-9a-fA-F]{40}", args.commit):
                    raise ValueError("Fetch requires an exact 40-character official commit SHA")
                archive = temporary / "official.zip"
                with archive.open("wb") as output:
                    subprocess.run(["gh", "api", f"repos/{UPSTREAM}/zipball/{args.commit}"], stdout=output, check=True)
                result = install(extract(archive, temporary / "extracted"), args.commit)
            else:
                source = args.source.expanduser().resolve()
                unpacked = extract(source, temporary / "extracted") if source.is_file() else source
                result = verify(unpacked) if args.command == "verify" else install(unpacked)
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Chart setup failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
