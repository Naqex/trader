# Order marker refinement — 19 October 2026

Owner request: space out dashes, slim on-chart markers, center the negative PnL sign, make the BUY entry line white, and preserve the Save button foreground on hover.

- Replaced browser-controlled dashed borders with a 1px repeating gradient: 6px stroke, 6px gap.
- Desktop marker/body/close control height is 20px (previously 22px). Touch targets retain 32px.
- Labels expose a line color separately from their border: BUY uses the existing pale entry token (#F5F8FF dark / #E8EBEF light); SELL, SL and TP retain their border colors. Price-axis colors are unchanged. The existing overlay still positions lines from order prices and owns drag previews.
- Negative label amounts use a mathematical minus (U+2212) to align the sign with the digits. Only display strings change; values and order requests are unchanged.
- Save hover now explicitly uses `--project-on-action`, matching its normal state. Reproduced the prior CSS conflict: normal black foreground became white on hover; verified it stays black in dark mode and white in light mode. Background alone uses the action hover token.

Checks: production build passed; 6 overlay unit tests passed. Browser fixture verified 4 cases across BUY/SELL, VI/EN, dark/light and 390/768/1368 widths, with intercepted API writes. It checks line color/dash period, marker size, protection interactions, independent axis hover and Save foreground. The first fixture rerun failed on a desktop-only 20px assertion for a touch context; corrected the oracle to preserve the intended 32px touch size and all 4 cases passed in `verified/`.

Installed local UI/API smoke passed with all owner writes blocked (3 activity requests); no order or playback operations submitted. Reviewed installed BUY chart and hovered Save screenshot, SELL fixture and light-mode Save screenshot. Reloaded the owner's IAB chart to the new build. This is scoped UI verification, not full-product or broker acceptance. Fixture activity retry toasts are expected because persistence is blocked during QA.
