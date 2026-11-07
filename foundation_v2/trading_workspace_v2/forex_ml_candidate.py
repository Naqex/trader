"""Frozen H1 ML signals from local JSON; no training, broker or scientific runtime."""
from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
import struct

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .forex_h4 import CandleState, HOUR

ML_CANDIDATES = tuple('eurusd-h1-ml-' + name + '-tr14x1p5-time4-r025-v1'
                      for name in ('ridge', 'forest', 'ridge-shuffled', 'forest-shuffled'))
FEATURE_NAMES = (*('return' + str(n) for n in (1, 3, 6, 12, 24, 48, 72)),
    'range', 'body', 'upper_wick', 'lower_wick', 'gap_sma20', 'gap_sma80',
    'std20_changes', 'channel20', 'hour_sin', 'hour_cos', 'weekday_sin',
    'weekday_cos', 'gap168', 'spread')


def features(history, spread=Decimal(0)):
    if len(history) < 100:
        return None, None
    bars = list(history)[-100:]
    tr = sum((max(b.high-b.low, abs(b.high-a.close), abs(b.low-a.close))
              for a, b in zip(bars[-15:-1], bars[-14:])), Decimal(0))/14
    if tr <= 0:
        return None, None
    last = bars[-1]
    closes = [p.close for p in bars]
    changes = [b-a for a, b in zip(closes[-21:-1], closes[-20:])]
    avg = sum(changes, Decimal(0))/20
    variance = sum(((p-avg)**2 for p in changes), Decimal(0))/20
    lo, hi = min(p.low for p in bars[-20:]), max(p.high for p in bars[-20:])
    raw = [(last.close-closes[-n-1])/tr for n in (1, 3, 6, 12, 24, 48, 72)]
    raw += [(last.high-last.low)/tr, (last.close-last.open)/tr,
        (last.high-max(last.open, last.close))/tr, (min(last.open, last.close)-last.low)/tr,
        (last.close-sum(closes[-20:], Decimal(0))/20)/tr,
        (last.close-sum(closes[-80:], Decimal(0))/80)/tr, variance.sqrt()/tr,
        (last.close-lo)/(hi-lo) if hi > lo else Decimal('.5')]
    end = datetime.fromtimestamp(last.timestamp+HOUR, timezone.utc)
    raw += [math.sin(2*math.pi*end.hour/24), math.cos(2*math.pi*end.hour/24),
        math.sin(2*math.pi*end.weekday()/7), math.cos(2*math.pi*end.weekday()/7),
        min((last.timestamp-bars[-2].timestamp)/HOUR, 168)/168, spread/tr]
    values = [float(p) for p in raw]
    if len(values) != len(FEATURE_NAMES) or not all(math.isfinite(p) for p in values):
        raise ValueError('nonfinite ML features')
    return values, tr*Decimal('1.5')


