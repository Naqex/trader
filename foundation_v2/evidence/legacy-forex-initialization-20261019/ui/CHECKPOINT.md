# Quiet preset back action

Owner requested the preset editor's back action match the close icon. It now consumes the existing `wm-dialog-close` style; the local border/background/size duplication was removed. Navigation and draft state remain unchanged.

Production UI build PASS. Four preset journeys (Backtesting/Prop Firm × VI/EN) PASS with explicit comparison of back/close base styles, zero border, transparent hover, icon color change and restoration. Existing CRUD/error/reload and responsive checks also pass. Owner writes blocked; preset HTTP uses the existing in-memory fixture. `browser.json` records this scope; `new-preset.png` was visually reviewed.
