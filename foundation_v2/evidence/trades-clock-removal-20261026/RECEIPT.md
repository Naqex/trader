# Trades toolbar correction — 26/10/2026

Owner rejected the agent-added Chart/Realtime filter selector: it was a local
proposal, not a verified FX control. **Removed and verified on UI5180**.

- Removed the selector, adjacent clock info, exclusive props/state/copy/CSS and
  Realtime-only year note. The existing session selector, filter chips, column
  controls, three Return info controls and entry/exit timestamp columns remain.
- Aggregate Testing Trades now always requests `time_basis=market`. Closed rows
  filter by market exit time; open rows by market entry time, in Settings timezone.
  Old `trades_time_basis` URLs cannot silently select another clock; filter URL
  updates strip that retired parameter while preserving session/language scope.
- No backend or Return calculation change. UI defaults keep replay date filtering
  useful without exposing an extra control. FX date-filter backend parity remains
  unverified; this correction does not claim it.

## Verification and saved evidence

`E:/BACKUP-TRADINGWORKSPACE/trades-clock-removal-20261026/` contains source/build
hashes, logs, candidate/deployed reports/screenshots, review and rollback.

- 17 focused model/contract tests PASS; build PASS from HEAD `364a31d` plus eight
  intentional overlays. Accepted prior release CSS is retained; unrelated WIP
  excluded. First model run failed due to an edited assertion missing its expected
  value; corrected the test and reran successfully before build/QA.
- 10 browser cases PASS on candidate, then the same 10 PASS on deployed UI5180.
  Actual 1920/1366/390/320px VI/EN light/dark journeys verify absence of the clock
  toolbar, fixed market requests even for old activity URLs, chart date + side
  Apply, chips/removal/clear/reload, session scope, sort, pagination, unchanged
  money/%/R/open/zero and keyboard/touch Return help. Labeled response fixtures
  cover empty, unknown, partial, denied, error and stale. No browser writes/page
  errors; no document/content horizontal overflow. Table scroll remains local.
- Independent source, model and representative screenshot review PASS by
  `/root/trades_review`. Owner's existing tab was reloaded; absence of the
  selector and presence of all three Return help controls confirmed.
- Current reference decision is §7 in
  [testing-trades.md](../../../ui/references/fxreplay/testing-trades.md). The prior
  receipt remains historical, with a supersession notice.

## Runtime and recovery

Promotion preserved private branding and prior hashed assets, backed up the old
entry index/mutable assets and atomically switched the index. HTTP200 served SHA:
`b4f112b40a43581b9655a8ea6e6607f3aee2d4b649b0792dc2ffa17a83865116`.
`ui-before-release/` holds rollback; `final-verification.json` records checks.

The attempted combined detached preview-launch command was rejected by tool
policy before execution. The temporary preview instead ran in its own tool
session and was stopped through that session after QA. Live UI/API services
remained independently running; no API/terminal restart or broker action.

Rerun the updated existing browser script from `foundation_v2/web`:

    node tests/tradesReference.browser.mjs http://127.0.0.1:5180 E:/BACKUP-TRADINGWORKSPACE/trades-clock-removal-20261026/rerun-qa

The read-only browser oracle remains pinned to the existing 14-row audit sample.
This is scoped correction acceptance, not full-product or FX backend acceptance.
