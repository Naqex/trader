from __future__ import annotations

import copy
import sys
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trading_workspace_v2.forex_pilot_risk import (
    ForexPilotSnapshot, PilotRiskLimits, PilotRiskState, advance_forex_pilot,
    initialize_forex_pilot, queue_forex_pilot_order, queue_forex_pilot_exit,
)
from trading_workspace_v2.replay_execution import ReplayExecutionError, queue_market_order
from trading_workspace_v2.replay_tick_execution import (
    BrokerReplayTick, ReplayTickExecutionSnapshot, advance_tick_execution, initialize_tick_execution,
)


def ms(text="2022-01-03T12:00:00+00:00"):
    return int(datetime.fromisoformat(text).timestamp() * 1000)


def tick(bid="1.10000", ask="1.10020", *, when=None, sequence=0):
    return {"time_msc": ms() if when is None else when, "sequence": sequence, "bid": bid, "ask": ask}


def execution(*, commission="0", financing="0", slippage="0"):
    # Declared synthetic costs and instrument, not an FTMO account specification.
    return initialize_tick_execution(replay_session_id="pilot-test", branch_id="main",
        dataset_id="synthetic", dataset_sha256="d" * 64,
        tick_snapshot_id="synthetic-ticks", tick_snapshot_sha256="a" * 64,
        instrument_spec={"instrument_id": "EURUSD", "asset_class": "fx", "base_ccy": "EUR",
            "quote_ccy": "USD", "account_ccy": "USD", "tick_size": "0.00001",
            "pip_size": "0.0001", "contract_size": "100000", "quantity_min": "0.01",
            "quantity_step": "0.01", "effective_from_utc": "2022-01-01T00:00:00Z"},
        cost_model={"version": "synthetic-pilot-cost-v1", "spread_basis": "bid_ask_embedded",
            "commission_per_side_account": commission, "minimum_fee_account": "0",
            "slippage_price_per_side": slippage, "financing_account": financing,
            "quote_to_account_rate": "1", "account_ccy": "USD", "rounding_decimals": 2},
        spread_price="0", timeframe_seconds=60, starting_balance="10000", cursor_index=0,
        research_margin={"version": "fixed-starting-balance-leverage-v1", "leverage": "30"})


def bar(ticks):
    mids = [(Decimal(t["bid"]) + Decimal(t["ask"])) / 2 for t in ticks]
    return {"timestamp": ticks[0]["time_msc"] // 60000 * 60,
            "open": float(mids[0]), "high": float(max(mids)), "low": float(min(mids)),
            "close": float(mids[-1])}


def advance(snapshot, ticks):
    return advance_forex_pilot(snapshot, ticks=iter(ticks), bar=bar(ticks),
                               cursor_index=snapshot.execution.cursor_index + 1)


def queue(snapshot, *, side="BUY", quantity="1", stop="1.10000", operation="entry"):
    return queue_forex_pilot_order(snapshot, operation_id=operation, side=side, quantity=quantity,
                                   stop_loss=stop, take_profit=None)


def carried(*, side="BUY", at=None):
    # Inject an oversized carried position to stress the liquidation guard independently
    # of admission. Normal pilot admission would reject this wide initial stop.
    first = tick(when=ms() if at is None else at)
    state = queue_market_order(execution(), operation_id="carry", side=side, quantity="1",
                               stop_loss="1.05" if side == "BUY" else "1.15", take_profit=None)
    opened = advance_tick_execution(state, ticks=[first], bar=bar([first]), cursor_index=1).snapshot
    return ForexPilotSnapshot(execution=opened, limits=PilotRiskLimits(),
        risk=PilotRiskState(day=datetime.fromtimestamp(first["time_msc"] / 1000,
            tz=ZoneInfo("Europe/Prague")).date().isoformat(),
            start_time_msc=first["time_msc"], daily_anchor_balance=Decimal("10000"),
            last_tick=BrokerReplayTick.model_validate(first), observed_ticks=1,
            minimum_observed_equity=opened.equity))


