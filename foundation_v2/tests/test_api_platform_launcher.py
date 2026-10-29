"""Restart guards must remain read-only and must reject foreign/recycled processes."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("platform_launcher", Path(__file__).resolve().parents[1] / "scripts/run_api_platform.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_storage_profile_overrides_inherited_environment_and_rejects_compatibility_compact(self):
        for profile, storage in [('compatibility', 'full'), ('native', 'full'), ('native', 'compact')]:
            args = launcher.parser().parse_args(['--runtime-profile', profile, '--replay-storage-profile', storage])
            with patch.dict('os.environ', {'TW_V2_DATABASE_URL': 'host=localhost user=fixture',
                                           'TW_V2_REPLAY_STORAGE_PROFILE': 'compact'}):
                self.assertEqual(launcher.configuration(args)['TW_V2_REPLAY_STORAGE_PROFILE'], storage)
        with patch.object(launcher, 'configuration') as config, patch.object(launcher, 'build_candidate') as build:
            with self.assertRaises(launcher.PreflightError):
                launcher.main(['--replay-storage-profile', 'compact', '--build-only'])
            config.assert_not_called()
            build.assert_not_called()

    def test_build_only_uses_selected_candidate_and_never_connects_or_starts(self):
        with patch.object(launcher, 'configuration') as config, patch.object(launcher, 'supervise') as start, \
             patch.object(launcher, 'build_candidate') as build:
            self.assertEqual(launcher.main(['--runtime-profile', 'native', '--build-only']), 0)
            self.assertIn('native-candidate', str(build.call_args.args[0].rust_binary))
            config.assert_not_called()
            start.assert_not_called()
            for action in ['--check-only', '--migrate', '--stop', '--setup-only', '--build', '--allow-pending-migrations', '--adopt-legacy-downloads']:
                with self.subTest(action=action), self.assertRaises(launcher.PreflightError):
                    launcher.main(['--build-only', action])
            self.assertEqual(build.call_count, 1)

    def test_native_pending_schema_is_reported_only_for_explicit_check_or_stop(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args([
            '--runtime-profile', 'native', '--check-only', '--allow-pending-migrations']))
        receipt = {'schema_current': False, 'pending': ['0001_fixture.sql']}
        with patch.object(launcher.subprocess, 'run', return_value=MagicMock(returncode=0, stdout=json.dumps(receipt))) as run:
            self.assertEqual(launcher.native_database_preflight(args, {}), receipt)
            self.assertEqual(run.call_args.args[0], [str(args.rust_admin_binary), 'check'])
        with patch.object(launcher, 'configuration') as config:
            with self.assertRaises(launcher.PreflightError):
                launcher.main(['--runtime-profile', 'native', '--allow-pending-migrations'])
            config.assert_not_called()

    def test_native_scientific_descriptor_is_explicit_and_verified_before_start(self):
        with tempfile.TemporaryDirectory() as folder:
            capability=Path(folder).resolve()/'scientific.json';capability.write_text('{}')
            args=launcher.resolve_profile_paths(launcher.parser().parse_args(['--runtime-profile','native',
                '--scientific-capability',str(capability),'--legacy-codec-capability',str(capability)]))
            with patch.dict('os.environ',{'TW_V2_DATABASE_URL':'host=localhost user=fixture'}):
                env=launcher.configuration(args)
            self.assertEqual(env['TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY'],str(capability.resolve()))
            self.assertEqual(env['TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY'],str(capability.resolve()))
            for result in [MagicMock(returncode=1,stdout=''),MagicMock(returncode=0,stdout='{}'),
                           MagicMock(returncode=0,stdout='not json')]:
                with patch.object(launcher.subprocess,'run',return_value=result):
                    with self.assertRaises(launcher.PreflightError):launcher.native_scientific_preflight(args,env)
            with patch.object(launcher.subprocess,'run',return_value=MagicMock(returncode=0,stdout='{"valid":true,"verification":"metadata"}')) as run:
                launcher.native_scientific_preflight(args,env)
                self.assertEqual(run.call_args.args[0],[str(args.rust_admin_binary),'scientific-capability-metadata',str(capability)])
            for mode in ['--check-only','--setup-only','--stop']:
                full_args=launcher.resolve_profile_paths(launcher.parser().parse_args(['--runtime-profile','native',mode]))
                with patch.object(launcher.subprocess,'run',return_value=MagicMock(returncode=0,stdout='{"valid":true,"verification":"installation"}')) as run:
                    launcher.native_scientific_preflight(full_args,env)
                    self.assertEqual(run.call_args.args[0],[str(full_args.rust_admin_binary),'scientific-capability',str(capability)])
                with patch.object(launcher.subprocess,'run',return_value=MagicMock(returncode=0,stdout='{"valid":true,"verification":"metadata"}')):
                    with self.assertRaises(launcher.PreflightError):launcher.native_scientific_preflight(full_args,env)

    def test_native_provider_selection_and_pins_are_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            home=Path(folder);exe=home/'qdmcli.exe';exe.write_bytes(b'fixture-only-never-executed')
            args=launcher.parser().parse_args(['--runtime-profile','native','--download-engine','qdm','--qdm-home',str(home)])
            with patch.dict('os.environ',{'TW_V2_DATABASE_URL':'host=localhost user=fixture'}):
                env=launcher.configuration(args)
            self.assertEqual(env['TW_V2_DOWNLOAD_ENGINE'],'qdm')
            self.assertEqual(env['TW_V2_QDM_HOME'],str(home.resolve()))
            launcher.native_provider_preflight(args,env)
            self.assertEqual(env['TW_V2_QDM_SHA256'],launcher.binary_digest(exe))
            args.download_engine='dukascopy'
            with self.assertRaises(launcher.PreflightError):launcher.native_provider_preflight(args,{})
            metadata=home/'metadata.json';metadata.write_text('{}')
            (home/'package.json').write_text('{}');(home/'package-lock.json').write_text('{}')
            (home/'node_modules').mkdir();(home/'node_modules/dependency.js').write_text('fixture')
            sys.path.insert(0,str(launcher.FOUNDATION/'scripts'))
            from rust_provider_adapter_bootstrap import dependency_digest
            pins=dict(TW_V2_DUKASCOPY_METADATA_PATH=str(metadata),TW_V2_DUKASCOPY_NODE=str(exe),
                      TW_V2_DUKASCOPY_NODE_SHA256=launcher.binary_digest(exe),TW_V2_DUKASCOPY_WORKER=str(exe),
                      TW_V2_DUKASCOPY_WORKER_SHA256=launcher.binary_digest(exe),
                      TW_V2_DUKASCOPY_DEPENDENCIES_SHA256=dependency_digest(home))
            launcher.native_provider_preflight(args,pins)
            (home/'node_modules/dependency.js').write_text('changed')
            with self.assertRaises(launcher.PreflightError):launcher.native_provider_preflight(args,pins)
            (home/'node_modules/dependency.js').write_text('fixture')
            exe.write_bytes(b'changed')
            with self.assertRaises(launcher.PreflightError):launcher.native_provider_preflight(args,pins)

    def test_child_import_paths_and_remote_hostaddr_guard(self):
        args = launcher.parser().parse_args(["--download-engine", "none"])
        with patch.dict("os.environ", {"TW_V2_DATABASE_URL": "host=localhost user=fixture"}):
            env = launcher.configuration(args)
        self.assertIn(str(launcher.PROJECT), env["PYTHONPATH"])
        self.assertTrue(Path(env["TW_V2_OPENAPI_PATH"]).is_file())
        with patch.dict("os.environ", {"TW_V2_DATABASE_URL": "host=localhost hostaddr=192.0.2.1"}):
            with self.assertRaises(launcher.PreflightError): launcher.configuration(args)

    def fake_database(self, *, active=False):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        def execute(query, parameters=None):
            response = MagicMock()
            if "SELECT to_regclass" in query:
                response.fetchone.return_value = {"name": "existing_table"}
            elif "FROM tw_schema_migrations" in query:
                response.fetchall.return_value = []
            elif "information_schema.columns" in query:
                response.fetchone.return_value = {"present": False}
            else:
                response.fetchone.return_value = {"count": 1 if "pg_tables" in query or active else 0}
            return response
        connection.execute.side_effect = execute
        return connection

    def test_compatibility_guard_includes_all_compact_revisions_without_mutation(self):
        for compact in (True, False):
            conn = MagicMock()
            conn.execute.return_value.fetchone.side_effect = [{"present": True}, {"present": compact}]
            if compact:
                with self.assertRaisesRegex(launcher.PreflightError, "Historical and deleted"):
                    launcher.compatibility_storage_preflight(conn)
            else:
                launcher.compatibility_storage_preflight(conn)
            query = conn.execute.call_args_list[-1].args[0]
            self.assertIn("storage_format <> 'full_snapshot'", query)
            self.assertNotIn("deleted", query)
            self.assertNotIn("current_revision", query)
            self.assertTrue(all(call.args[0].lstrip().startswith("SELECT") for call in conn.execute.call_args_list))

    def test_pre_compact_schema_needs_no_storage_column_and_stop_remains_allowed(self):
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = {"present": False}
        launcher.compatibility_storage_preflight(conn)
        conn.execute.assert_called_once()
        with patch("psycopg.connect", return_value=self.fake_database()), \
             patch.object(launcher, "compatibility_storage_preflight") as guard:
            launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, allow_pending=True)
            guard.assert_called_once()
            guard.reset_mock()
            launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, allow_pending=True, allow_compact=True)
            guard.assert_not_called()

    def test_compact_guard_blocks_compatibility_before_any_child_and_does_not_block_stop(self):
        with patch.object(launcher, "configuration", return_value={"TW_V2_DATABASE_URL": "fixture"}), \
             patch.object(launcher, "validate_paths"), patch("psycopg.connect", return_value=self.fake_database()), \
             patch.object(launcher, "compatibility_storage_preflight", side_effect=launcher.PreflightError("compact fixture")), \
             patch.object(launcher, "supervise") as start:
            with self.assertRaisesRegex(launcher.PreflightError, "compact fixture"):
                launcher.main(["--check-only", "--allow-pending-migrations"])
            start.assert_not_called()
        with patch.object(launcher, "configuration", return_value={}), patch.object(launcher, "validate_paths"), \
             patch.object(launcher, "database_preflight", return_value={"schema_current": True}) as database, \
             patch.object(launcher, "stop_owned") as stop, patch.object(launcher, "supervise") as start:
            self.assertEqual(launcher.main(["--stop"]), 0)
            self.assertTrue(database.call_args.kwargs["allow_compact"])
            stop.assert_called_once()
            start.assert_not_called()

    def test_pending_schema_requires_explicit_migrate(self):
        with patch("psycopg.connect", return_value=self.fake_database()), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"})
            result = launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, allow_pending=True)
            self.assertFalse(result["schema_current"])
            self.assertGreater(len(result["pending"]), 0)
            migration.assert_not_called()

    def test_existing_database_migrate_requires_backup_and_idle(self):
        with patch("psycopg.connect", return_value=self.fake_database()), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True)
            migration.assert_not_called()
            launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True, backup_confirmed=True)
            migration.assert_called_once()
        with patch("psycopg.connect", return_value=self.fake_database(active=True)), \
             patch("trading_workspace_v2.migrations.apply_migrations") as migration:
            with self.assertRaises(launcher.PreflightError):
                launcher.database_preflight({"TW_V2_DATABASE_URL": "fixture"}, migrate=True, backup_confirmed=True)
            migration.assert_not_called()

    def test_child_logs_redact_database_and_tokens(self):
        env = {"TW_V2_DATABASE_URL": "host=127.0.0.1 dbname=fixture password=fixture-only-password",
               "TW_V2_METRICS_TOKEN": "fixture-only-token"}
        sanitized = launcher.sanitize_log("driver: " + env["TW_V2_DATABASE_URL"] + " password: fixture-only-password token: fixture-only-token", env)
        self.assertNotIn("fixture-only-password", sanitized)
        self.assertNotIn("fixture-only-token", sanitized)
        self.assertNotIn("host=127.0.0.1", sanitized)

    def test_check_only_rejects_mutation_before_config(self):
        for action in ("--migrate", "--stop", "--build", "--adopt-legacy-downloads"):
            with self.subTest(action=action), patch.object(launcher, "configuration") as config:
                with self.assertRaises(launcher.PreflightError):
                    launcher.main(["--check-only", action])
                config.assert_not_called()

    def test_check_only_does_not_supervise_or_migrate(self):
        with patch.object(launcher, "configuration", return_value={}), patch.object(launcher, "validate_paths"), \
             patch.object(launcher, "database_preflight", return_value={"schema_current": True}) as database, \
             patch.object(launcher, "port_is_free", return_value=False), patch.object(launcher, "supervise") as start:
            self.assertEqual(launcher.main(["--check-only"]), 0)
            self.assertFalse(database.call_args.kwargs["migrate"])
            start.assert_not_called()

    def test_pending_versions_cannot_be_allowed_on_launch(self):
        with self.assertRaises(launcher.PreflightError):
            launcher.main(["--allow-pending-migrations"])

    def test_native_profile_is_explicit_and_separate_from_compatibility_rollback(self):
        compatibility = launcher.resolve_profile_paths(launcher.parser().parse_args([]))
        native = launcher.resolve_profile_paths(launcher.parser().parse_args(["--runtime-profile", "native"]))
        self.assertEqual(compatibility.runtime_profile, "compatibility")
        self.assertEqual(compatibility.manifest.name, "owner.json")
        self.assertEqual(native.manifest.name, "native-owner.json")
        self.assertNotEqual(native.rust_binary, compatibility.rust_binary)
        self.assertIn("native-candidate", str(native.rust_binary))
        self.assertEqual(native.rust_admin_binary.parent, native.rust_binary.parent)
        commands = launcher.child_commands(native, {})
        self.assertEqual(set(commands), {"research", "api"})
        self.assertEqual(commands["research"][0], str(native.rust_research_binary))
        self.assertNotIn("api_command_worker", json.dumps(commands))
        self.assertNotIn("trading_workspace_v2.worker", json.dumps(commands))

    def test_native_admin_owns_schema_check_and_migration_not_python_domain(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(["--runtime-profile", "native"]))
        complete = MagicMock(returncode=0, stdout=json.dumps({"schema_current": True, "pending": [], "migration_count": 1}))
        with patch.object(launcher.subprocess, "run", return_value=complete) as run, \
             patch("trading_workspace_v2.migrations.apply_migrations") as python_migrate:
            self.assertTrue(launcher.native_database_preflight(args, {"TW_V2_DATABASE_URL":"fixture"})["schema_current"])
            self.assertEqual(run.call_args.args[0], [str(args.rust_admin_binary), "check"])
            python_migrate.assert_not_called()
        args.migrate = args.backup_confirmed = True
        complete.stdout = json.dumps({"applied": ["0001_fixture.sql"]})
        with patch.object(launcher.subprocess, "run", return_value=complete) as run, patch.object(launcher, "active_jobs_preflight") as idle:
            self.assertTrue(launcher.native_database_preflight(args, {})["schema_current"])
            idle.assert_called_once()
            self.assertEqual(run.call_args.args[0], [str(args.rust_admin_binary), "migrate", "--backup-confirmed"])

    def test_native_admin_pending_corrupt_failed_receipts_never_start(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(["--runtime-profile", "native"]))
        for code, output in [(0, "{}"), (0, "[]"), (0, "not json"), (1, "fixture-sensitive-driver-output"),
                             (0, json.dumps({"schema_current":False,"pending":["0002.sql"]}))]:
            with self.subTest(output=output), patch.object(launcher.subprocess,"run",return_value=MagicMock(returncode=code,stdout=output)):
                with self.assertRaises(launcher.PreflightError) as error:
                    launcher.native_database_preflight(args,{})
                self.assertNotIn("fixture-sensitive", str(error.exception))

    def test_native_check_only_uses_native_schema_and_never_launches(self):
        with patch.object(launcher,"configuration",return_value={}), patch.object(launcher,"validate_paths"), \
             patch.object(launcher,"native_database_preflight",return_value={"schema_current":True}) as native, \
             patch.object(launcher,"database_preflight") as compatibility, patch.object(launcher,"supervise") as start:
            self.assertEqual(launcher.main(["--runtime-profile","native","--download-engine","none","--check-only"]),0)
            native.assert_called_once()
            compatibility.assert_not_called()
            start.assert_not_called()

    def test_native_disallows_implicit_legacy_adoption_and_stop_actions(self):
        for arguments in [["--runtime-profile","native","--adopt-legacy-downloads"], ["--stop","--build"], ["--stop","--migrate"]]:
            with self.subTest(arguments=arguments), patch.object(launcher,"configuration") as config:
                with self.assertRaises(launcher.PreflightError): launcher.main(arguments)
                config.assert_not_called()

    def test_worker_readiness_requires_nonce_pid_identity_and_liveness(self):
        with tempfile.TemporaryDirectory() as folder:
            ready = Path(folder)/"owned.ready.json"
            child = MagicMock(pid=42)
            child.poll.return_value = None
            identity = {"pid":42,"created":111,"executable":"fixture.exe"}
            value = {"schema":"research-worker-ready-v1","worker_id":"fixture-worker","pid":42,"startup_token":"fixture-token"}
            ready.write_text(json.dumps(value),encoding="utf-8")
            with patch.object(launcher,"process_identity",return_value=identity):
                self.assertTrue(launcher.native_worker_ready(ready,"fixture-token","fixture-worker",child,identity))
                self.assertFalse(launcher.native_worker_ready(ready,"wrong-token","fixture-worker",child,identity))
                self.assertFalse(launcher.native_worker_ready(ready,"fixture-token","other-worker",child,identity))
                child.poll.return_value = 0
                self.assertFalse(launcher.native_worker_ready(ready,"fixture-token","fixture-worker",child,identity))
            child.poll.return_value = None
            with patch.object(launcher,"process_identity",return_value={**identity,"created":222}):
                self.assertFalse(launcher.native_worker_ready(ready,"fixture-token","fixture-worker",child,identity))

    def test_native_manifest_requires_exact_profile_roles_binary_and_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ("api.exe","research.exe"):
                (root/name).write_bytes(name.encode())
            args = launcher.resolve_profile_paths(launcher.parser().parse_args(["--runtime-profile","native","--manifest",str(root/"owner.json"),
                "--rust-binary",str(root/"api.exe"),"--rust-research-binary",str(root/"research.exe")]))
            roles = {"supervisor":str(Path(sys.executable).resolve()),"api":str((root/"api.exe").resolve()),"research":str((root/"research.exe").resolve())}
            identities = {role:{"pid":index,"created":index*100,"executable":path} for index,(role,path) in enumerate(roles.items(),start=100)}
            value = {"schema":"api-platform-runtime-v2","runtime_profile":"native","project":str(launcher.PROJECT.resolve()),"port":args.port,
                "run_id":"a"*32,"stop_file":str((root/f"platform-{'a'*32}.stop").resolve()),"processes":identities,
                "executable_sha256":{role:launcher.binary_digest(Path(path)) for role,path in roles.items()}}
            args.manifest.write_text(json.dumps(value),encoding="utf-8")
            with patch.object(launcher,"process_identity",side_effect=lambda pid: next(v for v in identities.values() if v["pid"]==pid)):
                self.assertEqual(launcher.owned_manifest(args)[0],value)
                (root/"research.exe").write_bytes(b"changed")
                with self.assertRaises(launcher.PreflightError): launcher.owned_manifest(args)
            args.runtime_profile = "compatibility"
            with self.assertRaises(launcher.PreflightError): launcher.owned_manifest(args)

    def test_build_refuses_overwriting_live_owned_binary(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = launcher.resolve_profile_paths(launcher.parser().parse_args(["--manifest",str(root/"owner.json"),"--rust-binary",str(root/"release/api.exe")]))
            identity = {"pid":42,"created":123,"executable":str(args.rust_binary.resolve())}
            args.manifest.write_text(json.dumps({"processes":{"api":identity}}),encoding="utf-8")
            with patch.object(launcher,"process_identity",return_value=identity), patch.object(launcher.subprocess,"run") as run:
                with self.assertRaises(launcher.PreflightError): launcher.build_candidate(args)
                run.assert_not_called()

    def test_legacy_active_job_is_found_in_both_provider_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for provider in ("qdm", "dukascopy"):
                checkpoint = root / provider / "workspace" / "job-id" / "job.json"
                checkpoint.parent.mkdir(parents=True)
                checkpoint.write_text(json.dumps({"status": "running"}), encoding="utf-8")
                with self.assertRaises(launcher.PreflightError):
                    launcher.assert_no_legacy_download(root)
                checkpoint.write_text(json.dumps({"status": "paused"}), encoding="utf-8")
                launcher.assert_no_legacy_download(root)

    def test_corrupt_legacy_checkpoint_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "qdm").mkdir()
            (root / "qdm/job.json").write_text("invalid", encoding="utf-8")
            with self.assertRaises(launcher.PreflightError):
                launcher.assert_no_legacy_download(root)

    def test_foreign_or_recycled_pid_never_gets_shutdown_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            args = launcher.parser().parse_args(["--manifest", str(Path(folder) / "owner.json")])
            run_id = "a" * 32
            marker = Path(folder) / f"platform-{run_id}.stop"
            expected = {"pid": 321, "created": 111, "executable": str(Path(sys.executable).resolve())}
            value = {"project": str(launcher.PROJECT.resolve()), "port": args.port, "run_id": run_id,
                     "stop_file": str(marker.resolve()), "processes": {"supervisor": expected}}
            args.manifest.write_text(json.dumps(value), encoding="utf-8")
            with patch.object(launcher, "process_identity", return_value={**expected, "created": 222}):
                with self.assertRaises(launcher.PreflightError):
                    launcher.stop_owned(args)
            self.assertFalse(marker.exists())

    def test_marker_path_cannot_escape_runtime_owner_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            args = launcher.parser().parse_args(["--manifest", str(Path(folder) / "owner.json")])
            value = {"project": str(launcher.PROJECT.resolve()), "port": args.port, "run_id": "b" * 32,
                     "stop_file": str(Path(folder).parent / "foreign.stop"), "processes": {}}
            args.manifest.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaises(launcher.PreflightError):
                launcher.owned_manifest(args)

    @unittest.skipUnless(sys.platform == "win32", "Win32 process identity")
    def test_live_self_process_identity_is_stable(self):
        import os
        first = launcher.process_identity(os.getpid())
        self.assertEqual(first, launcher.process_identity(os.getpid()))
        self.assertGreater(first["created"], 0)
        self.assertTrue(Path(first["executable"]).is_file())

    @unittest.skipUnless(sys.platform == "win32", "Win32 exited process identity")
    def test_exited_process_with_retained_handle_is_not_live(self):
        import subprocess
        child = subprocess.Popen([sys.executable, "-c", "pass"], creationflags=subprocess.CREATE_NO_WINDOW)
        child.wait(timeout=10)
        self.assertIsNone(launcher.process_identity(child.pid))

    @unittest.skipUnless(sys.platform == "win32", "Win32 profile lock")
    def test_second_supervisor_cannot_take_same_profile_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder) / "owner.json"
            with launcher.runtime_lock(manifest):
                with self.assertRaises(launcher.PreflightError):
                    with launcher.runtime_lock(manifest):
                        self.fail("second supervisor acquired the runtime lock")
            with launcher.runtime_lock(manifest):
                pass


if __name__ == "__main__":
    unittest.main()
