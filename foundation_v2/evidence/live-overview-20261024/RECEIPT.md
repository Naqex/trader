# Live overview and chart entry — 2026-10-24

Scope: owner's approved Live overview, compact chart shortcut, recent charts,
orange shared chart AI control, and one chart-entry loading presentation. No
order commands, OrderCheck, reconnect, API restart or schema change.

## Implementation and decisions

- Account facts use the existing trading summary. Performance reads the selected
  connection's history independently, and checks login/server/currency against
  the current account before displaying it. It excludes non-trading cashflows,
  includes commission/swap/fee and names counts as executions, not closed trades.
  The synced history window is explicit; unknown costs/coverage stay unknown.
- Successful chart readiness records up to six local symbol/timeframe shortcuts,
  isolated by workspace, connection, login and server. Storage errors are benign.
- Route, lazy components, first snapshot and renderer share the existing chart
  loader. Live manages readiness explicitly; Replay keeps its default behavior.
  Chart chunks load concurrently with the market read. SSE reconnect retains
  the existing chart. No fake minimum duration or inferred broker schedule.
- Native chart AI uses the highlight orange for both themes; compact menu uses
  the same palette. Editor/info colors keep their existing semantics.

## Evidence

Full local logs, scripts, reports, screenshots and rollback are under
`E:/BACKUP-TRADINGWORKSPACE/live-overview-20261024/`.

- Scoped HEAD archive plus intentional overlays only; unrelated WIP excluded.
  Bundled Node 24.22.1 production build: exit 0. System Node 24.19.0 emitted a
  libuv closing assertion after finishing its first build; that attempt was not
  accepted as a clean build.
- 20 focused Node tests passed: accounting/unknowns, recent-chart isolation,
  navigation, SSE framing/retention and live datafeed.
- `tests/liveOverview.browser.mjs`: 11 cases passed against production preview:
  1440/390, dark/light, loaded metrics, orange AI, back/reload persistence, slow
  data, reconnect retention, cached renderer roundtrip, network error, empty,
  locked, library failure and lightweight. Synthetic GET-only data plus real
  local chart engine; no page errors or API mutations.
- `tests/chartStartup.browser.mjs`: 3 existing Replay startup cases passed with
  isolated origin override. The older `chartLoading.browser.mjs` fails its
  content-box geometry oracle on both the unchanged baseline and candidate;
  it expects content bounds while the established loader covers the viewport.
  This is retained as a known test limitation, not counted as a pass.
- Independent review reproduced a cached renderer readiness race; fixed reset
  ownership, then reviewer reran it successfully. Recent-card icon, wrapping and
  section spacing were also corrected. Final review: no remaining finding.
- Real local 5180 read-only journey: loaded account/history, overview -> chart,
  orange AI, chart -> overview, recent entries after reload; no page errors or
  API mutations. Served index hash verified against promoted file.

Baseline entry observation was 1445 ms; candidate 1453 ms and deployed 1487 ms
(one sample each, not a performance benchmark). Baseline changed loading copy
between stages; final journey keeps one presentation and no premature empty
chart. No significant latency improvement is claimed.

## Promotion and rollback

UI-only atomic index promotion, old hashed assets retained and private branding
preserved. No API/terminal restart. Before SHA-256:
`5be6c5bb8175e98d4de66147d4d1a594404c358373cec1d56e41a0e857ed5c2e`.
Served final SHA-256:
`20ab38c6cee57e52849bc7a6d8b08cb7acfeefc34ba114c14f156c80707deb7c`.
Rollback index and mutable CSS are in `ui-before-verified/` beside the promotion
helper/receipt. Only owned candidate previews were started for verification.

Product-wide, broker execution and capacity acceptance are outside this receipt.
