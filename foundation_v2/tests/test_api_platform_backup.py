import importlib.util
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("platform_backup", Path(__file__).resolve().parents[1] / "scripts/backup_api_platform.py")
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)


class BackupGuardTests(unittest.TestCase):
    def test_backup_output_is_confined_to_dedicated_root(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(backup, "FOUNDATION", Path(folder)):
            base = Path(folder).resolve()
            artifacts = base / "artifacts"
            expected = base / ".runtime/api-platform-backups/snapshot"
            self.assertEqual(backup.backup_output(None, "snapshot", artifacts), expected.resolve())
            expected.mkdir(parents=True)
            for rejected in (expected, base / "outside", expected.parent / "../escape"):
                with self.assertRaises(backup.BackupPreflightError):
                    backup.backup_output(rejected, "snapshot", artifacts)
            new = expected.parent / "new"
            for artifacts in (expected.parent, new, new / "nested"):
                with self.assertRaises(backup.BackupPreflightError):
                    backup.backup_output(new, "snapshot", artifacts)

    @unittest.skipUnless(os.name == "nt", "Windows junction relocation")
    def test_backup_root_can_be_a_junction_without_allowing_child_escape(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder, patch.object(backup, "FOUNDATION", Path(folder) / "project"):
            base = Path(folder).resolve()
            target = base / "external-backups"
            target.mkdir()
            link = backup.FOUNDATION / ".runtime/api-platform-backups"
            link.parent.mkdir(parents=True)
            def junction(path, destination):
                subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                                f"New-Item -ItemType Junction -Path '{path}' -Target '{destination}' | Out-Null"],
                               check=True, capture_output=True)
            junction(link, target)
            try:
                self.assertEqual(backup.backup_output(link / "new", "snapshot", base / "artifacts"), target / "new")
                outside = base / "outside"
                outside.mkdir()
                junction(target / "escape", outside)
                try:
                    with self.assertRaises(backup.BackupPreflightError):
                        backup.backup_output(link / "escape/new", "snapshot", base / "artifacts")
                finally:
                    os.rmdir(target / "escape")
            finally:
                os.rmdir(link)

    def test_no_implicit_mutation_authority(self):
        with self.assertRaises(SystemExit), patch.object(backup, "database_preflight") as database:
            backup.main([])
        database.assert_not_called()

    def test_exact_port_must_be_stopped(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); sock.listen()
            with self.assertRaises(backup.BackupPreflightError):
                backup.require_stopped_port(sock.getsockname()[1])

    def test_legacy_active_and_unfinished_files_reject_backup(self):
        with tempfile.TemporaryDirectory() as root:
            job = Path(root) / "qdm/fixture/job.json"; job.parent.mkdir(parents=True)
            job.write_text('{"status":"running"}')
            with self.assertRaises(backup.BackupPreflightError): backup.artifact_references(Path(root))
            job.write_text('{"status":"completed"}')
            references, total = backup.artifact_references(Path(root))
            self.assertIn("qdm/fixture/job.json", references); self.assertGreater(total, 0)
            (job.parent / "candles.csv.tmp").write_text("retained partial download")
            self.assertIn("qdm/fixture/candles.csv.tmp", backup.artifact_references(Path(root))[0])
            (Path(root) / "publication.tmp").write_text("unfinished")
            with self.assertRaises(backup.BackupPreflightError): backup.artifact_references(Path(root))

    def test_remote_hostaddr_cannot_override_loopback(self):
        args = type("Args", (), {"database_name": "fixture"})()
        for dsn in ("host=192.0.2.1", "host=localhost hostaddr=192.0.2.1"):
            with patch.dict(os.environ, {"TW_V2_DATABASE_URL": dsn}), self.assertRaises(backup.BackupPreflightError):
                backup.configuration(args)

    def test_dump_has_no_secret_in_argv_and_failure_text(self):
        result = type("Completed", (), {"returncode": 1})()
        with patch.object(backup.subprocess, "run", return_value=result) as run:
            with self.assertRaises(backup.BackupPreflightError) as caught:
                backup.dump_database({"host": "127.0.0.1", "dbname": "fixture", "password": "fixture-private"},
                                     Path("pg_dump.exe"), Path("metadata.dump"), timeout=5)
        self.assertNotIn("fixture-private", str(run.call_args.args))
        self.assertNotIn("fixture-private", str(caught.exception))
        self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "fixture-private")
