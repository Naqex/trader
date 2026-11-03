from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

from test_forex_forward import fixture
from trading_workspace_v2.forex_forward import forward_artifact_json

V2 = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('forex_forward_cli', V2 / 'scripts/forex_forward.py')
cli = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = cli
spec.loader.exec_module(cli)


def registration(folder):
    session, _, _ = fixture(warm=False)
    pilot = session.snapshot().pilot.model_dump(mode='json')
    data = b'DateTime,Bid,Ask,Volume\n' + b''.join(
        f'20220103 {hour:02d}:00:00.001,1.10200,1.10220,1\n'.encode() for hour in range(6))
    digest = hashlib.sha256(data).hexdigest()
    pilot['execution']['dataset_sha256'] = pilot['execution']['tick_snapshot_sha256'] = digest
    artifacts = {'data': data, 'seed': forward_artifact_json(pilot),
        'instrument_spec': forward_artifact_json(pilot['execution']['instrument_spec']),
        'cost_model': forward_artifact_json(pilot['execution']['cost_model'])}
    entries = {}
    for name, content in artifacts.items():
        path = folder / (name + '.dat')
        path.write_bytes(content)
        entries[name] = dict(path=path.name, sha256=hashlib.sha256(content).hexdigest())
    for name, filename in cli.SOURCE_FILES.items():
        path = V2 / filename
        entries[name] = dict(path=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    manifest = folder / 'registration.json'
    manifest.write_bytes(forward_artifact_json(dict(schema_version='forex-forward-cli-v1',
        candidate_id='fixed-eurusd-h4', strategy_revision='system-v1', purpose='system_fixture',
        first_day='20220103', last_day='20220103', artifacts=entries)))
    return manifest


class ForexForwardCliTests(unittest.TestCase):
    def test_qdm_batches_resume_to_identical_continuous_state_and_leave_final_hour_open(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = registration(folder)
            full, batches = folder / 'full.json', folder / 'batches.json'
            expected = cli.consume(manifest, full, resume=False, checkpoint_every=3)
            first = cli.consume(manifest, batches, resume=False, max_quotes=2, checkpoint_every=1)
            self.assertFalse(first['source_eof'])
            self.assertEqual(first['received_quotes'], 2)
            result = cli.consume(manifest, batches, resume=True, checkpoint_every=3)
            self.assertTrue(result['source_eof'])
            self.assertEqual((result['received_quotes'], result['committed_hours'], result['buffered_quotes']), (6, 5, 1))
            self.assertEqual(json.loads(full.read_bytes())['snapshot'], json.loads(batches.read_bytes())['snapshot'])
            self.assertFalse(result['execution_capability'])
            self.assertFalse(expected['strategy_qualified'])
            again = cli.consume(manifest, batches, resume=True, checkpoint_every=3)
            self.assertEqual(again['processed_quotes'], 0)
            self.assertEqual(result['received_quotes'], again['received_quotes'])

    def test_wrong_source_tampering_and_restart_are_rejected_without_clobber(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = registration(folder)
            checkpoint = folder / 'session.json'
            cli.consume(manifest, checkpoint, resume=False, max_quotes=2, checkpoint_every=1)
            saved = checkpoint.read_bytes()
            with self.assertRaisesRegex(ValueError, 'already exists'):
                cli.consume(manifest, checkpoint, resume=False)
            data = folder / 'data.dat'
            data.write_bytes(data.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                cli.consume(manifest, checkpoint, resume=True)
            self.assertEqual(saved, checkpoint.read_bytes())
            raw = json.loads(manifest.read_bytes())
            raw['artifacts']['source']['path'] = 'data.dat'
            manifest.write_bytes(forward_artifact_json(raw))
            with self.assertRaisesRegex(ValueError, 'executed module'):
                cli.consume(manifest, checkpoint, resume=True)

    def test_watermark_cannot_skip_unread_source_and_must_be_explicit_at_eof(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = registration(folder)
            checkpoint = folder / 'session.json'
            boundary = 1641193200000  # 03 January 2022 07:00 UTC
            with self.assertRaisesRegex(ValueError, 'before EOF'):
                cli.consume(manifest, checkpoint, resume=False, max_quotes=2, checkpoint_every=1,
                    close_before_msc=boundary)
            result = cli.consume(manifest, checkpoint, resume=True, close_before_msc=boundary)
            self.assertEqual((result['received_quotes'], result['committed_hours'], result['buffered_quotes']), (6, 6, 0))
            self.assertTrue(result['source_watermark_asserted'])

    def test_main_reports_machine_readable_failure_and_preserves_input(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = registration(folder)
            original = manifest.read_bytes()
            output = io.StringIO()
            with contextlib.redirect_stderr(output):
                code = cli.main(['start', '--manifest', str(manifest), '--checkpoint', str(manifest)])
            self.assertEqual(code, 2)
            self.assertFalse(json.loads(output.getvalue())['execution_capability'])
            self.assertIn('must not replace', json.loads(output.getvalue())['reason'])
            self.assertEqual(original, manifest.read_bytes())

    def test_checkpoint_lock_cannot_mutate_registered_input(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            manifest = registration(folder)
            # The lock helper creates/appends one byte; refuse aliases before IO.
            raw = json.loads(manifest.read_bytes())
            lock = folder / 'checkpoint.json.lock'
            lock.write_bytes((folder / 'data.dat').read_bytes())
            raw['artifacts']['data']['path'] = lock.name
            manifest.write_bytes(forward_artifact_json(raw))
            original = lock.read_bytes()
            for resume in (False, True):
                with self.subTest(resume=resume), self.assertRaisesRegex(ValueError, 'must not replace'):
                    cli.consume(manifest, folder / 'checkpoint.json', resume=resume)
                self.assertEqual(original, lock.read_bytes())


if __name__ == '__main__':
    unittest.main()
