"""Supervise explicit loopback compatibility or native-candidate runtime profiles."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from uuid import uuid4

FOUNDATION = Path(__file__).resolve().parents[1]
PROJECT = FOUNDATION.parent
sys.path.insert(0, str(FOUNDATION))


class PreflightError(RuntimeError):
    pass


def configuration(args):
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    config = conninfo_to_dict(os.environ.get("TW_V2_DATABASE_URL", ""))
    if config.get("host") not in {"127.0.0.1", "localhost", "::1"} or (config.get("hostaddr") is not None and config["hostaddr"] not in {"127.0.0.1", "::1"}):
        raise PreflightError("TW_V2_DATABASE_URL must identify the existing loopback database.")
    config["dbname"] = args.database_name
    env = dict(os.environ)
    env.update(TW_V2_DATABASE_URL=make_conninfo(**config),
               TW_V2_ARTIFACT_ROOT=str(args.artifact_root.resolve()),
               TW_V2_LOCAL_WORKSPACES="tenant-a", TW_V2_LOCAL_IDENTITY="local-owner",
               TW_V2_AUTH_MODE="local-trusted-identity", TW_V2_RUST_BIND=f"127.0.0.1:{args.port}",
               TW_V2_OPENAPI_PATH=str(FOUNDATION / "contracts/openapi.json"),
               PYTHONPATH=os.pathsep.join((str(FOUNDATION), str(PROJECT))),
               TW_V2_LEARN_WORKSPACE_ID="tenant-a",
               TW_V2_EDUCATION_ROOT=str(PROJECT.parents[1] / "education"))
    env["TW_V2_RUNTIME_PROFILE"] = args.runtime_profile
    if args.runtime_profile == "native":
        env["TW_V2_DOWNLOAD_ENGINE"] = args.download_engine
        if args.scientific_capability:
            env["TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY"] = str(args.scientific_capability.resolve())
        if args.legacy_codec_capability:
            env["TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY"] = str(args.legacy_codec_capability.resolve())
        if args.download_engine == "qdm":
            env["TW_V2_QDM_HOME"] = str(args.qdm_home.resolve())
    return env


def resolve_profile_paths(args):
    profile_root = FOUNDATION / "api-rust/target"
    if args.runtime_profile == "native":
        profile_root /= "native-candidate"
    if args.rust_binary is None:
        args.rust_binary = profile_root / "release/trading-workspace-api.exe"
    if args.rust_admin_binary is None:
        args.rust_admin_binary = args.rust_binary.parent / "rust_runtime_admin.exe"
    if args.rust_research_binary is None:
        args.rust_research_binary = args.rust_binary.parent / "rust_research_worker.exe"
    if args.manifest is None:
        owner = "native-owner.json" if args.runtime_profile == "native" else "owner.json"
        args.manifest = FOUNDATION / ".runtime/api-platform" / owner
    return args


def active_jobs_preflight(env):
    """Startup guard only; native schema authority belongs to the Rust admin."""
    import psycopg
    with psycopg.connect(env["TW_V2_DATABASE_URL"], connect_timeout=5) as conn:
        for table in ("research_jobs", "api_commands"):
            if conn.execute("SELECT to_regclass(%s)", (f"public.{table}",)).fetchone()[0] and conn.execute(
                f"SELECT count(*) FROM {table} WHERE status IN ('queued','running')").fetchone()[0]:
                raise PreflightError("A research/API job is active. Finish or cancel it before restart/migration.")
        if conn.execute("SELECT to_regclass('public.download_job_snapshots')").fetchone()[0] and conn.execute(
            "SELECT count(*) FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')").fetchone()[0]:
            raise PreflightError("A download is active. Pause it and wait until paused before restart/migration.")


def native_database_preflight(args, env):
    if args.stop or args.require_idle or args.migrate:
        active_jobs_preflight(env)
    command = [str(args.rust_admin_binary), "migrate" if args.migrate else "check"]
    if args.migrate and args.backup_confirmed:
        command.append("--backup-confirmed")
    result = subprocess.run(command, env=env, cwd=FOUNDATION, capture_output=True,
                            text=True, timeout=60, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise PreflightError("Native schema administration failed; inspect the matching schema and backup/idle gates. No configuration values were printed.")
    try:
        summary = json.loads(result.stdout)
        if not isinstance(summary, dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise PreflightError("Native schema administration returned an invalid receipt.") from None
    if args.migrate:
        applied = summary.get("applied")
        if not isinstance(applied, list) or not all(isinstance(v, str) for v in applied):
            raise PreflightError("Native schema migration returned an invalid receipt.")
        return {"schema_current": True, "pending": [], "applied": applied}
    if not isinstance(summary.get("schema_current"), bool) or not isinstance(summary.get("pending"), list):
        raise PreflightError("Native schema check returned an invalid receipt.")
    if not summary["schema_current"] and not args.allow_pending_migrations:
        raise PreflightError("Schema migrations pending. Back up DB AND artifacts, then explicitly migrate before native startup.")
    return summary


def database_preflight(env, *, migrate=False, backup_confirmed=False, require_idle=False, allow_pending=False):
    import psycopg
    from psycopg.rows import dict_row
    from trading_workspace_v2.migrations import MIGRATION_DIRECTORY, apply_migrations

    with psycopg.connect(env["TW_V2_DATABASE_URL"], row_factory=dict_row, connect_timeout=5) as conn:
        exists = conn.execute("SELECT to_regclass('public.tw_schema_migrations') AS name").fetchone()["name"]
        tables = conn.execute("SELECT count(*) AS count FROM pg_tables WHERE schemaname='public'").fetchone()["count"]
        versions = {} if not exists else {r["version"]: r["sha256"] for r in conn.execute(
            "SELECT version,sha256 FROM tw_schema_migrations").fetchall()}
        expected = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(MIGRATION_DIRECTORY.glob("[0-9][0-9][0-9][0-9]_*.sql"))}
        if not expected or any(name not in expected or expected[name] != digest for name, digest in versions.items()):
            raise PreflightError("Database migration authority/checksum mismatch; restore the matching code before launch.")
        if require_idle or migrate:
            for table in ("research_jobs", "api_commands"):
                present = conn.execute("SELECT to_regclass(%s) AS name", (f"public.{table}",)).fetchone()["name"]
                if present and conn.execute(f"SELECT count(*) AS count FROM {table} WHERE status IN ('queued','running')").fetchone()["count"]:
                    raise PreflightError("A research/API job is active. Finish or cancel it before restart/migration.")
            present = conn.execute("SELECT to_regclass('public.download_job_snapshots') AS name").fetchone()["name"]
            if present and conn.execute("SELECT count(*) AS count FROM download_job_snapshots WHERE snapshot->>'status' IN ('queued','running','pausing')").fetchone()["count"]:
                raise PreflightError("A download is active. Pause it and wait until paused before restart/migration.")
        pending = sorted(set(expected) - set(versions))
        if pending and not migrate and not allow_pending:
            raise PreflightError("Schema migrations pending: " + ", ".join(pending) +
                                 ". Back up DB AND artifacts, then use --migrate --backup-confirmed (existing DB).")
        if pending and migrate:
            if tables and not backup_confirmed:
                raise PreflightError("Existing database requires a verified DB/artifact backup and --backup-confirmed before migration.")
            apply_migrations(conn)
        return {"schema_current": not pending or migrate, "migration_count": len(expected),
                "pending": [] if migrate else pending, "applied": pending if migrate else []}


def assert_no_legacy_download(root):
    # File checkpoints are still authoritative before explicit adoption into PostgreSQL.
    for checkpoint in (p for source in ("qdm", "dukascopy") for p in (root / source).glob("**/job.json")):
        try:
            value = json.loads(checkpoint.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise PreflightError("A legacy download checkpoint cannot be verified; nothing was stopped.") from None
        if value.get("status") in {"queued", "running", "pausing"}:
            raise PreflightError("A legacy download is active. Pause it before restarting or migrating.")


def validate_paths(args, *, need_binary=True):
    if not args.artifact_root.is_dir():
        raise PreflightError("Artifact directory is missing; restore it before launch.")
    if args.download_engine == "qdm" and not (args.qdm_home / "qdmcli.exe").is_file():
        raise PreflightError("Licensed local qdmcli.exe is missing; set --qdm-home or explicitly use --download-engine none.")
    if need_binary and not args.rust_binary.is_file():
        raise PreflightError("Rust release binary is missing. Run --build before launching.")
    if need_binary and args.runtime_profile == "native" and not all(path.is_file() for path in (args.rust_admin_binary, args.rust_research_binary)):
        raise PreflightError("Native admin/research candidate binaries are missing. Build the complete candidate before launching.")


def binary_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def native_provider_preflight(args, env):
    """Pin existing adapters only; no download or vendor process is started."""
    if args.runtime_profile != "native":
        return
    if args.download_engine == "qdm":
        env["TW_V2_QDM_SHA256"] = binary_digest(args.qdm_home / "qdmcli.exe")
    elif args.download_engine == "dukascopy":
        required = ("TW_V2_DUKASCOPY_METADATA_PATH", "TW_V2_DUKASCOPY_NODE", "TW_V2_DUKASCOPY_NODE_SHA256",
                    "TW_V2_DUKASCOPY_WORKER", "TW_V2_DUKASCOPY_WORKER_SHA256", "TW_V2_DUKASCOPY_DEPENDENCIES_SHA256")
        if not all(env.get(key) for key in required):
            raise PreflightError("Native Dukascopy requires an explicitly pinned metadata/Node/worker capability before startup.")
        for path_key, hash_key in ((required[1], required[2]), (required[3], required[4])):
            path = Path(env[path_key])
            if not path.is_absolute() or not path.is_file() or binary_digest(path) != env[hash_key]:
                raise PreflightError("Native Dukascopy adapter identity changed; nothing was started.")
        metadata = Path(env[required[0]])
        if not metadata.is_absolute() or not metadata.is_file() or metadata.stat().st_size > 4 * 1024 * 1024:
            raise PreflightError("Native Dukascopy metadata capability is missing or exceeds its bound.")
        from rust_provider_adapter_bootstrap import dependency_digest
        try:
            if dependency_digest(Path(env[required[3]]).parent) != env[required[5]]:
                raise ValueError()
        except (OSError, ValueError):
            raise PreflightError("Native Dukascopy installed dependencies changed; nothing was started.") from None


def native_scientific_preflight(args, env):
    if args.runtime_profile != "native" or not env.get("TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY"):
        return
    path = Path(env["TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY"])
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 1024*1024:
        raise PreflightError("Scientific adapter capability is missing or invalid; prepare the installed adapter before startup.")
    result = subprocess.run([str(args.rust_admin_binary), "scientific-capability", str(path)],
        env=env, cwd=FOUNDATION, capture_output=True, text=True, timeout=30,
        creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    try:
        valid = result.returncode == 0 and json.loads(result.stdout).get("valid") is True
    except (ValueError, AttributeError):
        valid = False
    if not valid:
        raise PreflightError("Scientific adapter identity is stale or invalid; nothing was started.")


def process_roles(args):
    python_paths = {Path(sys.executable).resolve(), Path(getattr(sys, "_base_executable", sys.executable)).resolve()}
    roles = {"supervisor": python_paths, "api": {args.rust_binary.resolve()}}
    if args.runtime_profile == "native":
        roles["research"] = {args.rust_research_binary.resolve()}
    else:
        roles.update(domain=python_paths, research=python_paths)
    return roles


def build_candidate(args):
    if args.manifest.exists():
        try:
            value = json.loads(args.manifest.read_text(encoding="utf-8"))
            targets = {args.rust_binary.resolve(), args.rust_admin_binary.resolve(), args.rust_research_binary.resolve()}
            for entry in value.get("processes", {}).values():
                if Path(entry["executable"]).resolve() in targets and process_identity(entry["pid"]) == entry:
                    raise PreflightError("A build target belongs to a running managed process. Build a separate candidate path before guarded cutover.")
        except (ValueError, KeyError, TypeError):
            raise PreflightError("Existing manifest cannot establish build target ownership.") from None
    cargo = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo.exe")
    target = args.rust_binary.parent.parent
    if args.rust_binary.parent.name != "release":
        raise PreflightError("--build requires candidate binaries in a release directory.")
    subprocess.run([cargo, "build", "--release", "--locked", "--bins", "--manifest-path",
                    str(FOUNDATION / "api-rust/Cargo.toml"), "--target-dir", str(target)],
                   check=True, timeout=900, cwd=FOUNDATION,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def port_is_free(port):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def process_identity(pid):
    """PID, kernel creation time and executable prevent acting on a recycled PID."""
    if os.name != "nt":
        raise PreflightError("Managed restart ownership checks currently require Windows.")
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:  # No process currently has this PID.
            return None
        raise PreflightError("Cannot open owned process for identity verification; no stop was authorized.")
    try:
        times = [wintypes.FILETIME() for _ in range(4)]
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if not kernel.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
            raise PreflightError("Cannot verify owned process identity.")
        if times[1].dwHighDateTime or times[1].dwLowDateTime:
            return None
        if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            # A graceful shutdown can finish between time and image queries.
            # An exited process may remain queryable while Popen holds its handle.
            exit_code = wintypes.DWORD()
            if kernel.GetExitCodeProcess(handle, ctypes.byref(exit_code)) and exit_code.value != 259:
                return None
            raise PreflightError("Cannot verify owned process identity.")
        return {"pid": pid, "created": (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime,
                "executable": str(Path(buffer.value).resolve())}
    finally:
        kernel.CloseHandle(handle)


def manifest_write(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@contextmanager
def runtime_lock(manifest):
    import msvcrt
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.with_suffix(".lock").open("a+b") as handle:
        if handle.seek(0, 2) == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            raise PreflightError("This runtime profile already has a supervisor; no second runtime was started.") from None
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def sanitize_log(line, env):
    from psycopg.conninfo import conninfo_to_dict
    values = [env.get("TW_V2_DATABASE_URL", ""), os.environ.get("TW_V2_DATABASE_URL", "")]
    values.extend(value for key, value in env.items() if any(word in key.upper() for word in ("PASSWORD", "TOKEN", "SECRET", "API_KEY")))
    values.append(conninfo_to_dict(env["TW_V2_DATABASE_URL"]).get("password", ""))
    for value in sorted(set(values), key=len, reverse=True):
        if value:
            line = line.replace(value, "[redacted]")
    return line


def copy_log(stream, output, env):
    try:
        for raw in iter(stream.readline, b""):
            output.write(sanitize_log(raw.decode("utf-8", errors="replace"), env).encode("utf-8"))
            output.flush()
    finally:
        stream.close()


def owned_manifest(args):
    resolve_profile_paths(args)
    value = json.loads(args.manifest.read_text(encoding="utf-8"))
    if value.get("project") != str(PROJECT.resolve()) or value.get("port") != args.port:
        raise PreflightError("Runtime ownership manifest belongs to another project/port.")
    run_id = value.get("run_id", "")
    if len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
        raise PreflightError("Runtime ownership manifest has an invalid run identity.")
    marker = args.manifest.parent / f"platform-{run_id}.stop"
    if value.get("stop_file") != str(marker.resolve()):
        raise PreflightError("Runtime shutdown marker is outside its expected owner scope.")
    schema = value.get("schema", "api-platform-runtime-v1")
    if schema not in {"api-platform-runtime-v1", "api-platform-runtime-v2"}:
        raise PreflightError("Unknown runtime ownership manifest version.")
    if value.get("runtime_profile", "compatibility") != args.runtime_profile:
        raise PreflightError("Runtime profile differs. Stop with its exact recorded profile before compatibility rollback.")
    if schema == "api-platform-runtime-v1" and args.runtime_profile != "compatibility":
        raise PreflightError("Legacy manifest cannot own a native candidate.")
    expected = process_roles(args)
    for role, entry in value.get("processes", {}).items():
        if role not in expected or Path(entry["executable"]).resolve() not in expected[role]:
            raise PreflightError("Runtime executable ownership mismatch.")
        if process_identity(entry["pid"]) != entry:
            raise PreflightError("Runtime process changed or exited; stale manifest cannot stop it.")
        if schema == "api-platform-runtime-v2" and value.get("executable_sha256", {}).get(role) != binary_digest(Path(entry["executable"])):
            raise PreflightError("Runtime executable contents differ from its startup identity.")
    if set(value.get("processes", {})) != set(expected):
        raise PreflightError("Runtime ownership manifest is incomplete.")
    return value, marker


def child_commands(args, env):
    if args.runtime_profile == "native":
        return {"research": [str(args.rust_research_binary), "--max-active-jobs", "1", "--poll-ms", "100"],
                "api": [str(args.rust_binary)]}
    commands = {
        "domain": [sys.executable, "-B", "-m", "trading_workspace_v2.api_command_worker",
                   "--server-origin", f"http://127.0.0.1:{args.port}", "--download-engine", args.download_engine,
                   "--concurrency", "4", "--qdm-home", str(args.qdm_home)],
        "research": [sys.executable, "-B", "-m", "trading_workspace_v2.worker", "--max-active-jobs", "1"],
        "api": [str(args.rust_binary)],
    }
    if args.adopt_legacy_downloads:
        commands["domain"].append("--adopt-legacy-downloads")
    return commands


def native_worker_ready(path, token, worker_id, child, identity):
    if child.poll() is not None or process_identity(child.pid) != identity or not path.is_file():
        return False
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return value == {"schema": "research-worker-ready-v1", "worker_id": worker_id,
                     "pid": child.pid, "startup_token": token}


def stop_owned(args):
    value, marker = owned_manifest(args)
    marker.write_text("stop\n", encoding="ascii")
    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        if all(process_identity(entry["pid"]) != entry for entry in value["processes"].values()):
            print("Owned runtime stopped.", flush=True)
            return
        time.sleep(0.25)
    raise PreflightError("Owned runtime did not stop within deadline; no unrelated process was killed.")


def worker_ready(env):
    import psycopg
    with psycopg.connect(env["TW_V2_DATABASE_URL"], connect_timeout=3) as conn:
        return conn.execute("SELECT EXISTS(SELECT 1 FROM api_command_workers WHERE heartbeat_at_utc > CURRENT_TIMESTAMP - interval '10 seconds' AND worker_id LIKE %s)",
                            (env["TW_V2_COMMAND_WORKER_PREFIX"] + "-%",)).fetchone()[0]


def supervise(args, env):
    if not port_is_free(args.port):
        raise PreflightError("Loopback API port is occupied. Use the guarded restart script; no process was stopped.")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    if args.manifest.exists():
        try:
            previous = json.loads(args.manifest.read_text(encoding="utf-8"))
            parent = previous.get("processes", {}).get("supervisor")
            if parent and process_identity(parent["pid"]) == parent:
                raise PreflightError("A managed runtime is already alive; use guarded restart.")
        except (ValueError, KeyError):
            raise PreflightError("Invalid previous manifest; verify ownership before removing it.") from None
    run_id = uuid4().hex
    stop_file = args.manifest.parent / f"platform-{run_id}.stop"
    env["TW_V2_SHUTDOWN_FILE"] = str(stop_file.resolve())
    env["TW_V2_COMMAND_WORKER_PREFIX"] = f"platform-{run_id}"
    worker_ready_file = args.manifest.parent / f"platform-{run_id}-research.ready.json"
    startup_token = uuid4().hex + uuid4().hex
    worker_id = f"platform-{run_id}-research"
    if args.runtime_profile == "native":
        env.update(TW_V2_WORKER_READY_FILE=str(worker_ready_file.resolve()),
                   TW_V2_WORKER_STARTUP_TOKEN=startup_token, TW_V2_WORKER_ID=worker_id)
    state = {"schema": "api-platform-runtime-v2", "runtime_profile": args.runtime_profile,
             "run_id": run_id, "project": str(PROJECT.resolve()), "port": args.port,
             "stop_file": str(stop_file.resolve()), "ready": False,
             "processes": {"supervisor": process_identity(os.getpid())}, "executable_sha256": {}}
    state["executable_sha256"]["supervisor"] = binary_digest(Path(state["processes"]["supervisor"]["executable"]))
    commands = child_commands(args, env)
    children, logs, log_threads = {}, [], []
    env["PYTHONUNBUFFERED"] = "1"
    try:
        for role in commands:
            if role == "api":
                deadline = time.monotonic() + 30
                def ready():
                    if args.runtime_profile == "native":
                        child = children["research"]
                        return native_worker_ready(worker_ready_file, startup_token, worker_id, child, state["processes"]["research"])
                    return worker_ready(env)
                while not ready():
                    if any(p.poll() is not None for p in children.values()) or time.monotonic() > deadline:
                        raise PreflightError("Runtime worker did not advertise owned readiness; API was not started.")
                    time.sleep(0.25)
            output = (args.manifest.parent / f"platform-{run_id}-{role}.out.log").open("ab")
            error = (args.manifest.parent / f"platform-{run_id}-{role}.err.log").open("ab")
            logs.extend((output, error))
            child_env = dict(env)
            if role != "research":
                for key in ("TW_V2_WORKER_READY_FILE", "TW_V2_WORKER_STARTUP_TOKEN", "TW_V2_WORKER_ID"):
                    child_env.pop(key, None)
            child = subprocess.Popen(commands[role], cwd=FOUNDATION, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            children[role] = child
            for stream, destination in ((child.stdout, output), (child.stderr, error)):
                thread = threading.Thread(target=copy_log, args=(stream, destination, env), daemon=True)
                thread.start()
                log_threads.append(thread)
            state["processes"][role] = process_identity(child.pid)
            if state["processes"][role] is None:
                raise PreflightError("Runtime child exited before executable identity was established.")
            state["executable_sha256"][role] = binary_digest(Path(state["processes"][role]["executable"]))
            manifest_write(args.manifest, state)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if any(p.poll() is not None for p in children.values()):
                raise PreflightError("A runtime child exited during startup; inspect sanitized role logs.")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/health/ready", timeout=2) as response:
                    health = json.load(response)
                    if health.get("ok") and (args.runtime_profile != "native" or health.get("command_worker") == "not_required"):
                        state["ready"] = True
                        manifest_write(args.manifest, state)
                        break
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        if not state["ready"]:
            raise PreflightError("Rust API readiness deadline exceeded.")
        print(f"Rust offline API ready on loopback port {args.port}; {args.runtime_profile} profile supervised.", flush=True)
        while not stop_file.exists():
            if any(p.poll() is not None for p in children.values()):
                raise PreflightError("A runtime child exited; stopping only this owned runtime.")
            time.sleep(0.25)
    finally:
        stop_file.write_text("stop\n", encoding="ascii")
        deadline = time.monotonic() + 45
        while any(p.poll() is None for p in children.values()) and time.monotonic() < deadline:
            time.sleep(0.25)
        for role, child in children.items():
            # Popen holds the process handle; no tree kill or port-owner kill is used.
            if child.poll() is None:
                print(f"Owned {role} shutdown deadline reached; terminating its process handle.", flush=True)
                child.kill()
            child.wait(timeout=5)
        for thread in log_threads:
            thread.join(timeout=5)
        for log in logs:
            log.close()
        state["ready"] = False
        state["stopped"] = True
        manifest_write(args.manifest, state)
        worker_ready_file.unlink(missing_ok=True)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--port", type=int, default=8010)
    result.add_argument("--database-name", default="trading_workspace_v2_exness_history")
    result.add_argument("--artifact-root", type=Path, default=FOUNDATION / ".runtime/exness-market-data")
    result.add_argument("--qdm-home", type=Path, default=FOUNDATION / ".runtime/quantdatamanager")
    result.add_argument("--download-engine", choices=("qdm", "dukascopy", "none"), default="qdm")
    result.add_argument("--runtime-profile", choices=("compatibility", "native"), default="compatibility",
                        help="Compatibility remains rollback/default; native uses separate candidate binaries and no Python domain/research service.")
    result.add_argument("--scientific-capability", type=Path, help="Existing installed Nautilus capability; validated by native admin before startup.")
    result.add_argument("--legacy-codec-capability", type=Path, help="Existing PyArrow 21 capability for exact legacy artifact restoration only.")
    result.add_argument("--rust-binary", type=Path)
    result.add_argument("--rust-admin-binary", type=Path)
    result.add_argument("--rust-research-binary", type=Path)
    result.add_argument("--manifest", type=Path)
    result.add_argument("--check-only", action="store_true")
    result.add_argument("--allow-pending-migrations", action="store_true", help="Read-only preflight reports pending versions; cannot start workers with these.")
    result.add_argument("--require-idle", action="store_true", help="Fail if queued/running jobs or legacy downloads exist.")
    result.add_argument("--setup-only", action="store_true", help="Build/apply explicitly selected migrations and exit without starting services.")
    result.add_argument("--stop", action="store_true")
    result.add_argument("--build", action="store_true")
    result.add_argument("--migrate", action="store_true")
    result.add_argument("--backup-confirmed", action="store_true")
    result.add_argument("--adopt-legacy-downloads", action="store_true")
    return result


def main(argv=None):
    args = resolve_profile_paths(parser().parse_args(argv))
    if not 1024 <= args.port <= 65535:
        raise PreflightError("Port must be between 1024 and 65535.")
    if args.check_only and (args.build or args.migrate or args.stop or args.adopt_legacy_downloads):
        raise PreflightError("--check-only cannot be combined with actions.")
    if args.allow_pending_migrations and not (args.check_only or args.stop):
        raise PreflightError("--allow-pending-migrations requires --check-only or guarded --stop.")
    if args.runtime_profile == "native" and args.adopt_legacy_downloads:
        raise PreflightError("Native profile cannot silently adopt legacy checkpoints; perform explicit provider adoption before native cutover.")
    if args.stop and (args.build or args.migrate or args.setup_only):
        raise PreflightError("Stop cannot be combined with build/migration/setup actions.")
    env = configuration(args)
    validate_paths(args, need_binary=not args.build)
    native_provider_preflight(args, env)
    assert_no_legacy_download(args.artifact_root) if (args.stop or args.migrate or args.require_idle) else None
    if args.build and args.runtime_profile == "native":
        build_candidate(args)
        validate_paths(args)
    native_scientific_preflight(args, env)
    if args.runtime_profile == "native":
        summary = native_database_preflight(args, env)
    else:
        summary = database_preflight(env, migrate=args.migrate, backup_confirmed=args.backup_confirmed,
                                     require_idle=args.stop or args.require_idle, allow_pending=args.allow_pending_migrations)
    if args.check_only:
        print(json.dumps({"check_only": True, "runtime_profile": args.runtime_profile, "port_free": port_is_free(args.port), **summary}))
        return 0
    if args.stop:
        stop_owned(args)
        return 0
    if args.build and args.runtime_profile != "native":
        build_candidate(args)
    if args.setup_only:
        print(json.dumps({"setup_only": True, **summary}))
        return 0
    with runtime_lock(args.manifest):
        supervise(args, env)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception as exc:
        # Driver/compiler/provider exception text can contain credentials or paths.
        print(str(exc) if isinstance(exc, PreflightError) else f"Runtime failed ({type(exc).__name__}); configuration values were not printed.", file=sys.stderr)
        raise SystemExit(1)
