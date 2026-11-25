"""Restart guards must remain read-only and must reject foreign/recycled processes."""
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location("platform_launcher", Path(__file__).resolve().parents[1] / "scripts/run_api_platform.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class RuntimeReadinessTests(unittest.TestCase):
    def run_monitor(self, probes, *, initially_ready=True, expect_exit=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            args = launcher.parser().parse_args(['--runtime-profile', 'native', '--manifest', str(root / 'owner.json')])
            stop = root / 'owned.stop'
            state = {'ready': initially_ready, 'run_id': 'owned-run', 'processes': {'api': {'pid': 42}}}
            child = MagicMock()
            child.poll.return_value = None
            values, writes, clock = iter(probes), [], [0.0]
            def probe(_args):
                value = next(values)
                if value == 'stop':
                    stop.write_text('stop')
                    return True
                if value == 'exit':
                    child.poll.return_value = 1
                    return True
                return value
            def record(path, value):
                self.assertEqual(path, args.manifest)
                writes.append(json.loads(json.dumps(value)))
            with patch.object(launcher, 'api_ready', side_effect=probe), \
                 patch.object(launcher, 'manifest_write', side_effect=record), \
                 patch.object(launcher.time, 'monotonic', side_effect=lambda: clock[0]), \
                 patch.object(launcher.time, 'sleep', side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)):
                if expect_exit:
                    with self.assertRaises(launcher.PreflightError):
                        launcher.monitor_owned_runtime(args, state, {'api': child}, stop)
                else:
                    launcher.monitor_owned_runtime(args, state, {'api': child}, stop)
            return state, writes, child

    def test_hung_live_child_degrades_and_recovers_without_restart_or_repeated_writes(self):
        state, writes, child = self.run_monitor([False, False, False, False, True, True, 'stop'])
        self.assertEqual([item['ready'] for item in writes], [False, True])
        self.assertEqual(writes[0]['readiness_reason'], 'api_readiness_unavailable')
        self.assertNotIn('readiness_reason', writes[1])
        self.assertEqual(state['run_id'], 'owned-run')
        self.assertEqual(state['processes'], {'api': {'pid': 42}})
        child.kill.assert_not_called()
        child.terminate.assert_not_called()

    def test_transient_failure_does_not_degrade_and_stop_during_probe_cannot_recover(self):
        state, writes, _ = self.run_monitor([False, False, True, 'stop'])
        self.assertTrue(state['ready'])
        self.assertEqual(writes, [])
        state, writes, _ = self.run_monitor(['stop'], initially_ready=False)
        self.assertFalse(state['ready'])
        self.assertEqual(writes, [])

    def test_child_exit_during_probe_cannot_publish_recovery(self):
        state, writes, child = self.run_monitor(['exit'], initially_ready=False, expect_exit=True)
        self.assertFalse(state['ready'])
        self.assertEqual(writes, [])
        child.kill.assert_not_called()

    def test_repeated_outages_only_publish_transitions_and_never_restart_children(self):
        cycle = [False] * 12 + [True] * 6
        state, writes, child = self.run_monitor(cycle * 64 + ['stop'])
        self.assertEqual([item['ready'] for item in writes], [False, True] * 64)
        self.assertTrue(state['ready'])
        self.assertEqual(state['run_id'], 'owned-run')
        child.kill.assert_not_called()
        child.terminate.assert_not_called()

    def test_readiness_timeout_or_invalid_profile_response_is_unhealthy(self):
        args = launcher.parser().parse_args(['--runtime-profile', 'native'])
        with patch.object(launcher.urllib.request, 'urlopen', side_effect=TimeoutError):
            self.assertFalse(launcher.api_ready(args))
        for body, expected in [('[]', False), ('invalid', False), ('{"ok": true}', False),
                               ('{"ok": true, "command_worker": "not_required"}', True)]:
            with self.subTest(body=body), patch.object(launcher.urllib.request, 'urlopen', return_value=io.StringIO(body)):
                self.assertEqual(launcher.api_ready(args), expected)

    def test_supervisor_stop_during_startup_never_publishes_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            args = launcher.parser().parse_args(['--manifest', str(Path(folder) / 'owner.json'),
                '--worktree-runtime-root', folder, '--artifact-root', str(Path(folder) / 'artifacts')])
            child = MagicMock(pid=42)
            child.poll.return_value = None
            capability = str(Path(folder) / 'private-capabilities.json')
            env = {'TW_V2_AUTH_MODE': 'local-capability', 'TW_V2_LOCAL_CAPABILITY_FILE': capability}
            writes = []
            def probe(_args):
                Path(env['TW_V2_SHUTDOWN_FILE']).write_text('stop')
                child.poll.return_value = 0
                return True
            with patch.object(launcher, 'port_is_free', return_value=True), \
                 patch.object(launcher, 'child_commands', return_value={'api': ['fixture']}), \
                 patch.object(launcher, 'process_identity', side_effect=lambda pid: {'pid': pid, 'executable': 'fixture.exe'}), \
                 patch.object(launcher, 'binary_digest', return_value='fixture-hash'), \
                 patch.object(launcher, 'worker_ready', return_value=True), \
                 patch.object(launcher.subprocess, 'Popen', return_value=child), \
                 patch.object(launcher.threading, 'Thread'), \
                 patch.object(launcher, 'api_ready', side_effect=probe), \
                 patch.object(launcher, 'manifest_write', side_effect=lambda _path, state: writes.append(json.loads(json.dumps(state)))), \
                 patch.object(launcher, 'monitor_owned_runtime') as monitor:
                with self.assertRaisesRegex(launcher.PreflightError, 'shutdown requested'):
                    launcher.supervise(args, env)
            self.assertTrue(all(item['ready'] is False for item in writes))
            self.assertTrue(any(item.get('stopping') for item in writes))
            self.assertTrue(writes[-1]['stopped'])
            self.assertFalse(writes[-1]['stopping'])
            self.assertTrue(all(item['auth_mode'] == 'local-capability' for item in writes))
            self.assertTrue(all(item['local_capability_file'] == capability for item in writes))
            self.assertTrue(all(item['worktree_runtime'] == {
                'root': str(Path(folder).resolve()), 'database_name': args.database_name,
                'artifact_root': str(args.artifact_root.resolve())} for item in writes))
            child.wait.assert_called_once()
            child.kill.assert_not_called()
            monitor.assert_not_called()


class LocalCapabilityLauncherTests(unittest.TestCase):
    def test_default_profiles_strip_inherited_capability_and_keep_legacy_auth(self):
        for profile in ('native', 'compatibility'):
            args = launcher.parser().parse_args(['--runtime-profile', profile])
            with self.subTest(profile=profile), patch.dict('os.environ', {
                    'TW_V2_DATABASE_URL': 'host=localhost user=fixture',
                    'TW_V2_AUTH_MODE': 'local-capability',
                    'TW_V2_LOCAL_CAPABILITY_FILE': 'stale-private-config.json'}):
                env = launcher.configuration(args)
            self.assertEqual(env['TW_V2_AUTH_MODE'], 'local-trusted-identity')
            self.assertNotIn('TW_V2_LOCAL_CAPABILITY_FILE', env)

    def test_explicit_native_file_selects_capability_mode_without_reading_secret_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            config = project / '.runtime/local-owner-access/generation-fixture/capabilities.json'
            config.parent.mkdir(parents=True)
            config.write_bytes(b'opaque-private-config-never-printed')
            args = launcher.parser().parse_args(['--runtime-profile', 'native',
                '--local-capability-file', str(config)])
            with patch.object(launcher, 'PROJECT', project), patch.dict('os.environ', {
                    'TW_V2_DATABASE_URL': 'host=localhost user=fixture',
                    'TW_V2_LOCAL_CAPABILITY_FILE': 'stale-other-config'}), \
                 patch.object(Path, 'read_text', side_effect=AssertionError('launcher must not read secrets')):
                env = launcher.configuration(args)
            self.assertEqual(env['TW_V2_AUTH_MODE'], 'local-capability')
            self.assertEqual(env['TW_V2_LOCAL_CAPABILITY_FILE'], str(config))
            self.assertEqual(config.read_bytes(), b'opaque-private-config-never-printed')

    def test_compatibility_selection_is_rejected_before_build_or_other_actions(self):
        with patch.object(launcher, 'configuration') as config, \
             patch.object(launcher, 'build_candidate') as build:
            with self.assertRaisesRegex(launcher.PreflightError, 'native runtime profile'):
                launcher.main(['--local-capability-file', 'private.json', '--build-only'])
            config.assert_not_called()
            build.assert_not_called()

    def test_private_scope_size_links_and_runtime_output_collisions_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            private = project / '.runtime/local-owner-access/generation-fixture'
            private.mkdir(parents=True)
            capability = private / 'capabilities.json'
            capability.write_bytes(b'{}')
            outside = project / 'source.json'
            outside.write_bytes(b'keep')
            huge = private / 'large.json'
            huge.write_bytes(b'x' * (64 * 1024 + 1))
            empty = private / 'empty.json'
            empty.touch()
            for path in (outside, huge, empty, private / 'missing.json', private):
                args = launcher.parser().parse_args(['--runtime-profile', 'native', '--local-capability-file', str(path)])
                with self.subTest(path=path), patch.object(launcher, 'PROJECT', project):
                    with self.assertRaises(launcher.PreflightError):
                        launcher.local_capability_file(args)
            for output in (capability, capability.with_name(capability.name + '.bootstrap-spent.json')):
                args = launcher.parser().parse_args(['--runtime-profile', 'native',
                    '--local-capability-file', str(capability), '--manifest', str(output)])
                with self.subTest(output=output), patch.object(launcher, 'PROJECT', project):
                    with self.assertRaises(launcher.PreflightError):
                        launcher.local_capability_file(args)
            args = launcher.parser().parse_args(['--runtime-profile', 'native', '--local-capability-file', str(capability)])
            with patch('scripts.local_owner_access.require_local_tree', side_effect=ValueError('reparse')):
                with self.assertRaises(launcher.PreflightError):
                    launcher.local_capability_file(args)
            lock_input = private / 'capabilities.lock'
            lock_input.write_bytes(b'{}')
            args = launcher.parser().parse_args(['--runtime-profile', 'native',
                '--local-capability-file', str(lock_input), '--manifest', str(private / 'capabilities.json')])
            with patch.object(launcher, 'PROJECT', project):
                with self.assertRaises(launcher.PreflightError):
                    launcher.local_capability_file(args)
            self.assertEqual(outside.read_bytes(), b'keep')
            self.assertEqual(capability.read_bytes(), b'{}')


class LauncherTests(unittest.TestCase):
    def setUp(self):
        # These fixtures exercise the unchanged primary-checkout contract;
        # linked checkout admission is covered separately below.
        guard = patch.object(launcher, 'linked_worktree', return_value=False)
        guard.start()
        self.addCleanup(guard.stop)

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


class LinkedWorktreeIsolationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.project = self.root / 'project'
        self.metadata = self.root / 'metadata' / 'worktrees' / 'child'
        self.project.mkdir()
        self.metadata.mkdir(parents=True)
        (self.project / '.git').write_text('gitdir: ' + self.metadata.as_posix())
        (self.metadata / 'HEAD').write_text('ref: refs/heads/fixture\n')
        (self.metadata / 'commondir').write_text('../..')
        self.runtime = self.root / 'private-runtime'
        for name, value in (('PROJECT', self.project), ('FOUNDATION', self.project / 'foundation_v2')):
            change = patch.object(launcher, name, value)
            change.start()
            self.addCleanup(change.stop)

    def selection(self, *extra):
        return ['--runtime-profile', 'native', '--download-engine', 'none',
                '--worktree-runtime-root', str(self.runtime), '--database-name', 'lane_fixture',
                '--port', '19081', *extra]

    def test_defaults_cannot_reach_inherited_database_from_linked_worktree(self):
        with patch.object(launcher, 'configuration', return_value={}) as config, \
             patch.object(launcher, 'validate_paths'), \
             patch.object(launcher, 'native_database_preflight', return_value={}) as database, \
             patch.object(launcher, 'port_is_free', return_value=True):
            with self.assertRaises(launcher.PreflightError):
                launcher.main(['--runtime-profile', 'native', '--download-engine', 'none', '--check-only'])
            config.assert_not_called()
            database.assert_not_called()

    def test_external_runtime_root_rebases_outputs_without_creating_or_connecting(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection()))
        self.assertEqual(args.artifact_root, self.runtime / 'artifacts')
        self.assertEqual(args.manifest, self.runtime / 'api-platform/native-owner.json')
        self.assertTrue(args.rust_binary.is_relative_to(self.runtime / 'target'))
        with patch.object(launcher, 'configuration') as config, \
             patch.object(launcher, 'build_candidate') as build, \
             patch.object(launcher, 'supervise') as supervise, \
             patch.object(launcher, 'port_is_free') as port:
            self.assertEqual(launcher.main(self.selection('--check-isolation-only')), 0)
        config.assert_not_called()
        build.assert_not_called()
        supervise.assert_not_called()
        port.assert_not_called()
        self.assertFalse(self.runtime.exists())

    def test_build_only_requires_output_isolation_but_not_database_or_port(self):
        with patch.object(launcher, 'configuration') as config, patch.object(launcher, 'build_candidate') as build:
            self.assertEqual(launcher.main(['--runtime-profile', 'native', '--build-only',
                                          '--worktree-runtime-root', str(self.runtime)]), 0)
            self.assertTrue(build.call_args.args[0].rust_binary.is_relative_to(self.runtime))
            config.assert_not_called()
        with patch.object(launcher, 'build_candidate') as build:
            with self.assertRaises(launcher.PreflightError):
                launcher.main(['--build-only'])
            build.assert_not_called()

    def test_relative_output_selections_are_bound_before_child_working_directory_changes(self):
        with patch('os.getcwd', return_value=str(self.project)):
            args = launcher.resolve_profile_paths(launcher.parser().parse_args([
                '--build-only', '--worktree-runtime-root', '.artifacts/private',
                '--rust-binary', '.artifacts/private/target/release/trading-workspace-api.exe']))
            launcher.worktree_isolation_preflight(args)
        self.assertEqual(args.worktree_runtime_root, self.project / '.artifacts/private')
        self.assertTrue(all(getattr(args, name).is_absolute() for name in
                            ('manifest', 'artifact_root', 'rust_binary', 'rust_admin_binary', 'rust_research_binary')))
        with patch.object(launcher.subprocess, 'run') as run:
            launcher.build_candidate(args)
        command = run.call_args.args[0]
        self.assertEqual(command[command.index('--target-dir') + 1],
                         str(self.project / '.artifacts/private/target'))

    def test_default_and_ambiguous_database_names_or_port_are_rejected(self):
        for option, value in (('--port', '8010'), ('--database-name', 'trading_workspace_v2_exness_history'),
                              ('--database-name', ''), ('--database-name', 'a' * 64),
                              ('--database-name', 'postgres'), ('--database-name', 'name with spaces')):
            with self.subTest(option=option, value=value), patch.object(launcher, 'configuration') as config:
                with self.assertRaises(launcher.PreflightError):
                    launcher.main(self.selection(option, value, '--check-only'))
                config.assert_not_called()

    def test_runtime_check_can_intentionally_use_its_selected_database_in_dsn(self):
        from psycopg.conninfo import conninfo_to_dict
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection()))
        launcher.worktree_isolation_preflight(args)
        inherited = {'TW_V2_DATABASE_URL': 'host=localhost dbname=lane_fixture user=fixture',
                     'TW_V2_MT5_ADAPTER_ROOT': 'foreign-adapter', 'TW_V2_MT5_TERMINAL': 'foreign-terminal',
                     'TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY': 'foreign-scientific',
                     'TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY': 'foreign-codec',
                     'TW_AI_WORKFLOW_PYTHON': 'foreign-workflow'}
        with patch.dict('os.environ', inherited), patch('psycopg.connect') as connect:
            env = launcher.configuration(args)
            connect.assert_not_called()
        self.assertEqual(conninfo_to_dict(env['TW_V2_DATABASE_URL'])['dbname'], 'lane_fixture')
        self.assertEqual(env['TW_V2_MT5_ADAPTER_ROOT'], str(launcher.FOUNDATION.resolve()))
        self.assertEqual(env['TW_V2_SCIENTIFIC_ADAPTER_ROOT'], str(launcher.FOUNDATION.resolve()))
        for key in ('TW_V2_MT5_TERMINAL', 'TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY',
                    'TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY', 'TW_AI_WORKFLOW_PYTHON'):
            self.assertNotIn(key, env)
        self.assertEqual(env['TW_V2_ARTIFACT_ROOT'], str(args.artifact_root.resolve()))

    def test_explicit_capabilities_stay_selected_in_isolated_profile(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection(
            '--scientific-capability', str(self.runtime / 'scientific.json'),
            '--legacy-codec-capability', str(self.runtime / 'codec.json'))))
        with patch.dict('os.environ', {'TW_V2_DATABASE_URL': 'host=localhost user=fixture'}):
            env = launcher.configuration(args)
        self.assertEqual(env['TW_V2_SCIENTIFIC_ADAPTER_CAPABILITY'], str((self.runtime / 'scientific.json').resolve()))
        self.assertEqual(env['TW_V2_LEGACY_PARQUET_CODEC_CAPABILITY'], str((self.runtime / 'codec.json').resolve()))

    def test_dirty_ai_environment_is_disabled_without_shared_account_or_mcp_bindings(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection()))
        dirty = {'TW_V2_DATABASE_URL': 'host=localhost dbname=lane_fixture user=fixture',
                 'TW_CHATGPT_WEB_HOME': str(self.root / 'foreign-home'),
                 'TW_CHATGPT_WEB_CORE': str(self.root / 'foreign-core'),
                 'TW_CHATGPT_WEB_BUN': str(self.root / 'foreign-bun.exe'),
                 'TW_CHATGPT_WEB_PORT': '17851', 'TW_AI_INTEGRATIONS_DISABLED': '0',
                 'TW_AI_GATEWAY_BASE_URL': 'http://127.0.0.1:17852/v1',
                 'TW_AI_GATEWAY_KEY_FILE': str(self.root / 'foreign-inference.key'),
                 'TW_AI_GATEWAY_MODEL': 'external-model', 'TW_AI_PROVIDER': 'local-gateway',
                 'TW_MT5_MCP_CONFIG': str(self.root / 'foreign-mcp.json'),
                 'TW_MT5_MCP_KEY_FIXTURE': 'fixture-not-a-real-credential'}
        with patch.dict('os.environ', dirty), patch.object(Path, 'read_bytes', side_effect=AssertionError('no credential reads')):
            env = launcher.configuration(args)
            self.assertEqual(launcher.os.environ['TW_AI_INTEGRATIONS_DISABLED'], '0')
            self.assertEqual(launcher.os.environ['TW_CHATGPT_WEB_HOME'], dirty['TW_CHATGPT_WEB_HOME'])
        for key in ('TW_CHATGPT_WEB_HOME', 'TW_CHATGPT_WEB_CORE', 'TW_CHATGPT_WEB_BUN', 'TW_AI_GATEWAY_KEY_FILE'):
            self.assertTrue(Path(env[key]).is_relative_to(self.runtime))
        for key in ('TW_CHATGPT_WEB_PORT', 'TW_AI_GATEWAY_BASE_URL', 'TW_AI_GATEWAY_MODEL',
                    'TW_AI_PROVIDER', 'TW_MT5_MCP_CONFIG', 'TW_MT5_MCP_KEY_FIXTURE'):
            self.assertNotIn(key, env)
        self.assertEqual(env['TW_AI_INTEGRATIONS_DISABLED'], '1')
        self.assertFalse(self.runtime.exists())

    def test_primary_configuration_keeps_explicit_ai_integration_environment(self):
        args = launcher.parser().parse_args([])
        original = {'TW_V2_DATABASE_URL': 'host=localhost user=fixture',
                    'TW_CHATGPT_WEB_HOME': str(self.root / 'owner-home'),
                    'TW_AI_GATEWAY_BASE_URL': 'http://127.0.0.1:17852/v1',
                    'TW_AI_GATEWAY_KEY_FILE': str(self.root / 'owner-key'),
                    'TW_MT5_MCP_CONFIG': str(self.root / 'owner-mcp.json')}
        with patch.dict('os.environ', original, clear=True):
            env = launcher.configuration(args)
        for key, value in original.items():
            if key != 'TW_V2_DATABASE_URL':
                self.assertEqual(env[key], value)
        self.assertNotIn('TW_AI_INTEGRATIONS_DISABLED', env)

    def test_foreign_checkout_and_output_escapes_fail_before_build_or_database(self):
        foreign = self.root / 'foreign-project'
        foreign.mkdir()
        (foreign / '.git').mkdir()
        for arguments in (self.selection('--artifact-root', str(foreign / 'data')),
                          self.selection('--manifest', str(foreign / 'owner.json')),
                          self.selection('--rust-binary', str(foreign / 'release/api.exe')),
                          self.selection('--worktree-runtime-root', str(foreign / '.runtime')),
                          self.selection('--worktree-runtime-root', str(self.project))):
            with self.subTest(arguments=arguments), patch.object(launcher, 'configuration') as config, \
                 patch.object(launcher, 'build_candidate') as build:
                with self.assertRaises(launcher.PreflightError):
                    launcher.main([*arguments, '--build'])
                config.assert_not_called()
                build.assert_not_called()

    def test_manifest_binds_project_database_artifacts_port_and_runtime_root(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection()))
        args.manifest.parent.mkdir(parents=True)
        owner = {'project': str(self.project), 'port': args.port, 'runtime_profile': args.runtime_profile,
                 'worktree_runtime': {'root': str(self.runtime), 'database_name': args.database_name,
                                      'artifact_root': str(args.artifact_root.resolve())}}
        args.manifest.write_text(json.dumps(owner))
        self.assertTrue(launcher.worktree_isolation_preflight(args)['isolated_runtime'])
        for section, field, value in ((None, 'project', str(self.root / 'foreign')),
                                      (None, 'port', 19082), ('worktree_runtime', 'database_name', 'foreign'),
                                      ('worktree_runtime', 'root', str(self.root / 'foreign')),
                                      ('worktree_runtime', 'artifact_root', str(self.root / 'foreign'))):
            changed = json.loads(json.dumps(owner))
            (changed if section is None else changed[section])[field] = value
            args.manifest.write_text(json.dumps(changed))
            with self.subTest(field=field), self.assertRaises(launcher.PreflightError):
                launcher.worktree_isolation_preflight(args)

    def test_link_or_junction_in_output_tree_is_rejected(self):
        args = launcher.resolve_profile_paths(launcher.parser().parse_args(self.selection()))
        with patch('scripts.local_owner_access.require_local_tree', side_effect=ValueError('reparse')):
            with self.assertRaises(launcher.PreflightError):
                launcher.worktree_isolation_preflight(args)

    def test_primary_submodule_gitfile_keeps_the_existing_launcher_contract(self):
        (self.metadata / 'commondir').unlink()
        (self.metadata / 'config').write_text('[core]\n bare = false\n')
        (self.metadata / 'objects').mkdir()
        args = launcher.resolve_profile_paths(launcher.parser().parse_args([]))
        self.assertEqual(launcher.worktree_isolation_preflight(args),
                         {'linked_worktree': False, 'isolated_runtime': False})

    def test_malformed_gitfile_fails_before_any_configuration(self):
        (self.project / '.git').write_text('not a gitdir')
        with patch.object(launcher, 'configuration') as config:
            with self.assertRaises(launcher.PreflightError):
                launcher.main(self.selection('--check-only'))
            config.assert_not_called()

    def test_missing_gitdir_or_head_cannot_fall_back_to_primary_checkout_defaults(self):
        for problem in ('missing-gitdir', 'missing-head', 'empty-head', 'invalid-head', 'missing-commondir'):
            (self.project / '.git').write_text('gitdir: ' + self.metadata.as_posix())
            (self.metadata / 'HEAD').write_text('ref: refs/heads/fixture\n')
            (self.metadata / 'commondir').write_text('../..')
            if problem == 'missing-gitdir':
                (self.project / '.git').write_text('gitdir: ' + (self.root / 'missing-metadata').as_posix())
            elif problem == 'missing-head':
                (self.metadata / 'HEAD').unlink()
            elif problem == 'missing-commondir':
                (self.metadata / 'commondir').unlink()
            else:
                (self.metadata / 'HEAD').write_text('' if problem == 'empty-head' else 'unrecognized')
            with self.subTest(problem=problem), patch.object(launcher, 'configuration') as config, \
                 patch.object(launcher, 'build_candidate') as build:
                with self.assertRaises(launcher.PreflightError):
                    launcher.main(['--check-only'])
                config.assert_not_called()
                build.assert_not_called()

    @unittest.skipUnless(shutil.which('pwsh') or shutil.which('powershell'), 'PowerShell wrapper')
    def test_wrapper_passes_one_root_and_checks_isolation_before_owner_or_listener_access(self):
        scripts = self.project / 'scripts'
        scripts.mkdir()
        python = self.project / 'foundation_v2/.venv/Scripts/python.exe'
        python.parent.mkdir(parents=True)
        python.touch()
        entry = self.project / 'foundation_v2/scripts/run_api_platform.py'
        entry.parent.mkdir(parents=True)
        entry.touch()
        source = Path(__file__).resolve().parents[2] / 'scripts/restart_offline_api.ps1'
        code = source.read_text(encoding='utf-8')
        # Exercise the actual wrapper's argument construction and ordering, then
        # stop at its first launcher call. No executable, listener or DB is used.
        interception = '''
function Invoke-Platform([string[]]$ActionArgs) {
    Write-Output ('FIXTURE:' + (@{profile=$profileArgs; action=$ActionArgs} | ConvertTo-Json -Compress))
    throw 'fixture_stop_before_actions'
}
function Resolve-LocalCapabilityFile { throw 'owner_access_before_isolation' }
function Get-OfflineListener { throw 'listener_access_before_isolation' }
'''
        code = code.replace('try {\n    if ($CheckOnly', interception + '\ntry {\n    if ($CheckOnly', 1)
        wrapper = scripts / 'restart_offline_api.ps1'
        wrapper.write_text(code, encoding='utf-8')
        completed = subprocess.run([shutil.which('pwsh') or shutil.which('powershell'),
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(wrapper),
            '-CheckOnly', '-RuntimeProfile', 'native', '-WorktreeRuntimeRoot', str(self.runtime),
            '-DatabaseName', 'lane_fixture', '-Port', '19081', '-DownloadEngine', 'none'],
            capture_output=True, text=True, timeout=20,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(completed.returncode, 1)
        lines = [line for line in completed.stdout.splitlines() if line.startswith('FIXTURE:')]
        self.assertEqual(len(lines), 1, completed.stdout)
        call = json.loads(lines[0].removeprefix('FIXTURE:'))
        self.assertEqual(call['action'], ['--check-isolation-only'])
        profile = dict(zip(call['profile'][::2], call['profile'][1::2]))
        self.assertEqual(Path(profile['--worktree-runtime-root']), self.runtime)
        for key in ('--artifact-root', '--manifest', '--rust-binary', '--rust-admin-binary', '--rust-research-binary'):
            self.assertTrue(Path(profile[key]).is_relative_to(self.runtime))
        self.assertIn('fixture_stop_before_actions', completed.stdout)
        self.assertNotIn('owner_access_before_isolation', completed.stdout)
        self.assertNotIn('listener_access_before_isolation', completed.stdout)
        self.assertFalse(self.runtime.exists())


if __name__ == "__main__":
    unittest.main()
