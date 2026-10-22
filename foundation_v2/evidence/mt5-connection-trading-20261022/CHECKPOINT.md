# MT5 connection access and broker trading — 2026-10-22

## Delivered behavior

Demo and Real broker accounts use the same Live → Tổng quan → Mở biểu đồ flow.
Opening a chart navigates directly, without the setup dialog. Replay/session/Prop
identifiers are removed from chart URLs. Symbols and timeframe are selected in
the chart. Existing account badges and action buttons retain their gray surface
on row hover.

The connection form uses the shared FxSelect for Chỉ xem / Giao dịch. Password
labels and help follow that choice. MT5 determines Demo/Real and verifies actual
account, terminal and Python permissions. Existing credentials remain read-only;
the migration does not promote an investor connection.

Data flow: authorized workspace + selected connection → native API → encrypted
credential and generation check → owned MT5 worker → broker account/quotes/specs.
The managed path uses broker lot/price/margin constraints with optional SL/TP;
it has no invented Prop settings, app risk cap or simulated balance. Commission
and swap are not assumed to be zero. Legacy external Demo policy limits remain
separate for compatibility.

Trading workers keep their terminal warm and share it with journal collection.
Requests are serialized; generation changes revoke authority. Unknown outcomes
are durable and block new sends until reconciliation. Reconnect preserves unknown
receipts; removal is denied while any outcome remains unresolved. Revocation
retains the same worker slot while an operation finishes, preventing overlapping
old/new terminal lifetimes. This deployment assumes one native API owner.

## Verification

- Python connector, order helper and persistent-worker tests: **37 passed,
  25 subtests passed**, synthetic SDK/DB only.
- Frontend model/navigation tests: **10 passed**. Vite production build passed
  with the existing chunk-size warning.
- Rust focused tests: connector **5 passed**; trading **4 passed**, including
  reconnect reconciliation and worker revocation during an in-flight operation.
  Release binaries built and the final native API restarted successfully.
- Disposable PostgreSQL acceptance: [connections-pg.json](connections-pg.json)
  and [trading-pg.json](trading-pg.json), both PASS. These prove scoped native
  routing/lifecycle/receipt behavior, not actual broker fills.
- Independent review found post-send revocation, reconciliation across reconnect,
  netting history, external pending cancellation and removal-bypass issues; fixed
  before acceptance. Real-mode badge and HTTP-200 invalid-symbol recovery were
  subsequently fixed and checked in the browser.
- Actual 5180 browser: direct chart navigation, read-only execution lock,
  permission-select/password-label change, row hover. Hovered row background was
  `rgb(23,25,29)`; badge/action backgrounds stayed `rgb(35,38,42)`.
- Isolated 5192 fixture: Real label on ticket/footer, managed invalid-symbol
  recovery, 300 rendered candles; ticket checked at 1440px and 360px. At 360px
  there was no horizontal overflow and the dialog stayed inside the viewport.
  Stale-quote state showed its explanation and disabled order checking.
  Fixture has no broker/SDK/DB or upstream proxy. Temporary viewport reset.

## Actual runtime and connection

Verified DB + artifacts backup: `.runtime/api-platform-backups/mt5-access-20261022`,
snapshot `20261022T150848Z-f1f694ce8ec2`, 4,142 artifact files / 4,267,594,723 bytes.
Manifest SHA-256:
`5af0162178b7b954a00682c9a16d71f39060ceb96a58b83e0b139378595dba65`.
Migration 0011 applied; native/compact API on 8010 and UI on 5180 are running.

Actual Exness connection ending 4926 read Demo / 10,000 USD successfully. A later
periodic sync exposed a separate cleanup bug: `PermissionError` in `run →
clean_terminal → shutil.rmtree` after a successful MT5 read. MT5 WebView children
still held files. Cleanup now runs after the native owner terminates the complete
job tree, rather than inside the collector. Successful subsequent sync timestamps
included 15:18:12Z, 15:19Z, 15:20:32Z, 15:22:45Z and 15:24:48Z.

After the final API restart, one sync reported `mt5_identity_changed`. No identity
check was relaxed and no order was sent. A read-only diagnostic observed matching
login/server at both identity fences; [six subsequent cold syncs](cold-sync-checks.json)
all connected successfully (15:31:45Z through 15:32:23Z). The single identity
mismatch was not reproduced; its root cause remains unconfirmed. This is a
remaining intermittent broker/startup issue, not a proven fix.

See [runtime-readonly.json](runtime-readonly.json) and
[actual-connected-account.png](actual-connected-account.png).
The existing connection remains `read_only`, with verified read=true/trade=false.
Trading requires reconnecting through the form with Giao dịch and the trading
password. No credential was entered in chat or included in this evidence.

## Acceptance limits

No actual broker order was sent. End-to-end trading permissions, fills and account
management on the selected broker remain unverified until the account is connected
with trading access and an explicit test order is authorized. Supported commands
are Market placement, full close, SL/TP modification and cancellation of existing
pending orders. New Limit/Stop placement and partial close remain unsupported.
This checkpoint closes this implementation slice, not whole-product acceptance.
