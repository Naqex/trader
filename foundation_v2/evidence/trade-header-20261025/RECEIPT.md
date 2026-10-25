# Compact Trades header — 25/10/2026

- Removed two-line real/chart headings and the separate timezone strip; reused
  `columnLabel()` for one-line headings and the existing footer meta slot for
  the selected IANA timezone. Data, filtering, sorting and pagination state are unchanged.
- Scoped build: tracked HEAD `3647792` plus `FxTradeLedger.jsx` and `trade-labels.css`;
  retained the prior verified private CSS baseline, excluding unrelated WIP.
- Candidate and deployed UI: four real-data browser cases each at 1920 dark,
  1440 light, 390 dark/light, with Ho Chi Minh / UTC / New York zones. PASS:
  44px headers, full-cell sort hit areas, edge hover, keyboard sort, sticky header,
  footer fit, no document overflow or page errors. Independent source/visual review approved.
- Evidence/scripts/screenshots: `E:/BACKUP-TRADINGWORKSPACE/trade-header-20261025/`.
  Preview API GETs forwarded to the existing local service; event stream disabled
  in QA. Mutations, live/broker paths and external requests blocked. No broker acceptance.
- UI-only atomic promotion retained old assets and private branding; no API restart.
  Index SHA256: `0a3a2a7f6f9cde497a291a81d0c5fdf0c331ab36ea032b9a5141ff2c4efc5c1d`.
  Previous index retained in the evidence directory under `ui-before-release/`.
- First browser harness attempt failed while proxying the continuous event stream;
  aborting that unrelated stream fixed the harness. Both completed runs passed.
