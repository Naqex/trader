# Live chart stability and market stream — 24 October 2026

Scope: managed MT5 chart streaming, chart-only retention during temporary outages,
stable warning geometry, and anchored searchable asset selection. No broker
commands, permission changes or freshness bypasses were part of verification.

## Finding and resulting behavior

The baseline browser made 12 snapshot HTTP reads over about 24 seconds, each
roughly 36 KB/300 bars with 229–356 ms response time. The iframe mounted once;
the reproduced flicker came from the stale warning changing chart height from
889 to 851 px, rather than repeated iframe mounts. Warnings now overlay the chart.

Managed charts open one SSE connection. A bounded Rust feed shares warm SDK reads
within the exact workspace/subject/connection/symbol/timeframe scope. Initial
and recovery snapshots contain 300 bars; later events carry deltas. The terminal
SDK is sampled every 500 ms, with no overlapping/catch-up reads; this is not a
direct broker tick-push transport or a guaranteed 500 ms latency claim.
See [the contract](../../docs/LIVE-MARKET-STREAM.md) for limits and lifecycle.

Temporary failures retain visual bars and identity only. Current stream/read
state still gates orders, and revoked/deleted/unauthorized scopes clear the
visual cache. Selecting an asset uses a searchable anchored popover with keyboard
navigation and a timeframe row; it updates the existing URL scope.

## Validation

- Node: 18 tests passed across liveMarketStream, liveChartDatafeed,
  liveTradingModel and liveTradingNavigation.
- Python: 31 tests and 26 subtests passed across MT5 broker worker/demo trading.
- Rust: 7 focused tests passed, covering existing demo safety, tail/corrections,
  access-denial classification, fanout/isolation, limits and idle cleanup.
- Locked Rust release and isolated Vite production builds passed. The existing
  Vite chunk-size warning remains; no dependency/framework was added.
- Browser fixture on deployed UI5180: 1920 dark, 1440 light, 768 dark and 390 dark.
  Stable warning geometry; ready/unavailable/recovery retains iframe and blocks
  orders; search/empty/Escape/focus/keyboard and symbol/timeframe routing passed;
  disconnect/reconnect passed. No page errors or non-read API mutations.
- Independent source/UI review completed. Its access-denial propagation finding
  was fixed and covered by a focused test; no remaining review blockers.

Actual local read-only MT5 checks blocked all non-read API methods:

- EURUSDm: one SSE GET, one iframe mount, no detach/page errors, approximately
  36.6 KB in 28 seconds. Startup recovered to 300 bars, but source quote age was
  about 3 h 47 min. Trading remained disabled; stable 889 px chart after loading.
- BTCUSDm: one SSE GET with an initial 300-bar snapshot and 21 delta events over
  about 28 seconds, 41,378 response-body bytes, one iframe mount and no page
  errors. Reported quote age at update delivery ranged 944–1,488 ms (includes
  broker/terminal timestamp effects, not an isolated transport-latency metric).
  A gap of about 5.5 seconds briefly triggered the unchanged stale guard; the
  next quote recovered it. Chart geometry remained 889 px after initial loading,
  including while the stale warning appeared. No order was sent or checked.

This is scoped functional/runtime evidence, not a long-duration/load benchmark,
broker-execution acceptance or whole-product acceptance. Backtest/Prop continue
using deterministic replay state; they do not require a live broker subscription.

## Local deployment and external evidence

API8010 uses native/compact from
`E:/BACKUP-TRADINGWORKSPACE/live-chart-stability-20261024/rust-target/release`.
Existing schema15 had no pending migrations. Scientific descriptor:
`.runtime/api-platform/native-scientific-capability-ai-platform-20261023.json`;
legacy descriptor unchanged. API/UI were stopped before restoration; no active
terminal was stopped or restarted. Current ownership is in the canonical manifests.

UI5180 isolated build contains HEAD plus only the task's source overlays, excluding
unrelated dirty ReplayWorkspace/learn/visual-polish changes. Previous assets and
brand SVG were retained during guarded promotion. Deployed index SHA-256:
`302215abc49907f7f55cf18510a4039ca7750509622fd13e3d42e60061975fde`.

Large artifacts, scratch builds and runtime logs are on E: under
`E:/BACKUP-TRADINGWORKSPACE/live-chart-stability-20261024/`:

- `baseline.json`, `ui/report.json`, `active-fixture/report.json` and screenshots;
- `actual-stream.json`/`.png`, `actual-btc-stream.json`/`.png`;
- `rust-tests-final.log`, `rollout.log`, `ui-promotion-verified.json`;
- `ui-before-verified/index.html` for the prior deployed entrypoint;
- `runtime-api-platform/`, reached by the original `.runtime/api-platform` junction.

Reusable read-only fixture: `web/run_live_market_acceptance.mjs`; it labels
synthetic data and blocks non-read API methods. Its output origin/evidence paths
are controlled by `TW_LIVE_UI_ORIGIN` and `TW_LIVE_UI_EVIDENCE`.
