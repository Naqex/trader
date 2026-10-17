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

FOUNDATION = Path(__file__).resolve().parents[1]
PROJECT = FOUNDATION.parent
sys.path[:0] = [str(FOUNDATION), str(PROJECT)]


def inspect_adapter():
    from trading_workspace_v2.nautilus_worker import RUNTIME, adapter_hash, runtime_identity
    from trading_workspace_v2.research_engine import engine_code_sha256

    identity = runtime_identity()
    probe = subprocess.run([str(RUNTIME / ".venv/Scripts/python.exe"), "-I", "-c",
                            "import json,sys,nautilus_trader,pyarrow;print(json.dumps({'executable':sys.executable,'base_executable':sys._base_executable,'nautilus_file':nautilus_trader.__file__,'pyarrow_file':pyarrow.__file__}))"],
                           check=True, capture_output=True, text=True, timeout=15,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    paths = json.loads(probe.stdout)
    files = {}
    for path in [Path(paths["executable"]), Path(paths["base_executable"]),
                 Path(paths["nautilus_file"]), Path(paths["pyarrow_file"]), RUNTIME / "uv.lock",
                 *RUNTIME.joinpath(".venv/Lib/site-packages").glob("nautilus_trader-*.dist-info/METADATA"),
                 *RUNTIME.joinpath(".venv/Lib/site-packages").glob("pyarrow-*.dist-info/METADATA")]:
        resolved = path.resolve(strict=True)
        files[str(resolved)] = hashlib.sha256(resolved.read_bytes()).hexdigest()
    return {"schema": "research-scientific-adapter-capability-v1", "runtime_identity": identity,
            "adapter_sha256": adapter_hash(), "engine_code_sha256": engine_code_sha256(),
            "foundation_root": str(FOUNDATION.resolve()), "files": files}


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
