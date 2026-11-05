"""Offline registration bindings, shared by the runner and artifact reviewer.

Content registration restricts an experiment; it grants no broker authority
and does not attest that historical data was previously unseen.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, getcontext
from importlib.metadata import version
import hashlib
import json
from pathlib import Path
import sys


REGISTERED_STUDIES = {
    'ddc56313f1656631bb418e0def6c90119e65e342ad87ae8156158ced09e2d8b6':
        'eurusd-h4-q12023-historical-robustness-v1',
}
HISTORICAL_SCHEMA = 'forex-h4-historical-robustness-v1'
HISTORICAL_PURPOSE = 'registered_historical_robustness_not_qualification'


def runtime_binding():
    return dict(python=sys.version.split()[0], pydantic=version('pydantic'),
                decimal_precision=getcontext().prec, decimal_rounding=getcontext().rounding)


def load_registration(path: Path, expected_sha256: str):
    data = path.read_bytes()
    if (hashlib.sha256(data).hexdigest() != expected_sha256
            or expected_sha256 not in REGISTERED_STUDIES):
        raise ValueError('unregistered or changed study registration')
    registration = json.loads(data)
    if (registration.get('schema') != 'forex-historical-study-registration-v1'
            or registration.get('study_id') != REGISTERED_STUDIES[expected_sha256]
            or registration.get('data_role') != 'historical_robustness'
            or registration.get('clean_oos') is not False
            or registration.get('prior_exposure') != 'unverified_owner_cannot_recall'
            or registration.get('authorization', {}).get('promotion_authorized') is not False):
        raise ValueError('unsupported historical registration scope')
    return registration


def validate_registration(registration, inputs, candidate, *, protocol_sha256=None,
                          source_files=None, account_spec_sha256=None, scenarios=None):
    if candidate not in registration['candidates']:
        raise ValueError('candidate differs from study registration')
    if set(inputs) != {'warmup', 'development'}:
        raise ValueError('input roles differ from study registration')
    for role, registered_role in (('warmup', 'warmup'), ('development', 'evaluation')):
        for key in ('first_day', 'last_day'):
            if inputs[role][key] != registration['windows'][registered_role][key]:
                raise ValueError('input window differs from study registration')
    if inputs['warmup']['last_day'] >= inputs['development']['first_day']:
        raise ValueError('warmup overlaps evaluation')
    if protocol_sha256 is not None and protocol_sha256 != registration['protocol']['sha256']:
        raise ValueError('protocol differs from study registration')
    if account_spec_sha256 is not None and account_spec_sha256 != registration['account_spec']['sha256']:
        raise ValueError('account spec differs from study registration')
    if source_files is not None:
        normalized = {name.replace('\\', '/'): digest for name, digest in source_files.items()}
        if len(normalized) != len(source_files):
            raise ValueError('ambiguous numerical source paths')
        # Only the CLI's contract plumbing changes in this implementation.
        # Numerical modules and candidate definitions keep their frozen bytes.
        for name, digest in registration['source_files'].items():
            if name != 'scripts/forex_h4_pilot.py' and normalized.get(name) != digest:
                raise ValueError('numerical source differs from study registration')
    if scenarios is not None:
        start = datetime.strptime(inputs['development']['first_day'], '%Y%m%d').replace(tzinfo=timezone.utc)
        end = datetime.strptime(inputs['development']['last_day'], '%Y%m%d').replace(tzinfo=timezone.utc) + timedelta(days=1)
        schedule = []
        day = start.replace(hour=22)
        while day < end:
            if day.weekday() < 5:
                schedule.append((int(day.timestamp())*1000, 3 if day.weekday() == 2 else 1))
            day += timedelta(days=1)
        expected = {s['name']: s for s in registration['scenarios']}
        if len(scenarios) != len(expected) or {s['name'] for s in scenarios} != set(expected):
            raise ValueError('scenarios differ from study registration')
        for scenario in scenarios:
            cost = expected[scenario['name']]
            if (Decimal(scenario['commission_usd_per_lot_per_side']) != Decimal(cost['commission_usd_per_lot_per_side'])
                    or Decimal(scenario['slippage']) != Decimal(cost['slippage_price_per_side'])):
                raise ValueError('costs differ from study registration')
            if [(t['scheduled_time_msc'], t['multiplier']) for t in scenario['financing_calendar']] != schedule:
                raise ValueError('financing calendar differs from study registration')
            for terms in scenario['financing_calendar']:
                if terms['known_at_msc'] != int(start.timestamp())*1000:
                    raise ValueError('financing availability differs from study registration')
                for side in ('buy', 'sell'):
                    key = 'debit_' + side + '_usd_per_lot'
                    if Decimal(terms[key]) != Decimal(cost['financing_' + key]):
                        raise ValueError('financing differs from study registration')


def inspect_registered_manifest(manifest, run_dir):
    binding = manifest['study_registration']
    registration = load_registration(Path(run_dir)/'study-registration.json', binding['sha256'])
    if (manifest.get('schema') != HISTORICAL_SCHEMA or manifest.get('purpose') != HISTORICAL_PURPOSE
            or manifest.get('data_role') != registration['data_role']
            or manifest.get('prior_exposure') != registration['prior_exposure']
            or manifest.get('clean_oos') is not False
            or manifest.get('risk_usd') != [25, 100, 500]
            or binding.get('study_id') != registration['study_id']):
        raise ValueError('historical evidence scope differs from registration')
    validate_registration(registration, manifest['inputs'], manifest['candidate'],
        protocol_sha256=manifest['research_protocol']['sha256'], source_files=manifest['source_files'],
        account_spec_sha256=manifest['observed_account_spec']['sha256'], scenarios=manifest['scenarios'])
    return registration