class ForexPilotRiskTests(unittest.TestCase):
    def test_invalid_last_quote_does_not_publish_counters_and_valid_retry_can_restart(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        before = initial.model_dump_json()
        quotes = [tick(), tick(when=ms()+1, sequence=1)]
        with self.assertRaises(ValueError):
            advance(initial, [*quotes, tick('1.10030', '1.10020', when=ms()+2)])
        self.assertEqual(initial.model_dump_json(), before)
        accepted = advance(initial, quotes)
        self.assertEqual(accepted.risk.observed_ticks, 2)
        self.assertEqual(accepted.risk.last_tick.time_msc, ms()+1)
        restored = ForexPilotSnapshot.model_validate_json(accepted.model_dump_json())
        following = advance(restored, [tick(when=ms()+60000), tick(when=ms()+60000, sequence=1)])
        self.assertEqual(following.risk.observed_ticks, 4)
        self.assertEqual(following.risk.last_tick.sequence, 1)
        self.assertEqual(restored.risk.observed_ticks, 2)

    def test_repeated_prices_keep_tick_count_and_same_ms_risk_trigger_then_close(self):
        for side, normal, breach, recovery in (
            ("BUY", ("1.10000", "1.10020"), ("1.09920", "1.09940"), ("1.09930", "1.09950")),
            ("SELL", ("1.10000", "1.10020"), ("1.10080", "1.10100"), ("1.10070", "1.10090")),
        ):
            with self.subTest(side=side):
                state = carried(side=side)
                when = ms() + 60000
                quotes = [tick(*normal, when=when, sequence=0),
                          tick(*normal, when=when, sequence=1),
                          tick(*breach, when=when, sequence=2),
                          tick(*recovery, when=when, sequence=3),
                          tick(*recovery, when=when + 1, sequence=0)]
                result = advance(state, quotes)
                self.assertEqual(result.risk.observed_ticks, 6)
                self.assertEqual(result.risk.minimum_observed_equity, Decimal("9900"))
                self.assertEqual(result.risk.stops[0].tick.sequence, 2)
                self.assertTrue(result.risk.daily_stopped)
                closes = [e for e in result.execution.ledger if e["kind"] == "protective_fill"]
                self.assertEqual(len(closes), 1)
                self.assertEqual(closes[0]["details"]["reason"], "pilot_risk_stop")
                self.assertEqual(closes[0]["details"]["sequence"], 3)
                self.assertEqual(result.execution.balance, Decimal("9910"))
                self.assertEqual(result.execution.floating_pl, Decimal("0"))
                self.assertIsNone(result.execution.position)

    def test_strategy_exit_uses_first_quote_strictly_after_decision_for_both_sides(self):
        for side, stop, bid, ask in (("BUY", "1.09", "1.09900", "1.09920"),
                                    ("SELL", "1.11", "1.10100", "1.10120")):
            with self.subTest(side=side):
                initial = initialize_forex_pilot(execution(commission="0.025"), start_time_msc=ms())
                opened = advance(queue(initial, side=side, quantity="0.01", stop=stop), [tick()])
                requested = queue_forex_pilot_exit(opened, operation_id="strategy-exit")
                decision = ms() + 60000
                result = advance(requested, [tick(when=decision),
                    tick(bid, ask, when=decision, sequence=1),
                    tick(bid, ask, when=decision + 1)])
                closes = [e for e in result.execution.ledger if e["kind"] == "protective_fill"]
                self.assertEqual(len(closes), 1)
                self.assertEqual(closes[0]["details"]["time_msc"], decision + 1)
                self.assertEqual(closes[0]["details"]["reason"], "pilot_strategy_exit")
                self.assertEqual(closes[0]["details"]["command_operation_id"], "strategy-exit")
                self.assertEqual(result.execution.balance, Decimal("9998.75"))
                self.assertIsNone(result.risk.exit_pending)
                ForexPilotSnapshot.model_validate_json(result.model_dump_json())
                with self.assertRaisesRegex(ReplayExecutionError, "already consumed"):
                    queue(result, operation="strategy-exit")

    def test_exit_waits_for_later_quote_and_survives_json_restart(self):
        opened = advance(queue(initialize_forex_pilot(execution(), start_time_msc=ms()),
                               quantity="0.01", stop="1.09"), [tick()])
        requested = queue_forex_pilot_exit(opened, operation_id="exit")
        boundary_only = advance(requested, [tick(when=ms() + 60000)])
        self.assertIsNotNone(boundary_only.execution.position)
        self.assertEqual(boundary_only.risk.exit_pending, requested.risk.exit_pending)
        restored = ForexPilotSnapshot.model_validate_json(boundary_only.model_dump_json())
        result = advance(restored, [tick("1.09800", "1.09820", when=ms() + 120000)])
        self.assertIsNone(result.execution.position)
        self.assertEqual(result.execution.balance, Decimal("9997.80"))

    def test_existing_protection_wins_and_clears_queued_strategy_exit(self):
        for side, stop, bid, ask in (("BUY", "1.09900", "1.09800", "1.09820"),
                                    ("SELL", "1.10100", "1.10200", "1.10220")):
            with self.subTest(side=side):
                opened = advance(queue(initialize_forex_pilot(execution(), start_time_msc=ms()),
                    side=side, quantity="0.01", stop=stop), [tick()])
                requested = queue_forex_pilot_exit(opened, operation_id="exit")
                result = advance(requested, [tick(bid, ask, when=ms() + 60001)])
                closes = [e for e in result.execution.ledger if e["kind"] == "protective_fill"]
                self.assertEqual(len(closes), 1)
                self.assertEqual(closes[0]["details"]["reason"], "stop_loss")
                self.assertIsNone(result.risk.exit_pending)

    def test_risk_liquidation_wins_and_preserves_latch(self):
        pending = advance(carried(), [tick("1.09920", "1.09940", when=ms() + 60000)])
        self.assertTrue(pending.risk.daily_stopped)
        requested = queue_forex_pilot_exit(pending, operation_id="exit-while-halted")
        result = advance(requested, [tick("1.09800", "1.09820", when=ms() + 120001)])
        closes = [e for e in result.execution.ledger if e["kind"] == "protective_fill"]
        self.assertEqual(len(closes), 1)
        self.assertEqual(closes[0]["details"]["reason"], "pilot_risk_stop")
        self.assertTrue(result.risk.daily_stopped)
        self.assertIsNone(result.risk.exit_pending)
        self.assertIsNone(result.risk.close_pending)

    def test_exit_rejects_missing_position_duplicate_and_altered_decision(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        with self.assertRaisesRegex(ReplayExecutionError, "open position"):
            queue_forex_pilot_exit(initial, operation_id="exit")
        opened = advance(queue(initial, quantity="0.01", stop="1.09"), [tick()])
        for operation in ("entry", " "):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                queue_forex_pilot_exit(opened, operation_id=operation)
        requested = queue_forex_pilot_exit(opened, operation_id="exit")
        with self.assertRaisesRegex(ReplayExecutionError, "already queued"):
            queue_forex_pilot_exit(requested, operation_id="another-exit")
        raw = requested.model_dump(mode="json")
        raw["risk"]["exit_pending"]["decision_time_msc"] += 1
        with self.assertRaisesRegex(ValueError, "canonical closed-bar"):
            ForexPilotSnapshot.model_validate(raw)
        result = advance(requested, [tick(when=ms() + 60001)])
        raw = result.execution.model_dump(mode="json")
        close = next(e for e in raw["ledger"] if e["details"].get("reason") == "pilot_strategy_exit")
        close["details"]["pilot_exit"]["decision_time_msc"] += 1
        with self.assertRaisesRegex(ValueError, "canonical closed-bar"):
            ReplayTickExecutionSnapshot.model_validate(raw)

    def test_invalid_window_keeps_strategy_exit_queued_without_partial_fill(self):
        opened = advance(queue(initialize_forex_pilot(execution(), start_time_msc=ms()),
                               quantity="0.01", stop="1.09"), [tick()])
        requested = queue_forex_pilot_exit(opened, operation_id="exit")
        before = requested.model_dump(mode="json")
        with self.assertRaises(ValueError):
            advance(requested, [tick(when=ms() + 60001),
                tick("1.10020", "1.10000", when=ms() + 60002)])
        self.assertEqual(requested.model_dump(mode="json"), before)

    def test_limits_and_account_currency_fail_closed(self):
        for values in ({"per_trade_loss": "NaN"}, {"daily_loss": "10"}, {"overall_loss": "0"}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                PilotRiskLimits(**values)
        e = execution()
        e.instrument_spec["account_ccy"] = "EUR"
        with self.assertRaisesRegex(ValueError, "USD research account"):
            initialize_forex_pilot(e, start_time_msc=ms())

    def test_trade_risk_includes_commission_and_allows_exact_25_dollars(self):
        for side, stop in (("BUY", "1.10000"), ("SELL", "1.10020")):
            with self.subTest(side=side):
                initial = initialize_forex_pilot(execution(commission="2.50"), start_time_msc=ms())
                result = advance(queue(initial, side=side, stop=stop), [tick()])
                # Stop is hit at the same first quote; spread20 + commission5 = loss25.
                self.assertEqual(result.execution.balance, Decimal("9975"))
                self.assertFalse(result.risk.rejections)

    def test_cost_above_budget_rejects_without_opening_or_charging(self):
        for costs in ({"commission": "2.51"}, {"financing": "5.01"}, {"slippage": "0.00003"}):
            with self.subTest(costs=costs):
                initial = initialize_forex_pilot(execution(**costs), start_time_msc=ms())
                result = advance(queue(initial), [tick()])
                self.assertIsNone(result.execution.position)
                self.assertEqual(result.execution.balance, Decimal("10000"))
                self.assertEqual(result.risk.rejections[0].reason, "trade_risk")
                self.assertGreater(result.risk.rejections[0].estimated_loss, 25)

    def test_no_stop_and_entry_gap_are_not_filled(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        with self.assertRaisesRegex(ReplayExecutionError, "stop loss"):
            queue(initial, stop=None)
        result = advance(queue(initial), [tick("1.09950", "1.09970")])
        self.assertEqual(result.risk.rejections[0].reason, "entry_gap")
        self.assertIsNone(result.execution.position)
        with self.assertRaisesRegex(ReplayExecutionError, "already rejected"):
            queue(result)

    def test_buy_temporary_breach_closes_next_same_ms_quote_at_gap_price(self):
        initial = carried()
        when = ms() + 60000
        result = advance(initial, [tick("1.09920", "1.09940", when=when),
            tick("1.09800", "1.09820", when=when, sequence=1),
            tick("1.10500", "1.10520", when=when + 1)])
        close = next(e for e in result.execution.ledger if e["details"].get("reason") == "pilot_risk_stop")
        self.assertEqual(close["details"]["fill_price"], "1.09800")
        self.assertEqual(result.execution.balance, Decimal("9780"))
        self.assertEqual(result.risk.minimum_observed_equity, Decimal("9780"))
        self.assertTrue(result.risk.daily_stopped)
        self.assertEqual(result.risk.stops[0].equity, Decimal("9900"))
        self.assertEqual(result.risk.observed_ticks, 4)
        self.assertEqual(result.execution.ledger[-1]["details"]["intrabar_equity_coverage"], "insufficient")
        with self.assertRaisesRegex(ReplayExecutionError, "pilot is stopped"):
            queue(result)

    def test_sell_spread_widening_is_measured_at_ask(self):
        result = advance(carried(side="SELL"), [
            tick("1.10000", "1.10100", when=ms() + 60000),
            tick("1.10000", "1.10220", when=ms() + 60001)])
        self.assertEqual(result.execution.balance, Decimal("9780"))
        self.assertTrue(result.risk.daily_stopped)

    def test_normal_stop_can_fill_on_breach_quote_without_duplicate_risk_close(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        result = advance(queue(initial, stop="1.09999"), [tick(),
            tick("1.09920", "1.09940", when=ms() + 1),
            tick("1.09800", "1.09820", when=ms() + 2)])
        closes = [e for e in result.execution.ledger if e["kind"] == "protective_fill"]
        self.assertEqual(len(closes), 1)
        self.assertEqual(closes[0]["details"]["reason"], "stop_loss")
        self.assertEqual(result.execution.balance, Decimal("9900"))
        self.assertTrue(result.risk.daily_stopped)
        self.assertIsNone(result.risk.close_pending)

    def test_margin_rejection_remains_owned_by_execution(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms())
        result = advance(queue(initial, quantity="3"), [tick(ask="1.10001")])
        self.assertEqual(result.execution.ledger[0]["details"]["reason"], "insufficient_research_margin")
        self.assertFalse(result.risk.rejections)
        self.assertEqual(result.execution.balance, Decimal("10000"))

    def test_pending_close_survives_json_restart_and_new_day(self):
        midnight = ms("2022-01-03T23:00:00+00:00")
        initial = carried(at=midnight - 120000)
        pending = advance(initial, [tick("1.09920", "1.09940", when=midnight - 1)])
        self.assertIsNotNone(pending.risk.close_pending)
        restored = ForexPilotSnapshot.model_validate_json(pending.model_dump_json())
        result = advance(restored, [tick("1.09800", "1.09820", when=midnight)])
        self.assertIsNone(result.execution.position)
        self.assertIsNone(result.risk.close_pending)
        self.assertEqual(result.execution.balance, Decimal("9780"))
        self.assertEqual(result.risk.daily_anchor_balance, Decimal("10000"))
        self.assertTrue(result.risk.daily_stopped)
        ForexPilotSnapshot.model_validate_json(result.model_dump_json())
        tampered = copy.deepcopy(result.execution.model_dump(mode="json"))
        event = next(e for e in tampered["ledger"] if e["details"].get("reason") == "pilot_risk_stop")
        event["details"]["pilot_trigger"]["equity"] = "9899"
        with self.assertRaisesRegex(ValueError, "trigger equity"):
            ReplayTickExecutionSnapshot.model_validate(tampered)

    def test_remaining_daily_budget_is_checked_after_realized_losses(self):
        current = initialize_forex_pilot(execution(), start_time_msc=ms())
        for i in range(4):
            current = advance(queue(current, quantity="0.1", stop="1.09820", operation=f"loss-{i}"), [
                tick(when=ms() + i * 60000 + 1),
                tick("1.09820", "1.09840", when=ms() + i * 60000 + 2)])
        self.assertEqual(current.execution.balance, Decimal("9920"))
        result = advance(queue(current, quantity="0.1", stop="1.09820", operation="too-large"),
                         [tick(when=ms() + 4 * 60000 + 1)])
        self.assertEqual(result.risk.rejections[-1].reason, "remaining_budget")
        self.assertIsNone(result.execution.position)

    def test_daily_latch_resets_at_prague_midnight_and_overall_does_not(self):
        for local_midnight in ("2022-01-03T23:00:00+00:00", "2022-07-03T22:00:00+00:00"):
            midnight = ms(local_midnight)
            initial = carried(at=midnight - 120000)
            stopped = advance(initial, [tick("1.09920", "1.09940", when=midnight - 60000),
                                       tick("1.09920", "1.09940", when=midnight - 59999)])
            resumed = advance(stopped, [tick(when=midnight)])
            self.assertFalse(resumed.risk.daily_stopped)
            self.assertEqual(resumed.risk.daily_anchor_balance, Decimal("9900"))
            self.assertIsNotNone(queue(resumed, quantity="0.01").execution.pending_market_order)
        midnight = ms("2022-01-03T23:00:00+00:00")
        stopped = advance(carried(at=midnight - 120000), [
            tick("1.09520", "1.09540", when=midnight - 60000),
            tick("1.09420", "1.09440", when=midnight - 59999)])
        result = advance(stopped, [tick(when=midnight)])
        self.assertTrue(result.risk.overall_stopped)
        with self.assertRaisesRegex(ReplayExecutionError, "pilot is stopped"):
            queue(result)

    def test_invalid_later_quote_does_not_publish_partial_risk_or_execution(self):
        initial = carried()
        before = initial.model_dump(mode="json")
        with self.assertRaises(ValueError):
            advance(initial, [tick("1.09920", "1.09940", when=ms() + 60000),
                              tick("1.10020", "1.10000", when=ms() + 60001)])
        self.assertEqual(initial.model_dump(mode="json"), before)

    def test_registered_time_empty_coverage_and_corrupt_checkpoint_are_rejected(self):
        initial = initialize_forex_pilot(execution(), start_time_msc=ms() + 1)
        with self.assertRaisesRegex(ReplayExecutionError, "registered start time"):
            advance(initial, [tick()])
        with self.assertRaisesRegex(ReplayExecutionError, "coverage is empty"):
            advance_forex_pilot(initial, ticks=[], bar=bar([tick()]), cursor_index=1)
        current = carried()
        raw = current.model_dump(mode="json")
        raw["risk"]["last_tick"]["sequence"] += 1
        with self.assertRaisesRegex(ValueError, "last quote"):
            ForexPilotSnapshot.model_validate(raw)


if __name__ == "__main__":
    unittest.main()
