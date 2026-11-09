# Trade detail and note drawers — 2026-10-29

## Scope

Implemented the requested right-side panel shape for three places:

1. Notes: create/edit uses the existing `LiveRecordDialog` save contract, now as a right drawer.
2. Practice trade details: existing `TradeInspector`/`ProvenanceInspector` is a right drawer with Details, Tags and Notes tabs.
3. Live trade details: selected broker position/deal opens a right drawer with known broker fields, shared label control and a Notes CTA.

## Data boundaries

- Live detail is read-only and renders reconstructed broker-row values. Unknown values remain `-`/`N/A`.
- Live labels keep the existing catalog/session/ticket contract.
- Notes CTA does not write a live note with an invented trade identifier. The current live-note schema has no trade link; it opens the existing Notes surface instead.
- Existing Live note save behavior, expected revision, folder attachment and uncertain-result guard remain unchanged.

## Verification

- Vite production build: PASS; existing large-chunk warning only.
- Live Notes local journey on port 5180: drawer bounds `[920, 1440]` at 1440px viewport; form and real save controls rendered; no data submitted.
- Live trade local journey on port 5180: drawer bounds `[920, 1440]`; Details tab shows account, asset, side, entry/exit, prices, size, SL/TP and gross/fees/net PnL; close/Escape work.
- Practice trade local journey on port 5180: selected replay row opens drawer bounds `[920, 1440]`; tabs `Chi tiết / Nhãn / Ghi chú` render; screenshot inspected.
- Screenshots: `live-final-opaque2.png`, `note-final-opaque.png`, `practice.png` under `E:/BACKUP-TRADINGWORKSPACE/trade-note-panels-20261029`.
- Served UI promotion: `b06509a5bbbc5b823fa93b253e3263a49e62da543c3b5089f4c4118e8f2ba7d5`; rollback saved as `ui-before-final-2/index.html`.

This receipt covers UI structure and read-only presentation. It does not claim a finalized trade-linked note backend contract.
