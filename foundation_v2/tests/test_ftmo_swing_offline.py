"""Synthetic rule conformance; no market data, broker or challenge qualification."""
from __future__ import annotations

import copy
import json
import sys
import unittest
from decimal import Decimal
from pathlib import Path

from pydantic import ValidationError

V2 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V2))
from trading_workspace_v2.prop_session import (
    ChallengeAttemptSnapshot, MoneyOracleInput, PhaseStateSnapshot,
    PropLifecycleEvent, PropPhaseSpec, PropSessionSnapshot,
    evaluate_prop_lifecycle_event, money_oracle,
)

FIXTURE = json.loads((V2 / "tests/fixtures/ftmo-swing-offline.json").read_text(encoding="utf-8"))


def evaluate(payload):
    return evaluate_prop_lifecycle_event(
        PropSessionSnapshot.model_validate(payload["session"]),
        ChallengeAttemptSnapshot.model_validate(payload["attempt"]),
        PhaseStateSnapshot.model_validate(payload["phase"]),
        PropLifecycleEvent.model_validate(payload["event"]),
        resume_state=payload["resume_state"],
    )


class FtmoSwingOfflineTests(unittest.TestCase):
    def test_balance_anchor_is_independent_of_floating_profit_and_cost_order(self):
        for order in ("fees_then_reset", "reset_then_fees"):
            for floating in ("-100", "100"):
                with self.subTest(order=order, floating=floating):
                    p = copy.deepcopy(FIXTURE)
                    p["session"]["profile"]["phases"][0]["reset_order"] = order
                    p["event"].update(floating_pl=floating, fees="2", swap="3")
                    result = evaluate(p)
                    anchor = Decimal("10195" if order == "fees_then_reset" else "10200")
                    self.assertEqual(result["phase"].daily_anchor, anchor)
                    self.assertEqual(result["phase"].balance, Decimal("10195"))
                    self.assertEqual(result["objectives"]["money"]["daily_loss"]["floor"], str(anchor - 500))

    def test_legacy_profiles_keep_equity_anchor_when_field_is_absent(self):
        p = copy.deepcopy(FIXTURE)
        del p["session"]["profile"]["phases"][0]["daily_anchor_basis"]
        self.assertEqual(evaluate(p)["phase"].daily_anchor, Decimal("10100"))

    def test_midnight_can_breach_new_day_floor_without_a_new_price_move(self):
        p = copy.deepcopy(FIXTURE)
        p["event"]["floating_pl"] = "-600"
        result = evaluate(p)
        self.assertEqual(result["phase"].equity, Decimal("9600"))
        self.assertEqual(result["objectives"]["money"]["daily_loss"]["floor"], "9700")
        self.assertEqual(result["attempt"].status, "failed_breach")

    def test_exact_loss_floor_is_allowed_but_one_cent_below_breaches(self):
        spec = PropPhaseSpec.model_validate(FIXTURE["session"]["profile"]["phases"][0])
        for anchor, balance, floor_key in (("10000", "9500", "daily_loss"), ("9500", "9000", "overall_drawdown")):
            for adjustment, breached in (("0", False), ("-0.01", True)):
                with self.subTest(anchor=anchor, adjustment=adjustment):
                    result = money_oracle(spec, MoneyOracleInput(
                        initial_capital="10000", daily_anchor=anchor,
                        balance_before_separate_costs=Decimal(balance) + Decimal(adjustment),
                        floating_pl="0", high_water_mark="12000",
                    ))
                    self.assertEqual(result[floor_key]["breached"], breached)
                    self.assertEqual(result["overall_drawdown"]["floor"], Decimal("9000"))

    def test_target_needs_four_entry_days_and_closed_positions_in_each_phase(self):
        for phase_index, balance, status in ((1, "11000", "phase_passed"), (2, "10500", "completed_pass")):
            for days, opened in ((3, 0), (4, 1), (4, 0)):
                with self.subTest(phase=phase_index, days=days, opened=opened):
                    p = copy.deepcopy(FIXTURE)
                    p["phase"].update(phase_index=phase_index, virtual_time_utc="2026-01-05T12:00:00+00:00")
                    p["event"].update(kind="simulation_snapshot", virtual_time_utc="2026-01-05T13:00:00+00:00",
                                      balance_before_separate_costs=balance, floating_pl="0", open_positions=opened)
                    p["resume_state"] = {"prop_lifecycle": {"qualifying_local_dates": [f"2026-01-0{d}" for d in range(1, days + 1)]}}
                    self.assertEqual(evaluate(p)["attempt"].status, status if days == 4 and opened == 0 else "running")

    def test_carrying_an_open_position_does_not_add_a_trading_day(self):
        p = copy.deepcopy(FIXTURE)
        p["resume_state"] = {"prop_lifecycle": {"qualifying_local_dates": ["2026-01-01"]}}
        self.assertEqual(evaluate(p)["phase"].qualifying_days, 1)

    def test_close_only_equity_cannot_pass_the_evaluation(self):
        p = copy.deepcopy(FIXTURE)
        p["event"].update(evaluation_quality="approximate", balance_before_separate_costs="11000", floating_pl="0", open_positions=0)
        result = evaluate(p)
        self.assertEqual(result["objectives"]["technical_status"], "blocked_by_data")
        self.assertFalse(result["objectives"]["pass_ready"])
        self.assertEqual(result["attempt"].status, "running")

    def test_invalid_anchor_basis_is_rejected(self):
        p = copy.deepcopy(FIXTURE["session"]["profile"]["phases"][0])
        p["daily_anchor_basis"] = "high_water_mark"
        with self.assertRaises(ValidationError):
            PropPhaseSpec.model_validate(p)


if __name__ == "__main__":
    unittest.main()
