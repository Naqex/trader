"""Check maintained setup links and executable paths; preserve historical evidence."""
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]


def check():
    failures = []
    documents = [ROOT / name for name in (
        "README.md", "CONTRIBUTING.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md",
        "docs/releases.md", "docs/advanced-charts.md", "docs/paths-and-migration.md",
        ".agents/skills/release-management/SKILL.md",
    )]
    for path in documents:
        for target in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding="utf8")):
            if target.startswith(("https://", "http://", "#")):
                continue
            target = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if target and not (path.parent / target).exists():
                failures.append(f"Broken link in {path.relative_to(ROOT)}: {target}")
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files"], text=True).splitlines()
    for relative in tracked:
        if relative.startswith(("foundation_v2/evidence/", "foundation_v2/experiments/")):
            continue
        path = ROOT / relative
        if path.suffix not in {".py", ".ps1", ".js", ".jsx", ".mjs", ".rs"} or not path.is_file():
            continue
        if re.search(r"[A-Z]:[/\\]+(?:Users|ANNAM|BACKUP-TRADINGWORKSPACE)[/\\]", path.read_text(encoding="utf8"), re.I):
            failures.append(f"Developer-specific absolute path: {relative}")
    return failures


if __name__ == "__main__":
    failures = check()
    for failure in failures:
        print(failure)
    print(f"Maintained link/path check: {len(failures)} failures")
    raise SystemExit(bool(failures))
