# Live layout, account picker and MT5 readiness — 2026-10-23

Scope: owner-requested UI corrections and read-only MT5 diagnosis. Source baseline
`c3915f4`; standalone AI Documents removal saved separately in `cb8588f`.

## Result

- Removed the standalone Documents route/navigation; old links render Connections.
  Agent upload/library remains available inside the agent editor.
- Restored desktop Calendar, Trades and Accounts to the remaining viewport height.
  The stale direct-child CSS selectors did not match the new `.fx-main-content`
  wrapper. Fixed MT5 positions-button sizing so the chart footer does not clip.
- Reused `SessionFilter` for searchable account details and checkboxes. Calendar
  accepts all, none or explicit accounts; URL selection survives reload/navigation.
  Other Live surfaces retain single-account data semantics.
- Calendar sums only same-currency, available sources. Missing accounts or mixed
  currencies show an explanation and no partial/converted total. Deal provenance
  is retained; complete-day coverage uses the intersection of source histories.
  Monthly review requires one selected account.
- Additional snapshots are GET-only, up to four concurrent reads, ETag-cached,
  polled every five seconds while visible and aborted when scope changes.

## MT5 diagnosis and authorized correction

The connected demo account had verified read/trade permission and reported
`ready / demo_ready / execution_enabled=true`. Journal snapshot
`execution_capability=false` describes its read-only journal scope, not a broker
permission failure.

Windows was approximately **12.2 seconds fast**, verified against Windows and
Cloudflare NTP. Quotes consequently appeared about 13 seconds old and correctly
failed the five-second freshness guard. The owner explicitly approved Windows
clock synchronization. Built-in resync failed; a task-specific elevated script
applied a one-time correction from three consistent Windows NTP samples. No
persistent time-service configuration changed. Post-correction NTP offset was
about +0.014 seconds; read-only API quote age was 1,492 ms, then 964 ms on final
verification, with readiness enabled.

UI now reports the actual local quote/identity readiness failure instead of
turning `demo_ready` into a generic error. Future timestamp tolerance matches the
backend's one second; quote-age limits and execution policy remain enforced.
One earlier transient `demo_invalid_number` was observed; its exact offending
field was not identified. The UI now names that error explicitly.

**No OrderCheck, order preview/send, account mutation, MT5 restart, policy change
or model inference was performed.** Readiness is verified; broker order execution
has not been tested by this task.

## Validation

- Focused Node tests: **26 passed** across calendar aggregation/selection, trading
  readiness, Live navigation/model and workspace context.
- Isolated Vite production build passed. Source came from `git archive` plus
  task files, excluding unrelated dirty changes. Existing large-chunk advisory
  remains. No new duplicate translation keys.
- Actual local UI/read-only API: **11 cases passed** on the candidate and again
  after promotion to port 5180. Calendar, MT5 chart/ledger at 1920/1440/768/390;
  Trades/Accounts full height; old Documents fallback. No JS errors or mutations.
- Labeled two-account browser fixtures: **3 cases passed**, VI/EN, dark/light,
  desktop/tablet/mobile. +25 and -10 produce +15; tested selection/search/reload,
  none, mixed-currency and unavailable-source handling. Fixture results are not
  evidence that this installation has multiple real connected accounts.
- Visual screenshots reviewed; independent source review by
  `/root/ai_foundation_review` reported no blockers.

Reusable fixture command (from `foundation_v2/web`):

```powershell
$env:TW_LIVE_UI_ORIGIN='http://127.0.0.1:5180'
$env:TW_LIVE_UI_EVIDENCE='E:/BACKUP-TRADINGWORKSPACE/live-calendar-ui'
node run_live_calendar_acceptance.mjs
```

## Evidence and rollback

Full temporary/build/backup artifacts remain outside D: under
`E:/BACKUP-TRADINGWORKSPACE/viewport-mt5-20261023/`:

- `browser/report.json`, `browser-active.log`, `browser/*.png`: active UI checks.
- `picker-final/report.json`, `picker-final/*.png`: labeled multi-account cases.
- `clock-sync.json`, `mt5-after-clock-sync.json`: clock correction/readiness.
- `prepare.py`, `source/`, `dist/`: isolated source/build.
- `ui-promotion-verified.json`, `ui-before-verified/index.html`: guarded local
  promotion receipt and previous entrypoint for rollback. Existing hashed assets
  were retained, and the active brand asset was preserved.

UI index SHA-256 after promotion:
`133eb4e5d68741ca7eb57ad9c94883a7ef08e3fd32f7bb28af25364e99a29381`.
Restore the saved entrypoint atomically to roll back the running UI; no database
migration or API restart was required. Unrelated source/evidence changes were
excluded from both the build and the commits.
