# Prop quick trading and entry-marker UI — 18 October 2026

## Root cause and behavior

The new owner replay `126a3b4bc77e4a43b7b8eaca2e465999` contains two datasets.
The shared creator allowed up to twelve assets for Prop as well as Backtest,
although Prop lifecycle binds one dataset. Python and Rust both allowed that
configuration at creation and rejected it later at Prop feed. This was not a
Rust-versus-Python execution-speed problem.

Prop now requires one selected asset in the picker, validation, creation service
and native replay API. Switching a multiasset Backtest draft to Prop retains the
selection and asks for explicit deselection. Backtest retains multiasset support.
Existing incompatible Prop sessions remain readable with an explanation and a
link to create a new session; initialization, trading and stepping are blocked
before financial writes. No existing portfolio, order or challenge was reset.

Quick market orders still fill at the current modeled quote. TP/SL previews are
local; release persists a protection change. Replay remains financial authority,
then Prop consumes canonical events. Failed feed locks further trading until
explicit recovery catches up without resubmitting the order. Sync failure is no
longer stored as a revision conflict; ordinary domain409 retains its reason.

Entry markers follow the owner's explicit color request: BUY has a green border
and orange text, SELL has an orange border and green text. The close segment
retains its pale background/blue icon. Text, vector arrow, quantity and close
share their vertical center; compact TP/SL handles have no empty arrow gap.

## Evidence

- 27 focused Node tests passed for creation, labels/scales, Prop rules and sync.
- `../prop-single-asset-20261018/default-r3/receipt.json`: 78 cases passed against
  the Rust router with disposable PostgreSQL, covering fail-fast rejection,
  unchanged invalid-session financial/history snapshots, valid immediate SELL,
  replay/Prop feeds, retries, branches and transitions. Its Python differential
  harness uses its default profile; this is distinct from native/compact below.
- `native-r2/browser.json`: actual Rust native/compact + isolated PostgreSQL +
  Vite/Advanced Charts. Create singleasset Prop, BUY, failed503 feed, reload,
  failed409 recovery, successful catch-up, drag TP and SL, close, SELL, drag both
  protections, close and reload all passed. Both closes leave Prop flat and its
  acknowledgement at the replay event sequence. No JavaScript errors. An
  explicitly synthetic legacy portfolio snapshot is blocked without financial
  writes. Native screenshots show BUY and SELL protection placement.
- `chart-fixture-r3/receipt.json`: ten journeys passed using synthetic API
  responses and the real chart iframe, including native dashed lines, drag
  validation/rejection, confirmation, price-scale modes, light/dark and narrow
  layouts. Reference colors and vertical centers are asserted. Business409 and
  revision409 produce different UI states. This is not a real API test.
- `../prop-creation-selection-20261018/r2/browser.json`: three creator journeys
  passed on desktop/mobile, with mutations denied. Independent review found no
  blocking defect in creator, backend guard, error state or overlay integration.
- Production build passed. Owner API restarted native/compact with API SHA256
  `134420fd33213d0de14d7154f1318bc222c7882105aa328bdbe1807dabb42530`.
  Scientific/codec descriptors retained; schema already current, no migration.
  Canonical native binary updated after guarded stop; previous API binary kept
  locally at `api-rust/target/prop-fix-20261018/previous-api.exe`.
- `owner-read/receipt.json`: rebuilt UI5180 shows the correct legacy-session
  notice, not a false revision banner. Replay revision2/payload unchanged,
  two datasets confirmed, no financial write attempts or JavaScript errors.

## Limits and failed attempts

No owner trade, protection edit, close, feed or migration was sent. The existing
invalid session is preserved and intentionally cannot trade; a new singleasset
Prop session is required. This is scoped workflow/UI acceptance, not whole-product
or broker acceptance. Backend native/compact differential attempt r1 stopped on
the Rust-only `step_view_version` field; r2 corrected a test fixture schema and
r3 passed the default harness. Browser native-r1 completed trading but its final
assertion incorrectly counted activity heartbeats as financial writes; r2 fixes
that assertion. Initial chart fixture exposed a hidden-arrow text issue, repaired
before passing r3. All failed attempts remain local and are not passing receipts.

Browser/build checks include the preexisting granular Prop auto-init dependency
edit in ReplayWorkspace. It remains unstaged; this task commits only its explicit
unsupported-portfolio guard/dependency and does not claim clean-checkout acceptance.
