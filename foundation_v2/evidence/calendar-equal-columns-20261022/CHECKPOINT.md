# Equal Live Calendar columns — 2026-10-22

The calendar uses eight equal grid tracks, including Total. Week summaries keep
the daily cells' row height. Compact summary spacing and a non-wrapping week label
keep W1 readable at narrower desktop widths. Mobile retains horizontal calendar
scrolling without overflowing the page.

## Validation

- `npm run build`: passed after the final CSS changes. Existing large-chunk warning remains.
- Browser QA at local port 5180: 1920×940 dark, 1368×790 light, 390×844 dark.
- 1920: all eight columns 153.25px wide; row cells 102.59375px high.
- 1368: columns 87.875–87.890625px wide (subpixel rounding); row cells 73.5px high.
- 390: all columns 74.75px wide; row cells 128px high; calendar scroll width 640px,
  document width 390px.
- Screenshots and raw measurements are stored beside this checkpoint.
- Independent read-only review of the equal-track change found no blocker.
  The suggested long financial-value mobile fixture was not covered by this QA.

Presentation and UI contract only; no API, database, totals calculation or broker
behavior changes. Dark theme and normal viewport restored after QA.
