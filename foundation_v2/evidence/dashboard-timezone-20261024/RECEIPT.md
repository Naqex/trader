# Dashboard, Sessions, Live and timezone refinement

Implemented and promoted locally on 24 October 2026. This receipt covers the
owner's 28 browser comments and global timezone request; it does not close the
whole Product Completion Plan or authorize broker execution.

## Result and decisions

- Live overview removes recent charts. Calendar combines observed same-currency
  account subtotals and marks incomplete coverage; unknown values never become
  measured zero. Weekly totals respect the date/weekday filter.
- Shared SearchInput and accent/token matching cover the affected workspace
  searches. Escape clears controlled state. Refresh preserves existing catalog
  content and disables stale mutations. Filter open/close retains card identity;
  the reported filter-specific flicker was not reproduced in the measured run.
- Dashboard/Sessions use shared SVG report charts: blue balance/win rate, gold
  measured practice activity and pink symbol counts, dashed grids and signed
  financial results. Mobile charts scroll inside their panel to retain readable
  labels. Bounded monthly summaries show displayed/total counts.
- USD uses `$`, date/money facts have a dot separator, and dashboard remaining
  copy reads `Còn lại: … ngày`. Removed redundant helper text. Closed-trade balance
  remains Balance/Số dư rather than Equity; realized average win/loss is not
  renamed planned Risk/Reward. Recent trade amounts remain net P/L.
- Dashboard edit uses the same session settings drawer as Sessions. The shared
  centered duplicate dialog offers clean configuration-only duplication and a
  history branch. Prop history duplication is disabled; a clean Prop copy is an
  independent Backtest. Missing legacy cost configuration is rejected explicitly.
- Journal remains a page link and receives that label. The journal detail dialog
  redesign stays deferred as requested. Replay provenance displays WMReplay.
- Entry recording metadata is captured only for newly proven fills, outside the
  core execution schema/hash. Exact dataset, position, operation and event sequence
  fence its use. Legacy unknown recording times/types remain unknown.

## Time contract

UTC persists through API, bars and ledger. Settings stores an IANA display zone
in `tw-timezone` and applies it to chart presentation, cards, tables, report
grouping, date filters and editable instants. Local civil-day boundaries convert
to UTC, including DST. Missing/repeated DST input is rejected. Native chart
timezone updates do not remount or shift OHLC/bar epochs. Civil dates, exchange
sessions, fixed UTC report intervals, imports/CSV and Prop reset rules retain
their respective domain contracts.

The preference is local to this browser; account-wide synchronization is not
implemented. The zone list is restricted to the installed native chart's supported
zones. Practice activity months use measured wall-clock intervals; historical
replay time and trade results remain separate metrics. The existing performance
date controls filter trade close dates, not account age or activity intervals.

See [display contract](../../../ui/display-conventions.md).

## Validation

- Frontend: 70 focused model/search/money/timezone/calendar/duplicate tests plus
  10 date/input regression tests passed. Isolated production build passed.
- Rust: analytics 8, entry recording 5 and replay core 30 tests passed; release
  build passed. Analytics tests include frozen financial/CSV oracles; the known
  12 HCM date-facet corrections are explicit, not broad snapshot rewrites.
- Independent review: native chart UTC versus Vietnam axes changed by seven
  hours with identical OHLC; DST invalid/repeated inputs, valid recovery, UTC
  bounds, Settings reload and chart geometry passed at desktop/mobile sizes.
- Duplicate dialog: GET-only browser checks passed at 1440/360px for centering,
  keyboard, Escape/Cancel and focus return; no user session was duplicated.
- Actual local UI/API: Settings save/reload, independent IANA date oracle against
  real trade data, Escape clearing, stable card identity and 1440/390px Dashboard,
  Sessions, Live and Calendar checks passed. No JS errors, page overflow or API
  mutation was produced by these browser checks.
- Actual API: 13 trades retained identical UTC instants and financial values
  across UTC/Vietnam projections; legacy recording values stayed null. Invalid
  `UTC+7` zone returns 422. Current overview contains measured activity months.
- Runtime preflight found no active work/unresolved broker submission and no
  pending migration. Guarded old-binary stop and candidate start retained
  native/compact, DB/artifact roots, QDM, scientific/legacy descriptors and AI
  workflow Python. An initial preflight with base Python lacked a dependency;
  the existing workflow venv passed before any stop occurred. API readiness is
  healthy. Connection …4926 reports connected/ready, demo, requested trading mode,
  fresh snapshot; no OrderCheck/OrderSend was issued.

## Deployment and rollback

API SHA256: `99d12e1b5414b07ad9ff0bfdd9886d9af1d9a45acbe03dcb4fbaaf7b1e89df0e`.
UI index SHA256: `b8749ea77de095fe54312d82c2699757a1f75658da7d269faf9110d85e601a27`.

Evidence/build/private rollback root:
`E:/BACKUP-TRADINGWORKSPACE/dashboard-refine-20261024/`.
It contains source overlays, selective ReplayWorkspace patch, runtime-before,
runtime logs, guarded promotion receipts and `deployed/` browser/API evidence.
Independent fixtures: `E:/BACKUP-TRADINGWORKSPACE/timezone-final-review-20261025/`
and `E:/BACKUP-TRADINGWORKSPACE/calendar-partial-20261025/`.

UI promotion retained previous hashed assets and private branding. The original
index is in `ui-before-verified/`; later intermediate indexes are retained too.
API rollback uses the previous mt5-tools binaries through the same ownership/idle
guards. Do not directly kill by port or restore private config wholesale.

Unrelated learn/visual CSS, the pre-existing ReplayWorkspace dependency hunk,
acceptance-script work and generated evidence remain outside these commits.

## Limits

No broker execution, new live trade, real duplicate/delete or migration was used
for acceptance. New entry recording and duplicate mutations have isolated tests;
they were not exercised on the owner's sessions. Native chart timezone has vendor
fixture evidence; sustained live feed performance and every chart tool are outside
this change. External timezone rule updates still require maintained browser/OS
and backend tzdata dependencies.
