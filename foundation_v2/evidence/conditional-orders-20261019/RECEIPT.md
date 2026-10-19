# Conditional replay entries — 19 October 2026

The chart order dialog now offers Market / Limit / Stop through the existing
FxSelect and design-system styles, with Vietnamese and English labels. Market
Save and Quick Buy/Sell remain immediate. Limit/Stop persist an entry level and
wait for subsequent replay prices; Buy uses Ask and Sell uses Bid.

## State and execution

The native service validates the type/timing combination and obtains the current
quote/time from the canonical dataset. Conditional submissions reuse the single
pending-order slot and append an `order_placed` checkpoint. Forward BAR/tick
execution checks the trigger, admits margin and transitions to the existing
position/financial ledger. Compact prefixes permit conditional orders to rest
across multiple bars while preserving the next-bar constraint for queued Market.
Reload and reconstruction consume persisted checkpoints, not a browser draft.
No migration or new dependency was required. The compatibility runtime rejects
conditional fields rather than silently submitting a Market order.

The supported scope remains one pending order or position per asset. Editing
TP/SL is supported; changing an accepted trigger requires cancel/recreate.
Limit gets its level or a better opening gap. Stop gets its level or a worse
opening gap, plus declared adverse slippage. With OHLC, entry and possible
same-bar protection are rejected as ambiguous; the step is atomic and does not
invent a price path. Tick execution remains the existing separate no-synthetic-
slippage model. Older runtimes cannot read the new conditional state/event fields.

## Validation

- Rust replay core: 24 tests passed, including four side/type combinations,
  resting/reload, executable spread side, opening gaps, rejection, margin at
  fill, cancellation/reconstruction, tick Ask crossing, receipt tampering and
  compact/full parity. Existing protection/partial-close tests also passed.
- Rust/Python differential suite: 5 passed for existing Market/BAR/tick behavior.
- Frontend model, notices and VI/EN copy: 13 passed.
- Compatibility command-worker tests: 29 passed, including rejecting conditional
  requests for every timing without invoking Market submission.
- Contract drift guard: 105 frozen commands and reference data schemas passed.
- Locked Rust release binaries and Vite production build succeeded. Vite retains
  its existing large-chunk warning.
- Real native API + disposable PostgreSQL + production chart UI: four successful
  journeys, Vietnamese/English, dark/light, widths 1368/768/390. Each tests
  invalid entry rejection, pending persistence after reload, no early fill,
  one fill after touch, and the resulting position. Also verified cancellation
  and Market Save filling immediately. See [browser report](native/browser.json).
  All fixture data was synthetic; no owner trade/replay mutation was used for QA.
- Reviewed screenshots: [desktop menu](native/BUY-limit-1368-menu.png),
  [light form](native/SELL-limit-768-form.png),
  [mobile form](native/SELL-stop-390-form.png).

Early checks caught and repaired the compact prefix's old next-bar-only pending
constraint. Browser harness retries corrected checkmark text, per-navigation
locale setup and an explicitly pinned historical cursor after direct API steps;
the final report requires the canonical cursor and passed. Tick coverage here
is core-level; the real HTTP/browser journeys above use BAR data.

## Installed runtime

The release candidate is isolated at `api-rust/target/conditional-entry/release`.
Cutover uses exact manifest/PID/executable identity, idle-work guards and unchanged
database/artifact/provider configuration. The scientific capability is inspected
again because the contract/Python source fingerprint changed. See native runtime
documentation for state compatibility and rollback constraints.

Installed cutover completed: native/compact API is ready on port 8010, and the
owner session's read-only GET advertises `conditional_orders: true`. Binary
identity and session revision/cursor are recorded in [installed.json](installed.json).
The first wrapper attempt refused stopping a different candidate path. The
recorded old binaries were then stopped through the launcher's identity/idle
guards, followed by a guarded start of the new candidate. No process ownership
check was bypassed. The disposable browser journeys passed again with the final
release build after the protection-checkpoint guard review.
