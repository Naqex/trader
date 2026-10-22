# Tooltip system and account header alignment

22 October 2026 · local preview 5180, API 8010 · scoped UI change.

## Result and data flow

App-owned hints now use one delegated `ProjectTooltipLayer` per document. The
root handles lazy pages; Advanced Charts gets the same controller/styles for its
iframe document. Controls supply their existing copy through `data-tooltip`.
The layer owns delay, focus, Escape, anchor removal, viewport dismissal and
`aria-describedby`; `LegacyPopover` owns placement and the correct portal root.
MT5 help uses this lifecycle rather than a separate implementation. Broker,
credential, order and request contracts are unchanged.

The back/sync-guide row occupies the same 60px row as the accounts table header.
At both 1368 and 1920px, button centers were y=219, table header y=219.25.

Reuse: current palette/geometry/motion tokens and LegacyPopover. No dependency
added. Component-reference examples cover short/multiline, disabled and native
dialog tooltips. Vendor-rendered TradingView data/control hints keep their own
renderer. App-owned chart header/order-marker hints use the shared system.

## Runtime evidence

Browser actions used the Codex in-app browser on an agent-owned tab. No account
details were entered and no connection/order was submitted.

- Accounts: hover alone opens help; pointer can enter the content without closing.
- Tab opens help immediately. Escape removes the tooltip and its description id.
- Both dark and light themes use the project colors; measured text 12px/18px,
  padding 8px/10px, maximum width 280px.
- Disabled reference control still shows its explanation on hover.
- Native dialog: tooltip is a descendant of the open native dialog, focus remains
  at the trigger. First Escape closes tooltip; second closes dialog.
- Mobile reference 390px in light/dark: multiline tooltip stays within viewport.
- Real accounts form at 360/768/1440px: all measured tooltip edges remain within
  viewport. See `responsive.json` and matching screenshots.
- Chart iframe hover shows the shared tooltip in dark/light. Escape dismisses it.
  Changing timeframe 3m -> 5m closes the old tooltip; restored 3m and dark theme.
- No browser console errors observed in the tested chart journey.

Screenshots are selective checkpoints, not canonical goldens. The account list
is genuinely empty in this workspace; reference samples are explicitly examples.
Native browser zoom, screen-reader output, axe, reduced-motion emulation and
every tooltip/page combination were not exhaustively tested. Keyboard opening
was verified on the parent document; iframe Escape/hover were verified separately.

## Engineering validation

- `npm run build`: passed; `build.txt`.
- `node --test tests/live-workspace.test.mjs tests/liveAccountModel.test.mjs
  tests/liveWorkspaceModel.test.mjs`: 18 passed.
- `node --test tests/advancedOrderOverlay.test.mjs
  tests/sessionTradingOptions.test.mjs`: 19 passed; `regression-tests.txt`.
- Focused `git diff --check`: clean.
- Independent source review found iframe realm/listener handling and pending
  Escape dismissal defects. Both were fixed and re-reviewed without new findings.
  Pending Escape cancellation is source-reviewed, not a timed browser assertion.

Browser test readers for QDM/session options/order markers now read the new
tooltip attribute; these complete browser suites were not run in this slice.
Unrelated worktree changes, including a separate ReplayWorkspace effect change,
are preserved and excluded from this commit. This is not full-product acceptance.

Rollback: revert this scoped commit; no migration or data rollback is required.
