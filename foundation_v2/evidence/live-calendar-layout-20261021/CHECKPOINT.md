# Live Calendar reference alignment — 2026-10-21

Owner reported that the Live Calendar differed from the supplied FX Replay reference. Baseline: `e3383ed`. Reference is the two owner-supplied screenshots in this task; no proprietary source or external account operation was used.

## Result

- Visible Live title and journal actions now sit above the existing shared section navigation. The existing actions render into a shell-owned slot through a React portal; record/dialog/read state stays in LiveSurfaces. Heading geometry is eager and reserves space while the lazy route loads.
- Account choice and Basic filters share a row. In Calendar this row sits on the left; Analytics starts at the same vertical boundary on the right. The empty Analytics surface follows the reference's text-only arrangement.
- Month/year use existing chevron icons with transparent resting backgrounds. Amount/%/Share/Monthly review remain in the calendar toolbar. Existing unavailable actions stay disabled.
- Week totals now have the same cell border/height as dates, with count, W1…Wn label (localized accessible week name), and total. Day PnL/count stay grouped at the bottom. Broker counts remain deals; manual journal counts remain closed trades. Unknown remains `—`; no fabricated zero or aggregate account/currency behavior was added.
- At <=1240px the Analytics panel stacks below the calendar; only the calendar grid scrolls on narrower screens. Project compact tokens and controls remain in use. The title/breakpoint pattern is documented in `ui/live-market-standard.md`.

## Verification

- Production build passed (`build.log`); main 5180 serves the new build. Existing >500kB main chunk advisory remains.
- Focused Live reader/model/ledger tests: 18 passed, 0 failed (`focused-tests.log`). No backend contract or database migration changed.
- Browser at 1368×790: filter/Analytics top boundaries match; all seven weekdays and week totals fit without clipping. Dark and light screenshots reviewed.
- 768×900 and 360×800: document does not overflow horizontally; calendar scroll is local and Analytics stacks. Screenshots reviewed.
- Create-account action opens the existing dialog; Cancel closes without saving. Basic filters expand; next/previous month updates the calendar. Switching Notes → Calendar preserves a single heading action group.
- Existing labeled DEMO_LIVE snapshot: 410 USD PnL, 8 filled deals retained. At 1200px the calendar fits with Analytics below. Day values and counts do not spill out of their cells.
- Console errors: none (`browser.json`). No owner record writes, broker sends, login or provider changes. QA tab closed, viewport and dark theme restored; main services remain running.
- Independent source review initially caught a weekly count mislabeled as trades for broker fills; fixed to deals. Portal lifecycle/state and authority reviewed without remaining blocker. Manual-account + strategy/tag toolbar was reviewed structurally, but not exercised with new owner records; no manual data was created for this visual task.

Screenshots: `calendar-1368-dark.jpg`, `calendar-1368-light.jpg`, `calendar-768-dark.jpg`, `calendar-360-dark.jpg`, `calendar-1200-demo.jpg`. Browser checks and geometry: `browser.json`.

Scope: reference layout alignment and existing interaction checks. This does not claim new Share/CSV/provider capabilities, full broker acceptance or whole-product UI acceptance.
