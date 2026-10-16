from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

import pyarrow.parquet as pq
import pytest

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]

from trading_workspace_v2 import artifacts
from trading_workspace_v2.artifacts import ArtifactConflict, ArtifactStore, sha256_file


def dataset(tmp_path):
    store = ArtifactStore(tmp_path)
    rows = [{'timestamp': n, 'open': 1., 'high': 2., 'low': .5, 'close': 1.5} for n in range(10)]
    relative, checksum = store.write_dataset('w', 'd', rows)
    return store, relative, checksum, rows


def read(store, relative, checksum):
    return store.read_dataset_indices(relative, checksum, start_index=2, end_index=5)


def corrupt_preserving_size_and_mtime(path):
    before = path.stat()
    data = bytearray(path.read_bytes())
    data[20] ^= 1
    path.write_bytes(data)
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    assert path.stat().st_size == before.st_size
    assert path.stat().st_mtime_ns == before.st_mtime_ns


def test_repeated_and_concurrent_windows_hash_once(tmp_path):
    store, relative, checksum, rows = dataset(tmp_path)
    barrier = Barrier(4)

    def concurrent_read(_):
        barrier.wait(timeout=5)
        return read(store, relative, checksum)

    with patch.object(artifacts.hashlib, 'sha256', wraps=artifacts.hashlib.sha256) as digest:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(concurrent_read, range(4)))
        assert results == [rows[2:5]] * 4
        assert read(store, relative, checksum) == rows[2:5]
        assert digest.call_count == 1


def test_cached_receipt_does_not_accept_another_expected_hash(tmp_path):
    store, relative, checksum, _ = dataset(tmp_path)
    read(store, relative, checksum)
    with pytest.raises(ArtifactConflict, match='checksum'):
        read(store, relative, '0' * 64)


def test_cached_receipt_detects_edit_with_original_size_and_mtime(tmp_path):
    store, relative, checksum, _ = dataset(tmp_path)
    read(store, relative, checksum)
    corrupt_preserving_size_and_mtime(tmp_path / relative)
    with pytest.raises(ArtifactConflict, match='checksum'):
        read(store, relative, checksum)


def test_replacement_with_original_size_and_mtime_is_reverified(tmp_path):
    store, relative, checksum, _ = dataset(tmp_path)
    read(store, relative, checksum)
    path = tmp_path / relative
    before = path.stat()
    replacement = path.with_suffix('.replacement')
    replacement.write_bytes(path.read_bytes())
    corrupt_preserving_size_and_mtime(replacement)
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    os.replace(replacement, path)
    with pytest.raises(ArtifactConflict, match='checksum'):
        read(store, relative, checksum)


def test_cached_read_still_detects_mutation_during_decode(tmp_path):
    store, relative, checksum, _ = dataset(tmp_path)
    read(store, relative, checksum)
    original = pq.ParquetFile.read_row_group

    def mutate(parquet, *args, **kwargs):
        result = original(parquet, *args, **kwargs)
        corrupt_preserving_size_and_mtime(tmp_path / relative)
        return result

    with patch.object(pq.ParquetFile, 'read_row_group', mutate), pytest.raises(ArtifactConflict, match='changed'):
        read(store, relative, checksum)


def test_unavailable_change_stamp_falls_back_to_full_verification(tmp_path):
    store, relative, checksum, rows = dataset(tmp_path)
    with patch.object(artifacts, '_descriptor_change_time', return_value=None), patch.object(artifacts.hashlib, 'sha256', wraps=artifacts.hashlib.sha256) as digest:
        assert read(store, relative, checksum) == rows[2:5]
        assert read(store, relative, checksum) == rows[2:5]
        assert digest.call_count == 2
        assert not store._verified_datasets
        corrupt_preserving_size_and_mtime(tmp_path / relative)
        with pytest.raises(ArtifactConflict, match='checksum'):
            read(store, relative, checksum)


def test_receipt_cache_is_bounded_and_evicts_least_recently_used(tmp_path):
    store = ArtifactStore(tmp_path)
    entries = []
    for index in range(33):
        path = tmp_path / str(index)
        path.write_bytes(str(index).encode())
        entries.append((path, sha256_file(path)))
        with path.open('rb') as handle:
            store._verify_dataset(handle, entries[-1][1])
    assert len(store._verified_datasets) == 32
    with patch.object(artifacts.hashlib, 'sha256', wraps=artifacts.hashlib.sha256) as digest:
        with entries[-1][0].open('rb') as handle:
            store._verify_dataset(handle, entries[-1][1])
        assert digest.call_count == 0
        with entries[0][0].open('rb') as handle:
            store._verify_dataset(handle, entries[0][1])
        assert digest.call_count == 1

