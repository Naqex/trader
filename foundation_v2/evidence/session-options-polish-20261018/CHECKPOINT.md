# Session options: VI/EN and execution slippage

Scope: owner-requested creation dialog copy/layout and four working slippage
modes for new Backtesting and Prop Firm sessions. Existing V1 sessions retain
their frozen behavior. This is scoped acceptance, not whole-product acceptance.

## Behavior and state

- Tabs use Backtesting / Prop Firm. Empty state is outside the cost card; redundant
  immutability and pip-example footnotes are removed. Both locales use short copy.
- Each selected dataset owns its fees and Off/Light/Medium/Fixed choice. The form
  preserves drafts across sections and serializes only selected datasets.
- Rust freezes V2 options and a server seed, derives the runtime model from the
  dataset manifest, and records deterministic adverse fills. Limits/TP do not
  worsen. Risk previews use bounds, not random samples. No double slippage fee.
- Leverage/margin and hedging remain disabled: their accounting and multiple
  positions are not implemented. Missing instrument specifications disable
  nonzero slippage rather than inventing a pip/tick size.
- These synthetic slippage bounds follow the supplied reference UI; they do not
  claim FXReplay's internal sampling algorithm or historical liquidity realism.

## Verification

- Frontend focused Node tests: 31 PASS (options, creation, VI/EN copy, risk preview).
- Browser `ui/browser.json`: Backtest/Prop x VI/EN, 4 PASS. Empty off/on states,
  four modes, independent assets, missing-spec denial, invalid Fixed denial,
  preserved drafts and outgoing payload. Dark/light at 1440, 768, 360 pixels.
- Browser `quick/browser.json`: BUY/SELL zero-cost and SELL with costs, 3 PASS.
  These browser tests use real controls/chart but intercept all writes; they do
  not constitute backend calculation evidence or alter owner sessions.
- Native compact HTTP with disposable PostgreSQL: PASS for all four Backtest
  modes and Prop V1/Fixed, quick order, protection, reload/feed, close and branch.
  See `../session-slippage-20261018/backend.json`.
- Backend worker reported 5 slippage, 3 config, 3 V1 cost, 4 legacy differential
  tests PASS; Python contract checks 5 tests with 21 subtests PASS.
- Independent source/visual review completed without an open blocker after
  correcting pre-initialization risk preview to include V2 bounds.
- Candidate and production Vite builds PASS. Production UI browser cases were
  rerun against port 5180 after cutover: 4 PASS, no unexpected writes.

## Local runtime

Native/compact API restarted successfully on port 8010; `/health/ready` returned
`ok: true`. Port 5180 serves the updated production UI. No schema migration was
required. API candidate: `api-rust/target/session-slippage-20261018/release`.

API SHA-256: `10855af1aacf2acb746d15622f8c504ac75c7054b6299603b933d506af51523d`.

The initial restart safely refused a binary ownership mismatch. Stopping with
the previous manifest's exact binary paths and then starting the new candidate
resolved cutover without changing the guard. The temporary preview on 5182 was
stopped. Owner sessions were not used for mutation tests.

The unused legacy `/data/cost-preview` endpoint does not calculate V2 slippage;
current UI previews use the versioned model locally. No broker execution,
FTMO preset, historical spread or cross-currency conversion was added.