def pack_digest(pack):
    return hashlib.sha256(json.dumps(pack, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def validate_model(model):
    n = len(FEATURE_NAMES)
    if model.get('kind') == 'ridge':
        for key in ('mean', 'scale'):
            if len(model[key]) != n or not all(_finite(x) for x in model[key]):
                raise ValueError('invalid ridge preprocessing')
        if (any(x <= 0 for x in model['scale']) or len(model['coef']) != 2
                or any(len(row) != n or not all(_finite(x) for x in row) for row in model['coef'])
                or len(model['intercept']) != 2 or not all(_finite(x) for x in model['intercept'])):
            raise ValueError('invalid ridge coefficients')
    elif model.get('kind') == 'forest':
        if not 1 <= len(model['trees']) <= 80:
            raise ValueError('invalid tree count')
        for tree in model['trees']:
            if not 1 <= len(tree) <= 31:
                raise ValueError('invalid bounded tree')
            parents = [0]*len(tree)
            for i, node in enumerate(tree):
                if (len(node) != 5 or type(node[0]) is not int or not _finite(node[1])
                        or len(node[4]) != 2 or not all(_finite(x) for x in node[4])):
                    raise ValueError('invalid tree node')
                feature, _, left, right, _ = node
                if type(left) is not int or type(right) is not int:
                    raise ValueError('invalid child index')
                if left == right == -1:
                    if feature != -2:
                        raise ValueError('invalid leaf')
                elif 0 <= feature < n and i < left < len(tree) and i < right < len(tree) and left != right:
                    parents[left] += 1
                    parents[right] += 1
                else:
                    raise ValueError('cyclic/outside tree')
            if parents != [0]+[1]*(len(tree)-1):
                raise ValueError('unreachable/shared tree node')
    else:
        raise ValueError('unknown safe model')


def predict(model, x):
    if len(x) != len(FEATURE_NAMES) or not all(_finite(p) for p in x):
        raise ValueError('invalid feature vector')
    if model['kind'] == 'ridge':
        scaled = [(v-a)/b for v, a, b in zip(x, model['mean'], model['scale'])]
        return [sum(v*c for v, c in zip(scaled, row))+intercept
                for row, intercept in zip(model['coef'], model['intercept'])]
    # sklearn's tree predictor converts features to float32 before comparisons.
    values = [struct.unpack('f', struct.pack('f', p))[0] for p in x]
    result = [0., 0.]
    for tree in model['trees']:
        node = tree[0]
        while node[2] != -1:
            node = tree[node[2] if values[node[0]] <= node[1] else node[3]]
        for j in range(2):
            result[j] += node[4][j]/len(model['trees'])
    return result


def validate_pack(pack, candidate):
    if (candidate not in ML_CANDIDATES or pack.get('schema') != 'forex-ml-h1-pack-v1'
            or pack.get('candidate') != candidate or pack.get('feature_names') != list(FEATURE_NAMES)
            or not pack.get('folds') or len(pack['folds']) > 4):
        raise ValueError('ML pack identity/schema mismatch')
    previous = -1
    for fold in pack['folds']:
        cutoff, available = fold['cutoff'], fold['available_from']
        if (type(cutoff) is not int or type(available) is not int or cutoff <= previous
                or available != cutoff+HOUR or fold['last_label_endpoint_msc'] >= cutoff*1000
                or fold['train_start'] >= cutoff or fold['train_rows'] < 100):
            raise ValueError('ML training/availability leakage')
        previous = cutoff
        validate_model(fold['model'])


class MLH1State(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, allow_inf_nan=False)
    candidate: str
    pack_sha256: str
    history: tuple[CandleState, ...] = Field(default=(), max_length=100)
    position_id: str | None = None
    position_side: str | None = None
    held_bars: int = Field(default=0, ge=0, strict=True)

    @model_validator(mode='after')
    def consistent(self):
        times = [b.timestamp for b in self.history]
        if (self.candidate not in ML_CANDIDATES or len(self.pack_sha256) != 64
                or any(c not in '0123456789abcdef' for c in self.pack_sha256)
                or any(t % HOUR for t in times) or any(b <= a for a, b in zip(times, times[1:]))
                or self.position_side not in (None, 'BUY', 'SELL')
                or (self.position_id is None) != (self.position_side is None)
                or (self.position_id is None and self.held_bars != 0)
                or (self.position_id is not None and (not times or not self.position_id.strip() or self.held_bars < 1))):
            raise ValueError('invalid ML causal state')
        return self


class MLH1Candidate:
    def __init__(self, candidate, pack):
        validate_pack(pack, candidate)
        # Take ownership; caller mutations cannot change a running signal.
        self.pack = json.loads(json.dumps(pack, allow_nan=False))
        self.candidate = candidate
        self.pack_sha256 = pack_digest(self.pack)
        self.history = deque(maxlen=100)
        self.position_id = self.position_side = None
        self.held_bars = 0

    def export_state(self):
        return MLH1State(candidate=self.candidate, pack_sha256=self.pack_sha256,
            history=tuple(CandleState(**vars(p)) for p in self.history),
            position_id=self.position_id, position_side=self.position_side, held_bars=self.held_bars)

    @classmethod
    def from_state(cls, state, *, pack):
        state = MLH1State.model_validate(state)
        result = cls(state.candidate, pack)
        if result.pack_sha256 != state.pack_sha256:
            raise ValueError('ML restore pack changed')
        result.history.extend(p.candle() for p in state.history)
        result.position_id, result.position_side, result.held_bars = state.position_id, state.position_side, state.held_bars
        return result

    def observe(self, candle, *, side=None, position_id=None, spread=Decimal(0)):
        bar = CandleState(**vars(candle))
        if (bar.timestamp % HOUR or (self.history and bar.timestamp <= self.history[-1].timestamp)
                or side not in (None, 'BUY', 'SELL') or (side is None) != (position_id is None)
                or (position_id is not None and (not isinstance(position_id, str) or not position_id.strip()))
                or (position_id is not None and position_id == self.position_id and side != self.position_side)
                or not spread.is_finite() or spread < 0):
            raise ValueError('invalid ML H1 observation/position/spread')
        self.held_bars = (self.held_bars+1 if position_id == self.position_id else 1) if position_id else 0
        self.position_id, self.position_side = position_id, side
        self.history.append(candle)
        x, distance = features(self.history, spread)
        if side is not None:
            return ('EXIT' if self.held_bars >= 4 else None), distance
        if x is None:
            return None, distance
        available = [fold for fold in self.pack['folds'] if fold['available_from'] <= bar.timestamp+HOUR]
        if not available:
            return None, distance
        buy, sell = predict(available[-1]['model'], x)
        return ('BUY' if buy > max(.1, sell) else 'SELL' if sell > max(.1, buy) else None), distance
