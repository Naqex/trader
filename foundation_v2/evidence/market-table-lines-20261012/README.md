# Market Data table line correction

The toolbar's separator and inherited table-wrapper top border formed two adjacent
lines. The wrapper now omits its top border; the toolbar owns that boundary. Last
row cells have the same quiet bottom separator as the lines between data rows.
Both main and preview use `data-library.css`; no data/API behavior changed.

Eight GET-only browser checks passed: main/preview, dark/light, 1537px/390px.
Verified a single 1px toolbar boundary, no wrapper top border, header alignment,
and a continuous 1px line across last-row cells. No browser errors or writes.
Receipt: `browser.json`; representative screenshots: `market-*.png`.
Independent source/visual review: `/root/testing_empty_review`.
