# Partial TP allocation controls — 19 October 2026

The allocation total is now an equal-split button, including when its current
total is below or already at 100%. Three targets become 33/33/34; remainder points
go to the final targets. The action changes local draft percentages only and
preserves target IDs, prices, order quantity and server revision. Existing
quantity-step validation and native submission remain authoritative.

Removed redundant TP/lot headings. Each remove action sits beside its share
input, and 10/25/50% shortcuts center below the input. The Single profit action
brightens on hover without a border/background. The add button keeps the shared
orange action palette and stable contrasting text. Explicit role selectors fix
the generic dialog hover rule taking precedence. Shared close-button sizing is
retained, with 44px targets for coarse pointers.

Validation:

- Production `npm run build` passed; existing large-chunk advisory remains.
- `browser-final/browser.json`: three native/compact journeys passed, with no
  browser errors: BUY/1368/dark/VI, SELL/768/light/EN, BUY/390/dark/VI.
- Each journey checks totals 150, 77 and 100 becoming 33/33/34, unchanged target
  identity/prices/server revision, keyboard activation, hover colors, alignment,
  accepted target fills/accounting, reload and branch behavior.
- Reviewed desktop/light equal-split and mobile share-layout screenshots.
- Rebuilt and reloaded the actual preview at port 5180. Restored the owner's
  two-target draft and inspected `owner-compact-tp.png`; no order was submitted.
- Scoped diff whitespace check passed. Earlier failed layout attempts remain
  local investigation evidence and are not acceptance results.

No backend code or runtime restart was required. These checks prove the scoped
replay behavior, not broker execution or whole-product acceptance.
