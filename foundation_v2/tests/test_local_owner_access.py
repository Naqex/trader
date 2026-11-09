from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


V2 = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_owner_access_cli', V2 / 'scripts/local_owner_access.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)
NOW = datetime(2026, 11, 3, 4, 5, 6, tzinfo=timezone.utc)
ORIGINS = ['http://127.0.0.1:5180', 'http://127.0.0.1:8010']


class LocalOwnerAccessTests(unittest.TestCase):
    def test_private_generation_contract_hashes_expiries_and_nonsecret_stdout(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            output = project / '.runtime/local-owner-access'
            prepare = cli.prepare
            with mock.patch.object(cli, 'prepare', side_effect=lambda path, origins, rotate=False:
                    prepare(path, origins, rotate=rotate, project_root=project, now=NOW)):
                stdout = io.StringIO()
                with contextlib.redirect_stdout(stdout):
                    code = cli.main(['prepare', '--output', str(output),
                        '--origin', ORIGINS[0], '--origin', ORIGINS[1]])
            self.assertEqual(code, 0)
            result = json.loads(stdout.getvalue())
            config = json.loads(Path(result['config_path']).read_text())
            handoff = json.loads(Path(result['secrets_path']).read_text())
            self.assertFalse(result['activated'])
            self.assertEqual(set(config), {'allowed_origins', 'owner_bearer', 'bootstrap'})
            self.assertEqual(config['allowed_origins'], ORIGINS)
            for raw, record, hash_name in ((handoff['owner_bearer'], config['owner_bearer'], 'token_sha256'),
                    (handoff['bootstrap_nonce'], config['bootstrap'], 'nonce_sha256')):
                self.assertGreaterEqual(len(raw), 43)
                self.assertEqual(hashlib.sha256(raw.encode()).hexdigest(), record[hash_name])
                self.assertNotIn(raw, stdout.getvalue())
            for name in ('session_token', 'csrf_token'):
                self.assertGreaterEqual(len(config['bootstrap'][name]), 43)
                self.assertNotIn(config['bootstrap'][name], stdout.getvalue())
            self.assertEqual(len({handoff['owner_bearer'], handoff['bootstrap_nonce'],
                config['bootstrap']['session_token'], config['bootstrap']['csrf_token']}), 4)
            self.assertEqual(config['bootstrap']['expires_at_utc'], '2026-11-03T04:15:06Z')
            self.assertEqual(config['bootstrap']['session_expires_at_utc'], '2026-11-03T16:05:06Z')
            self.assertEqual(config['owner_bearer']['expires_at_utc'], '2026-11-10T04:05:06Z')
            self.assertFalse(list(output.glob('.pending-*')))

    def test_rotation_requires_deliberate_flag_and_keeps_old_generation_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            output = project / '.runtime/local-owner-access'
            first = cli.prepare(output, ORIGINS, project_root=project, now=NOW)
            original = {name: Path(first[name]).read_bytes() for name in ('config_path', 'secrets_path')}
            with self.assertRaisesRegex(cli.ProvisionError, '--rotate'):
                cli.prepare(output, ORIGINS, project_root=project, now=NOW)
            second = cli.prepare(output, ORIGINS, rotate=True, project_root=project, now=NOW)
            self.assertNotEqual(first['config_path'], second['config_path'])
            self.assertTrue(second['rotated'])
            for name, raw in original.items():
                self.assertEqual(Path(first[name]).read_bytes(), raw)
            self.assertEqual(len(list(output.glob('generation-*'))), 2)

    def test_rejects_nonlocal_origins_and_output_outside_owned_scope(self):
        bad = ['https://127.0.0.1:5180', 'http://localhost:5180', 'http://127.0.0.1:5180/',
            'http://127.0.0.1:0', 'http://127.0.0.1:5180?x=1', 'http://user@127.0.0.1:5180',
            ' http://127.0.0.1:5180', 'http://127.0.0.1:5180\n', 'http://0.0.0.0:5180']
        for origin in bad:
            with self.subTest(origin=origin), self.assertRaises(cli.ProvisionError):
                cli.exact_origins([origin])
        self.assertEqual(cli.exact_origins(['http://[::1]:8010']), ['http://[::1]:8010'])
        with self.assertRaises(cli.ProvisionError):
            cli.exact_origins(ORIGINS + ORIGINS)
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            target = project / 'source.json'
            target.write_bytes(b'keep source')
            with self.assertRaisesRegex(cli.ProvisionError, 'under project'):
                cli.prepare(target, ORIGINS, project_root=project)
            self.assertEqual(target.read_bytes(), b'keep source')
            with self.assertRaisesRegex(cli.ProvisionError, 'existing managed'):
                cli.prepare(project / '.runtime/local-owner-access', ORIGINS,
                    rotate=True, project_root=project)

    def test_exclusive_write_and_partial_generation_failure_do_not_replace_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            existing = project / 'input.json'
            existing.write_bytes(b'preserve')
            with self.assertRaises(FileExistsError):
                cli.write_exclusive(existing, {'secret': 'never overwrite'})
            self.assertEqual(existing.read_bytes(), b'preserve')
            output = project / '.runtime/local-owner-access'
            write = cli.write_exclusive
            def failing_write(path, value):
                if path.name == 'owner-secrets.json':
                    raise OSError('sensitive internal message')
                write(path, value)
            with mock.patch.object(cli, 'write_exclusive', side_effect=failing_write):
                with self.assertRaises(OSError):
                    cli.prepare(output, ORIGINS, project_root=project, now=NOW)
            self.assertFalse(list(output.glob('generation-*')))
            self.assertFalse(list(output.glob('.pending-*')))
            stderr = io.StringIO()
            with mock.patch.object(cli, 'prepare', side_effect=RuntimeError('SECRET-IN-ERROR')):
                with contextlib.redirect_stderr(stderr):
                    code = cli.main(['prepare', '--output', str(output), '--origin', ORIGINS[0]])
            self.assertEqual(code, 2)
            self.assertNotIn('SECRET-IN-ERROR', stderr.getvalue())

    def test_symlink_ancestor_is_refused_before_resolving(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            real = project / 'real'
            real.mkdir()
            linked = project / '.runtime'
            try:
                linked.symlink_to(real, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest('symlink creation unavailable for this user')
            with self.assertRaisesRegex(cli.ProvisionError, 'symlinks or reparse'):
                cli.prepare(linked / 'local-owner-access', ORIGINS, project_root=project)
            self.assertFalse(list(real.iterdir()))

    def test_windows_reparse_attribute_is_refused_without_following_target(self):
        info = SimpleNamespace(st_mode=0o040700, st_file_attributes=1024)
        with mock.patch.object(Path, 'lstat', return_value=info):
            with self.assertRaisesRegex(cli.ProvisionError, 'symlinks or reparse'):
                cli.require_local_tree(Path('private-output'))


if __name__ == '__main__':
    unittest.main()
