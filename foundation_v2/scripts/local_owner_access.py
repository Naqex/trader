"""Provision private, immutable local owner capabilities; never activate them."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import sys
from urllib.parse import urlsplit
from uuid import uuid4


FOUNDATION = Path(__file__).resolve().parents[1]
PROJECT = FOUNDATION.parent
LAYOUT = {'schema_version': 'local-owner-access-directory-v1'}


class ProvisionError(ValueError):
    pass


def require_local_tree(path: Path) -> None:
    """Check lexical ancestors before resolve can hide a link or junction."""
    for item in (path, *path.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 1024):
            raise ProvisionError('output tree must not contain symlinks or reparse points')
    if str(path).startswith(('\\\\', '//')):
        raise ProvisionError('output must be on a local filesystem')
    for part in path.parts[1:]:
        if ':' in part or part.endswith((' ', '.')):
            raise ProvisionError('output has an ambiguous filesystem component')


def private_directory(path: Path) -> None:
    if os.name == 'nt':
        # Reuse the connector's native DACL implementation: current user + SYSTEM,
        # protected from inherited grants, with inheritance for newly written files.
        sys.path.insert(0, str(FOUNDATION))
        from scripts.mt5_connector import private_directory as protect
        protect(path)
    else:
        path.chmod(0o700)


def exact_origins(values: list[str]) -> list[str]:
    if not values or len(values) > 8 or len(set(values)) != len(values):
        raise ProvisionError('provide one to eight distinct exact loopback origins')
    for value in values:
        try:
            parsed = urlsplit(value)
            host, port = parsed.hostname, parsed.port
        except ValueError:
            raise ProvisionError('origin must be an exact HTTP loopback origin with a port') from None
        canonical = f'http://{"[::1]" if host == "::1" else host}:{port}'
        if (host not in {'127.0.0.1', '::1'} or port is None or not 1 <= port <= 65535
                or value != canonical):
            raise ProvisionError('origin must be an exact HTTP loopback origin with a port')
    return list(values)


def write_exclusive(path: Path, value: dict) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def prepare(output: Path, origins: list[str], *, rotate: bool = False,
            project_root: Path = PROJECT, now: datetime | None = None) -> dict:
    """Create a generation under project/.runtime/local-owner-access only.

    Rotation emits a new config path; no active pointer, environment variable,
    old capability or runtime is changed. Filesystem access remains the trust
    boundary: this is not protection against a malicious process as this user.
    """
    origins = exact_origins(origins)
    clock = now or datetime.now(timezone.utc)
    if clock.tzinfo is None or clock.utcoffset() != timedelta(0):
        raise ProvisionError('clock must be timezone-aware UTC')
    project_root = Path(os.path.abspath(project_root))
    output = Path(os.path.abspath(output))
    require_local_tree(project_root)
    require_local_tree(output)
    scope = project_root.resolve() / '.runtime' / 'local-owner-access'
    output = output.resolve()
    if not output.is_relative_to(scope):
        raise ProvisionError('output must be under project/.runtime/local-owner-access')
    marker = output / 'provisioner.json'
    if output.exists():
        if not rotate:
            raise ProvisionError('output already exists; --rotate is required for a new generation')
        if not output.is_dir() or not marker.is_file() or marker.stat().st_size > 1024:
            raise ProvisionError('rotation requires a managed private output directory')
        require_local_tree(marker)
        try:
            managed = json.loads(marker.read_text(encoding='utf-8')) == LAYOUT
        except (ValueError, UnicodeError):
            managed = False
        if not managed:
            raise ProvisionError('rotation requires a managed private output directory')
    else:
        if rotate:
            raise ProvisionError('--rotate requires an existing managed output directory')
        output.mkdir(parents=True, exist_ok=False, mode=0o700)
        require_local_tree(output)
        private_directory(output)
        write_exclusive(marker, LAYOUT)

    # Existing managed ACLs must be repaired before writing another generation.
    # Only this explicit, project-scoped invocation performs that operation.
    private_directory(output)
    expiry = lambda delta: (clock + delta).isoformat(timespec='seconds').replace('+00:00', 'Z')
    expires = dict(bootstrap_expires_at_utc=expiry(timedelta(minutes=10)),
                   session_expires_at_utc=expiry(timedelta(hours=12)),
                   bearer_expires_at_utc=expiry(timedelta(days=7)))
    bearer, nonce, session, csrf = (secrets.token_urlsafe(32) for _ in range(4))
    digest = lambda token: hashlib.sha256(token.encode('ascii')).hexdigest()
    config = dict(allowed_origins=origins,
        owner_bearer=dict(token_sha256=digest(bearer), expires_at_utc=expires['bearer_expires_at_utc']),
        bootstrap=dict(nonce_sha256=digest(nonce), expires_at_utc=expires['bootstrap_expires_at_utc'],
            session_token=session, csrf_token=csrf, session_expires_at_utc=expires['session_expires_at_utc']))
    handoff = dict(schema_version='local-owner-access-secrets-v1', owner_bearer=bearer,
                   bootstrap_nonce=nonce, **expires)
    generation = output / ('generation-' + uuid4().hex)
    staging = output / ('.pending-' + uuid4().hex)
    staging.mkdir(mode=0o700)
    names = ('capabilities.json', 'owner-secrets.json')
    try:
        private_directory(staging)
        write_exclusive(staging / names[0], config)
        write_exclusive(staging / names[1], handoff)
        require_local_tree(output)
        if generation.exists():
            raise ProvisionError('generation already exists; nothing was replaced')
        staging.rename(generation)
    except Exception:
        # Only files created inside this fresh private staging directory are ours.
        for name in names:
            (staging / name).unlink(missing_ok=True)
        staging.rmdir()
        raise
    return dict(status='prepared', activated=False, rotated=rotate,
        config_path=str(generation / names[0]), secrets_path=str(generation / names[1]), **expires)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare'])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--origin', action='append', required=True)
    parser.add_argument('--rotate', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = prepare(args.output, args.origin, rotate=args.rotate)
    except (ProvisionError, OSError, RuntimeError):
        # Exception messages from OS/credential helpers must never reach logs.
        print(json.dumps(dict(status='failed', reason='local_owner_access_prepare_failed')), file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
