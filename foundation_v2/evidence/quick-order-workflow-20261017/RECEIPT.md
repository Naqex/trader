# Quick order workflow check — 2026-10-17

Scope: restart the existing local app and assess Market Quick Buy/Sell and the Order dialog. No product UI or engine changes; UI/UX direction remains with the owner. Auto-BE and multi-position remain deferred.

## Runtime

- Restarted the managed offline API with `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File scripts/restart_offline_api.ps1` and Vite on port 5180. Schema was current; no migration run.
- Final checks: UI HTTP 200; API `/health/ready` returned `ok: true`, database ready and command worker ready. Services left running.

## Workflow and evidence

- `live/receipt.json`: PASS using the real local Axum/PostgreSQL/Python service and native Advanced Charts, on a newly created disposable session. Four alternating Buy/Sell entries queued and cancelled; the actual Order dialog saved quantity 0.08 plus SL/TP; a BUY filled on the next replay bar; iframe SL drag persisted through reload; confirmed position close produced a manual-close ledger entry. The disposable session was deleted successfully at revision 18.
- `fixture/receipt.json`: PASS for nine browser scenario groups / 20 synthetic mutations. Coverage includes optional protections, Scalper presets, duplicate-submit prevention, valid/invalid SELL TP drag, Escape/rejection rollback, keyboard removal, chart scaling/resizing, close confirmation and first Order submission. These scenarios intercept API traffic and are separate from real-service evidence.
- `owner-readonly.json` and screenshot: actual owner replay chart ready, no alerts/page errors. All non-GET browser requests were blocked. Owner revision 29 / cursor 4628037 were unchanged. Buy/Sell are disabled because an existing BUY 0.01 is already queued, consistent with the single-active-order contract.
- Independent read-only review found no functional blocker in the examined order hooks, submission guards or expanded live test. Busy locks prevent duplicate submissions; revision/context checks protect saved state; closing remains possible at the dataset end.

Market orders deliberately queue at the decision cutoff and fill at the next replay bar's open. Waiting without advancing replay does not fill them. Quick entry and the form use the same engine and revision contract; dragged protections save against the active order/position.

## Validation

From the product repo root:

```powershell
foundation_v2/.venv/Scripts/python.exe -m pytest foundation_v2/tests/test_replay_quick_orders.py foundation_v2/tests/test_replay_protection.py foundation_v2/tests/test_replay_execution_core.py -q
foundation_v2/.venv/Scripts/python.exe -m pytest foundation_v2/tests/test_ps02_replay_prop_connection.py::ReplayPropConnectionTests -q
```

Results: 52 passed; 7 passed with 3 subtests passed. An initial run from the wrong working directory failed collection; the repo-root rerun above passed. Prop checks were the in-memory class, not PostgreSQL integration against owner data.

From `foundation_v2/web`:

```powershell
node --test tests/advancedOrderOverlay.test.mjs tests/replayOrderModel.test.mjs
$env:QUICK_TRADING_OUTPUT='../evidence/quick-order-workflow-20261017/live'
node tests/quickTrading.live.browser.mjs
$env:QUICK_TRADING_OUTPUT='../evidence/quick-order-workflow-20261017/fixture'
node tests/quickTrading.browser.mjs
```

Results: 11 Node tests passed; real-service and synthetic browser suites PASS. UI-QA doctor readiness also passed; readiness is not product acceptance.

The live browser script now accepts an evidence output path and asserts actual Order-dialog submission and filled-position close, so these journeys remain repeatable.

## Limits and next step

- Four local latency samples: pending feedback 36.5–54.6 ms; server-confirmed queued UI 376.6–502.5 ms. These are smoke samples, not a latency benchmark or an instant-confirmation guarantee.
- Real integration used one FX dataset at 1368×790 and bar replay. SELL was queued/cancelled; SELL fill/close, tick replay, multi-asset and full Prop lifecycle were not exercised by this browser run. No broker/live trading acceptance is implied.
- Existing Market workflow is suitable to proceed with the owner's UI/UX instructions. Limit/Stop entry, Auto-BE and multi-position are outside this check. No redesign was made.
