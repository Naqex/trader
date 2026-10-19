# Partial-close layout correction — 19/10/2026

Owner-requested follow-up to marker-notices: default remaining-position close is
100%; remove Max and unsolicited sizing hint; show current size (with lot unit
for Forex) and realized PnL as two left-aligned label/value lines; add a full-width
divider above the footer. Uses existing palette, typography, spacing and controls.
PnL follows the selected locale and account currency. The dialog uses the same
overlay layer as Edit position so existing chart notifications cannot cover its
summary or footer on small screens. Invalid amounts still mark
the input invalid and disable Save; server rejection messages remain visible.
No execution, persistence, API or database changes. Opening the dialog never trades.

Validation: 5 focused sizing/copy tests, production build, and four existing
native-chart browser journeys (VI/EN, BUY/SELL, dark/light, 390/768/1368px) passed.
New browser assertions cover initial 100%/full amount, absent Max/hint, invalid
amount disabling Save, stacked/aligned summary and full-width footer border.
Partial rejection/retry, original/remaining basis and reload regressions passed.
Desktop screenshots reviewed. Installed smoke opened the owner's 0.01-lot position
dialog and verified default 100% and enabled Save, then dismissed without trading;
all API writes were blocked (practice activity only). See browser.json and
installed/installed-browser.json. The owner's actual tab was reloaded and left
with the new dialog open; no order was submitted.
