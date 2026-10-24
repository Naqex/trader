# Shared notification timing — 2026-10-24

Owner request: stale notification should disappear automatically; choose a reasonable shared timing policy across the application.

## Result and data flow

`NotificationSurface` owns the transient notification clock for provider action messages, Live state and Replay/Propfirm chart messages. Defaults: success 5s, info 7s, warning 8s, ordinary error 10s. Hover, contained keyboard focus and a hidden browser tab independently suspend the countdown. Resuming keeps the remaining time, and ordinary content/callback changes do not restart it. Timers and visibility listeners clean up on unmount.

The Live stale episode uses the existing stable scope/reason/quote-category identity. A timeout follows the same dismiss path as the close button, so SSE updates do not resurrect it. Explicit stale Buy/Sell or draft-check attempts create a fresh 8-second presentation. Hiding the notification never clears a freshness, permission or pending-request gate; stale attempts still make no preview/command request.

Intentional exceptions: unresolved broker results and symbol-recovery actions remain persistent (manually closable, with recovery still reachable); Replay revision/sync conflicts and pending-save retry state retain their recovery controls. These are ongoing state, not transient success/error feedback. This task does not claim that every `.wm-notification` element now auto-dismisses.

The shared component keeps existing markup, notification positions, colors and close controls. `ui/testing-standard.md` records the timing contract and primary design-system references (Carbon optional 5-second toast, Atlassian 8-second automatic flag). Error 10s is a product choice for longer reading, not a universal standard.

## Verification

- Production build PASS, 339 modules; existing chunk-size advisory remains.
- `tests/notificationTiming.browser.mjs`: PASS, nine clock-controlled cases. All four exact durations; hover/focus/hidden-tab pause with remaining time; repeated content updates do not restart the clock; critical state persists and closes manually. The initial test attempt used an advancing clock and failed its exact boundary; freezing Playwright's clock fixed the test oracle. No product timing change was needed for that fixture failure.
- Market browser: PASS at 1920 dark, 1440 light, 768 dark, 390 dark. Desktop waits for actual 8s stale dismissal across SSE, verifies no resurrection and retry restoration; all widths retain close, chart stability, quote categories and reconnect checks. Zero mutations.
- Dock browser: PASS at the same four sizes, including synthetic command results and unknown-result locking. Zero broker calls; all POST endpoints intercepted.
- Replay regression: PASS at 1440/390 in dark/light, no unexpected requests.
- Independent read-only review by `/root/backend_review`: no timer/lifecycle finding; explicitly noted and preserved persistent-state exceptions.
- Reviewed mobile stale-warning screenshot; no visual/layout change to the shared toast.
- Promoted isolated HEAD source plus only task overlays to UI 5180. For `ReplayWorkspace.jsx`, only the notification import/render changes were overlaid; unrelated dirty initialization changes and CSS were excluded.
- Actual 5180 browser read-only PASS: warning manually closes without reappearing, Buy restores it, then it auto-hides after approximately 8s (8044ms after screenshot), remains hidden across updates, and the next Buy restores it. No POST, no real broker preview or send.

Artifacts and rollback: `E:/BACKUP-TRADINGWORKSPACE/notification-timing-20261024/` (build log, isolated source, exact Replay patch, timing/browser/dock/replay reports and screenshots, runtime report and `ui-before-verified`). Previous active index SHA256 `cfe14d2712f7b152b2b31ecf76a58f881ecffab8ba04f5d1ed1c715ef3e19b27`; promoted index `b9129f4f4b3f57b853f9c29c14dc6c348350a2880a60b224894611c79497b7a2`.

Scope is notification UI behavior. No backend, terminal, account permission, execution policy, holdout or provider change. Synthetic checks do not establish broker acceptance.
