"""Pin the installed scientific adapter once before starting the native API.

This only inspects the already installed isolated runtime. No provider, broker,
dataset or job is opened. It is not part of request dispatch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
import struct
import tomllib
import tempfile

FOUNDATION = Path(__file__).resolve().parents[1]
PROJECT = FOUNDATION.parent
sys.path[:0] = [str(FOUNDATION), str(PROJECT)]

MAX_FILES = 100_000
MAX_BYTES = 4 * 1024 * 1024 * 1024


def _regular(path, directory=False):
    stat = path.lstat()
    if path.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 0x400:
        raise ValueError('scientific dependency links are unsupported')
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError('scientific dependency type is invalid')
    return stat


def dependency_tree(root):
    """Match Rust framing; include bytecode, DLL/PYD and all transitive files."""
    root = Path(root)
    if not root.is_absolute():
        raise ValueError('scientific dependency path must be absolute')
    for ancestor in (root, *root.parents):
        _regular(ancestor, True)
    files = []
    folders = [root]
    directories = 0
    while folders:
        folder = folders.pop()
        _regular(folder, True)
        directories += 1
        for path in folder.iterdir():
            if path.is_dir():
                _regular(path, True)
                folders.append(path)
            else:
                _regular(path)
                files.append(path)
            if directories + len(folders) + len(files) > MAX_FILES:
                raise ValueError('scientific dependency file budget exceeded')
    digest = hashlib.sha256()
    total = 0
    for path in sorted(files, key=lambda p: p.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        name = relative.encode('utf-8')
        if len(name) > 4096:
            raise ValueError('scientific dependency path budget exceeded')
        _regular(path)
        content = hashlib.sha256()
        size = 0
        with path.open('rb') as source:
            before = os.fstat(source.fileno())
            for chunk in iter(lambda: source.read(65536), b''):
                size += len(chunk)
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('scientific dependency byte budget exceeded')
                content.update(chunk)
            after = os.fstat(source.fileno())
        if before.st_size != size or after.st_size != size or before.st_mtime_ns != after.st_mtime_ns:
            raise ValueError('scientific dependency changed during verification')
        digest.update(struct.pack('<Q', len(name)))
        digest.update(name)
        digest.update(content.digest())
    return dict(sha256=digest.hexdigest(), file_count=len(files), total_bytes=total)


def dependency_digest(trees):
    return hashlib.sha256((json.dumps(trees, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()


def validate_import_paths(paths, runtime, base):
    roots = [Path(runtime).resolve(strict=True), Path(base).resolve(strict=True)]
    if not paths or any(not path for path in paths):
        raise ValueError('scientific import path is outside pinned installation')
    for path in paths:
        candidate = Path(path).resolve(strict=False)
        if not any(candidate.is_relative_to(root) for root in roots):
            raise ValueError('scientific import path is outside pinned installation')
        for ancestor in (Path(path), *Path(path).parents):
            if ancestor.exists():
                _regular(ancestor, True if ancestor.is_dir() else False)


def inspect_adapter():
    from trading_workspace_v2.nautilus_worker import RUNTIME, adapter_hash
    from trading_workspace_v2.research_engine import engine_code_sha256

    with tempfile.TemporaryDirectory(prefix='scientific-probe-') as scratch:
        probe = subprocess.run([str(RUNTIME / ".venv/Scripts/python.exe"), "-I", "-B", "-X", f'pycache_prefix={scratch}/pycache', "-c",
                                "import json,sys,platform,nautilus_trader,pyarrow;print(json.dumps({'executable':sys.executable,'base_executable':sys._base_executable,'base_prefix':sys.base_prefix,'sys_path':sys.path,'nautilus_file':nautilus_trader.__file__,'pyarrow_file':pyarrow.__file__,'runtime_identity':{'python':platform.python_version(),'pyarrow':pyarrow.__version__,'nautilus_trader':nautilus_trader.__version__}}))"],
                               check=True, capture_output=True, text=True, timeout=15,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    paths = json.loads(probe.stdout)
    validate_import_paths(paths['sys_path'], RUNTIME, paths['base_prefix'])
    identity = paths['runtime_identity']
    versions = {item['name']: item.get('version') for item in tomllib.loads((RUNTIME/'uv.lock').read_text(encoding='utf-8')).get('package', [])}
    if identity.get('nautilus_trader') != versions.get('nautilus-trader') or identity.get('pyarrow') != versions.get('pyarrow'):
        raise ValueError('isolated Nautilus runtime differs from uv.lock')
    if identity.get('nautilus_trader') != '1.231.0':
        raise ValueError('isolated Nautilus runtime version differs from pinned installation')
    files = {}
    for path in [Path(paths["executable"]), Path(paths["base_executable"]),
                 Path(paths["nautilus_file"]), Path(paths["pyarrow_file"]), RUNTIME / "uv.lock", RUNTIME / '.venv/pyvenv.cfg',
                 *RUNTIME.joinpath(".venv/Lib/site-packages").glob("nautilus_trader-*.dist-info/METADATA"),
                 *RUNTIME.joinpath(".venv/Lib/site-packages").glob("pyarrow-*.dist-info/METADATA")]:
        for parent in path.absolute().parents:
            _regular(parent, True)
        _regular(path)
        resolved = path.resolve(strict=True)
        files[str(resolved)] = hashlib.sha256(resolved.read_bytes()).hexdigest()
    trees = {}
    for name, root in [('engine_runtime', RUNTIME), ('base_python', Path(paths['base_prefix']))]:
        root = root.absolute()
        trees[name] = dict(path=str(root.resolve(strict=True)), **dependency_tree(root))
    if Path(paths['base_executable']).resolve().parent != Path(trees['base_python']['path']):
        raise ValueError('scientific base interpreter differs from pinned installation')
    return {"schema": "research-scientific-adapter-capability-v2", "runtime_identity": identity,
            "adapter_sha256": adapter_hash(), "engine_code_sha256": engine_code_sha256(),
            "foundation_root": str(FOUNDATION.resolve()), "files": files,
            "dependency_trees": trees, "dependency_sha256": dependency_digest(trees),
            "bytecode_policy": 'pinned-isolated-cache-v1'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    descriptor = inspect_adapter()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f".{args.output.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(descriptor, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps({"schema": descriptor["schema"], "runtime_identity": descriptor["runtime_identity"], "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
