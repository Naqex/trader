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
    '6cecb35194623d312ec772c1f1508cc442fe519ad943e2c686cec4cbbd772b7e':
        'eurusd-h1-discovery6-2023-fixing-screen-v1',
    '8de38c065e56302c6e1d14117bc35be99af26b38853cba67334b0d36e9a1e60d':
        'eurusd-h1-discovery6-2024-fixing-screen-v1',
    '489a8feeff3252ed2327f38ab6f07ea252859787531bfdfc2bca090496fb8004':
        'eurusd-h1-discovery4-2024-selection-v2',
    '8ee9aa764fa43904230c8dfae4c9d980c2e86fb0d124b3b064651a6f7e7d264b':
        'eurusd-h1-discovery4-2023-historical-screen-v1',
    'ddc56313f1656631bb418e0def6c90119e65e342ad87ae8156158ced09e2d8b6':
        'eurusd-h4-q12023-historical-robustness-v1',
    'ce7de7f0d60ace46dc72884d6c8b00a3f6c36fb8bd7630a82909409f4b1bb659':
        'eurusd-h4-2023-calendar-horizons-v1',
    'c5e5c8b5bdaef5b0cbc753f2c134c562e2e0ca48fe520ccdea3e737dcf427a31':
        'eurusd-h4-2023-calendar-horizons-recovery-v2',
    '2f7bfcd2fdfad9e3d2adcb14e8a0dd4f7fdafe85af8f389ee9f72d3e15299eb9':
        'eurusd-h4-2023-prop-path-survivors-v1',
    '22a08798500af13137cd4203140511065f63ea59caf5668e3985d14264daa0d7':
        'eurusd-h4-2022-q2q3-period-robustness-v1',
    '368aaaf3b9aaae6ef0cb301dac4f42ef4cfeec9e6f44493846805a1fd23158b5':
        'eurusd-h4-utc-2024-historical-validation-v1',
    '5d1c1c99a164ca45e39715d42b9b433f187d05a990efecfd07c4c7539fe27c64':
        'eurusd-h4-compression-2023-robustness-v1',
    'cd73f00a794cdb4d833f83722bcbd524511d9d82f281e7e4fd1bedc5ae8464d5':
        'eurusd-h4-utc-2024-historical-validation-calendar-recovery-v2',
    '4f018bf5bdcc1e22a9bc5d92f9ef41360a71081f33b8a359eeaa8c71f7ffb67c':
        'eurusd-h4-compression-2023-robustness-calendar-recovery-v2',
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
    if registration.get('prop_profile') is not None:
        from .prop_session import PropProfileSnapshot
        if PropProfileSnapshot.model_validate(registration['prop_profile']).model_dump(mode='json')!=registration['prop_profile']:
            raise ValueError('prop profile must be canonical before registration')
    if registration.get('pre_quote_flat_financing') not in (None,'explicit_not_applicable_v1'):
        raise ValueError('unsupported pre-quote financing contract')
    return registration


def validate_registration(registration, inputs, candidate, *, protocol_sha256=None,
                          source_files=None, account_spec_sha256=None, scenarios=None,
                          allow_source_drift=False):
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
    if 'input_pins' in registration:
        pinned={role: registration['input_pins'][role] for role in ('warmup','development')}
        if inputs != pinned:
            raise ValueError('input content pins differ from study registration')
    if 'horizon_cutoffs' in registration:
        start = datetime.strptime(inputs['development']['first_day'], '%Y%m%d').replace(tzinfo=timezone.utc)
        months = registration.get('horizon_months')
        if (months not in ([3, 6], [3, 6, 12]) or start.day != 1
                or any(type(value) is not int for value in months)):
            raise ValueError('time-fit requires registered calendar 3/6 or 3/6/12 months from a month start')
        expected_cutoffs = []
        for count in months:
            offset = start.year*12 + start.month-1 + count
            boundary = start.replace(year=offset//12, month=offset%12+1)
            expected_cutoffs.append(int(boundary.timestamp())*1000)
        end = datetime.strptime(inputs['development']['last_day'], '%Y%m%d').replace(tzinfo=timezone.utc)+timedelta(days=1)
        if (registration['horizon_cutoffs'] != expected_cutoffs
                or any(type(value) is not int for value in registration['horizon_cutoffs'])
                or expected_cutoffs[-1] != int(end.timestamp())*1000):
            raise ValueError('time-fit cutoffs differ from registered calendar horizons')
    if protocol_sha256 is not None and protocol_sha256 != registration['protocol']['sha256']:
        raise ValueError('protocol differs from study registration')
    if account_spec_sha256 is not None and account_spec_sha256 != registration['account_spec']['sha256']:
        raise ValueError('account spec differs from study registration')
    if source_files is not None:
        normalized = {name.replace('\\', '/'): digest for name, digest in source_files.items()}
        if len(normalized) != len(source_files):
            raise ValueError('ambiguous numerical source paths')
        # Legacy registrations allowed CLI plumbing drift. Calendar-aware
        # registrations pin the CLI too because it owns numerical event timing.
        for name, digest in registration['source_files'].items():
            if (not allow_source_drift
                    and (name != 'scripts/forex_h4_pilot.py' or registration.get('calendar_accounting'))
                    and normalized.get(name) != digest):
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
            or manifest.get('calendar_accounting') != registration.get('calendar_accounting')
            or manifest.get('prop_profile') != registration.get('prop_profile')
            or manifest.get('horizon_cutoffs') != registration.get('horizon_cutoffs')
            or manifest.get('pre_quote_flat_financing') != registration.get('pre_quote_flat_financing')
            or binding.get('study_id') != registration['study_id']):
        raise ValueError('historical evidence scope differs from registration')
    validate_registration(registration, manifest['inputs'], manifest['candidate'],
        protocol_sha256=manifest['research_protocol']['sha256'], source_files=manifest['source_files'],
        account_spec_sha256=manifest['observed_account_spec']['sha256'], scenarios=manifest['scenarios'],
        allow_source_drift=manifest.get('benchmark_only') is True)
    return registration
