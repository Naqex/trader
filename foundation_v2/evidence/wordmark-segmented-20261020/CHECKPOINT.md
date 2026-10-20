# WMREPLAY segmented wordmark — 20 October 2026

Owner rejected the diagonal stencil cuts and requested the cutting style of FX Replay.

Reference inspected in the actual FX Replay dashboard and its observed white SVG asset. The reference separates letter components (not random diagonal slashes): the E consists of three bars, R omits its left stem, P separates its upper bar from its lower stem; other letters remain connected. No external logo paths or assets were copied into the product.

The custom WMREPLAY SVG now uses detached R/E/P components with consistent stroke weight; W/M remain continuous and share geometry with the compact mark. The existing #wordmark and #wm IDs, currentColor, 242x30 full viewBox and 55x30 compact viewBox remain compatible with the shell. No app state or API contract changed.

Validation:
- npm run build: passed (existing >500 kB chunk warning remains).
- node --test tests/shellPreferences.test.mjs: 1/1 passed.
- git diff --check for the SVG: passed.
- Browser: full header rendered on dark/light; 132x16.36 CSS px at 1280 viewport.
- Browser responsive emulation: viewport 360, document scrollWidth 360; wordmark 70x8.67 CSS px, x59 y27.16. Both themes checked. Emulation reset and original dark theme restored.
- preview.png uses the same external SVG symbols as the product, enlarged and at header size. Full header screenshots are saved beside it; responsive sizing was verified through DOM metrics. Invalid blank screenshot crops from the browser clip API were discarded.

Scope limitation: dashboard data requests returned HTTP 500 during this check. Logo/theme/responsive validation does not establish API health or full product acceptance. API/runtime was not changed. Existing UI preview was unavailable; a local hidden Vite preview was started on 5180 for this work.
