# Marker actions and protection notifications — owner correction, 19/10/2026

This follow-up supersedes the quantity-click mapping in the parent receipt.

- An open position's X opens Take partials; quantity opens Edit position. Opening
  either dialog performs no trade. Partial requests retain the server capability
  gate. Servers without it offer an explicit full-close confirmation instead.
- Edit position pairs price and signed pip distance from the original entry,
  using the instrument's declared pip size. No pip size means no pip field.
  Existing direction checks still use the current closeable quote, so error copy
  says current price rather than the reference product's entry-price wording.
- Errors have a red cross, Order Error title and a precise localized reason.
  Saved TP/SL state distinguishes first addition from subsequent movement;
  success is shown only after the mutation succeeds. Removing/both-field updates
  also have accurate messages. Notification deduplication includes the detail.
- Uses existing modal, field, switch and palette tokens; no backend/migration or
  dependency changes. Quick trading retains immediate current-quote execution.

Validation: 16 focused Node tests, production build, four native-chart browser
fixture journeys (VI/EN, BUY/SELL, dark/light, 1368/768/390px). See browser.json and
the parent marker-notices-tests.txt/build-marker-notices.txt. Browser writes are
intercepted; this follow-up makes no new financial-engine correctness claim.
Checks include invalid-direction/no-write, first-add/move, price/pip round trip,
clearing/retyping, empty required field, cancel/reopen, edit submit, partial sizing,
rejection/retry, reload, and old-server fallback. Screenshots reviewed.

Independent read-only review found an empty-input/unmount bug; fixed with separate
enabled state and covered by browser regressions. Installed native API + production
UI smoke also opened both dialogs with owner API writes blocked, then dismissed
them without trading. See installed/installed-browser.json and screenshots.
All owner writes blocked during this smoke were practice-activity writes.

Prior unrelated dirty files were preserved. Rollback is a revert of this scoped
frontend commit and a UI rebuild; native API and data do not change.
