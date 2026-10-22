# MT5 connection health and resource check

Baseline: `ff1a434`; scoped follow-up on branch `Nam`, 22-23 October 2026.

## Changes and data flow

The Rust scheduler reuses one managed Python worker and portable MT5 terminal per
connection. A health read about every 10 seconds verifies DB authority, terminal
isolation, account identity and broker connectivity without reading history.
The scheduler selects metadata only. About every 60 seconds a journal collection
reads broker history with overlap and merges the previous stored snapshot; only
that successful incremental collection fetches the old journal from PostgreSQL.
Full sync replaces the old snapshot. Generation checks still fence all updates.

Network loss retains the live terminal so its own broker session can reconnect;
broken IPC or a stopped terminal recycles the worker. Transient failures retry
after 15 seconds; authentication/identity failures retain a 5-minute retry.
Recovery never resends a trading command or clears an unknown order receipt.

Preparation now seeds all three installed executables (terminal, MetaEditor,
tester) and retains owned self-updated binaries. Previously the terminal logged
a same-build LiveUpdate download followed by updater startup/exit around six
minutes after launch; companion binaries were missing/deleted on cold startup.
No global update settings were changed. `before-liveupdate.txt` is a redacted
observation captured before the old private log was cleaned.

Accounts UI uses the fuller Vietnamese CSV instruction and omits the redundant
stale-snapshot banner when the account summary is available. Row-level connection
errors remain visible; API/auth failures keep their error/retry surface.

## Verification

- Python connector, persistent worker and execution rules: 42 tests, 36 subtests PASS.
- Rust connector: 6 tests PASS; optimized API release build PASS.
- `connections-pg.json`: PASS on current source, disposable PostgreSQL only;
  credential isolation, lifecycle, permissions and compact account response.
- `trading-pg.json`: PASS on the unchanged trading implementation from the first
  part of this slice; durable unknown/concurrent retries and access fences. No SDK.
- Node trading model/navigation: 10 tests PASS. Earlier frontend build PASS;
  the Rust metadata projection follow-up does not change frontend assets.
- `terminal-recovery.json`: PASS; deliberately stopped only the application's
  isolated read-only terminal, observed `mt5_terminal_stopped`, recovered with a
  new PID in 33.62 seconds. This predates the metadata-only query follow-up.
- Production preview UI checked at 1280 and 360px. CSV copy is correct, redundant
  banner count is zero. `accounts-connected.png` captures the desktop result;
  viewport overrides were reset. This is scoped UI verification, not an audit
  of every existing responsive layout.
- `summary-performance.json`: 15 measured warm pairs after one warmup pair,
  sequential reused HTTP connection. Summary p50 0.908ms, sample p95 1.087ms,
  1083 bytes. Conditional GET p50 0.946ms, sample p95 1.102ms, 304 and zero body
  bytes on all pairs. First summary request 115.25ms is separately retained.
  These are API timings for one connected account without trade history,
  not browser-render, load-capacity or whole-product speed measurements.

## Persistent-session measurement

`warm-receipt.json`: PASS after 481.53 seconds, 47 observations, eight snapshot
revisions, one terminal PID and one managed-worker PID throughout. Every sample
was connected and read-only. The current terminal log contains zero LiveUpdate,
exit or shutdown entries (`after-liveupdate.json`), exceeding the earlier
six-minute failure window. This is a bounded soak, not a 24/7 guarantee.

The whole API/SDK/terminal descendant tree accumulated 20.390625 CPU seconds over
471.112 seconds between first and last counter samples: 4.328% of one core, or
0.721% of this six-logical-processor machine. Peak summed working set was
228.82 MiB; peak summed private bytes was 337.67 MiB. Working-set totals can count
shared pages more than once. PostgreSQL, frontend/browser and system CPU/RAM are
outside these process totals. Raw per-process counters remain in
`warm-samples.json`. `summarize-warm-cpu.ps1` recomputes the aggregate from those
counters: the probe's initial use of an integer `Math.Max` overload truncated
fractional CPU deltas; the corrected probe and receipt preserve doubles.

The sparse connections GET probe (one warmup plus 46 samples at roughly 10-second
intervals) measured p50 63.05ms and sample p95 162.78ms, with at most 614 response
bytes (`warm-requests.json`). This end-to-end HTTP-client measurement has a
different cadence/client lifetime from the tight summary/304 pairs above; do not
substitute one for the other or call the difference a speedup. No previous-build
resource baseline, busy trading/chart load, large journal, multiple accounts or
long-duration memory-leak acceptance is claimed.

The fixed cost of keeping a dedicated MT5 process is intentional: each terminal
has account/session state, so another account must not silently change identity
while a request is being checked or sent. The health path avoids repeated cold
starts and history processing without weakening identity/permission checks.

## Runtime and limits

The local stack was restored after Windows boot at 00:20 on 23 October. API8010
uses native/compact with the existing descriptors; UI5180 is production preview.
The authorized existing account remains `read_only`; all checks sent zero broker
orders. Continuous availability still requires Windows, the API and connectivity.
Trading Demo/Real share the managed path, but execution performance has not been
measured by this read-only idle test.
