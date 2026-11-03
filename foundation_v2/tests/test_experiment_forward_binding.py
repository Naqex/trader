from __future__ import annotations

import hashlib
import io
import unittest

from pydantic import ValidationError

from trading_workspace_v2.experiment_forward_binding import (
    ArtifactDigest,
    ExperimentBindingError,
    ExperimentForwardBinding,
    bind_experiment_artifacts,
    validate_forward_binding,
)


class ExperimentForwardBindingTests(unittest.TestCase):
    def setUp(self):
        self.artifacts = {
            "data": b"timestamp,bid,ask\n1,1.10,1.11\n",
            "instrument_spec": b'{"symbol":"EURUSD","volume_step":"0.01"}',
            "cost_model": b'{"commission":"unknown","scope":"counterfactual"}',
            "source": b"strategy_revision = 'r1'\n",
        }
        self.pins = {name: hashlib.sha256(content).hexdigest() for name, content in self.artifacts.items()}
        self.arguments = dict(
            candidate_id="eurusd-h4", strategy_revision="r1", purpose="system_fixture",
            artifacts=self.artifacts, expected_sha256=self.pins,
        )

    def test_roundtrip_and_canonical_fingerprint(self):
        binding = bind_experiment_artifacts(**self.arguments)
        restored = ExperimentForwardBinding.model_validate_json(binding.model_dump_json())
        reversed_arguments = dict(self.arguments, artifacts=dict(reversed(list(self.artifacts.items()))))
        self.assertEqual(binding, restored)
        self.assertEqual(binding.fingerprint(), bind_experiment_artifacts(**reversed_arguments).fingerprint())
        self.assertEqual(64, len(binding.fingerprint()))
        self.assertEqual(binding, validate_forward_binding(restored, **self.arguments))
        self.assertEqual(self.pins["data"], binding.artifact_sha256("data"))
        self.assertFalse(binding.execution_capability)
        self.assertFalse(binding.strategy_qualified)
        with self.assertRaises(ExperimentBindingError):
            binding.artifact_sha256("unbound")

    def test_nested_binding_is_immutable_and_does_not_retain_mutable_inputs(self):
        binding = bind_experiment_artifacts(**self.arguments)
        with self.assertRaises(ValidationError):
            binding.candidate_id = "another"
        with self.assertRaises(ValidationError):
            binding.artifacts[0].sha256 = "0" * 64
        frozen_fingerprint = binding.fingerprint()
        self.artifacts["data"] = b"changed"
        self.pins["data"] = "0" * 64
        self.assertEqual(frozen_fingerprint, binding.fingerprint())

    def test_tampering_each_critical_artifact_is_rejected(self):
        binding = bind_experiment_artifacts(**self.arguments)
        for name in self.artifacts:
            with self.subTest(name=name):
                changed = dict(self.artifacts, **{name: self.artifacts[name] + b"changed"})
                with self.assertRaises(ExperimentBindingError):
                    validate_forward_binding(binding, **dict(self.arguments, artifacts=changed))
                updated_pins = dict(self.pins, **{name: hashlib.sha256(changed[name]).hexdigest()})
                with self.assertRaises(ExperimentBindingError):
                    validate_forward_binding(
                        binding, **dict(self.arguments, artifacts=changed, expected_sha256=updated_pins)
                    )

    def test_missing_extra_malformed_and_unresolved_artifacts_are_rejected(self):
        invalid = [
            dict(self.arguments, artifacts={key: value for key, value in self.artifacts.items() if key != "data"}),
            dict(self.arguments, artifacts=dict(self.artifacts, extra=b"extra")),
            dict(self.arguments, expected_sha256=dict(self.pins, data="A" * 64)),
            dict(self.arguments, expected_sha256=dict(self.pins, data="0" * 63)),
            dict(self.arguments, artifacts=dict(self.artifacts, data="/some/file.csv")),
        ]
        for arguments in invalid:
            with self.subTest(arguments=arguments), self.assertRaises(ExperimentBindingError):
                bind_experiment_artifacts(**arguments)

    def test_changed_identity_or_purpose_is_rejected_on_resume(self):
        binding = bind_experiment_artifacts(**self.arguments)
        for change in ({"candidate_id": "other"}, {"strategy_revision": "r2"}, {"purpose": "research"}):
            with self.subTest(change=change), self.assertRaises(ExperimentBindingError):
                validate_forward_binding(binding, **dict(self.arguments, **change))
        for change in ({"candidate_id": " "}, {"strategy_revision": ""}, {"purpose": "demo"}):
            with self.subTest(change=change), self.assertRaises(ExperimentBindingError):
                bind_experiment_artifacts(**dict(self.arguments, **change))

    def test_additional_artifacts_are_bound_and_must_survive_resume(self):
        arguments = dict(
            self.arguments,
            artifacts=dict(self.artifacts, warmup=b"warmup"),
            expected_sha256=dict(self.pins, warmup=hashlib.sha256(b"warmup").hexdigest()),
        )
        binding = bind_experiment_artifacts(**arguments)
        self.assertEqual(binding, validate_forward_binding(binding, **arguments))
        with self.assertRaises(ExperimentBindingError):
            validate_forward_binding(binding, **self.arguments)

    def test_serialized_structure_cannot_grant_authority_or_hide_artifacts(self):
        binding = bind_experiment_artifacts(**self.arguments)
        for field in ("execution_capability", "strategy_qualified"):
            for value in (True, 0, "false"):
                with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                    ExperimentForwardBinding.model_validate(dict(binding.model_dump(), **{field: value}))
        for artifacts in (binding.artifacts[:-1], binding.artifacts + (binding.artifacts[0],)):
            with self.assertRaises(ValidationError):
                ExperimentForwardBinding.model_validate(dict(binding.model_dump(), artifacts=artifacts))
        with self.assertRaises(ValidationError):
            ArtifactDigest(name="../data.csv", sha256="0" * 64)
        with self.assertRaises(ExperimentBindingError):
            validate_forward_binding(binding.model_copy(update={"execution_capability": True}), **self.arguments)

    def test_stream_hashes_entire_artifact_in_bounded_chunks_and_preserves_cursor(self):
        class BoundedStream(io.BytesIO):
            def read(self, size=-1):
                if not 0 < size <= 1024 * 1024:
                    raise AssertionError("hashing must use bounded chunks")
                return super().read(size)

        content = b"data" * (1024 * 1024)
        stream = BoundedStream(content)
        stream.seek(11)
        arguments = dict(
            self.arguments,
            artifacts=dict(self.artifacts, data=stream),
            expected_sha256=dict(self.pins, data=hashlib.sha256(content).hexdigest()),
        )
        binding = bind_experiment_artifacts(**arguments)
        self.assertEqual(hashlib.sha256(content).hexdigest(), binding.artifact_sha256("data"))
        self.assertEqual(11, stream.tell())
        self.assertFalse(stream.closed)
        self.assertEqual(binding, validate_forward_binding(binding, **arguments))
        self.assertEqual(11, stream.tell())
        stream.seek(0)
        stream.write(b"changed")
        stream.seek(11)
        with self.assertRaises(ExperimentBindingError):
            validate_forward_binding(binding, **arguments)
        self.assertEqual(11, stream.tell())
        self.assertFalse(stream.closed)

    def test_invalid_and_broken_streams_fail_clearly_without_taking_ownership(self):
        class NonseekableStream(io.BytesIO):
            def seekable(self):
                return False

        class BrokenStream(io.BytesIO):
            def read(self, size=-1):
                raise OSError("fixture read failure")

        class FailedRestoreStream(io.BytesIO):
            def seek(self, offset, whence=0):
                if offset == 3:
                    raise OSError("fixture seek failure")
                return super().seek(offset, whence)

        closed_stream = io.BytesIO(b"data")
        closed_stream.close()
        broken = BrokenStream(b"data")
        broken.seek(2)
        restore_failure = FailedRestoreStream(b"data")
        io.BytesIO.seek(restore_failure, 3)
        for stream, message in (
            (io.StringIO("data"), "binary bytes"),
            (NonseekableStream(b"data"), "seekable"),
            (closed_stream, "could not be read"),
            (broken, "could not be read"),
            (restore_failure, "could not be restored"),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(ExperimentBindingError, message):
                bind_experiment_artifacts(**dict(self.arguments, artifacts=dict(self.artifacts, data=stream)))
            if stream is not closed_stream:
                self.assertFalse(stream.closed)
        self.assertEqual(2, broken.tell())


if __name__ == "__main__":
    unittest.main()
