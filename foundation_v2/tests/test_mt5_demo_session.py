"""Exercise durable orchestration with a fake native API; no SDK/network/grants."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

V2 = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('demo_session', V2 / 'scripts/mt5_demo_session.py')
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)


class Crashed(BaseException):
    pass


class FakeNative:
    def __init__(self, plan, credential):
        self.plan, self.credential = plan, credential
        self.calls, self.receipts = [], {}
        self.behavior = 'filled'

    def proof(self, command, *, status='filled', volume=None):
        return dict(request_id=command['request_id'], action=command['action'],
            scope={**{k: command[k] for k in ('connection_id', 'mode', 'account_id', 'server', 'symbol')},
                   'generation': self.plan.connection_generation},
            automation=dict(grant_id=str(self.credential.grant_id), credential_id=str(self.credential.credential_id),
                            artifact_sha256=self.plan.artifact_sha256),
            status=status, requires_reconciliation=False, volume=command['volume'] if volume is None else volume,
            retcode=10009 if status == 'filled' else None, order=17 if command['action'] == 'place' else 18)

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.endswith('/commands'):
            command = body['command']
            result = self.proof(command)
            if self.behavior == 'crash_before_post':
                raise Crashed()
            if self.behavior == 'partial':
                result.update(volume=.005, requires_reconciliation=True, retcode=10010)
            if self.behavior == 'wrong_scope':
                result['scope']['generation'] += 1
            if self.behavior == 'reject':
                result.update(status='rejected', reason='demo_quote_stale')
            self.receipts[command['request_id']] = result
            if self.behavior == 'crash_after_fill':
                raise Crashed()
            if self.behavior == 'timeout_after_fill':
                raise TimeoutError()
            return 200, result
        request_id = path.rsplit('/', 1)[1] if body is None else body['request_id']
        return (200, self.receipts[request_id]) if request_id in self.receipts else (404, {})

    def sends(self):
        return [body['command'] for path, body in self.calls if path.endswith('/commands')]


class DemoSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifact = self.root / 'artifact.json'
        self.artifact.write_bytes(b'{"purpose":"system_fixture"}\n')
        self.manifest, self.credentials, self.folder = (self.root / x for x in ('plan.json', 'credential.json', 'run'))
        self.clock = datetime.now(timezone.utc)
        self.plan = dict(schema_version='mt5-demo-session-v1', api_origin='http://127.0.0.1:8010',
            workspace_id='fixture', connection_generation=11, artifact_path='artifact.json',
            artifact_sha256=hashlib.sha256(self.artifact.read_bytes()).hexdigest(),
            expires_at=(self.clock + timedelta(minutes=15)).isoformat(),
            entry=dict(request_id=str(uuid4()), connection_id=str(uuid4()), mode='demo', account_id='123',
                       server='Fixture', action='place', symbol='EURUSD', side='BUY', order_type='market',
                       volume=.01, stop_loss=1.10), close_request_id=str(uuid4()))
        self.secret = dict(grant_id=str(uuid4()), credential_id=str(uuid4()), credential='x' * 43)
        self.write_inputs()
        self.api = FakeNative(runner.Plan.model_validate(self.plan), runner.Credential.model_validate(self.secret))
        self.factory = lambda *_: self.api

    def write_inputs(self):
        self.manifest.write_bytes(runner.encoded(self.plan))
        self.credentials.write_bytes(runner.encoded(self.secret))

    def run_session(self, **kwargs):
        return runner.run(self.manifest, self.credentials, self.folder,
            client_factory=self.factory, now=lambda: self.clock, **kwargs)

    def test_one_open_close_pair_and_completed_resume_never_posts_again(self):
        result = self.run_session()
        self.assertEqual(result['status'], 'completed')
        self.assertFalse(result['requires_owner_attention'])
        self.assertEqual([c['action'] for c in self.api.sends()], ['place', 'close'])
        self.assertEqual(self.api.sends()[1]['ticket'], 17)
        self.run_session(resume=True)
        self.assertEqual(len(self.api.calls), 2)
        self.assertNotIn(self.secret['credential'], (self.folder / 'state.json').read_text())
        with self.assertRaises(FileExistsError):
            self.run_session()

    def test_crash_after_fill_recovers_same_id_and_closes_without_second_open(self):
        self.api.behavior = 'crash_after_fill'
        with self.assertRaises(Crashed):
            self.run_session()
        self.assertIsNotNone(runner.load(self.folder / 'state.json')['opening'])
        self.api.behavior = 'filled'
        result = self.run_session(resume=True)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual([c['action'] for c in self.api.sends()], ['place', 'close'])

    def test_missing_receipt_after_crash_before_post_is_never_reposted(self):
        self.api.behavior = 'crash_before_post'
        with self.assertRaises(Crashed):
            self.run_session()
        self.api.behavior = 'filled'
        result = self.run_session(resume=True)
        self.assertTrue(result['requires_owner_attention'])
        self.assertEqual(len(self.api.sends()), 1)
        self.assertTrue(self.api.calls[-1][0].endswith('/reconcile'))

    def test_timeout_recovers_receipt_without_replaying_send(self):
        self.api.behavior = 'timeout_after_fill'
        result = self.run_session()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(self.api.sends()), 2)
        self.assertEqual(result['opening']['transport_outcome'], 'unknown')

    def test_partial_or_wrong_scope_never_advances_to_close(self):
        for behavior in ('partial', 'wrong_scope'):
            self.folder = self.root / behavior
            self.api.behavior = behavior
            self.api.calls.clear()
            result = self.run_session()
            self.assertTrue(result['requires_owner_attention'])
            self.assertEqual(len(self.api.sends()), 1)
            self.assertIsNone(result['closing'])

    def test_rejection_is_blocked_without_retry_and_needs_no_close(self):
        self.api.behavior = 'reject'
        result = self.run_session()
        self.assertEqual((result['status'], result['reason']), ('blocked', 'demo_quote_stale'))
        self.assertFalse(result['requires_owner_attention'])
        self.run_session(resume=True)
        self.assertEqual(len(self.api.calls), 1)

    def test_expiry_stop_and_reconcile_mode_never_create_new_sends(self):
        self.clock += timedelta(minutes=20)
        result = self.run_session()
        self.assertEqual(result['status'], 'stopped')
        self.assertEqual(self.api.calls, [])
        self.clock -= timedelta(minutes=20)
        (self.folder / 'STOP').touch()
        self.run_session(resume=True)
        self.assertEqual(self.api.calls, [])
        (self.folder / 'STOP').unlink()
        self.api.behavior = 'crash_after_fill'
        with self.assertRaises(Crashed):
            self.run_session(resume=True)
        self.clock += timedelta(minutes=20)
        result = self.run_session(resume=True, reconcile_only=True)
        self.assertEqual(result['status'], 'attention_required')
        self.assertEqual(len(self.api.sends()), 1)
        self.assertIsNone(result['closing'])

    def test_changed_registration_credential_artifact_or_corrupt_state_stop_before_io(self):
        self.api.behavior = 'reject'
        self.run_session()
        saved = (self.folder / 'state.json').read_bytes()
        self.api.calls.clear()
        self.plan['entry']['stop_loss'] = 1.09
        self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.run_session(resume=True)
        self.plan['entry']['stop_loss'] = 1.10
        self.secret['credential'] = 'z' * 43
        self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.run_session(resume=True)
        self.secret['credential'] = 'x' * 43
        self.write_inputs()
        self.artifact.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.run_session(resume=True)
        self.assertEqual((self.folder / 'state.json').read_bytes(), saved)
        damaged = json.loads(saved)
        damaged['state']['opening'] = None
        (self.folder / 'state.json').write_bytes(runner.encoded(damaged))
        with self.assertRaisesRegex(ValueError, 'integrity'):
            runner.load(self.folder / 'state.json')
        self.assertEqual(self.api.calls, [])

    def test_state_lock_collision_and_input_directory_preserve_inputs(self):
        with self.assertRaises(FileExistsError):
            runner.run(self.manifest, self.credentials, self.root, client_factory=self.factory)
        self.assertTrue(self.artifact.exists())
        self.api.behavior = 'reject'
        self.run_session()
        self.api.calls.clear()
        with runner._exclusive_file_lock(self.folder / 'state.lock'):
            with self.assertRaises(RuntimeError):
                self.run_session(resume=True)
        self.assertEqual(self.api.calls, [])

    def test_real_mode_remote_origin_and_credential_redirect_are_denied(self):
        for changes in ({'api_origin': 'http://example.com:8010'},
                        {'entry': {**self.plan['entry'], 'mode': 'real'}}):
            with self.assertRaises(ValueError):
                runner.Plan.model_validate({**self.plan, **changes})
        client = runner.NativeClient(self.api.plan, self.api.credential)
        with self.assertRaises(ValueError):
            client.call('/api/v2/automation/grants', {})
        redirect = next(h for h in client.opener.handlers if isinstance(h, runner.request.HTTPRedirectHandler))
        self.assertIsNone(redirect.redirect_request(None, None, None, None, None))


if __name__ == '__main__':
    unittest.main()
