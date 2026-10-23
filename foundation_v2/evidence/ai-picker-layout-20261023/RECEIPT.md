# Compact Mentor model picker — 2026-10-23

Composer shows the model name and an explicit effort separated by a subtle rule.
Default effort stays inside the popup. Provider is a secondary line in the model
list/current model and remains in the full tooltip/accessibility option label.
Effort has its own caption/value above the existing slider. Existing design
tokens, popover and selection path are reused; no dependency/network/backend change.

Model name and provider label are separate fields; provider/model IDs and saved
selection semantics stay unchanged. Same-name models across two providers remain
distinct and selecting one updates the exact provider route.

Isolated production build passed; existing main-chunk warning remains. UI fixture
regression passed6/6 (VI/EN ×360/768/1440), including duplicate model names across
providers, effort selection and existing stop/continue/reload/idempotency checks.
Installed read-only UI/API passed4/4 (VI/EN ×360/1440),0writes/0page errors; screenshots
reviewed for mobile/desktop and light/dark. No real inference or config changes.

Builds/screenshots/reports/previous UI index live outside Git at
`E:/BACKUP-TRADINGWORKSPACE/ai-picker-layout-20261023/`:
`browser/report.json`, `installed/report.json`, `ui-promotion.json`.
UI5180 promoted atomically with old assets/brand retained; reload receives it.
Rollback restores `ui-before/index.html`. API/gateway did not restart.
