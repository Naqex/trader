"""Pin operator-resolved experiment bytes to an offline forward session.

Digests establish artifact identity only, not data quality, historical cost
accuracy, strategy qualification, or permission to execute on a broker.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import re
from typing import BinaryIO, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


REQUIRED_ARTIFACTS = frozenset({"data", "instrument_spec", "cost_model", "source"})
BindingPurpose = Literal["system_fixture", "research"]
ArtifactContent = bytes | BinaryIO
_HASH_CHUNK_BYTES = 1024 * 1024


class ExperimentBindingError(ValueError):
    """The provided experiment no longer matches its frozen identity."""


def _artifact_digest(content: ArtifactContent) -> str:
    if isinstance(content, bytes):
        return hashlib.sha256(content).hexdigest()
    if not all(callable(getattr(content, method, None)) for method in ("read", "seek", "tell", "seekable")):
        raise ExperimentBindingError("artifact content must be bytes or an open seekable binary stream")
    original_cursor = None
    try:
        if not content.seekable():
            raise ExperimentBindingError("artifact stream must be seekable")
        original_cursor = content.tell()
        content.seek(0)
        digest = hashlib.sha256()
        while True:
            chunk = content.read(_HASH_CHUNK_BYTES)
            if not isinstance(chunk, bytes):
                raise ExperimentBindingError("artifact stream must return binary bytes")
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)
    except ExperimentBindingError:
        raise
    except (OSError, ValueError, TypeError) as exc:
        raise ExperimentBindingError("artifact stream could not be read") from exc
    finally:
        if original_cursor is not None:
            try:
                content.seek(original_cursor)
            except (OSError, ValueError, TypeError) as exc:
                raise ExperimentBindingError("artifact stream cursor could not be restored") from exc


class ArtifactDigest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = Field(strict=True, pattern=r"^[a-z][a-z0-9_.:-]{0,127}$")
    sha256: str = Field(strict=True, pattern=r"^[0-9a-f]{64}$")


class ExperimentForwardBinding(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["experiment-forward-binding-v1"] = "experiment-forward-binding-v1"
    candidate_id: str = Field(strict=True)
    strategy_revision: str = Field(strict=True)
    purpose: BindingPurpose
    artifacts: tuple[ArtifactDigest, ...]
    execution_capability: Literal[False] = False
    strategy_qualified: Literal[False] = False

    @field_validator("candidate_id", "strategy_revision")
    @classmethod
    def nonempty_identity(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("experiment identity must not be blank")
        return value

    @field_validator("execution_capability", "strategy_qualified", mode="before")
    @classmethod
    def false_only(cls, value: object) -> Literal[False]:
        if value is not False:
            raise ValueError("binding does not grant qualification or execution authority")
        return False

    @model_validator(mode="after")
    def canonical_artifacts(self) -> ExperimentForwardBinding:
        names = [artifact.name for artifact in self.artifacts]
        if len(set(names)) != len(names):
            raise ValueError("artifact names must be unique")
        if not REQUIRED_ARTIFACTS.issubset(names):
            raise ValueError("data, instrument_spec, cost_model and source artifacts are required")
        object.__setattr__(self, "artifacts", tuple(sorted(self.artifacts, key=lambda item: item.name)))
        return self

    def fingerprint(self) -> str:
        encoded = json.dumps(
            self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def artifact_sha256(self, name: str) -> str:
        for artifact in self.artifacts:
            if artifact.name == name:
                return artifact.sha256
        raise ExperimentBindingError(f"artifact is not bound: {name}")


def bind_experiment_artifacts(
    *,
    candidate_id: str,
    strategy_revision: str,
    purpose: BindingPurpose,
    artifacts: Mapping[str, ArtifactContent],
    expected_sha256: Mapping[str, str],
) -> ExperimentForwardBinding:
    """Verify resolved content; streams stay open and keep their original cursor.

    The caller owns opening local artifacts. No path or network is resolved here.
    """
    if set(artifacts) != set(expected_sha256):
        raise ExperimentBindingError("artifact names and expected digest names must match exactly")
    if not REQUIRED_ARTIFACTS.issubset(artifacts):
        raise ExperimentBindingError("data, instrument_spec, cost_model and source artifacts are required")
    digests = []
    for name, content in artifacts.items():
        expected = expected_sha256[name]
        if not isinstance(expected, str) or re.fullmatch(r"[0-9a-f]{64}", expected) is None:
            raise ExperimentBindingError("expected digest must be lowercase SHA256")
        actual = _artifact_digest(content)
        if actual != expected:
            raise ExperimentBindingError(f"artifact digest mismatch: {name}")
        try:
            digests.append(ArtifactDigest(name=name, sha256=actual))
        except ValueError as exc:
            raise ExperimentBindingError("invalid logical artifact name") from exc
    try:
        return ExperimentForwardBinding(
            candidate_id=candidate_id,
            strategy_revision=strategy_revision,
            purpose=purpose,
            artifacts=tuple(digests),
        )
    except ValueError as exc:
        raise ExperimentBindingError("invalid experiment identity or purpose") from exc


def validate_forward_binding(
    binding: ExperimentForwardBinding,
    *,
    candidate_id: str,
    strategy_revision: str,
    purpose: BindingPurpose,
    artifacts: Mapping[str, ArtifactContent],
    expected_sha256: Mapping[str, str],
) -> ExperimentForwardBinding:
    """Rehash on cold resume and reject identity, content, or pin changes."""
    verified = bind_experiment_artifacts(
        candidate_id=candidate_id,
        strategy_revision=strategy_revision,
        purpose=purpose,
        artifacts=artifacts,
        expected_sha256=expected_sha256,
    )
    if binding != verified:
        raise ExperimentBindingError("experiment differs from the frozen forward binding")
    return verified
