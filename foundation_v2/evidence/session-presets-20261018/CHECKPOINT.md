# Session presets — 18 October 2026

Scope: session-creation UI on the existing Rust native/compact runtime. No backend or owner-session writes were needed.

Implemented browser-local presets, separately scoped to workspace and Backtesting/Prop Firm. The header menu supports apply, create, edit and confirmed deletion. Presets store balance, selected datasets, strategy, prop rules and canonical per-asset trading options. Applying or saving a preset preserves the session name and dates; cancelling the editor restores the prior draft. Storage/schema failures remain visible and do not overwrite unreadable data.

The editor reuses the existing form and design tokens. The create-session uncertainty guard also locks presets, so applying a preset cannot unlock an uncertain submission. Popup Escape leaves the session dialog open, including after deletion. Delete confirmation restores focus. Read-only independent review found no remaining functional blocker after the uncertainty fix.

Smooth candles is a disabled UI option only. The [official FXReplay article](https://support.fxreplay.com/articles/what-is-the-smoothing-candle-feature) describes noise reduction without a precise algorithm. No candle-price transformations or animation behavior were invented. Margin/leverage and hedging remain unsupported because they require risk accounting and multiple-position engine changes; the owner explicitly allowed deferring complex work.

Validation:

- `node --test tests/sessionPresets.test.mjs tests/testingCopy.test.mjs tests/quick-session-validation.test.mjs`: 14 passed.
- `npm run build`: passed; existing bundle-size warning remains.
- `node tests/sessionPresets.browser.mjs`: four journeys passed (Backtesting/Prop Firm × Vietnamese/English) on production preview port 5180, with real catalog GETs and isolated browser storage. No owner data changed. All writes were blocked except an intercepted 503 test of the uncertainty guard; its request asserted the applied balance and spread.
- Browser coverage: create/apply/edit/cancel/reload/delete, independent asset costs, required name, mode isolation, keyboard dismissal and narrow viewport. Browser report: `browser.json`.
- Screenshots reviewed at desktop and 360px; separate light-theme/English editor checks passed without horizontal overflow. Menu screenshots disable entrance animation so they show the settled surface; computed popup background is opaque and uses the existing semantic token. No popup CSS workaround was necessary.

Limit: presets do not sync across browsers or machines. This receipt covers the preset UI, not acceptance of the entire trading product, leverage, hedging or candle smoothing.
