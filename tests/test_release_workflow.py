"""Offline release guards exercised in a relocated fixture; no broker/network."""
import importlib.util
import hashlib
import json
import re
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load("release_tools", ROOT / "scripts/release.py")
charts = load("chart_setup", ROOT / "scripts/advanced_charts.py")


class ReleaseWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="naqex relocated fixture ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "source checkout"
        self.root.mkdir()
        paths = ["VERSION", "LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", "docs/releases.md", "docs/advanced-charts.md", *release.MANIFESTS]
        for relative in paths:
            source = ROOT / relative
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            for lock_name in ("uv.lock", "Cargo.lock", "package-lock.json"):
                if source.with_name(lock_name).is_file():
                    shutil.copy2(source.with_name(lock_name), target.with_name(lock_name))
        self.patcher = patch.object(release, "ROOT", self.root)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_prepare_and_check_versions_after_relocation(self):
        result = release.prepare("0.2.0-beta.3")
        self.assertTrue(result["passed"])
        self.assertEqual("0.2.0b3", release.manifest(self.root / release.MANIFESTS[0])["project"]["version"])
        self.assertEqual("0.2.0-beta.3", release.manifest(self.root / release.MANIFESTS[3])["version"])

    def test_invalid_version_does_not_mutate_source(self):
        before = (self.root / "VERSION").read_bytes()
        with self.assertRaises(ValueError):
            release.prepare("01.2.0")
        self.assertEqual(before, (self.root / "VERSION").read_bytes())

    def test_mismatched_lock_is_rejected(self):
        lock = self.root / "foundation_v2/web/package-lock.json"
        document = json.loads(lock.read_text())
        document["packages"][""]["version"] = "9.0.0"
        lock.write_text(json.dumps(document))
        with self.assertRaisesRegex(ValueError, "Lock mismatch"):
            release.check()

    def test_missing_later_lock_does_not_partially_bump(self):
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        missing = self.root / "foundation_v2/data_worker/package-lock.json"
        missing.unlink()
        with self.assertRaises(FileNotFoundError):
            release.prepare("0.3.0-alpha.1")
        for path, content in before.items():
            if path != missing:
                self.assertEqual(content, path.read_bytes(), str(path))

    def test_check_rejects_missing_python_lock(self):
        (self.root / "foundation_v2/uv.lock").unlink()
        with self.assertRaisesRegex(ValueError, "Missing lock"):
            release.check()

    def test_packaged_source_keeps_rust_compile_time_resources(self):
        for source in (ROOT / "foundation_v2/api-rust").rglob("*.rs"):
            for relative in re.findall(r'include_(?:str|bytes)!\(\s*"([^"]+)"', source.read_text(encoding="utf8")):
                resource = (source.parent / relative).resolve()
                self.assertTrue(resource.is_file(), str(resource))
                self.assertTrue(release.included(resource.relative_to(ROOT).as_posix()), str(resource))

    def test_package_excludes_private_files_and_has_source_identity(self):
        private = self.root / ".env"
        private.write_text("fixture=not-a-real-secret")
        tracked = [p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()]
        def fake_git(*args):
            return "\n".join(tracked) if args[0] == "ls-files" else "a" * 40 if args[0] == "rev-parse" else ""
        with patch.object(release, "git", side_effect=fake_git):
            result = release.package(Path(self.temporary.name) / "packages")
        with zipfile.ZipFile(result["path"]) as archive:
            self.assertNotIn(".env", archive.namelist())
            manifest = json.loads(archive.read("PACKAGE.json"))
            self.assertEqual("a" * 40, manifest["source_commit"])
            self.assertEqual("source", manifest["kind"])
            self.assertIn("LICENSE", archive.namelist())

    def test_dirty_checkout_and_in_tree_output_are_rejected(self):
        with patch.object(release, "git", return_value=" M VERSION"):
            with self.assertRaisesRegex(ValueError, "committed tracked source"):
                release.package(Path(self.temporary.name) / "packages")
        with patch.object(release, "git", return_value=""):
            with self.assertRaisesRegex(ValueError, "outside the checkout"):
                release.package(self.root / "dist")

    def test_wrong_vendor_hash_does_not_install(self):
        source = self.root / "vendor"
        (source / "bundles").mkdir(parents=True)
        (source / charts.LOADER).write_text("unsupported fixture distribution")
        with patch.object(charts, "ROOT", self.root):
            with self.assertRaisesRegex(ValueError, "Unsupported loader hash"):
                charts.install(source)
        self.assertFalse((self.root / ".runtime/vendors").exists())

    def test_vendor_archive_rejects_path_traversal(self):
        archive = self.root / "unsafe.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("../escape.js", "fixture")
        with self.assertRaisesRegex(ValueError, "Unsafe archive"):
            charts.extract(archive, self.root / "extract")
        self.assertFalse((self.root / "escape.js").exists())

    def test_vendor_loader_alone_is_not_an_intact_distribution(self):
        source = self.root / "vendor"
        (source / "bundles").mkdir(parents=True)
        loader = b"fixture loader"
        (source / charts.LOADER).write_bytes(loader)
        inventory = self.root / "vendor-inventory.json"
        inventory.write_text(json.dumps({"files": [{"path": "bundles/required.js", "sha256": "0" * 64}]}))
        with patch.object(charts, "INVENTORY", inventory), patch.object(charts, "LOADER_SHA256", hashlib.sha256(loader).hexdigest()):
            with self.assertRaisesRegex(ValueError, "Missing or unsafe vendor asset"):
                charts.verify(source)


if __name__ == "__main__":
    unittest.main()
