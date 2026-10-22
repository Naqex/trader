# MetaTrader provider picker — 2026-10-22

Removed the redundant terminal/read-only helper below the provider picker.
The picker now shows the MetaTrader symbol in a 56px token-colored circle above
its name, with no info icon. The entire control is one native button. Hover
changes the circle and label; keyboard focus uses the shared focus token.
The existing provider state and connection form remain in place.

Asset provenance: MetaQuotes' official MetaTrader 5 site links this PNG:
https://www.metatrader5.com/i/metatrader-5-logo.png
Downloaded 2026-10-22 to `web/public/brand/metatrader-5.png` (175×47, 6,139 bytes).
The local PNG is unchanged; CSS displays its symbol at the left of the wordmark.
The mark belongs to MetaQuotes and identifies the supported platform.

Validation: production build passed. Actual route at 1368×790 was checked in
dark/light themes (`accounts-dark.png`, `accounts-light.png`). Clicking the
provider opens the existing MetaTrader form; Back returns to the picker. Tab
from Manual focuses the provider with a solid 2px outline. The asset loads and
the removed helper is absent. At 390px the document remains 390px wide. Demo
keeps the provider disabled. No credentials entered or broker requests submitted.

Independent read-only review identified an inherited global hover background;
the scoped hover rule now explicitly stays transparent around the circle/label.
Temporary tab closed, real-data mode/dark theme restored, viewport reset.
