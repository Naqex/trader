from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys

import pytest

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2])]
from trading_workspace_v2.artifacts import ArtifactStore, sha256_file
from trading_workspace_v2.data_ingest import TRANSFORM_VERSION, _parquet_rows
from trading_workspace_v2.local_datasets import LocalDatasetService, DatasetRecoveryError


@pytest.fixture
def recovery(tmp_path):
    artifacts = ArtifactStore(tmp_path / 'artifacts')
    raw = tmp_path / 'input.csv'
    raw.write_text('time,open,high,low,close,volume\n60,1,2,1,1,0\n120,1,2,1,1,1\n')
    source, source_hash = artifacts.write_raw_source('w', 'd', raw)
    path, checksum = artifacts.write_dataset_iter('w', 'd', _parquet_rows(raw))
    manifest = SimpleNamespace(workspace_id='w', dataset_id='d', artifact_path=path, artifact_sha256=checksum,
                               raw_artifact_path=source, raw_sha256=source_hash, transform_version=TRANSFORM_VERSION)
    store = SimpleNamespace(dataset_mutation=lambda *_: nullcontext(), get_dataset=lambda w, d: manifest if (w, d) == ('w', 'd') else None)
    return LocalDatasetService(store, artifacts), manifest, artifacts.root / path, artifacts.root / source


@pytest.mark.parametrize('damage', ['missing', 'corrupt'])
def test_recovery_restores_exact_bytes_without_changing_manifest(recovery, damage):
    service, manifest, target, raw = recovery
    original = target.read_bytes()
    if damage == 'missing':
        target.unlink()
    else:
        target.write_bytes(b'broken parquet')
    before = vars(manifest).copy()
    assert service.repair_dataset('w', 'd')['status'] == 'restored'
    assert target.read_bytes() == original
    assert vars(manifest) == before
    assert sha256_file(raw) == manifest.raw_sha256
    assert service.repair_dataset('w', 'd')['status'] == 'verified'
    if damage == 'corrupt':
        assert next((service.artifacts.root / 'w/quarantine').iterdir()).read_bytes() == b'broken parquet'


@pytest.mark.parametrize('damage, code', [('missing', 'dataset_source_unavailable'), ('corrupt', 'dataset_source_corrupt'), ('version', 'dataset_transform_unavailable')])
def test_unrecoverable_source_never_replaces_or_removes_target(recovery, damage, code):
    service, manifest, target, raw = recovery
    target.write_bytes(b'keep damaged evidence')
    if damage == 'missing': raw.unlink()
    elif damage == 'corrupt': raw.write_bytes(b'changed source')
    else: manifest.transform_version = 'unsupported'
    with pytest.raises(DatasetRecoveryError, match=code): service.repair_dataset('w', 'd')
    assert target.read_bytes() == b'keep damaged evidence'


def test_changed_writer_is_rejected_and_publish_failure_rolls_back(recovery):
    service, manifest, target, raw = recovery
    target.write_bytes(b'keep damaged evidence')
    checksum = manifest.artifact_sha256
    manifest.artifact_sha256 = 'f' * 64
    with pytest.raises(DatasetRecoveryError, match='dataset_recovery_mismatch'):
        service.repair_dataset('w', 'd')
    assert target.read_bytes() == b'keep damaged evidence'
    manifest.artifact_sha256 = checksum
    import trading_workspace_v2.local_datasets as module
    original = module.publish_immutable
    def fail_candidate(source, destination):
        if 'dataset-recovery' in source.parts: raise OSError('disk failure')
        return original(source, destination)
    with patch.object(module, 'publish_immutable', fail_candidate), pytest.raises(OSError):
        service.repair_dataset('w', 'd')
    assert target.read_bytes() == b'keep damaged evidence'


def test_recovery_is_workspace_scoped(recovery):
    service, _, target, _ = recovery
    with pytest.raises(LookupError): service.repair_dataset('other', 'd')
    assert target.is_file()
