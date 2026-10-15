"""Remove only unpinned local dataset versions; public catalogs are untouched."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from uuid import uuid4

from .market_sync import atomic_json
from .artifacts import ArtifactConflict, ArtifactStore, _file_identity, publish_immutable, sha256_file


class DatasetInUse(RuntimeError):
    pass


class DatasetRecoveryError(RuntimeError):
    pass


class LocalDatasetService:
    def __init__(self, store, artifacts):
        self.store, self.artifacts = store, artifacts

    def _journal(self, workspace, dataset_id):
        digest = hashlib.sha256(f'{workspace}:{dataset_id}'.encode()).hexdigest()
        return self.artifacts.root / 'dataset-removals' / f'{digest}.json'

    def repair_dataset(self, workspace, dataset_id):
        from .data_ingest import TRANSFORM_VERSION, _parquet_rows
        with self.store.dataset_mutation(workspace, dataset_id):
            manifest = self.store.get_dataset(workspace, dataset_id)
            if manifest is None:
                raise LookupError('dataset_not_found')
            paths = self.artifacts.dataset_paths(workspace, dataset_id, manifest.artifact_path, manifest.raw_artifact_path)
            target = paths[0]
            identity = _file_identity(target.stat()) if target.exists() else None
            if identity is not None:
                try:
                    with target.open('rb') as handle:
                        checked = self.artifacts._verify_dataset(handle, manifest.artifact_sha256)
                        self.artifacts._verify_unchanged(target, handle, checked)
                except ArtifactConflict:
                    pass
                else:
                    return {'dataset_id': dataset_id, 'status': 'verified'}
            if len(paths) < 2 or not paths[1].is_file():
                raise DatasetRecoveryError('dataset_source_unavailable')
            raw = paths[1]
            if sha256_file(raw) != manifest.raw_sha256:
                raise DatasetRecoveryError('dataset_source_corrupt')
            if manifest.transform_version != TRANSFORM_VERSION:
                raise DatasetRecoveryError('dataset_transform_unavailable')
            # Rebuild away from the canonical path. A changed parser/compressor
            # must never silently replace the bytes pinned by existing sessions.
            staging = self.artifacts._path('dataset-recovery')
            staging.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=staging) as temporary:
                candidate_store = ArtifactStore(temporary)
                relative, checksum = candidate_store.write_dataset_iter(workspace, dataset_id, _parquet_rows(raw))
                if checksum != manifest.artifact_sha256 or sha256_file(raw) != manifest.raw_sha256:
                    raise DatasetRecoveryError('dataset_recovery_mismatch')
                candidate = candidate_store.root / relative
                current = _file_identity(target.stat()) if target.exists() else None
                if current != identity:
                    raise ArtifactConflict('dataset changed during recovery')
                quarantine = None
                target.parent.mkdir(parents=True, exist_ok=True)
                if identity is not None:
                    quarantine = self.artifacts._path(Path(workspace) / 'quarantine' / f'{dataset_id}-{uuid4().hex}.parquet')
                    quarantine.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(target, quarantine)
                try:
                    publish_immutable(candidate, target)
                except BaseException:
                    if quarantine is not None and not target.exists():
                        publish_immutable(quarantine, target)
                    raise
            return {'dataset_id': dataset_id, 'status': 'restored'}

    def delete_dataset(self, workspace, dataset_id):
        with self.store.dataset_mutation(workspace, dataset_id):
            return self._delete_dataset(workspace, dataset_id)

    def _delete_dataset(self, workspace, dataset_id):
        journal = self._journal(workspace, dataset_id)
        paths = None
        # Hold the row lock through commit. Files remain available until all pins
        # have been checked and the catalog transaction has durably removed it.
        with self.store.dataset_removal(workspace, dataset_id) as manifest:
            if manifest is not None:
                paths = self.artifacts.dataset_paths(workspace, dataset_id, manifest.artifact_path, manifest.raw_artifact_path)
                journal.parent.mkdir(parents=True, exist_ok=True)
                atomic_json(journal, {'workspace_id': workspace, 'dataset_id': dataset_id,
                                      'artifact_path': manifest.artifact_path, 'raw_artifact_path': manifest.raw_artifact_path})
            elif journal.is_file():
                saved = json.loads(journal.read_text(encoding='utf-8'))
                if saved.get('workspace_id') != workspace or saved.get('dataset_id') != dataset_id:
                    raise ValueError('invalid_dataset_artifact_path')
                paths = self.artifacts.dataset_paths(workspace, dataset_id, saved['artifact_path'], saved.get('raw_artifact_path'))
            else:
                raise LookupError('dataset_not_found')
        # A crash or sharing violation leaves the exact-path journal for retry.
        # No directory tree, session, provider catalog or other version is removed.
        for path in paths:
            path.unlink(missing_ok=True)
        journal.unlink(missing_ok=True)
        return {'dataset_id': dataset_id, 'deleted': True}
