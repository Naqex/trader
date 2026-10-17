"""Exact Decimal serialization fixtures for persisted Prop objectives."""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import sys

V2 = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(V2), str(V2.parent)]
from trading_workspace_v2.prop_session import MoneyOracleInput, PropPhaseSpec, money_oracle

directory = V2 / 'evidence/rust-native-20261017/prop'
base = next(case for case in json.loads((directory / 'fixtures.json').read_text(encoding='utf-8')) if case['op'] == 'money')

def encode(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [encode(item) for item in value]
    return value

cases = []
for capital in ['100000', '100000.00', '100000.000', '1E+5', '0.00000100', '0.000000100', '1234567890123456789012345678', '9999999999999999999999999999']:
    for percent in ['0', '0.00', '5', '5.0', '0.123400', '33.33333333333333333333333333']:
        phase = deepcopy(base['args'][0])
        phase['initial_capital'] = capital
        for rule in ['profit_target', 'daily_loss', 'overall_drawdown']:
            phase[rule]['threshold'] = {'amount': None, 'percent': percent, 'percent_base': 'initial_capital'}
        for accounting in ['costs_included', 'costs_separate']:
            values = {'initial_capital': capital, 'daily_anchor': capital, 'high_water_mark': capital,
                      'balance_before_separate_costs': capital, 'floating_pl': '0.00', 'fees': '0.00',
                      'swap': '0.0', 'conversion_adjustment': '0.000', 'accounting': accounting}
            spec = PropPhaseSpec.model_validate(phase)
            inputs = MoneyOracleInput.model_validate(values)
            cases.append({'name': f'exact-decimal-{capital}-{percent}-{accounting}', 'op': 'money',
                          'args': [spec.model_dump(mode='json'), inputs.model_dump(mode='json')],
                          'expected': encode(money_oracle(spec, inputs))})
target = directory / 'decimal-scale-fixtures.json'
target.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'{len(cases)} exact Decimal fixtures: {target}')
