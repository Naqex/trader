"""Export deterministic offline control-route parity cases from the existing domain."""
from __future__ import annotations

import json
from pathlib import Path
import random
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT.parent), str(ROOT)]

from trading_workspace_v2.product import ProductService
from ai_provider import OfflineProvider
from ai_service import AIService
from trading_workspace_v2.connector_ledger import validate_connection_request, validate_intent_request, fingerprint


def main():
    cases = []
    def record(kind, body, fn):
        try:
            cases.append({"kind": kind, "body": body, "expected": fn(body)})
        except ValueError as exc:
            cases.append({"kind": kind, "body": body, "error": str(exc)})

    instrument = dict(instrument_id="EURUSD", asset_class="fx", base_ccy="eur", quote_ccy="usd", account_ccy="usd", tick_size="0.00001", pip_size="0.0001", contract_size="100000", quantity_min="0.01", quantity_step="0.01", effective_from_utc="2026-01-01T00:00:00Z")
    record("instrument", {"instrument": instrument}, lambda body: ProductService.validate_instrument(body["instrument"]))
    for field, value in [("tick_size", "0"), ("pip_size", "-1"), ("quantity_step", "NaN"), ("instrument_id", " "), ("base_ccy", None), ("effective_to_utc", " end "), ("quantity_min", "wrong")]:
        record("instrument", {"instrument": {**instrument, field: value}}, lambda body: ProductService.validate_instrument(body["instrument"]))

    randomizer = random.Random(20261017)
    for index in range(200):
        bid = round(randomizer.uniform(.5, 2000), 5)
        ask = bid + .0002
        exit_bid = round(bid + randomizer.uniform(-.05, .05), 5)
        cost_model = dict(version="parity-v1", spread_basis="bid_ask_embedded", account_ccy="usd", rounding_decimals=index % 9, commission_per_side_account=str(index % 4 / 100), minimum_fee_account="0.03", slippage_price_per_side="0.00001", financing_account="-0.005", quote_to_account_rate="1.1")
        body = dict(cost_model=cost_model, side="BUY" if index % 2 else "sell", quantity=.01, contract_size=100000, entry_bid=bid, entry_ask=ask, exit_bid=exit_bid, exit_ask=exit_bid + .0002)
        record("cost", body, ProductService.preview_cost)
    base = cases[-1]["body"]
    for field, value in [("entry_ask", .1), ("quantity", 0), ("side", "bad")]:
        record("cost", {**base, field: value}, ProductService.preview_cost)
    for field, value in [("spread_basis", "none"), ("rounding_decimals", 9), ("minimum_fee_account", -1), ("financing_account", "bad"), ("quote_to_account_rate", "NaN")]:
        record("cost", {**base, "cost_model": {**base["cost_model"], field: value}}, ProductService.preview_cost)

    events = [dict(event_id=f"event-{i:02}", currency="usd", scheduled_time_utc=100 + i % 4, known_at_utc=None if i % 3 == 0 else 95+i, event_type="cpi", impact_source="source", time_precision="second", revision_source="original") for i in range(16)]
    for cutoff in [90, 100, 110, 120]:
        for proxy in [False, True]:
            record("news", dict(events=events, decision_time_utc=cutoff, allow_archive_proxy=proxy), ProductService.visible_news)
    for field, value in [("scheduled_time_utc", "bad"), ("event_id", ""), ("known_at_utc", "bad")]:
        record("news", dict(events=[{**events[0], field:value}], decision_time_utc=120, allow_archive_proxy=True), ProductService.visible_news)

    ai = AIService(OfflineProvider(), enabled_jobs=set())
    states = [{}, {"title":"Tiếng Việt 😀", "nested":["\t\n", 1, True, None]}, {"small": 1e-7, "large": 1e20, "boundary":1e-4}, {"negative_zero":-0.0}, {"f":1e16}, {"f":1e15}, {"f":1e-5}, {"f":1e-6}, {"integer":10**100}, {"integer":-(10**100)}, {"nested":{"access-token":"secret"}}, {"items":list(range(65))}, {"long":"x"*17000}]
    for state in states:
        body=dict(job="chart_overlay", context_version=" v1 ", state=state)
        try:
            expected=ai.request(body)
            cases.append(dict(kind="ai", body=body, expected=expected))
        except Exception as exc:
            cases.append(dict(kind="ai", body=body, error=str(exc)))
    body=dict(job="journal_review", context_version="v1", state={}, context_hash="bad")
    record("ai", body, ai.request)
    for raw_value in ["1e309", "-0", "1.23000", "1.000e-8", "10000000000000000.0", "1e-400"]:
        raw='{"job":"chart_overlay","context_version":"v1","state":{"number":'+raw_value+'}}'
        try:
            cases.append(dict(kind="ai", raw_body=raw, expected=ai.request(json.loads(raw))))
        except Exception as exc:
            cases.append(dict(kind="ai", raw_body=raw, error=str(exc)))
    connection=dict(connection_id="conn:one",request_id="request:one",idempotency_key="key:one",account_ref=None,scopes=["read","write","read"],metadata={"label":"Tiếng Việt 😀","float":1e-7})
    conn_fn=lambda body:validate_connection_request(workspace_id="tenant-a",connector="notion",**body)
    record("notion_connection",connection,conn_fn)
    for field,value in [("connection_id","invalid id"),("account_ref",""),("scopes",[]),("scopes",["bad"]),("metadata",{"nested":[{"access-token":"secret"}]}),("metadata",{"holdout_content":[]})]:
        record("notion_connection",{**connection,field:value},conn_fn)
    intent=dict(schema_version="mt5-notion-export-intent-v1",status="PREP_ONLY",cloud_io=False,provider="notion",destination={"user_selected":True,"ref":"user-selected:page-one"},source={"session_revision":2,"attempt_revision":1},payload={"content_sha256":"sha256:"+"a"*64,"text":"Tiếng Việt"},write_policy={"mode":"manual"})
    intent["intent_fingerprint"]=fingerprint({key:intent[key] for key in ["provider","source","destination","payload","write_policy"]})
    intent_body=dict(intent_id="intent:one",request_id="request:one",idempotency_key="key:one",connection_id=None,intent=intent)
    intent_fn=lambda body:validate_intent_request(workspace_id="tenant-a",**body)
    record("notion_intent",intent_body,intent_fn)
    for field,value in [("cloud_io",True),("status","READY"),("provider","other"),("destination",{"user_selected":True,"ref":None}),("source",{"session_revision":True,"attempt_revision":1}),("payload",{"content_sha256":"wrong"}),("intent_fingerprint","wrong")]:
        record("notion_intent",{**intent_body,"intent":{**intent,field:value}},intent_fn)
    output=Path(__file__).with_name("oracle.json")
    output.write_text(json.dumps(cases, ensure_ascii=False, allow_nan=False, indent=2)+"\n", encoding="utf-8")
    print(f"{len(cases)} control domain parity cases -> {output}")


if __name__ == "__main__":
    main()
