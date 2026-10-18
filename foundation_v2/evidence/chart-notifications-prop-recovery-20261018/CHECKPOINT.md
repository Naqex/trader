# Chart notification placement and Prop synchronization recovery — 18 October 2026

Owner reported a misleading revision-conflict banner after a saved trade failed
to synchronize its Prop challenge, and requested bottom-left notifications only
on backtest/Prop chart screens.

## Diagnosis and change

`ReplayWorkspace` set the same `conflict` flag after both a revision conflict and
a failed Prop feed. Its banner always claimed another editor had changed the
session. Its reload button only reloaded replay, leaving the errored Prop state
locked. Reloading the entire page could instead discard the error flag and expose
controls despite unacknowledged replay events.

The read-only owner inspection found replay revision47/event43 and challenge
revision1 with no replay binding. Their engine, dataset hash, cost version and
initial balance agree. This confirms stale challenge progress; it does not prove
the original transport/server failure that first left it behind. No owner feed,
trade, protection change, step or database repair was sent as a diagnostic.

- Shared notifications, persistent conflict/recovery notices and chart messages
  now occupy the same viewport. Chart workspaces anchor it bottom-left, above the
  trading bar; other pages retain top-right placement. Existing design tokens and
  dismiss/focus/timer behavior remain. Persistent recovery controls do not shift
  the chart or disappear when ordinary toasts time out.
- Error wording distinguishes Prop synchronization from an actual revision
  conflict and retains the server's reason. The recovery action reads both latest
  snapshots, verifies their Prop identity and feeds only outstanding canonical
  events. It never repeats a Buy/Sell or modifies the replay itself.
- Step/order paths reuse the same ordered feed function. Partial success retains
  the last acknowledged event; terminal attempts stop consuming later marks.
  Reopening with unsynchronized events still blocks trading until reconciliation.
- The existing disposable browser harness now accepts explicit runtime/storage
  profiles, enabling this check against native/compact rather than silently using
  its compatibility default.

## Verification and limits

- 32 focused Node tests passed: replay mutation/step contracts, Prop rule model,
  partial synchronization, revision rejection, terminal state, malformed replies
  and reopening with a backlog.
- `r5/browser.json`: disposable PostgreSQL + actual native/compact HTTP + current
  Vite UI passed. One Buy is saved, injected503 blocks synchronization, reload
  keeps the backlog locked, injected409 preserves recovery, and the next actual
  feed catches up. Replay revision/financial state remain identical, exactly one
  order request was sent, challenge position count and event sequence agree, and
  step controls reenable. Screenshots/assertions cover1368×790 and390×844; other
  pages retain top-right placement. No page errors. r4 also passed before the
  final recovery identity guard; r5 covers that guard.
- r1/r2/r3 remain failed harness attempts: query-string order counting, waiting
  for a transitional banner before the error finished, and expecting computed
  CSS `bottom` to remain `auto` rather than its resolved pixel value. They are
  not promoted to passing receipts.
- Production build succeeded. `owner-read.json` verifies the rebuilt UI5180
  opens the existing chart and shows the recovery action at x16/y604, without
  JavaScript errors or any mutating request. That check blocked mutations and
  deliberately did not click recovery. Its screenshot stays in ignored local
  runtime storage.
- Tests use the current working source, including the preexisting Prop auto-init
  dependency edit in `ReplayWorkspace.jsx`. That unrelated edit remains unstaged;
  this change does not claim a clean-checkout or whole-product acceptance result.

Latest build/working-source fingerprints and local test scope are recorded in
`receipt.json`. Follow-up on the original failure, if it recurs: retain the new
server reason and failed request outcome. Do not reset account state, erase
history, skip canonical events or resubmit an already committed order.
