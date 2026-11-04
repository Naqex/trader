"""Recompute a saved shadow capture offline; never resumes or authorizes a run."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import mt5_observed_capture as capture
from scripts import mt5_shadow_step as shadow


def reprocess(manifest, directory, output, *, now_msc=None):
    manifest, directory, output = (Path(p).absolute() for p in (manifest, directory, output))
    for path in (manifest, directory, output):
        capture.require_local_tree(path)
    if (output.exists() or output.resolve().is_relative_to(directory.resolve()) or
            directory.resolve().is_relative_to(output.resolve()) or
            manifest.resolve().is_relative_to(output.resolve())):
        raise capture.CaptureError('shadow_reprocess_output_must_be_new_and_separate')
    original = capture.read_json(manifest)
    original_hash = hashlib.sha256(manifest.read_bytes()).hexdigest()
    old_pins, current = original['source_sha256'], shadow.source_pins()
    # Only reducer fixes are supported. Changed capture, candidate, clock/tick
    # contracts or dependencies need their own compatibility review.
    if (set(old_pins) != set(current) or
            any(not isinstance(v, str) or not re.fullmatch(r'[0-9a-f]{64}', v) for v in old_pins.values()) or
            any(old_pins[k] != current[k] for k in current if k != 'step') or
            original.get('continuation') is not None):
        raise capture.CaptureError('shadow_reprocess_compatibility_review_required')
    plan = shadow.Plan.model_validate({**original, 'source_sha256': current})
    capture_dir = directory/'capture'
    state, _, _ = capture.load(capture_dir, plan.capture)
    cursor_hash = capture.checksum(state)
    now_msc = int(time.time()*1000) if now_msc is None else now_msc
    if now_msc < state['next_from_msc']+plan.settle_seconds*1000:
        raise capture.CaptureError('shadow_reprocess_capture_not_settled')

    def saved_page(start, end):
        index = (start-plan.capture.from_msc)//(plan.capture.page_seconds*1000)
        page = shadow.page_at(capture_dir, state, plan.capture, index)
        if page['from_msc'] != start or page['to_msc'] != end:
            raise capture.CaptureError('shadow_reprocess_page_range_changed')
        return page

    report = shadow.reduce_capture(capture_dir, plan, None, saved_page, now_msc)
    after, _, _ = capture.load(capture_dir, plan.capture)
    if (capture.checksum(after) != cursor_hash or
            hashlib.sha256(manifest.read_bytes()).hexdigest() != original_hash or
            shadow.source_pins() != current):
        raise capture.CaptureError('shadow_reprocess_inputs_changed')
    result = dict(schema_version='mt5-shadow-offline-reprocess-v1',
        scope='saved_capture_only_not_fresh_forward', execution_capability=False,
        continuation_eligible=False, network_reads=0, processed_at_msc=now_msc,
        original_manifest_sha256=original_hash, original_source_sha256=old_pins,
        source_sha256=current, capture_state_sha256=cursor_hash,
        script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        source_directory=str(directory.resolve()), report=report)
    output.mkdir()
    capture.private_directory(output)
    capture.store(output/'reprocess.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = reprocess(args.manifest, args.state_dir, args.output_dir)
        print(capture.encoded(dict(status='reprocessed_offline', execution_capability=False,
            continuation_eligible=False, pages=result['report']['pages'],
            ticks=result['report']['ticks'], closed_hours=len(result['report']['hours']),
            output=str(args.output_dir/'reprocess.json'))).decode(), end='')
        return 0
    except (capture.CaptureError, ValueError, KeyError, OSError) as error:
        print(capture.encoded(dict(status='failed', reason=str(error), execution_capability=False)).decode(), end='')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
