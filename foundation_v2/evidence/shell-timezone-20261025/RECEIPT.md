# Shared header clock and timezone — 25 October 2026

## Behavior and state

- Moved the Trades footer timezone to the shared shell header. Footer pagination is unchanged. The header shows the current date, 24-hour time and current UTC offset/IANA zone; it is wall-clock time, not the replay candle cursor.
- Click opens the existing searchable FxSelect. Selection immediately calls the shared timezone store, persists under browser-local `tw-timezone`, updates display/filter requests and stays synchronized with Settings. It is not account/cross-device synchronization.
- Minute-aligned updates stay local to ShellClock. Returning to a visible tab refreshes time. The shared option builder calculates offsets at the supplied current instant, including DST. Historical data still uses IANA offsets at the observation instant; source timestamps are not rewritten.
- Storage denial leaves the selected zone usable in memory and shows a persistence warning. A subsequent store update clears the local warning.
- Desktop keeps a compact two-line control. Tablet actions fit the viewport. Mobile uses the existing second header row; chart-entry headers grow with wrapped controls. Zone names can truncate on narrow screens, while date/time remain complete and the accessible description/menu retain the full zone.

## Verification

Artifacts and reproducible scripts: `E:/BACKUP-TRADINGWORKSPACE/shell-timezone-20261025/`.

- Scoped Vite build PASS: tracked HEAD plus intentional overlays; preserves the previous accepted private CSS baseline. Excludes unrelated ReplayWorkspace effect, dirty CSS, API acceptance script and evidence WIP.
- Node timezone tests **5/5 PASS**, including IANA identity/options, New York winter/summer offsets, DST/date boundaries and existing money/search cases.
- Candidate and deployed browser checks **12/12 PASS** each (`candidate/report.json`, `deployed/report.json`): Trades1920dark/1440light/768dark/390light/320dark; actual clock formatting; each header control inside viewport; no overlap/date-time truncation; searchable popup bounds; Escape clears search then closes and returns focus; outside click; keyboard selection; UTC selection triggers timezone=UTC API read and changes displayed entry time; reload persistence; Settings changes reflected both ways; fake-clock minute/date rollover; replay chart-entry header1920/768/390/320; storage-denied status. No page errors or writes.
- Browser contexts are isolated, allow GET/HEAD only, block external/live/MT5/events/WebSockets. Trades reads use the existing local API. Replay checks exercise the chart-entry shell, not active chart-engine/broker acceptance.
- Independent reviewer ACCEPT after source and screenshot review. Initial responsive review caught clipped tablet utility buttons, mobile source selector and chart header height. These were corrected; final assertions check every control's bounds, rather than document overflow alone.
- Recovered QA harness attempts retained here as context: empty pagination-meta still exists structurally, so the correct assertion is empty text; SearchInput Escape first clears text; UTC can format as UTC+0. Installing a paused fake clock before data readiness stalled query scheduling, so the timer check pauses only after the real table is ready. Final runs passed.

## Local rollout

- Atomic UI-only promotion, preserving previous index/assets and private branding. Backup: `ui-before-release/`; promotion receipt: `ui-promotion-release.json`.
- UI5180 index SHA256: `bc6b3192881f2bff5c58b6dfa0e412715477d4d48011758db2049c8200fc5d90`.
- Previous index SHA256: `56ead2dd3fe06b1ac963ae348628ba0f273300d1d89a49f3a2fb93892dd008d5`.
- Existing native/compact API8010 run `12df5b87b39f4d0fae45ebb826479cbe` retained. No API/terminal restart, migration, broker action or persistent source-data mutation.
