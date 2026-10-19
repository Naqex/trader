# New order protection defaults

New order drafts start without SL/TP. Opening or reopening the dialog starts both switches off; price/pip editors appear only when explicitly enabled. Existing position/pending-order protection still comes from persisted execution state. Quick Buy/Sell preset protection uses its existing separate path.

Validation: 15 focused tests and production build passed. Real native API + compact storage + disposable PostgreSQL/chart browser journeys passed for BUY/SELL Limit/Stop at 1368/768/390px, VI/EN, dark/light. Explicitly verified initial off state, cancelling enabled draft protection then reopening off, choosing side/type off, opt-in edits/sizing, saved protection restored after reload, and Market execution. No owner mutations or backend restart. Reviewed desktop and mobile default-off screenshots.

Evidence: `native/browser.json`, `native/BUY-limit-1368-menu.png`, `native/SELL-stop-390-protection-off.png`.
