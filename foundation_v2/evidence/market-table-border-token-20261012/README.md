# Market Data border token alignment

Removed the custom 8% content/canvas color mix from data-row separators. Rows now
inherit the standard `--wm-border` color; the last-row bottom line uses that token
too. UI reference tables use `1px solid var(--wm-border)` in
`web/src/component-reference.css`. No data, layout or API behavior changed.

Eight GET-only browser checks passed: main/preview, dark/light, 1710px/390px.
Compared computed row/last-row colors directly with the rendered UI reference:
dark `rgb(61, 68, 76)`, light `rgb(210, 213, 218)`, 1px in both themes.
The single toolbar boundary and final-row line remain intact. No browser errors
or writes. Receipt: `browser.json`; visual captures: `market-*.png`.
Independent source/visual review: `/root/testing_empty_review`.
