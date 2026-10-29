"""Resolve optional integration tools without a developer's checkout path."""
import os
from pathlib import Path
import shutil

FOUNDATION_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = FOUNDATION_ROOT.parent


def postgres_bin(variable="TW_PLATFORM_TEST_PG_BIN"):
    configured = os.environ.get(variable) or os.environ.get("TW_PLATFORM_TEST_PG_BIN")
    if configured:
        return Path(configured).expanduser().resolve()
    executable = shutil.which("initdb")
    if executable:
        return Path(executable).resolve().parent
    # A documented optional installation location, never a historical QA run.
    return PROJECT_ROOT / ".runtime" / "postgres" / "bin"
