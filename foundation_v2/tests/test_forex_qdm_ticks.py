import hashlib
from decimal import Decimal
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[1]/'scripts')]
from trading_workspace_v2 import forex_qdm_ticks as cache
from trading_workspace_v2.forex_h4 import read_qdm_ticks
from trading_workspace_v2.forex_input_preparation import prepare_input_set


class PreparedTickTests(unittest.TestCase):
    def test_trusted_tick_has_same_public_model_and_rejects_unvalidated_quotes(self):
        tick = cache.BrokerReplayTick.trusted(time_msc=1, sequence=2,
            bid=Decimal('1.10000'), ask=Decimal('1.10020'))
        self.assertEqual(tick.model_dump(mode='json'),
                         {'time_msc': 1, 'sequence': 2, 'bid': '1.10000', 'ask': '1.10020'})
        with self.assertRaises(ValueError):
            cache.BrokerReplayTick.trusted(time_msc=1, sequence=2,
                bid=Decimal('1.10020'), ask=Decimal('1.10000'))
    def fixture(self, root):
        path = root/'quotes.csv'
        path.write_text('DateTime,Bid,Ask,Volume\n'
            '20220103 00:00:00.001,1.10000,1.10020,1\n'
            '20220103 00:00:00.001,1.1000,1.1002,1\n'
            '20220103 00:00:00.999,1.10010,1.10030,1\n'
            '20220103 01:00:00.000,1.10000,1.10020,1\n', encoding='utf-8')
        terms = dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), first_day='20220103', last_day='20220103')
        return path, terms, root/'cache'

    def test_exact_decimal_text_and_same_ms_sequence_across_batches_and_no_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            expected = [(t.time_msc, t.sequence, str(t.bid), str(t.ask)) for t in read_qdm_ticks(path, **terms)]
            with patch.object(cache, 'BATCH_SIZE', 2):
                payload = cache.prepare_ticks(path, cache_dir=folder, **terms)
                actual = [(t.time_msc, t.sequence, str(t.bid), str(t.ask))
                          for t in cache.read_prepared_ticks(path, cache_dir=folder, **terms)]
            self.assertEqual(actual, expected)
            self.assertEqual(payload['ticks'], 4)
            with patch.object(cache, 'read_qdm_ticks', side_effect=AssertionError('must reuse')):
                self.assertEqual(cache.prepare_ticks(path, cache_dir=folder, **terms), payload)

    def test_corrupt_cache_and_changed_raw_input_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            cache.prepare_ticks(path, cache_dir=folder, **terms)
            data, _, _ = cache.tick_cache_paths(folder, **terms)
            data.write_bytes(data.read_bytes()+b'corrupt')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                list(cache.read_prepared_ticks(path, cache_dir=folder, **terms))
            path.write_text('changed', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'CSV hash'):
                list(cache.read_prepared_ticks(path, cache_dir=folder, **terms))

    def test_window_runtime_version_drift_and_incomplete_publication_do_not_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            cache.prepare_ticks(path, cache_dir=folder, **terms)
            with self.assertRaisesRegex(ValueError, 'missing'):
                list(cache.read_prepared_ticks(path, cache_dir=folder, **dict(terms, last_day='20220104')))
            with patch.object(cache.pa, '__version__', 'changed'):
                with self.assertRaisesRegex(ValueError, 'missing'):
                    list(cache.read_prepared_ticks(path, cache_dir=folder, **terms))
            data, metadata, _ = cache.tick_cache_paths(folder, **terms)
            metadata.unlink()
            with self.assertRaisesRegex(ValueError, 'missing'):
                cache.prepare_ticks(path, cache_dir=folder, **terms)
            self.assertTrue(data.exists())

    def test_lock_and_invalid_or_cancelled_input_never_publish_an_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            data, metadata, _ = cache.tick_cache_paths(folder, **terms)
            folder.mkdir()
            lock = metadata.with_suffix('.lock')
            lock.write_text('other-owner', encoding='utf-8')
            with self.assertRaises(FileExistsError):
                cache.prepare_ticks(path, cache_dir=folder, **terms)
            self.assertEqual(lock.read_text(), 'other-owner')
            lock.unlink()
            def cancel(_):
                raise RuntimeError('owner cancelled')
            with patch.object(cache, 'BATCH_SIZE', 2), self.assertRaisesRegex(RuntimeError, 'cancelled'):
                cache.prepare_ticks(path, cache_dir=folder, **terms, on_progress=cancel)
            self.assertFalse(data.exists())
            self.assertFalse(metadata.exists())
            self.assertFalse(lock.exists())

    def test_parquet_with_resealed_wrong_order_is_still_rejected_per_tick(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            cache.prepare_ticks(path, cache_dir=folder, **terms)
            data, metadata, _ = cache.tick_cache_paths(folder, **terms)
            table = pq.read_table(data)
            values = table.to_pydict()
            values['sequence'][1] = 99
            pq.write_table(pa.Table.from_pydict(values, schema=cache.SCHEMA), data,
                           compression='zstd', use_dictionary=['bid', 'ask'])
            envelope = json.loads(metadata.read_bytes())
            envelope['payload']['sha256'] = cache._digest(data)
            envelope['payload']['bytes'] = data.stat().st_size
            envelope['payload_sha256'] = hashlib.sha256(cache._json_bytes(envelope['payload'])).hexdigest()
            metadata.write_bytes(cache._json_bytes(envelope))
            with self.assertRaisesRegex(ValueError, 'order'):
                list(cache.read_prepared_ticks(path, cache_dir=folder, **terms))

    def test_shared_preparation_reuses_one_recipe_and_deduplicates_across_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path, terms, folder = self.fixture(root)
            item = dict(terms, path=str(path))
            inputs = dict(warmup=item, development=item)
            seen, events = set(), []
            records = prepare_input_set(inputs, inspection_cache_dir=folder, tick_cache_dir=folder,
                                        seen=seen, on_progress=events.append)
            self.assertEqual([r['kind'] for r in records], ['quality', 'ticks'])
            self.assertTrue(all(r['ticks'] == 4 and r['cpu_seconds'] >= 0 for r in records))
            with patch('trading_workspace_v2.forex_input_preparation.prepare_inspection', side_effect=AssertionError('duplicate')):
                self.assertEqual(prepare_input_set(inputs, inspection_cache_dir=folder, tick_cache_dir=folder, seen=seen), [])
            self.assertEqual(len(list(cache.read_prepared_ticks(path, cache_dir=folder, **terms))), 4)
