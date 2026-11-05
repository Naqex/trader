import hashlib
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from forex_prepare_inspections import main as prepare_main
from trading_workspace_v2 import forex_qdm_inspection as cache
from trading_workspace_v2.forex_h4 import inspect_qdm


class InspectionCacheTests(unittest.TestCase):
    def fixture(self, root):
        path = root/'ticks.csv'
        path.write_text('DateTime,Bid,Ask,Volume\n' + ''.join(
            f'20220103 {hour:02d}:00:00.001,1.10000,1.10020,1\n'
            f'20220103 {hour:02d}:00:00.002,1.10010,1.10030,1\n' for hour in range(8)), encoding='utf-8')
        return path, dict(cache_dir=root/'cache', sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                          first_day='20220103', last_day='20220103')

    def test_prepared_quality_and_decimal_bars_equal_fresh_without_reparsing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, terms = self.fixture(root)
            expected = inspect_qdm(path, **{k: v for k, v in terms.items() if k != 'cache_dir'})
            self.assertEqual(cache.prepare_inspection(path, **terms), expected)
            entry, _ = cache.inspection_path(**terms)
            before = entry.read_bytes()
            with patch.object(cache, 'inspect_qdm', side_effect=AssertionError('must reuse')):
                self.assertEqual(cache.load_inspection(path, **terms), expected)
                self.assertEqual(cache.prepare_inspection(path, **terms), expected)
            self.assertEqual(entry.read_bytes(), before)
            self.assertFalse(entry.with_suffix('.lock').exists())

    def test_preparer_cli_records_both_roles_and_reuses_an_identical_slice(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, terms = self.fixture(root)
            item = dict(path=str(path), **{k: v for k, v in terms.items() if k != 'cache_dir'})
            manifest = root/'inputs.json'
            manifest.write_text(json.dumps(dict(schema='forex-h4-inputs-v1', warmup=item, development=item)), encoding='utf-8')
            output = io.StringIO()
            with redirect_stdout(output):
                prepare_main(['--input-manifest', str(manifest), '--cache-dir', str(terms['cache_dir'])])
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([e['stage'] for e in events], ['preparing', 'verified', 'checking', 'verified'])
            self.assertEqual(events[1]['entry'], events[3]['entry'])
            self.assertEqual(events[1]['ticks'], 16)

    def test_corrupted_entry_and_changed_raw_bytes_fail_without_rebuild(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, terms = self.fixture(root)
            cache.prepare_inspection(path, **terms)
            entry, _ = cache.inspection_path(**terms)
            raw = json.loads(entry.read_bytes())
            raw['payload']['quality']['ticks'] += 1
            entry.write_text(json.dumps(raw), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                cache.load_inspection(path, **terms)
            path.write_text('corrupt input', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                cache.load_inspection(path, **terms)

    def test_window_runtime_and_source_drift_never_load_an_old_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, terms = self.fixture(root)
            cache.prepare_inspection(path, **terms)
            variants = [dict(terms, last_day='20220104')]
            with self.assertRaisesRegex(ValueError, 'missing'):
                cache.load_inspection(path, **variants[0])
            with patch.object(cache, 'runtime_binding', return_value={'python': 'other'}):
                with self.assertRaisesRegex(ValueError, 'missing'):
                    cache.load_inspection(path, **terms)
            original_digest = cache._digest
            with patch.object(cache, '_digest', side_effect=lambda p: 'f'*64 if p.name == 'forex_h4.py' else original_digest(p)):
                with self.assertRaisesRegex(ValueError, 'missing'):
                    cache.load_inspection(path, **terms)

    def test_lock_blocks_second_preparer_and_bad_data_never_publishes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, terms = self.fixture(root)
            entry, _ = cache.inspection_path(**terms)
            entry.parent.mkdir()
            lock = entry.with_suffix('.lock')
            lock.write_text('existing-owner', encoding='utf-8')
            with self.assertRaises(FileExistsError):
                cache.prepare_inspection(path, **terms)
            self.assertEqual(lock.read_text(), 'existing-owner')
            lock.unlink()
            path.write_text(path.read_text().replace('1.10020', '1.00000'), encoding='utf-8')
            terms['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            entry, _ = cache.inspection_path(**terms)
            with self.assertRaises(ValueError):
                cache.prepare_inspection(path, **terms)
            self.assertFalse(entry.exists())
            self.assertFalse(entry.with_suffix('.lock').exists())
