# Workspace clock — 25 October 2026

## Behavior and ownership

- Move the shared wall-clock/timezone control from the normal topbar into the sidebar workspace group. The workspace link and timezone trigger remain sibling controls. A collapsed rail uses a 44px clock button with the full date/time in its popup; the mobile drawer shows the expanded clock.
- Display HH:mm:ss and refresh on second boundaries, including visibility resume and midnight rollover. Second ticks stay inside ShellClock; timezone option offsets are memoized by minute and selected zone.
- Keep the chart-toolbar clock when a chart workspace has no sidebar. Timezone still flows through the existing store and browser-local `tw-timezone` preference, synchronized with Settings. No new persistence owner or data timestamp conversion.
- Reuse FxSelect's flat search with a focus underline throughout the shell. The previous style selector required `.fx-content`, excluding header/sidebar controls. Extend that selector and account for the drawer clipping boundary and rail scrolling when positioning popups.
- Trade-off: a collapsed rail shows the time after opening its icon; this preserves compact navigation width. A narrow chart toolbar hides the zone name while retaining the full menu and accessible description.

## Verification

Artifacts and scripts: `E:/BACKUP-TRADINGWORKSPACE/workspace-clock-20261025/`.

- Scoped build PASS (`build.log`): HEAD plus five intentional source overlays; prior accepted private CSS baseline retained, unrelated dirty source excluded. All five working source overlays byte-match the candidate. Vite retains its existing large-chunk advisory.
- Existing timezone/date/money/search semantics tests **5/5 PASS**, `timezone-tests.log`.
- Candidate browser **12/12 PASS**, `candidate/report.json`; deployed UI5180 browser **12/12 PASS**, `deployed/report.json`; both have no page errors or attempted API writes.
- Trades at1920dark,1440light,768dark,390light and320dark: workspace placement, date/time fit, collapsed44px control, viewport/drawer popup fit, search autofocus and matching, Escape clear/close/focus return, and separate drawer dismissal.
- Sidebar search computed styles match Settings search. Timezone selection changes the read query and displayed trade time; reload persistence, Settings synchronization in both directions and keyboard selection pass. Storage denial retains a usable session selection and warning.
- Controlled browser clock verifies23:59:58 →23:59:59 →00:00:00 with the correct next date. Chart-entry fallback verified at1920/390px.
- Independent reviewer ACCEPT after source review and direct inspection of desktop, collapsed light theme, drawer320 and chart390 screenshots. No actionable blocker in clock/search scope.
- Browser contexts are isolated and allow GET/HEAD only; external, MT5/live, events and WebSockets are blocked. Chart fallback uses labeled demo. This receipt accepts the clock/search UI only, not chart-engine, broker or whole-product behavior.

## Local rollout

- Guarded atomic UI-only promotion on5180 preserves private branding and old hashed assets for open pages. Rollback index/mutable files are in `ui-before-release/`; promotion details are in `ui-promotion-release.json`.
- Previous index SHA256: `55da580719dbc6f3b61c1674adf99935c9a3270487a10e8fc7be31fb2ea9ae83`.
- Deployed index SHA256: `ddca8be9e4dc335a4b122343a4408835d9c72b88126edd9439397cc052c129e9`. The actual HTTP response hash matches the candidate (`served-hash.json`).
- No API/terminal restart, migration or broker action. The existing native/compact API owner run remains `12df5b87b39f4d0fae45ebb826479cbe`.
- The owned candidate preview on5196 was stopped after deployed verification, with PID/command-line identity checked first.
