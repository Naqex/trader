# Project palette

Owner-approved neutral black/white surfaces and fresh orange actions apply to
every MT5 web workspace and application control. Keep the existing flat layout,
sizes and navigation. Dark surfaces use neutral grays rather than blue-black.

`foundation_v2/web/public/project-palette.css` is now a deterministic snapshot
of pinned `annam-compact@0.3.0`; edit the token source and regenerate, not this
snapshot. [compact-system.md](compact-system.md) owns the color tables
and state treatment. General controls
use neutral hover (owner rejected a muddy blue fill on 09/10/2026). Orange is the
primary action with dark text in both themes, blue is focus/information/progress,
green is success or gain, red is destructive or loss, and gold is warning. Keep
names and accessible state alongside color. Disabled controls use an explicit
readable gray, not opacity on the whole control.

## Report charts (outside the trading chart)

Report series deliberately have more color separation than chrome. These tokens
must not recolor trading candles, price levels or user drawings.

| Series | Token |
| --- | --- |
| Balance / main series | `--report-blue` |
| Activity / comparison | `--report-peach` |
| Gain / positive PnL | `--report-positive` |
| Loss / drawdown | `--report-negative` |
| Additional comparison | `--report-violet` |
| Additional comparison | `--report-gold` |

Use opaque line colors and clear column edges; existing columns may use restrained
shaded fills. Area fills stay low-opacity. Keep neutral gridlines,
axis labels, units and tooltips. Positive/negative text retains the project
financial roles; only plotted data uses the report variants. Violet and gold are
available for additional named comparison series (Dashboard symbol counts use violet), not assigned arbitrarily to
individual Monte Carlo paths. Labels and position remain necessary alongside color.

## Legacy trading chart

The iframe adapter `nativeChartPalette.js` mirrors the pinned canvas, surface,
grid, border, text and semantic colors because the separate document cannot read
parent CSS variables. Its candle and order-specific roles remain separate from
report colors. Header and rails use the neutral theme roles. Saved layouts
cannot restore obsolete faded colors. Mentor/Editor use readable blue accents,
with darker blue on white.

Entry marker frames and text have separate color roles: BUY uses a primary blue
frame, SELL an orange frame; both retain the adapter's orange text. The quantity
cell follows the frame tint, and the close button keeps its pale surface and blue
icon. The dashed BUY price line remains green; it does not determine the marker
frame. These chart-only conventions do not assign UI status colors.
