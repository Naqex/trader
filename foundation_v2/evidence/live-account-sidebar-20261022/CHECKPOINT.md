# Live account sidebar refinement — 2026-10-22

Scope: compact CSV action, centered MetaTrader symbol, text-only Back/Cancel,
reference-aligned MT5 form and contextual help. Uses existing date/select,
popover, icon and semantic token components. Existing request, idempotency,
pending/uncertain locks and credential clearing are preserved. Account naming
defaults to MetaTrader 5 and can be changed through the existing account menu.

## Verification

- Vite production build passed. Existing >500 kB chunk warning remains.
- 18 existing focused tests passed: `live-workspace.test.mjs`,
  `liveAccountModel.test.mjs`, `liveLedgerModel.test.mjs`.
- Actual local preview 5180, API 8010, account-empty tenant-a; no fixtures or
  broker submission. Production dist was rebuilt for preview.
- CSV action measured 80px tall. Provider avatar 56x56 and symbol 36x36 have
  matching centers (10px inset on each side).
- Actual mouse hover on Back: background remains transparent; dark-theme text
  changes from rgb(184,192,201) to rgb(255,255,255).
- Server/login/sync help opens; Escape from the trigger and outside click close.
  Keyboard Enter -> Escape verified for login help. Independent source review
  found the original Escape gap; fixed and rechecked in browser.
- Platform select exposes only MetaTrader 5. Password eye toggles type using
  nonsecret dummy text, then the text was cleared. No credentials entered.
- Empty submit is blocked by native server validation; aria-busy remains false.
  Back and Cancel return to provider options.
- Dark/light desktop 1368x940 visually reviewed. At 1368x790 the sidebar scrolls
  independently to its actions. At 390x844 and 768x900 the panel stacks; document
  widths match viewport widths and footer stays below fields. All actions remain
  reachable. No captured browser console errors.

Screenshots: `after-options.jpg`, `after-connect-dark.jpg`,
`after-connect-light.jpg`, `after-connect-390.jpg`, `after-connect-768.jpg`.
UI verification does not claim broker authentication or collection acceptance.
