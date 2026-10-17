"""Capture existing Python execution tests as an independent Rust differential corpus."""
from __future__ import annotations

import functools
import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT / "foundation_v2")]

from trading_workspace_v2 import replay_execution as core
from trading_workspace_v2 import replay_immediate_execution as immediate
from trading_workspace_v2 import replay_tick_execution as tick

CASES = []


def encode(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def capture(module, name, action):
    original = getattr(module, name)

    @functools.wraps(original)
    def wrapped(*args, **kwargs):
        # Freeze iterators before both oracle execution and fixture serialization.
        if "ticks" in kwargs:
            kwargs["ticks"] = list(kwargs["ticks"])
        request = {"action": action, "args": kwargs}
        if args:
            request["snapshot"] = args[0]
        frozen = json.loads(json.dumps(request, default=encode))
        try:
            result = original(*args, **kwargs)
        except (ValueError, TypeError) as error:
            CASES.append({"request": frozen, "error": type(error).__name__, "message": str(error)})
            raise
        snapshot = result.snapshot if hasattr(result, "snapshot") else result
        old = len(frozen.get("snapshot", {}).get("ledger", []))
        raw = encode(snapshot)
        events = [] if action in {"reconstruct", "fork", "validate"} else raw["ledger"][old:]
        CASES.append({"request": frozen, "expected": {"snapshot": raw, "events": events}})
        return result

    setattr(module, name, wrapped)


def randomized_oracle():
    import random
    from foundation_v2.tests.test_replay_execution_core import initial_state
    rng = random.Random(8721)
    for n in range(120):
        base = initial_state().model_dump(mode="json")
        args = {k: base[k] for k in ("replay_session_id", "branch_id", "dataset_id", "dataset_sha256", "instrument_spec", "cost_model", "spread_price", "timeframe_seconds", "starting_balance", "cursor_index")}
        args["instrument_spec"]["ignored_source_metadata"]="not part of financial snapshot"
        args["cost_model"]["ignored_source_metadata"]="not part of financial snapshot"
        args["cost_model"].update(commission_per_side_account=str(rng.choice([Decimal("0.17"), Decimal("1.2345"), Decimal("0")])),
            minimum_fee_account=str(rng.choice([Decimal("0"),Decimal("0.725")])),
            slippage_price_per_side=str(rng.choice([Decimal("0"),Decimal("0.00013")])),
            financing_account=str(rng.choice([Decimal("-0.119"),Decimal("0.167")])),
            quote_to_account_rate=str(rng.choice([Decimal("1"),Decimal("0.901337")])),
            rounding_decimals=rng.choice([0,2,5,8]))
        if n % 2:
            args["research_margin"]={"version":"fixed-starting-balance-leverage-v1", "leverage":str(rng.choice([3,7,30,100]))}
        state=core.initialize_replay_execution(**args)
        buy=n%3==0
        mid=Decimal("1.1")+Decimal(rng.randrange(1,200))/Decimal(10000)
        state=core.queue_market_order(state, operation_id=f"random-open-{n}", side="BUY" if buy else "SELL",
            quantity=str(Decimal(rng.randrange(1,50))/100), stop_loss=None, take_profit=None)
        state=immediate.fill_current_quote(state,mid_close=str(mid),virtual_time_utc=60)
        if state.position is None:
            continue
        stop=mid-Decimal("0.02") if buy else mid+Decimal("0.02")
        target=mid+Decimal("0.02") if buy else mid-Decimal("0.02")
        state=core.change_replay_protection(state,target_id=state.position.position_id, operation_id=f"random-protect-{n}",
            stop_loss=str(stop),take_profit=str(target),mid_close=str(mid),virtual_time_utc=60)
        close=mid+Decimal(rng.randrange(-30,30))/10000
        state=core.advance_replay_execution(state,bar={"timestamp":60,"open":str(mid),"high":str(max(mid,close)+Decimal("0.001")),
            "low":str(min(mid,close)-Decimal("0.001")),"close":str(close)},cursor_index=1).snapshot
        state=core.close_replay_order(state,target_id=state.position.position_id,operation_id=f"random-close-{n}",
            mid_close=str(close),virtual_time_utc=120)
        core.parse_replay_execution_snapshot(state.model_dump(mode="json"))


for module, names in [
    (core, {"initialize_replay_execution": "initialize", "queue_market_order": "queue",
            "parse_replay_execution_snapshot": "validate",
            "advance_replay_execution": "advance", "change_replay_protection": "protection",
            "close_replay_order": "close", "reconstruct_replay_execution_checkpoint": "reconstruct",
            "fork_replay_execution_checkpoint": "fork", "transition_replay_phase": "transition"}),
    (immediate, {"fill_current_quote": "fill_current_quote"}),
    (tick, {"initialize_tick_execution": "initialize", "advance_tick_execution": "advance",
            "change_tick_protection": "protection", "close_tick_order": "close",
            "reconstruct_tick_execution_checkpoint": "reconstruct"}),
]:
    for name, action in names.items():
        capture(module, name, action)


if __name__ == "__main__":
    import pytest

    result = pytest.main([str(ROOT / "foundation_v2/tests" / name) for name in (
        "test_replay_execution_core.py", "test_replay_tick_execution.py", "test_replay_immediate_execution.py",
        "test_replay_protection.py", "test_replay_quick_orders.py", "test_replay_margin_v2.py",
    )] + ["-q", "--disable-warnings"])
    randomized_oracle()
    # Nested tick wrappers call OHLC functions before attaching tick provenance;
    # those temporary outputs are not valid public tick transitions.
    unique = {}
    for case in CASES:
        request = case["request"]
        if request.get("snapshot", {}).get("schema_version") == "replay-execution-tick-v1":
            if request["action"] in {"protection", "close"} and "expected" in case:
                last = case["expected"]["snapshot"]["ledger"][-1]["details"]
                if "bid" not in last:
                    continue
            if request["action"] == "reconstruct" and "expected" in case:
                s = case["expected"]["snapshot"]
                last = next((e["details"] for e in reversed(s["ledger"]) if "bid" in e["details"]), None)
                if last and (Decimal(s["last_bid"]) != Decimal(last["bid"]) or Decimal(s["last_ask"]) != Decimal(last["ask"])):
                    continue
        unique[json.dumps(case, sort_keys=True)] = case
    destination = ROOT / "foundation_v2/evidence/rust-native-20261017/replay-core/oracle.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(list(unique.values()), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Captured {len(unique)} cases from Python tests into {destination}")
    raise SystemExit(result)
