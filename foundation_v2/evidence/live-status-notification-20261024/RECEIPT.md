# Live status notification — 2026-10-24

User requested the existing bottom-left chart notification system for stale-price feedback.

- Reused NotificationSlot, including the existing persistent-blocker pattern. Live reason/paused/unresolved state renders one notification, updates in place and clears when the condition clears. No toast timer, repeated enqueue or new notification subsystem.
- Removed the absolute top-of-chart banner styles. Reconcile/reset-symbol actions retain their original handlers and disabled guards. Quote freshness, account permission, confirmation and order locks are unchanged.
- Shared mobile chart notification offset now leaves 16px above the two-row 88px trading bar. Desktop and non-chart notification placement are unchanged.

Validation: isolated production build PASS; Live market fixture PASS at 1920 dark, 1440 light, 768 dark and 390 dark, including notification host/position, no overlap with trading bar, stable chart bounds and fresh-price recovery. Trading dock fixture PASS at four widths, including reconciliation/unknown lock, preview expiry and rejected-operation feedback. Focused Replay regression PASS at 1440/390 dark/light. Independent review found no remaining issues; desktop/mobile screenshots reviewed. No real API writes or broker commands; fixtures intercept preview/command endpoints.

Promoted local UI 5180 and verified real MT5 read-only data: notification is in the shared bottom-left viewport, stale-price lock remains enabled, native interval/reload and wallet checks PASS, no API writes or browser errors. Build warning for existing large bundle remains. This is scoped UI validation, not broker or whole-product acceptance.

Build/temp/screenshots/reports/rollback: `E:/BACKUP-TRADINGWORKSPACE/live-status-notification-20261024/`. Files include `prepare.py`, `browser/report.json`, `dock/report.json`, `replay/report.json`, `runtime-check.mjs`, `runtime-report.json`, `runtime-notification.png`, `promote_ui.py`, `ui-promotion-verified.json` and `ui-before-verified/`. Unrelated dirty source excluded from build and commit. Old hashed assets retained.

Active index SHA256: `17ff7560ab5c344def57fc3fe0989336d1fe5acc602b17ff8be871fb69e62970`.
